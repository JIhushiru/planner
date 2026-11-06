# Builds dist\Planner.exe: one small exe that runs on the installed .NET Desktop Runtime (8 or newer).
#   powershell -ExecutionPolicy Bypass -File build.ps1
# If Planner is running from dist, it is asked to quit cleanly first (Planner.exe --quit) and is
# restarted in the tray afterwards. Your data is saved after every change, so nothing is lost.
#   -Force   stop it the hard way if it does not quit within 10 seconds
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$exe = Join-Path $dist 'Planner.exe'

$running = @(Get-Process -Name Planner -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
$wasRunning = $running.Count -gt 0
$wasVisible = $wasRunning -and ($running | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }).Count -gt 0
if ($wasRunning) {
    Write-Host 'Planner is running; asking it to quit...'
    Start-Process -FilePath $exe -ArgumentList '--quit' -Wait
    foreach ($p in $running) {
        if (-not $p.WaitForExit(10000)) {
            if (-not $Force) {
                Write-Host 'Planner did not quit. Quit it from the tray icon (right-click, Quit Planner) or run build.ps1 -Force.' -ForegroundColor Yellow
                exit 1
            }
            Stop-Process -Id $p.Id -Force
        }
    }
    Start-Sleep -Milliseconds 300
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    node (Join-Path $root 'tests\logic.test.js')
    if ($LASTEXITCODE -ne 0) { throw 'Logic tests failed; not building.' }
}

if (Test-Path $dist) { Get-ChildItem $dist -File | Where-Object { $_.Name -ne 'Planner.exe' } | Remove-Item -Force }
dotnet publish (Join-Path $root 'Planner.csproj') -c Release -o $dist --nologo
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Get-ChildItem $dist -File | Where-Object { $_.Name -ne 'Planner.exe' } | Remove-Item -Force

$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "Built $exe ($size MB)" -ForegroundColor Green
if ($wasVisible) {
    Start-Process -FilePath $exe
    Write-Host 'Planner was open, so it has been reopened.'
} elseif ($wasRunning) {
    Start-Process -FilePath $exe -ArgumentList '--minimized'
    Write-Host 'Planner was running in the tray, so it has been restarted there.'
}
