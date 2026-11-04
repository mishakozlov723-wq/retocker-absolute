# Smoke test on the build machine: start the app, look at the screen, move the mouse, press the hotkey.
# Screenshots and the app's log end up in the ci-shots branch.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
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
function Key($vk, $up) { [W]::keybd_event([byte]$vk, 0, $(if ($up) { 2 } else { 0 }), [UIntPtr]::Zero) }

$exe = (Resolve-Path "src-tauri/target/release/retocker-absolute.exe").Path
Log "exe: $exe ($((Get-Item $exe).Length) bytes)"
$p = Start-Process $exe -PassThru
Start-Sleep 14
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
Log "work area: $wa"
Log "foreground: $([W]::Title([W]::GetForegroundWindow()))"
Shot "01-start"

$cx = [int]($wa.X + $wa.Width / 2); $cy = [int]($wa.Bottom - 25)
[W]::SetCursorPos($cx - 300, $cy) | Out-Null; Start-Sleep -Milliseconds 700
Log "window under the mouse away from the capsule: '$([W]::At($cx - 300, $cy))'"
[W]::SetCursorPos($cx, $cy) | Out-Null; Start-Sleep -Milliseconds 900
Log "window under the mouse on the capsule: '$([W]::At($cx, $cy))'"
Shot "02-hover"
[W]::SetCursorPos($cx + 200, $cy - 200) | Out-Null; Start-Sleep -Milliseconds 600

# the default hotkey: hold Ctrl+Win
Key 0x11 $false; Key 0x5B $false
Start-Sleep -Milliseconds 1800
Shot "03-hold"
Key 0x5B $true; Key 0x11 $true
Start-Sleep -Milliseconds 2500
Shot "04-released"
Start-Sleep 3
Shot "05-later"
Log "start menu check — foreground: $([W]::Title([W]::GetForegroundWindow()))"

# second start = open the settings
Start-Process $exe | Out-Null
Start-Sleep 3
Shot "06-second-start"

$logf = Join-Path $env:LOCALAPPDATA "com.retocker.absolute\logs\retocker-absolute.log"
Log "---- app log"
if (Test-Path $logf) { Get-Content $logf | ForEach-Object { Log $_ } } else { Log "no log at $logf" }
if ($p.HasExited) { Log "APP EXITED, code $($p.ExitCode)"; exit 1 }
Stop-Process -Id $p.Id -Force
Log "ok"
