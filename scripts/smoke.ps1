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
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MI mi; [FieldOffset(0)] public KI ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  public static string Send(ushort vk, ushort scan, uint flags) {
    var a = new INPUT[1]; a[0].type = 1; a[0].u.ki.vk = vk; a[0].u.ki.scan = scan; a[0].u.ki.flags = flags;
    uint r = SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); return r + " (err " + Marshal.GetLastWin32Error() + ")";
  }
  public static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
  public static string At(int x, int y) { var p = new POINT(); p.X = x; p.Y = y; return Title(GetAncestor(WindowFromPoint(p), 2)); }
}
"@
# a minimal keyboard hook of our own: tells whether this machine delivers key events to hooks at all
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class H {
  public delegate IntPtr Proc(int code, IntPtr wp, IntPtr lp);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int c, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string n);
  public static int Count = 0; public static string Info = ""; static Proc keep; static IntPtr hh;
  public static void Start() {
    var t = new System.Threading.Thread(() => {
      keep = (c, w, l) => { Count++; return CallNextHookEx(hh, c, w, l); };
      hh = SetWindowsHookEx(13, keep, GetModuleHandle(null), 0);
      Info = "hook " + hh + " err " + Marshal.GetLastWin32Error();
      MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {}
    });
    t.IsBackground = true; t.Start();
  }
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

$exe = (Resolve-Path "src-tauri/target/release/retocker-voice.exe").Path
Log "exe: $exe ($((Get-Item $exe).Length) bytes)"
$env:RA_DEBUG = '1'
$p = Start-Process $exe -PassThru
Start-Sleep 14
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
Log "work area: $wa"
Log "foreground: $([W]::Title([W]::GetForegroundWindow()))"
Shot "01-start"

# the settings window: every page once, and a few states in the preview
$h = [W]::FindWindow([NullString]::Value, 'Retocker Voice')
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

# the default hotkey: hold Ctrl+Win (left Ctrl, then left Win) like a real keyboard.
# There is no Groq key and no microphone here, so the capsule should say so.
Key 0xA2 0x1D 0; Start-Sleep -Milliseconds 80; Key 0x5B 0x5B 1
Start-Sleep -Milliseconds 1500
Shot "03-hold"
Key 0x5B 0x5B 3; Start-Sleep -Milliseconds 40; Key 0xA2 0x1D 2
Start-Sleep -Milliseconds 2500
Shot "04-released"
Log "start menu check — foreground: $([W]::Title([W]::GetForegroundWindow()))"
# once more (the raw input backup again, or the hook if setting it up again helped)
Key 0xA2 0x1D 0; Start-Sleep -Milliseconds 80; Key 0x5B 0x5B 1
Start-Sleep -Milliseconds 900
Shot "05-hold-again"
Key 0x5B 0x5B 3; Start-Sleep -Milliseconds 40; Key 0xA2 0x1D 2
Start-Sleep -Milliseconds 1500

# for the record: does this machine deliver keys to a hook of our own
[H]::Start(); Start-Sleep -Milliseconds 500
Key 0xA2 0x1D 0; Start-Sleep -Milliseconds 120
Log "test hook ($([H]::Info)): system sees LCtrl: $([W]::GetAsyncKeyState(0xA2) -band 0x8000)"
Key 0xA2 0x1D 2; Start-Sleep -Milliseconds 200
Log "test hook saw $([H]::Count) key events (2 sent)"
# now our hook hears the keys as well: the raw input copies must be skipped (one start, not two)
Key 0xA2 0x1D 0; Start-Sleep -Milliseconds 80; Key 0x5B 0x5B 1
Start-Sleep -Milliseconds 900
Shot "05b-hold-hooked"
Key 0x5B 0x5B 3; Start-Sleep -Milliseconds 40; Key 0xA2 0x1D 2
Start-Sleep -Milliseconds 1500

# the cross only hides the settings; a second start brings them back
Click ($wx + 978) ($wy + 17); Start-Sleep -Milliseconds 1200
Log "after the cross: settings visible=$([W]::IsWindowVisible($h))"
Shot "06-closed"
Start-Process $exe | Out-Null
Start-Sleep 3
Log "after a second start: settings visible=$([W]::IsWindowVisible($h))"
Shot "07-second-start"

# start in tray: the capsule stays hidden until the hotkey, and showing it must leave the screen clickable
$dead = ''
if ($p.HasExited) { $dead = "APP EXITED, code $($p.ExitCode)" } else { Stop-Process -Id $p.Id -Force; $p.WaitForExit(5000) | Out-Null }
$tray = Join-Path $env:LOCALAPPDATA "com.retocker.absolute\start-in-tray"
Set-Content -Path $tray -Value '1' -NoNewline
# the capsule window's title, spelled with codes so this file stays plain ASCII
$capTitle = 'Retocker Voice ' + [char]0x2014 + ' ' + (-join [char[]](0x43A, 0x430, 0x43F, 0x441, 0x443, 0x43B, 0x430))
$p2 = Start-Process $exe -PassThru
Start-Sleep 10
$c = [W]::FindWindow([NullString]::Value, $capTitle)
Log "tray start: capsule visible=$([W]::IsWindowVisible($c)), settings visible=$([W]::IsWindowVisible([W]::FindWindow([NullString]::Value, 'Retocker Voice')))"
[W]::SetCursorPos($cx - 300, $cy - 300) | Out-Null
Key 0xA2 0x1D 0; Start-Sleep -Milliseconds 80; Key 0x5B 0x5B 1
Start-Sleep -Milliseconds 1200
Key 0x5B 0x5B 3; Start-Sleep -Milliseconds 40; Key 0xA2 0x1D 2
Start-Sleep -Milliseconds 1500
$under = [W]::At($cx - 300, $cy - 300)
Log "tray start, after the hotkey: capsule visible=$([W]::IsWindowVisible($c)), window under the mouse away from the capsule: '$under', foreground: '$([W]::Title([W]::GetForegroundWindow()))'"
Shot "08-tray-hotkey"
Remove-Item $tray -ErrorAction SilentlyContinue
$shown = [W]::IsWindowVisible($c)
$blocked = $under -eq $capTitle

$logf = Join-Path $env:LOCALAPPDATA "com.retocker.absolute\logs\retocker-voice.log"
Log "---- app log"
if (Test-Path $logf) { Get-Content $logf | ForEach-Object { Log $_ } } else { Log "no log at $logf" }
if ($dead) { Log $dead; exit 1 }
if ($p2.HasExited) { Log "APP EXITED after a start in tray, code $($p2.ExitCode)"; exit 1 }
Stop-Process -Id $p2.Id -Force
if (-not $shown) { Log "FAIL: the hotkey did not show the capsule after a start in tray"; exit 1 }
if ($blocked) { Log "FAIL: after a start in tray the overlay takes the clicks of the whole screen"; exit 1 }
Log "ok"
