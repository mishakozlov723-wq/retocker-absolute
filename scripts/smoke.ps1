# Smoke test on the build machine: start the app, look at the screen, click through the settings,
# move the mouse over the capsule, press the hotkey. Screenshots and the app's log end up in the ci-shots branch.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
  public static string At(int x, int y) { var p = new POINT(); p.X = x; p.Y = y; return Title(GetAncestor(WindowFromPoint(p), 2)); }
}
"@
New-Item -ItemType Directory -Force shots | Out-Null
function Log($s) { $s | Tee-Object -FilePath smoke.txt -Append }
function Shot($n) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size)
  $bmp.Save("shots/$n.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
# like a real keyboard: left/right specific codes, scan codes, the extended flag for Win
function Key($vk, $scan, $flags) { [W]::keybd_event([byte]$vk, [byte]$scan, [uint32]$flags, [UIntPtr]::Zero) }
function Click($x, $y) { [W]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 120; [W]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }

$exe = (Resolve-Path "src-tauri/target/release/retocker-absolute.exe").Path
Log "exe: $exe ($((Get-Item $exe).Length) bytes)"
$env:RA_DEBUG = '1'
$p = Start-Process $exe -PassThru
Start-Sleep 14
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
Log "work area: $wa"
Log "foreground: $([W]::Title([W]::GetForegroundWindow()))"
Shot "01-start"

# the settings window: every page once, and a few states in the preview
$h = [W]::FindWindow($null, 'Retocker Absolute')
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$wx = $r.L; $wy = $r.T
Log "settings window: $($r.L),$($r.T) - $($r.R),$($r.B) visible=$([W]::IsWindowVisible($h))"
$pages = @(@('caps', 92), @('text', 124), @('ctl', 156), @('key', 188), @('about', 220))
$i = 1
foreach ($pg in $pages) { Click ($wx + 100) ($wy + $pg[1]); Start-Sleep -Milliseconds 1100; Shot "1$i-$($pg[0])"; $i++ }
Click ($wx + 100) ($wy + 92); Start-Sleep -Milliseconds 600
Click ($wx + 317) ($wy + 73); Start-Sleep -Milliseconds 2600; Shot "16-preview-rec"
Click ($wx + 464) ($wy + 73); Start-Sleep -Milliseconds 1400; Shot "17-preview-review"
Click ($wx + 261) ($wy + 73); Start-Sleep -Milliseconds 600
Click ($wx + 100) ($wy + 60); Start-Sleep -Milliseconds 600

# the overlay lets the mouse through everywhere but the capsule
$cx = [int]($wa.X + $wa.Width / 2); $cy = [int]($wa.Bottom - 25)
[W]::SetCursorPos($cx - 300, $cy) | Out-Null; Start-Sleep -Milliseconds 700
Log "window under the mouse away from the capsule: '$([W]::At($cx - 300, $cy))'"
[W]::SetCursorPos($cx, $cy) | Out-Null; Start-Sleep -Milliseconds 900
Log "window under the mouse on the capsule: '$([W]::At($cx, $cy))'"
Shot "02-hover"
[W]::SetCursorPos($cx + 200, $cy - 200) | Out-Null; Start-Sleep -Milliseconds 600

# the default hotkey: hold Ctrl+Win (left Ctrl, then left Win), there is no microphone here, so an error is fine
Key 0xA2 0x1D 0; Start-Sleep -Milliseconds 80; Key 0x5B 0x5B 1
Start-Sleep -Milliseconds 1800
Shot "03-hold"
Key 0x5B 0x5B 3; Start-Sleep -Milliseconds 40; Key 0xA2 0x1D 2
Start-Sleep -Milliseconds 2500
Shot "04-released"
Start-Sleep 3
Shot "05-later"
Log "start menu check — foreground: $([W]::Title([W]::GetForegroundWindow()))"

# the cross only hides the settings; a second start brings them back
Click ($wx + 978) ($wy + 17); Start-Sleep -Milliseconds 1200
Log "after the cross: settings visible=$([W]::IsWindowVisible($h))"
Shot "06-closed"
Start-Process $exe | Out-Null
Start-Sleep 3
Log "after a second start: settings visible=$([W]::IsWindowVisible($h))"
Shot "07-second-start"

$logf = Join-Path $env:LOCALAPPDATA "com.retocker.absolute\logs\retocker-absolute.log"
Log "---- app log"
if (Test-Path $logf) { Get-Content $logf | ForEach-Object { Log $_ } } else { Log "no log at $logf" }
if ($p.HasExited) { Log "APP EXITED, code $($p.ExitCode)"; exit 1 }
Stop-Process -Id $p.Id -Force
Log "ok"
