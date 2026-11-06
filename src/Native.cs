using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Planner;

/// <summary>Small Win32 helpers: foreground handling, taskbar flashing and title-bar colours.</summary>
static class Native
{
    public const int ASFW_ANY = -1;
    public const int WM_COMMAND = 0x0111;
    public const int THBN_CLICKED = 0x1800;

    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int RegisterWindowMessage(string lpString);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr hIcon);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    [StructLayout(LayoutKind.Sequential)]
    struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    const uint FLASHW_STOP = 0;
    const uint FLASHW_TRAY = 2;
    const uint FLASHW_TIMERNOFG = 12;

    public static bool IsForeground(IntPtr hwnd) => hwnd != IntPtr.Zero && GetForegroundWindow() == hwnd;

    public static void BringToFront(IntPtr hwnd)
    {
        if (hwnd != IntPtr.Zero) SetForegroundWindow(hwnd);
    }

    /// <summary>Flash the taskbar button until the window is activated.</summary>
    public static void Flash(IntPtr hwnd, bool stop = false)
    {
        if (hwnd == IntPtr.Zero) return;
        var info = new FLASHWINFO
        {
            cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(),
            hwnd = hwnd,
            dwFlags = stop ? FLASHW_STOP : FLASHW_TRAY | FLASHW_TIMERNOFG,
            uCount = stop ? 0u : 4u,
            dwTimeout = 0,
        };
        FlashWindowEx(ref info);
    }

    /// <summary>Dark title bar plus (Windows 11) a caption colour that blends into the app header.</summary>
    public static void StyleTitleBar(IntPtr hwnd, bool dark, Color? caption, Color? text)
    {
        if (hwnd == IntPtr.Zero) return;
        try
        {
            int on = dark ? 1 : 0;
            DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int));        // DWMWA_USE_IMMERSIVE_DARK_MODE
            if (caption is Color c)
            {
                int v = c.R | (c.G << 8) | (c.B << 16);
                DwmSetWindowAttribute(hwnd, 35, ref v, sizeof(int));     // DWMWA_CAPTION_COLOR
                DwmSetWindowAttribute(hwnd, 34, ref v, sizeof(int));     // DWMWA_BORDER_COLOR
            }
            if (text is Color t)
            {
                int v = t.R | (t.G << 8) | (t.B << 16);
                DwmSetWindowAttribute(hwnd, 36, ref v, sizeof(int));     // DWMWA_TEXT_COLOR
            }
        }
        catch
        {
            // Older Windows builds ignore these attributes.
        }
    }

    public static bool SystemPrefersDark()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch
        {
            return false;
        }
    }

    public static bool TaskbarIsLight()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("SystemUsesLightTheme") is int v && v == 1;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Draws a simple media glyph (play / pause / skip) as an icon for the taskbar thumbnail toolbar.</summary>
    public static Icon Glyph(string kind, int size, Color color)
    {
        using var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var brush = new SolidBrush(color);
            float s = size;
            switch (kind)
            {
                case "play":
                    g.FillPolygon(brush, new[] { new PointF(s * 0.27f, s * 0.16f), new PointF(s * 0.84f, s * 0.5f), new PointF(s * 0.27f, s * 0.84f) });
                    break;
                case "pause":
                    g.FillRectangle(brush, s * 0.22f, s * 0.17f, s * 0.2f, s * 0.66f);
                    g.FillRectangle(brush, s * 0.58f, s * 0.17f, s * 0.2f, s * 0.66f);
                    break;
                default: // skip
                    g.FillPolygon(brush, new[] { new PointF(s * 0.16f, s * 0.18f), new PointF(s * 0.66f, s * 0.5f), new PointF(s * 0.16f, s * 0.82f) });
                    g.FillRectangle(brush, s * 0.7f, s * 0.18f, s * 0.15f, s * 0.64f);
                    break;
            }
        }
        IntPtr h = bmp.GetHicon();
        using var tmp = Icon.FromHandle(h);
        var icon = (Icon)tmp.Clone();
        DestroyIcon(h);
        return icon;
    }
}

