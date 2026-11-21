@echo off
rem BearWall launcher: double-click to open the control page.
rem If local.json has a "projectorUrl" and the projector answers within 2 seconds, this window becomes BearWall Control:
rem the control page opens in its own window, and closing THIS window disconnects your laptop (the projector locks).
rem Otherwise it opens the prototype on this PC. Copy local.example.json to local.json and set your projector's address.
cd /d "%~dp0"
set "URL="
for /f "usebackq delims=" %%u in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$u=''; try { $u=(ConvertFrom-Json (Get-Content -Raw 'local.json' -ErrorAction Stop)).projectorUrl; $x=[uri]$u; $c=New-Object Net.Sockets.TcpClient; if (-not $c.ConnectAsync($x.Host,$x.Port).Wait(2000)) { $u='' }; $c.Close() } catch { $u='' }; $u"`) do set "URL=%%u"
if defined URL (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0BearWall-Control.ps1"
) else (
  echo No projector found. Opening the BearWall prototype on this PC.
  start "" "%~dp0prototype\index.html"
)
