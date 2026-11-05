# Install, update and uninstall on the build machine. The old NSIS version 1.0.20 is replaced by the new setup
# (its window walks through the screens by itself: RA_SETUP_AUTO), the installed program updates itself from a
# signed local manifest, then it is removed through its own window, and once more without windows.
# Results: upgrade.txt; screenshots: shots/setup-*.png, shots/uninstall-*.png (both end up in the ci-shots branch).
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force shots | Out-Null
$log = 'upgrade.txt'
function L($s) { $s | Tee-Object -FilePath $log -Append }
function Shot($n) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size)
  $bmp.Save("shots/$n.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
function Running { @(Get-Process retocker-voice -ErrorAction SilentlyContinue).Count }
$exe = (Resolve-Path 'src-tauri/target/release/retocker-voice.exe').Path
$tmp = $env:RUNNER_TEMP
$setup = Join-Path $tmp 'Retocker-Voice-Setup.exe'
Copy-Item $exe $setup -Force
# like a file from the browser: the «downloaded from the internet» mark (the installed copy must not keep it)
Set-Content -Path $setup -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3"
$UN = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RetockerVoice'
$RUN = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$progs = [Environment]::GetFolderPath('Programs')
$menu = Join-Path $progs 'Retocker Voice.lnk'
$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Retocker Voice.lnk'
$data = Join-Path $env:LOCALAPPDATA 'com.retocker.absolute'
$logf = Join-Path $data 'logs\retocker-voice.log'
function AppLog($pat) { if (Test-Path $logf) { Get-Content $logf -Tail 80 | Select-String $pat | ForEach-Object { L ('  log: ' + $_.Line) } } }
Get-Process retocker-voice -ErrorAction SilentlyContinue | Stop-Process -Force

# 1. the old version 1.0.20 (NSIS), running, with autostart on
$old = Join-Path $tmp 'old-setup.exe'
Invoke-WebRequest 'https://github.com/mishakozlov723-wq/retocker-absolute-download/releases/download/v1.0.20/Retocker-Voice-Setup.exe' -OutFile $old
Start-Process $old -ArgumentList '/S' -Wait
$od = (Get-ItemProperty 'HKCU:\Software\Retocker\Retocker Voice' -ErrorAction SilentlyContinue).'(default)'
L "1.0.20 installed at: $od; exe: $(Test-Path "$od\retocker-voice.exe")"
New-ItemProperty $RUN -Name 'Retocker Voice' -Value "`"$od\retocker-voice.exe`" --autostart" -Force | Out-Null
Start-Process "$od\retocker-voice.exe" -ArgumentList '--autostart'
Start-Sleep 6
L "1.0.20 running: $(Running)"

# 2. the new setup through its window, screenshots on the way
$env:RA_SETUP_AUTO = '1'
$p = Start-Process $setup -PassThru -NoNewWindow
$i = 0
while (-not $p.HasExited -and $i -lt 16) { Start-Sleep 2; $i++; Shot ('setup-{0:d2}' -f $i) }
$p.WaitForExit(20000) | Out-Null
Remove-Item Env:RA_SETUP_AUTO
L "setup window closed: $($p.HasExited) (code $($p.ExitCode)) after about $(2 * $i) s"
$k = Get-ItemProperty $UN -ErrorAction SilentlyContinue
$nd = $k.InstallLocation
L "installed at: $nd; exe: $(Test-Path "$nd\retocker-voice.exe"); version: $($k.DisplayVersion); size: $($k.EstimatedSize) KB"
L "uninstall: $($k.UninstallString) | quiet: $($k.QuietUninstallString)"
L "1.0.20 removed: exe $(-not (Test-Path "$od\retocker-voice.exe")), folder $(-not (Test-Path $od)), key $(-not (Test-Path 'HKCU:\Software\Retocker\Retocker Voice')), apps entry $(-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Retocker Voice'))"
L "running after setup: $(Running)"
L "shortcuts: menu $(Test-Path $menu), desktop $(Test-Path $desk), old menu folder left $(Test-Path (Join-Path $progs 'Retocker'))"
L "autostart: $((Get-ItemProperty $RUN -ErrorAction SilentlyContinue).'Retocker Voice')"
L "settings kept: $(Test-Path (Join-Path $data 'EBWebView'))"
L "internet mark on the installed exe: $([bool](Get-Item "$nd\retocker-voice.exe" -Stream Zone.Identifier -ErrorAction SilentlyContinue))"
AppLog 'setup|Setup v'

# 3. the update inside the program: a signed manifest (version 9.9.9) that points at a copy of this build
$pay = Join-Path $tmp 'payload.exe'
Copy-Item $exe $pay -Force
$man = Join-Path $tmp 'latest-test.json'
$env:NOTES = 'test'
node scripts/sign.mjs $pay 9.9.9 $pay $man
Remove-Item Env:NOTES
L "test manifest: $(if (Test-Path $man) { (Get-Item $man).Length } else { 'missing' }) bytes"
$env:RA_DEBUG = '1'
$env:RA_UPDATE_URL = $man
Start-Process "$nd\retocker-voice.exe" -NoNewWindow
Start-Sleep 10
Start-Process "$nd\retocker-voice.exe" -ArgumentList '--test-update' -NoNewWindow
Start-Sleep 16
Shot 'update-after'
AppLog 'test update|update|start v|waited'
L "old copy left after the update: $(Test-Path "$nd\retocker-voice.old.exe")"
L "running after the update: $(Running)"
Get-Process retocker-voice -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item Env:RA_UPDATE_URL
Remove-Item Env:RA_DEBUG
Start-Sleep 1

# 4. uninstall through its window (the settings stay)
$env:RA_SETUP_AUTO = '1'
$u = Start-Process "$nd\retocker-voice.exe" -ArgumentList '--uninstall' -PassThru -NoNewWindow
$i = 0
while (-not $u.HasExited -and $i -lt 12) { Start-Sleep 2; $i++; Shot ('uninstall-{0:d2}' -f $i) }
$u.WaitForExit(20000) | Out-Null
Remove-Item Env:RA_SETUP_AUTO
Start-Sleep 6
L "uninstall window closed: $($u.HasExited) (code $($u.ExitCode))"
L "after uninstall: exe $(Test-Path "$nd\retocker-voice.exe"), folder $(Test-Path $nd), apps entry $(Test-Path $UN), menu $(Test-Path $menu), desktop $(Test-Path $desk), autostart $([bool]((Get-ItemProperty $RUN -ErrorAction SilentlyContinue).'Retocker Voice'))"
L "settings kept: $(Test-Path (Join-Path $data 'EBWebView'))"
L "setup temp folders left: $(@(Get-ChildItem $env:TEMP -Directory -Filter 'retocker-voice-setup-*' -ErrorAction SilentlyContinue).Count)"
AppLog 'uninstall'

# 5. once more without windows: a quiet install, then a quiet uninstall that also deletes the settings
$p = Start-Process $setup -ArgumentList '--silent', '--no-desktop' -PassThru -NoNewWindow -Wait
L "quiet install: code $($p.ExitCode); exe $(Test-Path "$nd\retocker-voice.exe"); menu $(Test-Path $menu); desktop $(Test-Path $desk)"
Copy-Item $logf shots/app-log.txt -ErrorAction SilentlyContinue
$p = Start-Process "$nd\retocker-voice.exe" -ArgumentList '--uninstall', '--silent', '--wipe' -PassThru -NoNewWindow -Wait
Start-Sleep 6
L "quiet uninstall: code $($p.ExitCode); exe $(Test-Path "$nd\retocker-voice.exe"); folder $(Test-Path $nd); apps entry $(Test-Path $UN); settings $(Test-Path $data)"
Get-Process retocker-voice -ErrorAction SilentlyContinue | Stop-Process -Force