/// <summary>"Start with Windows" through the per-user Run key.</summary>
static class Autostart
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string ValueName = "Planner";

    static string ExePath => Environment.ProcessPath ?? Application.ExecutablePath;

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is string v && v.Contains(ExePath, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public static void Set(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (enabled) key.SetValue(ValueName, $"\"{ExePath}\" --minimized");
            else key.DeleteValue(ValueName, false);
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }
}

/// <summary>Taskbar button extras: a progress bar for the running timer and play/pause/skip thumbnail buttons.</summary>
sealed class Taskbar
{
    public enum State { None = 0, Indeterminate = 1, Normal = 2, Error = 4, Paused = 8 }

    readonly ITaskbarList3 _list;
    readonly IntPtr _hwnd;
    bool _buttonsAdded;
    Icon? _play, _pause, _skip;

    public Taskbar(IntPtr hwnd)
    {
        _hwnd = hwnd;
        _list = (ITaskbarList3)new CTaskbarList();
        _list.HrInit();
    }

    public void SetProgress(State state, double value)
    {
        try
        {
            _list.SetProgressState(_hwnd, state);
            if (state is State.Normal or State.Paused or State.Error)
                _list.SetProgressValue(_hwnd, (ulong)Math.Round(Math.Clamp(value, 0, 1) * 1000), 1000);
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    public void SetButtons(bool running, bool active)
    {
        try
        {
            int size = Math.Max(16, SystemInformation.SmallIconSize.Width);
            var color = Native.TaskbarIsLight() ? Color.FromArgb(30, 30, 36) : Color.White;
            _play ??= Native.Glyph("play", size, color);
            _pause ??= Native.Glyph("pause", size, color);
            _skip ??= Native.Glyph("skip", size, color);
            var buttons = new[]
            {
                new THUMBBUTTON
                {
                    dwMask = THB.Icon | THB.Tooltip | THB.Flags,
                    iId = 1,
                    hIcon = running ? _pause.Handle : _play.Handle,
                    szTip = running ? "Pause timer" : "Start timer",
                    dwFlags = THBF.Enabled,
                },
                new THUMBBUTTON
                {
                    dwMask = THB.Icon | THB.Tooltip | THB.Flags,
                    iId = 2,
                    hIcon = _skip.Handle,
                    szTip = "Skip to next",
                    dwFlags = active ? THBF.Enabled : THBF.Disabled,
                },
            };
            int hr = _buttonsAdded
                ? _list.ThumbBarUpdateButtons(_hwnd, (uint)buttons.Length, buttons)
                : _list.ThumbBarAddButtons(_hwnd, (uint)buttons.Length, buttons);
            if (hr >= 0) _buttonsAdded = true;
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    [Flags]
    enum THB : uint { Bitmap = 1, Icon = 2, Tooltip = 4, Flags = 8 }

    [Flags]
    enum THBF : uint { Enabled = 0, Disabled = 1, DismissOnClick = 2, NoBackground = 4, Hidden = 8, NonInteractive = 0x10 }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct THUMBBUTTON
    {
        public THB dwMask;
        public uint iId;
        public uint iBitmap;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szTip;
        public THBF dwFlags;
    }

    [ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ITaskbarList3
    {
        // ITaskbarList
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);
        // ITaskbarList2
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fFullscreen);
        // ITaskbarList3
        void SetProgressValue(IntPtr hwnd, ulong ullCompleted, ulong ullTotal);
        void SetProgressState(IntPtr hwnd, State tbpFlags);
        void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
        void UnregisterTab(IntPtr hwndTab);
        void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
        void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, uint dwReserved);
        [PreserveSig] int ThumbBarAddButtons(IntPtr hwnd, uint cButtons, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] THUMBBUTTON[] pButtons);
        [PreserveSig] int ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] THUMBBUTTON[] pButtons);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
        void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string pszDescription);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string pszTip);
        void SetThumbnailClip(IntPtr hwnd, IntPtr prcClip);
    }

    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090"), ClassInterface(ClassInterfaceType.None)]
    class CTaskbarList { }
}
