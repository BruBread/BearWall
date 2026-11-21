# BearWall Control: while this window is open, this laptop can control the projector. Close it to disconnect.
# - Opens the control page in its own Edge window (a separate profile, not your normal browser).
# - Every 5 s tells the projector "still here" with the paired key; the projector only accepts control while it hears it.
# - Closing this window closes the control window too (Windows job object), and the projector locks within 15 s.
#   Closing the control window ends this panel and locks the projector right away.
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'BearWall Control'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content -Raw (Join-Path $root 'local.json') | ConvertFrom-Json
$base = ($cfg.projectorUrl -replace '/control/?$', '').TrimEnd('/')
$key = $cfg.projectorKey

# Kill-on-close job: everything put in it dies when this window's process ends, however it ends.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BearWallJob {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, uint l);
  [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  public static IntPtr KillOnClose() {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    int size = IntPtr.Size == 8 ? 144 : 112;                 // JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    IntPtr info = Marshal.AllocHGlobal(size);
    for (int i = 0; i < size; i++) Marshal.WriteByte(info, i, 0);
    Marshal.WriteInt32(info, IntPtr.Size == 8 ? 16 : 16, 0x2000);   // LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    SetInformationJobObject(j, 9, info, (uint)size);          // JobObjectExtendedLimitInformation
    Marshal.FreeHGlobal(info);
    return j;
  }
}
"@

function Send-Hello {
  try { Invoke-RestMethod -Method Post -Uri "$base/api/hello" -Headers @{ 'X-Key' = $key } -TimeoutSec 4 | Out-Null; return $true } catch { return $false }
}

Write-Host ''
Write-Host '  BearWall Control' -ForegroundColor Magenta
Write-Host "  Projector: $base"
if (-not $key) { Write-Host '  No projectorKey in local.json: this laptop is not paired.' -ForegroundColor Red; Read-Host '  Press Enter to close'; exit 1 }
if (-not (Send-Hello)) {
  Write-Host "  Can't reach the projector (or the key was refused). Is it on, and on the same Wi-Fi?" -ForegroundColor Red
  Read-Host '  Press Enter to close'; exit 1
}

$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
$prof = Join-Path $env:LOCALAPPDATA 'BearWall\control-window'
$job = [BearWallJob]::KillOnClose()
$p = Start-Process -FilePath $edge -PassThru -ArgumentList @("--app=$base/control", "--user-data-dir=`"$prof`"", '--no-first-run', '--no-default-browser-check', '--window-size=1500,1000')
[BearWallJob]::AssignProcessToJobObject($job, $p.Handle) | Out-Null

Write-Host '  The control page is open in its own window.'
Write-Host '  Close this window to disconnect.' -ForegroundColor Yellow
Write-Host ''
while (-not $p.HasExited) {
  $ok = Send-Hello
  $state = if ($ok) { 'connected   ' } else { 'reconnecting' }
  Write-Host ("`r  [{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $state) -NoNewline
  Start-Sleep -Seconds 5
}
try { Invoke-RestMethod -Method Post -Uri "$base/api/bye" -TimeoutSec 3 | Out-Null } catch { }   # control window closed: lock now
Write-Host "`n  Disconnected."
