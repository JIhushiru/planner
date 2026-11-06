using System.Security.Cryptography;
using System.Text;

namespace Planner;

static class Program
{
    /// <summary>Folder holding data.json, host.json and backups.</summary>
    public static string DataDir { get; private set; } = "";
    /// <summary>WebView2 browser profile folder.</summary>
    public static string WebViewDir { get; private set; } = "";
    /// <summary>Optional folder to serve the UI from instead of the embedded copy (development only).</summary>
    public static string? WebDir { get; private set; }
    /// <summary>Optional Chrome DevTools Protocol port (testing only).</summary>
    public static int? DebugPort { get; private set; }
    public static bool StartHidden { get; private set; }

    [STAThread]
    static void Main(string[] args)
    {
        string? overrideDir = Environment.GetEnvironmentVariable("PLANNER_DATA_DIR");
        bool isolated = !string.IsNullOrWhiteSpace(overrideDir);
        DataDir = isolated
            ? Path.GetFullPath(overrideDir!)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Planner");
        WebViewDir = isolated
            ? Path.Combine(DataDir, "WebView2")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Planner", "WebView2");
        string? webDir = Environment.GetEnvironmentVariable("PLANNER_WEB_DIR");
        if (!string.IsNullOrWhiteSpace(webDir) && Directory.Exists(webDir)) WebDir = Path.GetFullPath(webDir);
        if (int.TryParse(Environment.GetEnvironmentVariable("PLANNER_DEBUG_PORT"), out int port)) DebugPort = port;
        StartHidden = args.Any(a => a.Equals("--minimized", StringComparison.OrdinalIgnoreCase)
                                 || a.Equals("--tray", StringComparison.OrdinalIgnoreCase));
        bool quitRequest = args.Any(a => a.Equals("--quit", StringComparison.OrdinalIgnoreCase));

        // One running copy per data folder. A second launch (e.g. clicking the pinned
        // taskbar icon while Planner sits in the tray) just brings the first one forward.
        // "Planner.exe --quit" asks the running copy to quit cleanly (used by build.ps1).
        string instanceId = InstanceId(DataDir);
        using var mutex = new Mutex(true, $"Local\\Planner-{instanceId}", out bool isFirst);
        if (quitRequest)
        {
            if (!isFirst) SignalFirstInstance(instanceId, "quit");
            return;
        }
        if (!isFirst)
        {
            SignalFirstInstance(instanceId, "show");
            return;
        }

        Directory.CreateDirectory(DataDir);
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log(e.ExceptionObject as Exception);

        var context = new ApplicationContext();
        var form = new MainForm(instanceId, context);
        form.Start();
        Application.Run(context);
        GC.KeepAlive(mutex);
    }

    static string InstanceId(string dir)
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(dir.TrimEnd('\\', '/').ToLowerInvariant()));
        return Convert.ToHexString(hash, 0, 6);
    }

    static void SignalFirstInstance(string instanceId, string signal)
    {
        try
        {
            if (signal == "show") Native.AllowSetForegroundWindow(Native.ASFW_ANY);
            using var ev = EventWaitHandle.OpenExisting($"Local\\Planner-{instanceId}-{signal}");
            ev.Set();
        }
        catch
        {
            // The first copy is still starting up; it will show itself anyway.
        }
    }

    public static void Log(Exception? ex)
    {
        if (ex == null) return;
        try
        {
            File.AppendAllText(Path.Combine(DataDir, "error.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {ex}\r\n\r\n");
        }
        catch
        {
            // Logging must never take the app down.
        }
    }
}
