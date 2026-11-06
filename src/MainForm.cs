using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Planner;

/// <summary>
/// The Planner window. Hosts the HTML UI in WebView2 and provides what a web page cannot do on
/// its own: saving to disk, reliable alarms while hidden, Windows notifications, the tray icon,
/// taskbar progress / thumbnail buttons, title-bar colours and "start with Windows".
/// </summary>
sealed class MainForm : Form
{
    const string AppHost = "planner.example";
    const int WM_SYSCOMMAND = 0x0112;
    const int SC_CLOSE = 0xF060;
    static readonly string AppOrigin = $"https://{AppHost}";

    sealed record Alarm(string Key, long At, string Title, string Body, string Sound, double Volume, bool Notify, bool IsTimer);

    readonly string _instanceId;
    readonly ApplicationContext _context;
    readonly Storage _storage;
    readonly WebView2 _web;
    readonly NotifyIcon _tray;
    readonly ToolStripMenuItem _trayTimerItem;
    readonly System.Windows.Forms.Timer _clock;
    readonly Dictionary<string, Alarm> _timers = new();
    readonly HashSet<string> _firedReminders = new();
    readonly Dictionary<string, byte[]> _assets = new(StringComparer.OrdinalIgnoreCase);
    readonly int _taskbarCreatedMsg;
    readonly JsonObject _hostState;
    List<Alarm> _reminders = new();
    CoreWebView2Environment? _env;
    Taskbar? _taskbar;
    Taskbar.State _progressState = Taskbar.State.None;
    double _progressValue;
    bool _timerRunning, _timerActive;
    bool _quitting;
    bool _closeToTray = true;
    FormWindowState _restoreState = FormWindowState.Normal;
    string _backupDay = "";
    long _lastHousekeeping;

    public MainForm(string instanceId, ApplicationContext context)
    {
        _instanceId = instanceId;
        _context = context;
        _storage = new Storage(Program.DataDir);
        _hostState = _storage.ReadHostState();
        _taskbarCreatedMsg = Native.RegisterWindowMessage("TaskbarButtonCreated");
        LoadAssets();

        Text = "Planner";
        Icon = LoadIcon(32);
        StartPosition = FormStartPosition.Manual;
        Color bg = ParseColor(_hostState["bg"]?.GetValue<string>()) ?? (Native.SystemPrefersDark() ? Color.Black : Color.White);
        BackColor = bg;

        _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = bg };
        Controls.Add(_web);

        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("Open Planner", null, (_, _) => ShowFromTray());
        open.Font = new Font(menu.Font, FontStyle.Bold);
        _trayTimerItem = new ToolStripMenuItem("Start focus timer", null, (_, _) => Post(new { type = "pomo", action = "toggle" }));
        var newEvent = new ToolStripMenuItem("New event…", null, (_, _) => { ShowFromTray(); Post(new { type = "newEvent" }); });
        var quit = new ToolStripMenuItem("Quit Planner", null, (_, _) => Quit());
        menu.Items.AddRange(new ToolStripItem[] { open, _trayTimerItem, newEvent, new ToolStripSeparator(), quit });

        _tray = new NotifyIcon
        {
            Icon = LoadIcon(Math.Max(16, SystemInformation.SmallIconSize.Width)),
            Text = "Planner",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ShowFromTray(); };
        _tray.BalloonTipClicked += (_, _) => ShowFromTray();

