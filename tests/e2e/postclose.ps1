param([int]$ProcessId, [ValidateSet('sc', 'wm')][string]$Kind)
# Posts a close request to Planner's (possibly hidden) main window:
#   sc = WM_SYSCOMMAND/SC_CLOSE, what the title-bar X sends (Planner hides to the tray)
#   wm = bare WM_CLOSE, what Task Manager's End task sends (Planner quits)
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class PlannerWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static List<IntPtr> Find(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) { var t = new StringBuilder(256); GetWindowText(h, t, 256); var c = new StringBuilder(256); GetClassName(h, c, 256);
        if (t.ToString().EndsWith("Planner") && c.ToString().StartsWith("WindowsForms")) r.Add(h); }
      return true; }, IntPtr.Zero);
    return r;
  }
}
"@
$wins = [PlannerWin]::Find([uint32]$ProcessId)
foreach ($w in $wins) {
  if ($Kind -eq 'sc') { [PlannerWin]::PostMessage($w, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null }
  else { [PlannerWin]::PostMessage($w, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
}
Write-Output "posted $Kind to $($wins.Count) window(s)"
