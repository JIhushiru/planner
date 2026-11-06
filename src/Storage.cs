using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Planner;

/// <summary>
/// Owns everything Planner writes to disk: the data file (written atomically),
/// rolling daily backups and a small host-state file (window position, theme).
/// </summary>
sealed class Storage
{
    const int BackupsToKeep = 30;
    static readonly UTF8Encoding Utf8 = new(false);

    public Storage(string dir)
    {
        Dir = dir;
        Directory.CreateDirectory(Dir);
    }

    public string Dir { get; }
    public string DataFile => Path.Combine(Dir, "data.json");
    string HostFile => Path.Combine(Dir, "host.json");
    string BackupDir => Path.Combine(Dir, "backups");

    /// <summary>Returns the stored JSON (validated) or null on first run, plus a user-facing error if recovery happened.</summary>
    public (string? Json, string? Error) Load()
    {
        if (!File.Exists(DataFile)) return (null, null);
        try
        {
            string text = File.ReadAllText(DataFile, Encoding.UTF8);
            using (JsonDocument.Parse(text)) { }
            return (text, null);
        }
        catch (Exception ex)
        {
            Program.Log(ex);
            string keptAs = DataFile + $".unreadable-{DateTime.Now:yyyyMMdd-HHmmss}";
            try { File.Copy(DataFile, keptAs, true); } catch { /* best effort */ }
            string? backup = NewestValidBackup();
            string msg = $"Your data file could not be read, so a copy was kept as {Path.GetFileName(keptAs)}.";
            msg += backup != null ? " The most recent backup was restored." : " Planner started empty.";
            return (backup, msg);
        }
    }

    public bool Save(string json, out string? error)
    {
        try
        {
            using (JsonDocument.Parse(json)) { }
            string tmp = DataFile + ".tmp";
            File.WriteAllText(tmp, json, Utf8);
            File.Move(tmp, DataFile, overwrite: true);
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            Program.Log(ex);
            error = ex.Message;
            return false;
        }
    }

    /// <summary>Keeps one copy of the data file per day (the first save of that day wins).</summary>
    public void DailyBackup()
    {
        try
        {
            if (!File.Exists(DataFile)) return;
            Directory.CreateDirectory(BackupDir);
            string target = Path.Combine(BackupDir, $"data-{DateTime.Now:yyyy-MM-dd}.json");
            if (!File.Exists(target)) File.Copy(DataFile, target);
            Prune();
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    public void Snapshot(string tag)
    {
        try
        {
            if (!File.Exists(DataFile)) return;
            Directory.CreateDirectory(BackupDir);
            File.Copy(DataFile, Path.Combine(BackupDir, $"data-{DateTime.Now:yyyy-MM-dd-HHmmss}-{tag}.json"), true);
            Prune();
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    void Prune()
    {
        var old = new DirectoryInfo(BackupDir).GetFiles("data-*.json")
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Skip(BackupsToKeep);
        foreach (var f in old)
        {
            try { f.Delete(); } catch { /* ignore */ }
        }
    }

    string? NewestValidBackup()
    {
        try
        {
            if (!Directory.Exists(BackupDir)) return null;
            foreach (var f in new DirectoryInfo(BackupDir).GetFiles("data-*.json").OrderByDescending(f => f.LastWriteTimeUtc))
            {
                try
                {
                    string text = File.ReadAllText(f.FullName, Encoding.UTF8);
                    using (JsonDocument.Parse(text)) { }
                    return text;
                }
                catch { /* try the next one */ }
            }
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
        return null;
    }

    public JsonObject ReadHostState()
    {
        try
        {
            if (File.Exists(HostFile) && JsonNode.Parse(File.ReadAllText(HostFile)) is JsonObject o) return o;
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
        return new JsonObject();
    }

    public void WriteHostState(JsonObject state)
    {
        try
        {
            File.WriteAllText(HostFile, state.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), Utf8);
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }
}