        _clock = new System.Windows.Forms.Timer { Interval = 250 };
        _clock.Tick += (_, _) => OnClock();
    }

    // ───────────────────────────── startup ─────────────────────────────

    public void Start()
    {
        RestoreWindowState();
        StartShowListener();
        _storage.DailyBackup();
        _backupDay = DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (Program.StartHidden)
            _ = Handle; // create the window without showing it, so the UI (timers, reminders) still loads
        else
            Show();
        _clock.Start();
        _ = InitWebAsync();
    }

    async Task InitWebAsync()
    {
        try
        {
            // Keep JS timers running at full speed while the window is hidden in the tray.
            string args = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";
            if (Program.DebugPort is int port) args += $" --remote-debugging-port={port}";
            _env = await CoreWebView2Environment.CreateAsync(null, Program.WebViewDir, new CoreWebView2EnvironmentOptions(args));
            await _web.EnsureCoreWebView2Async(_env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show("Planner needs the Microsoft Edge WebView2 Runtime, which is missing on this PC.\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start Planner again.",
                "Planner", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Quit();
            return;
        }
        catch (Exception ex)
        {
            Program.Log(ex);
            MessageBox.Show("Planner could not start its window:\n\n" + ex.Message, "Planner", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Quit();
            return;
        }

        var core = _web.CoreWebView2;
        bool debug = Program.DebugPort != null;
        var s = core.Settings;
        s.AreDevToolsEnabled = debug;
        s.AreBrowserAcceleratorKeysEnabled = debug; // no reload / print / find in normal use
        s.IsZoomControlEnabled = false;             // Ctrl+wheel is used by the timeline zoom
        s.IsPinchZoomEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsSwipeNavigationEnabled = false;

        core.ContextMenuRequested += OnContextMenu;
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(AppOrigin + "/", StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                OpenExternal(e.Uri);
            }
        };
        core.ProcessFailed += (_, e) =>
        {
            Program.Log(new Exception($"WebView2 process failed: {e.ProcessFailedKind}"));
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                BeginInvoke(() => { try { _web.CoreWebView2?.Reload(); } catch { /* ignore */ } });
        };
        core.WebMessageReceived += OnWebMessage;
        core.AddWebResourceRequestedFilter($"{AppOrigin}/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnResource;
        core.Navigate($"{AppOrigin}/index.html");
    }

    void LoadAssets()
    {
        var asm = Assembly.GetExecutingAssembly();
        foreach (string name in asm.GetManifestResourceNames())
        {
            string key = name.Replace('\\', '/');
            if (!key.StartsWith("web/", StringComparison.OrdinalIgnoreCase)) continue;
            using var stream = asm.GetManifestResourceStream(name);
            if (stream == null) continue;
            using var ms = new MemoryStream();
            stream.CopyTo(ms);
            _assets[key] = ms.ToArray();
        }
    }

    static Icon? LoadIcon(int size)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("planner.ico");
        return stream == null ? null : new Icon(stream, size, size);
    }

    /// <summary>Listens for a second launch ("show me") and for "Planner.exe --quit".</summary>
    void StartShowListener()
    {
        var show = new EventWaitHandle(false, EventResetMode.AutoReset, $"Local\\Planner-{_instanceId}-show");
        var quit = new EventWaitHandle(false, EventResetMode.AutoReset, $"Local\\Planner-{_instanceId}-quit");
        var thread = new Thread(() =>
        {
            var handles = new WaitHandle[] { show, quit };
            while (true)
            {
                int which = WaitHandle.WaitAny(handles);
                try
                {
                    if (which == 0) BeginInvoke(ShowFromTray);
                    else BeginInvoke(Quit);
                }
                catch { /* window not ready yet */ }
            }
        })
        { IsBackground = true, Name = "Planner signal listener" };
        thread.Start();
    }

    // ───────────────────────────── serving the UI ─────────────────────────────

    void OnResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            var uri = new Uri(e.Request.Uri);
            string path = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
            if (path.Length == 0) path = "index.html";

            if (path == "api/boot")
            {
                e.Response = Respond(Encoding.UTF8.GetBytes(BootJson()), "application/json; charset=utf-8");
                return;
            }

            byte[]? bytes = null;
            if (Program.WebDir != null)
            {
                string full = Path.GetFullPath(Path.Combine(Program.WebDir, path));
                if (full.StartsWith(Program.WebDir, StringComparison.OrdinalIgnoreCase) && File.Exists(full)) bytes = File.ReadAllBytes(full);
            }
            else
            {
                _assets.TryGetValue("web/" + path, out bytes);
            }
            // Personal content (*.local.js) is gitignored, so a fresh copy has none: serve it empty.
            if (bytes == null && path.EndsWith(".local.js", StringComparison.OrdinalIgnoreCase)) bytes = Array.Empty<byte>();

            e.Response = bytes != null
                ? Respond(bytes, MimeFor(path))
                : _env!.CreateWebResourceResponse(null, 404, "Not Found", "");
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    CoreWebView2WebResourceResponse Respond(byte[] bytes, string mime) =>
        _env!.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK", $"Content-Type: {mime}\r\nCache-Control: no-store");

    static string MimeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        _ => "application/octet-stream",
    };

    string BootJson()
    {
        var (data, error) = _storage.Load();
        var sb = new StringBuilder();
        sb.Append("{\"data\":").Append(data ?? "null");
        sb.Append(",\"loadError\":").Append(JsonSerializer.Serialize(error));
        sb.Append(",\"autostart\":").Append(Autostart.IsEnabled() ? "true" : "false");
        sb.Append(",\"version\":").Append(JsonSerializer.Serialize(Application.ProductVersion.Split('+')[0]));
        sb.Append(",\"dataPath\":").Append(JsonSerializer.Serialize(_storage.DataFile));
        sb.Append(",\"systemDark\":").Append(Native.SystemPrefersDark() ? "true" : "false");
        sb.Append(",\"startHidden\":").Append(Program.StartHidden ? "true" : "false");
        sb.Append('}');
        return sb.ToString();
    }

    // ───────────────────────────── messages from the page ─────────────────────────────

    void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var m = doc.RootElement;
            switch (Str(m, "type"))
            {
                case "save":
                    if (!_storage.Save(Str(m, "json"), out string? err))
                        Post(new { type = "saveError", error = err });
                    break;
                case "timer":
                {
                    string token = Str(m, "token");
                    if (token.Length == 0) break;
                    _timers[token] = new Alarm(token, Long(m, "at"), Str(m, "title"), Str(m, "body"), Str(m, "sound"), Num(m, "volume", 0.7), Bool(m, "notify", true), true);
                    break;
                }
                case "timerCancel":
                {
                    string token = Str(m, "token");
                    if (token == "*") _timers.Clear(); else _timers.Remove(token);
                    break;
                }
                case "reminders":
                {
                    var list = new List<Alarm>();
                    if (m.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
                        foreach (var it in items.EnumerateArray())
                            list.Add(new Alarm(Str(it, "key"), Long(it, "at"), Str(it, "title"), Str(it, "body"), Str(it, "sound"), Num(it, "volume", 0.7), true, false));
                    _reminders = list;
                    break;
                }
                case "notify":
                    Notify(Str(m, "title"), Str(m, "body"));
                    break;
                case "chime":
                    Chime.Play(Str(m, "sound"), Num(m, "volume", 0.7));
                    break;
                case "status":
                    ApplyStatus(m);
                    break;
                case "theme":
                    ApplyTheme(Bool(m, "dark", false), Str(m, "bg"), Str(m, "caption"), Str(m, "text"));
                    break;
                case "hostSettings":
                    _closeToTray = Bool(m, "closeToTray", true);
                    break;
                case "setAutostart":
                    Autostart.Set(Bool(m, "enabled", false));
                    Post(new { type = "autostart", enabled = Autostart.IsEnabled() });
                    break;
                case "zoom":
                    _web.ZoomFactor = Math.Clamp(Num(m, "factor", 1.0), 0.5, 2.0);
                    break;
                case "openUrl":
                    OpenExternal(Str(m, "url"));
                    break;
                case "openDataFolder":
                    Process.Start(new ProcessStartInfo("explorer.exe", $"\"{Program.DataDir}\"") { UseShellExecute = true });
                    break;
                case "exportData":
                    BeginInvoke(ExportData);
                    break;
                case "importData":
                    BeginInvoke(ImportData);
                    break;
                case "snapshot":
                    _storage.Snapshot(Str(m, "tag", "manual"));
                    break;
                case "show":
                    ShowFromTray();
                    break;
                case "quit":
                    BeginInvoke(Quit);
                    break;
            }
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    void Post(object message)
    {
        try
        {
            _web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message));
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    static string Str(JsonElement m, string name, string fallback = "") =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? fallback : fallback;

    static double Num(JsonElement m, string name, double fallback) =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : fallback;

    static long Long(JsonElement m, string name) =>
        m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? (long)v.GetDouble() : 0;

    static bool Bool(JsonElement m, string name, bool fallback) =>
        m.TryGetProperty(name, out var v) ? v.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => fallback } : fallback;

    // ───────────────────────────── alarms and notifications ─────────────────────────────

    void OnClock()
    {
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        if (_timers.Count > 0)
        {
            foreach (var t in _timers.Values.Where(t => t.At <= now).ToList())
            {
                _timers.Remove(t.Key);
                Fire(t);
                Post(new { type = "timerFired", token = t.Key });
            }
        }

        if (_reminders.Count > 0)
        {
            foreach (var r in _reminders.Where(r => r.At <= now && !_firedReminders.Contains(r.Key)).ToList())
            {
                _firedReminders.Add(r.Key);
                // Skip reminders that went stale while the PC was asleep.
                if (now - r.At <= 5 * 60_000)
                {
                    Fire(r);
                    Post(new { type = "reminderFired", key = r.Key, title = r.Title, body = r.Body });
                }
            }
        }

        if (now - _lastHousekeeping > 30_000)
        {
            _lastHousekeeping = now;
            string today = DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (today != _backupDay)
            {
                _backupDay = today;
                _storage.DailyBackup();
            }
        }
    }

    bool IsInFront => Visible && WindowState != FormWindowState.Minimized && Native.IsForeground(Handle);

    void Fire(Alarm a)
    {
        bool front = IsInFront;
        if (a.Sound.Length > 0 && a.Sound != "none") Chime.Play(a.Sound, a.Volume);
        // When Planner is in front, the page itself shows what happened; no need for a toast.
        if (a.Notify && !(a.IsTimer && front)) Notify(a.Title, a.Body);
        if (!front && Visible) Native.Flash(Handle);
    }

    void Notify(string title, string body)
    {
        try
        {
            _tray.BalloonTipIcon = ToolTipIcon.None;
            _tray.BalloonTipTitle = Truncate(string.IsNullOrWhiteSpace(title) ? "Planner" : title, 63);
            _tray.BalloonTipText = Truncate(string.IsNullOrWhiteSpace(body) ? " " : body, 255);
            _tray.ShowBalloonTip(10_000);
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    void ApplyStatus(JsonElement m)
    {
        string title = Str(m, "title");
        Text = title.Length == 0 ? "Planner" : $"{title} · Planner";
        string tip = Str(m, "tooltip");
        _tray.Text = Truncate(tip.Length == 0 ? "Planner" : tip, 127);

        bool running = Bool(m, "running", false), active = Bool(m, "active", false);
        _trayTimerItem.Text = Str(m, "menuLabel", running ? "Pause timer" : "Start focus timer");
        _progressState = Str(m, "state") switch
        {
            "normal" => Taskbar.State.Normal,
            "paused" => Taskbar.State.Paused,
            _ => Taskbar.State.None,
        };
        _progressValue = Num(m, "value", 0);
        _taskbar?.SetProgress(_progressState, _progressValue);
        if (running != _timerRunning || active != _timerActive)
        {
            _timerRunning = running;
            _timerActive = active;
            _taskbar?.SetButtons(running, active);
        }
    }

    static string Truncate(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";

    // ───────────────────────────── window and theme ─────────────────────────────

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        float scale = DeviceDpi / 96f;
        MinimumSize = new Size((int)(720 * scale), (int)(500 * scale));
        bool dark = _hostState["dark"]?.GetValue<bool>() ?? Native.SystemPrefersDark();
        Native.StyleTitleBar(Handle, dark, ParseColor(_hostState["caption"]?.GetValue<string>()), ParseColor(_hostState["text"]?.GetValue<string>()));
    }

    protected override void WndProc(ref Message m)
    {
        // The title-bar X, Alt+F4 and the taskbar's "Close window" send SC_CLOSE: hide to the tray here,
        // so a plain WM_CLOSE from outside (Task Manager, an updater) still really closes the app.
        if (m.Msg == WM_SYSCOMMAND && (m.WParam.ToInt64() & 0xFFF0) == SC_CLOSE && _closeToTray && !_quitting)
        {
            HideToTray();
            return;
        }
        if (_taskbarCreatedMsg != 0 && m.Msg == _taskbarCreatedMsg)
        {
            try
            {
                _taskbar = new Taskbar(Handle);
                _taskbar.SetButtons(_timerRunning, _timerActive);
                _taskbar.SetProgress(_progressState, _progressValue);
            }
            catch (Exception ex)
            {
                Program.Log(ex);
                _taskbar = null;
            }
        }
        else if (m.Msg == Native.WM_COMMAND && ((m.WParam.ToInt64() >> 16) & 0xFFFF) == Native.THBN_CLICKED)
        {
            int id = (int)(m.WParam.ToInt64() & 0xFFFF);
            Post(new { type = "pomo", action = id == 1 ? "toggle" : "skip" });
        }
        base.WndProc(ref m);
    }

    void ApplyTheme(bool dark, string bg, string caption, string text)
    {
        Color background = ParseColor(bg) ?? (dark ? Color.Black : Color.White);
        BackColor = background;
        _web.DefaultBackgroundColor = background;
        Native.StyleTitleBar(Handle, dark, ParseColor(caption), ParseColor(text));

        string bgHex = ToHex(background);
        if (_hostState["bg"]?.GetValue<string>() != bgHex || _hostState["caption"]?.GetValue<string>() != caption
            || _hostState["text"]?.GetValue<string>() != text || (_hostState["dark"]?.GetValue<bool>() ?? !dark) != dark)
        {
            _hostState["bg"] = bgHex;
            _hostState["caption"] = caption;
            _hostState["text"] = text;
            _hostState["dark"] = dark;
            _storage.WriteHostState(_hostState);
        }
    }

    static Color? ParseColor(string? hex)
    {
        if (string.IsNullOrWhiteSpace(hex)) return null;
        hex = hex.Trim().TrimStart('#');
        if (hex.Length == 6 && int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int v))
            return Color.FromArgb(255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
        return null;
    }

    static string ToHex(Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";

    void RestoreWindowState()
    {
        Rectangle? saved = null;
        try
        {
            if (_hostState["bounds"] is JsonArray a && a.Count == 4)
                saved = new Rectangle((int)a[0]!, (int)a[1]!, (int)a[2]!, (int)a[3]!);
        }
        catch { /* ignore a malformed file */ }

        if (saved is Rectangle r && r.Width >= 480 && r.Height >= 360 && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)))
        {
            Bounds = r;
        }
        else
        {
            var wa = (Screen.PrimaryScreen ?? Screen.AllScreens[0]).WorkingArea;
            float scale = DeviceDpi / 96f;
            int w = (int)Math.Min(wa.Width * 0.9, 1440 * scale);
            int h = (int)Math.Min(wa.Height * 0.9, 900 * scale);
            Bounds = new Rectangle(wa.X + (wa.Width - w) / 2, wa.Y + (wa.Height - h) / 2, w, h);
        }
        if (_hostState["maximized"]?.GetValue<bool>() == true) WindowState = FormWindowState.Maximized;
        _restoreState = WindowState;
    }

    void SaveWindowState()
    {
        try
        {
            Rectangle b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            if (b.Width < 200 || b.Height < 150) return;
            _hostState["bounds"] = new JsonArray(b.X, b.Y, b.Width, b.Height);
            _hostState["maximized"] = WindowState == FormWindowState.Maximized
                || (WindowState == FormWindowState.Minimized && _restoreState == FormWindowState.Maximized);
            _storage.WriteHostState(_hostState);
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (WindowState != FormWindowState.Minimized) _restoreState = WindowState;
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e);
        SaveWindowState();
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        Native.Flash(Handle, stop: true);
    }

    void ShowFromTray()
    {
        if (_quitting) return;
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = _restoreState;
        Activate();
        Native.BringToFront(Handle);
        Post(new { type = "shown" });
    }

    void HideToTray()
    {
        SaveWindowState();
        Hide();
        if (_hostState["trayHintShown"]?.GetValue<bool>() != true)
        {
            Notify("Planner is still running", "Timers and reminders keep working. Click the tray icon to open Planner, or right-click it to quit.");
            _hostState["trayHintShown"] = true;
            _storage.WriteHostState(_hostState);
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        SaveWindowState();
        if (!_quitting && _closeToTray && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            HideToTray();
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _tray.Visible = false;
        _tray.Dispose();
        base.OnFormClosed(e);
        _context.ExitThread();
    }

    void Quit()
    {
        if (_quitting) return;
        _quitting = true;
        SaveWindowState();
        _clock.Stop();
        _tray.Visible = false;
        try { Close(); } catch { /* already gone */ }
        _context.ExitThread();
    }

    // ───────────────────────────── misc ─────────────────────────────

    void OnContextMenu(object? sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        if (Program.DebugPort != null) return;
        var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "undo", "redo", "emoji" };
        var items = e.MenuItems;
        for (int i = items.Count - 1; i >= 0; i--)
        {
            var item = items[i];
            if (item.Kind == CoreWebView2ContextMenuItemKind.Separator) continue;
            if (!keep.Contains(item.Name) && !item.Name.Contains("spell", StringComparison.OrdinalIgnoreCase)) items.RemoveAt(i);
        }
        // Tidy separators left at the edges or doubled up.
        for (int i = items.Count - 1; i >= 0; i--)
        {
            bool sep = items[i].Kind == CoreWebView2ContextMenuItemKind.Separator;
            bool edge = i == 0 || i == items.Count - 1;
            bool doubled = i > 0 && items[i - 1].Kind == CoreWebView2ContextMenuItemKind.Separator;
            if (sep && (edge || doubled)) items.RemoveAt(i);
        }
        if (items.Count == 0) e.Handled = true;
    }

    static void OpenExternal(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeMailto)) return;
        if (u.Host.Equals(AppHost, StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    void ExportData()
    {
        using var dlg = new SaveFileDialog
        {
            Title = "Export a Planner backup",
            Filter = "Planner backup (*.json)|*.json",
            FileName = $"planner-backup-{DateTime.Now:yyyy-MM-dd}.json",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            File.Copy(_storage.DataFile, dlg.FileName, true);
            Post(new { type = "toast", text = $"Backup saved as {Path.GetFileName(dlg.FileName)}" });
        }
        catch (Exception ex)
        {
            Post(new { type = "toast", text = "Export failed: " + ex.Message });
        }
    }

    void ImportData()
    {
        using var dlg = new OpenFileDialog
        {
            Title = "Import a Planner backup",
            Filter = "Planner backup (*.json)|*.json|All files (*.*)|*.*",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            string text = File.ReadAllText(dlg.FileName, Encoding.UTF8);
            using (JsonDocument.Parse(text)) { }
            Post(new { type = "importData", json = text, name = Path.GetFileName(dlg.FileName) });
        }
        catch (Exception ex)
        {
            Post(new { type = "toast", text = "That file is not a Planner backup: " + ex.Message });
        }
    }
}
