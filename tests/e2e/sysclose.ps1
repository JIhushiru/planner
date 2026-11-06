param([int]$ProcessId)
# Sends what the title-bar X button sends (WM_SYSCOMMAND / SC_CLOSE), not a bare WM_CLOSE.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class S { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }
"@
$h = (Get-Process -Id $ProcessId).MainWindowHandle
[S]::PostMessage($h, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null
Write-Output "posted SC_CLOSE to $h"
