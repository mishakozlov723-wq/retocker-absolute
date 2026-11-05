//! Global keyboard hook (WH_KEYBOARD_LL) on its own thread.
//! It knows the dictation hotkey (any combo, also modifiers only, e.g. Ctrl+Win), swallows the main key of a
//! combo so the app under the cursor never sees it, catches Esc / Enter while the capsule waits for them, and
//! can record a new hotkey for the settings window (then every key goes only to us, so Win never opens Start).
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

/// dwExtraInfo of every key event we inject ourselves (paste, typing, menu mask) — the hook lets them through.
pub const MARK: usize = 0x5241_4253;

// held modifier bits
const LCTRL: u8 = 1;
const RCTRL: u8 = 2;
const LALT: u8 = 4;
const RALT: u8 = 8;
const LSHIFT: u8 = 16;
const RSHIFT: u8 = 32;
const LWIN: u8 = 64;
const RWIN: u8 = 128;

#[derive(Debug)]
pub enum Ev {
  /// hotkey: "down" | "up" | "other"; `other` = another key was used while a modifier-only combo was held
  Hk(&'static str, bool),
  /// Esc / Enter caught while armed
  Key(&'static str),
  /// a key while recording a new hotkey
  Rec { name: String, down: bool, m: bool },
  /// send the menu mask key (keeps Start / the menu bar from opening after Win / Alt combos)
  Mask,
  /// a line for the log (only with RA_DEBUG=1)
  Dbg(String),
}

/// RA_DEBUG=1: every key the hook sees goes to the log (vk, flags, held modifiers, decision)
static DEBUG: AtomicBool = AtomicBool::new(false);
fn dbg(f: impl FnOnce() -> String) {
  if DEBUG.load(Ordering::Relaxed) {
    send(Ev::Dbg(f()));
  }
}

#[derive(Default)]
struct St {
  // hotkey
  req: [u8; 4], // ctrl, alt, shift, win: 0 not used, 1 left, 2 right, 3 any side
  key: u32,     // main key, 0 = modifiers only
  hold: bool,
  // live state
  held: u8,
  active: bool,
  cand: bool,
  other: bool,
  swallow: Vec<u32>,
  // extras
  esc: bool,
  enter: bool,
  rec_until: Option<Instant>,
  paused: bool,
  // GetAsyncKeyState has reported a held modifier at least once, so its "not held" can be trusted
  async_ok: bool,
}

static ST: OnceLock<Mutex<St>> = OnceLock::new();
static TX: OnceLock<Mutex<Sender<Ev>>> = OnceLock::new();

fn st() -> std::sync::MutexGuard<'static, St> {
  ST.get_or_init(|| Mutex::new(St::default())).lock().unwrap_or_else(|e| e.into_inner())
}
fn send(e: Ev) {
  if let Some(tx) = TX.get() {
    let _ = tx.lock().map(|t| t.send(e));
  }
}

fn mod_bit(vk: u32, scan: u32) -> u8 {
  match vk {
    0xA2 => if scan == 0x21D { 0 } else { LCTRL }, // AltGr sends a fake left Ctrl (scan 0x21D): not a modifier for us
    0xA3 => RCTRL,
    0xA4 => LALT,
    0xA5 => RALT,
    0xA0 => LSHIFT,
    0xA1 => RSHIFT,
    0x5B => LWIN,
    0x5C => RWIN,
    0x11 => LCTRL,
    0x12 => LALT,
    0x10 => LSHIFT,
    _ => 0,
  }
}

fn mods_match(held: u8, req: &[u8; 4]) -> bool {
  let pairs = [(LCTRL, RCTRL), (LALT, RALT), (LSHIFT, RSHIFT), (LWIN, RWIN)];
  for (i, (lb, rb)) in pairs.iter().enumerate() {
    let l = held & lb != 0;
    let r = held & rb != 0;
    let ok = match req[i] {
      0 => !l && !r,
      1 => l && !r,
      2 => r && !l,
      _ => l || r,
    };
    if !ok {
      return false;
    }
  }
  true
}

/// "Ctrl+Shift+Y", "Ctrl+Win", "RAlt", "F8" -> (mods, key)
pub fn parse(combo: &str) -> Option<([u8; 4], u32)> {
  let mut req = [0u8; 4];
  let mut key = 0u32;
  for p in combo.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()) {
    let (i, side) = match p {
      "Ctrl" => (0, 3),
      "LCtrl" => (0, 1),
      "RCtrl" => (0, 2),
      "Alt" => (1, 3),
      "LAlt" => (1, 1),
      "RAlt" => (1, 2),
      "Shift" => (2, 3),
      "LShift" => (2, 1),
      "RShift" => (2, 2),
      "Win" => (3, 3),
      "LWin" => (3, 1),
      "RWin" => (3, 2),
      _ => {
        key = name_vk(p)?;
        continue;
      }
    };
    req[i] = side;
  }
  if key == 0 && req == [0; 4] {
    return None;
  }
  Some((req, key))
}

const NAMES: &[(u32, &str)] = &[
  (0x20, "Space"), (0xC0, "`"), (0xBD, "-"), (0xBB, "="), (0xDB, "["), (0xDD, "]"), (0xDC, "\\"), (0xBA, ";"),
  (0xDE, "'"), (0xBC, ","), (0xBE, "."), (0xBF, "/"), (0x14, "CapsLock"), (0x2D, "Insert"), (0x2E, "Delete"),
  (0x24, "Home"), (0x23, "End"), (0x21, "PageUp"), (0x22, "PageDown"), (0x26, "↑"), (0x28, "↓"), (0x25, "←"),
  (0x27, "→"), (0x13, "Pause"), (0x91, "ScrollLock"), (0x0D, "Enter"), (0x09, "Tab"), (0x08, "Backspace"),
  (0x1B, "Esc"), (0x5D, "Menu"), (0x2C, "PrintScreen"), (0x6A, "Num*"), (0x6B, "Num+"), (0x6D, "Num-"),
  (0x6E, "Num."), (0x6F, "Num/"), (0x90, "NumLock"), (0xE2, "\\2"), (0xAD, "Mute"), (0xAE, "VolDown"),
  (0xAF, "VolUp"), (0xB3, "Play"), (0xB0, "Next"), (0xB1, "Prev"), (0xB2, "Stop"),
];

pub fn vk_name(vk: u32) -> String {
  match vk {
    0x41..=0x5A | 0x30..=0x39 => char::from_u32(vk).map(|c| c.to_string()).unwrap_or_default(),
    0x60..=0x69 => format!("Num{}", vk - 0x60),
    0x70..=0x87 => format!("F{}", vk - 0x6F),
    0xA2 | 0x11 => "LCtrl".into(),
    0xA3 => "RCtrl".into(),
    0xA4 | 0x12 => "LAlt".into(),
    0xA5 => "RAlt".into(),
    0xA0 | 0x10 => "LShift".into(),
    0xA1 => "RShift".into(),
    0x5B => "LWin".into(),
    0x5C => "RWin".into(),
    _ => NAMES.iter().find(|(v, _)| *v == vk).map(|(_, n)| n.to_string()).unwrap_or_else(|| format!("VK{:02X}", vk)),
  }
}

fn name_vk(n: &str) -> Option<u32> {
  let b = n.as_bytes();
  if b.len() == 1 && (b[0].is_ascii_uppercase() || b[0].is_ascii_digit()) {
    return Some(b[0] as u32);
  }
  if let Some(d) = n.strip_prefix("Num") {
    if let Ok(x) = d.parse::<u32>() {
      if x <= 9 {
        return Some(0x60 + x);
      }
    }
  }
  if let Some(d) = n.strip_prefix('F') {
    if let Ok(x) = d.parse::<u32>() {
      if (1..=24).contains(&x) {
        return Some(0x6F + x);
      }
    }
  }
  if let Some(h) = n.strip_prefix("VK") {
    return u32::from_str_radix(h, 16).ok();
  }
  NAMES.iter().find(|(_, s)| *s == n).map(|(v, _)| *v)
}

pub fn set_hotkey(combo: &str, hold: bool) -> bool {
  let Some((req, key)) = parse(combo) else { return false };
  let mut s = st();
  s.req = req;
  s.key = key;
  s.hold = hold;
  s.active = false;
  s.cand = false;
  s.other = false;
  true
}
pub fn set_keys(esc: bool, enter: bool) {
  let mut s = st();
  s.esc = esc;
  s.enter = enter;
}
pub fn set_record(on: bool) {
  st().rec_until = if on { Some(Instant::now() + Duration::from_secs(20)) } else { None };
}
pub fn set_paused(on: bool) {
  let mut s = st();
  s.paused = on;
  s.active = false;
  s.cand = false;
}

unsafe extern "system" fn proc_(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
  if code == HC_ACTION as i32 {
    LAST_KEY.store(now_ms(), Ordering::Relaxed);
    let kb = &*(lp.0 as *const KBDLLHOOKSTRUCT);
    if !(kb.flags.0 & LLKHF_INJECTED.0 != 0 && kb.dwExtraInfo == MARK) && handle(wp.0 as u32, kb) {
      return LRESULT(1);
    }
  }
  CallNextHookEx(None, code, wp, lp)
}

pub fn debug() -> bool {
  DEBUG.load(Ordering::Relaxed)
}

/// RA_DEBUG only: made-up key events through the same logic as real ones, e.g. "A2+,5B+" then "5B-,A2-"
pub fn test_keys(spec: &str) {
  for t in spec.split(',').map(|t| t.trim()).filter(|t| t.len() > 1) {
    let (h, d) = t.split_at(t.len() - 1);
    let Ok(vk) = u32::from_str_radix(h, 16) else { continue };
    let down = d == "+";
    let scan = unsafe { MapVirtualKeyW(vk, MAPVK_VK_TO_VSC) };
    let mut fl = if matches!(vk, 0x5B | 0x5C | 0xA3 | 0xA5) { LLKHF_EXTENDED.0 } else { 0 };
    if !down {
      fl |= LLKHF_UP.0;
    }
    let kb = KBDLLHOOKSTRUCT { vkCode: vk, scanCode: scan, flags: KBDLLHOOKSTRUCT_FLAGS(fl), time: 0, dwExtraInfo: 0 };
    let sw = handle(if down { WM_KEYDOWN } else { WM_KEYUP }, &kb);
    crate::logx::log(&format!("test key {t} swallowed={sw}"));
    std::thread::sleep(Duration::from_millis(60));
  }
}

static SEEN: AtomicU32 = AtomicU32::new(0);

/// true = swallow the event
fn handle(msg: u32, kb: &KBDLLHOOKSTRUCT) -> bool {
  let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
  if SEEN.fetch_add(1, Ordering::Relaxed) == 0 {
    send(Ev::Dbg("keyboard hook: the first key arrived".into()));
  }
  let r = handle_(down, kb);
  dbg(|| {
    let s = st();
    format!(
      "key vk={:02X} sc={:X} fl={:X} {} -> held={:08b} cand={} other={} active={} swallow={}",
      kb.vkCode, kb.scanCode, kb.flags.0, if down { "down" } else { "up" }, s.held, s.cand, s.other, s.active, r
    )
  });
  r
}

fn handle_(down: bool, kb: &KBDLLHOOKSTRUCT) -> bool {
  let vk = kb.vkCode;
  let bit = mod_bit(vk, kb.scanCode | if kb.flags.0 & LLKHF_EXTENDED.0 != 0 { 0x200 } else { 0 });
  let mut s = st();
  // a key whose press we swallowed: swallow its auto-repeats and its release too
  if s.swallow.contains(&vk) {
    if down {
      return true;
    }
    s.swallow.retain(|v| *v != vk);
    if s.key == vk && s.active {
      s.active = false;
      drop(s);
      send(Ev::Hk("up", false));
    }
    return true;
  }
  let repeat = down && bit != 0 && s.held & bit != 0;
  sync_held(&mut s, bit);
  if bit != 0 {
    if down { s.held |= bit } else { s.held &= !bit }
  }

  // recording a new hotkey for the settings: every press is ours
  if let Some(t) = s.rec_until {
    if Instant::now() < t {
      if down {
        s.swallow.push(vk);
        drop(s);
        if !repeat {
          send(Ev::Rec { name: vk_name(vk), down: true, m: bit != 0 });
        }
        return true;
      }
      drop(s);
      send(Ev::Rec { name: vk_name(vk), down: false, m: bit != 0 });
      return false;
    }
    s.rec_until = None;
  }
  if s.paused {
    return false;
  }

  if down && s.esc && vk == 0x1B && s.held == 0 {
    s.swallow.push(vk);
    drop(s);
    send(Ev::Key("esc"));
    return true;
  }
  if down && s.enter && vk == 0x0D && s.held == 0 {
    s.swallow.push(vk);
    drop(s);
    send(Ev::Key("enter"));
    return true;
  }

  if s.key != 0 {
    // a combo with a main key
    if vk == s.key && down {
      if mods_match(s.held, &s.req) {
        s.active = true;
        s.swallow.push(vk);
        let mask = s.req[1] != 0 || s.req[3] != 0;
        drop(s);
        if mask {
          send(Ev::Mask);
        }
        send(Ev::Hk("down", false));
        return true;
      }
      return false;
    }
    // hold mode: letting go of one of its modifiers ends it as well
    if !down && bit != 0 && s.active && s.hold {
      s.active = false;
      drop(s);
      send(Ev::Hk("up", false));
    }
    return false;
  }

  // modifiers only (e.g. Ctrl+Win)
  if s.req == [0; 4] {
    return false;
  }
  if bit != 0 {
    if down {
      if repeat {
        return false;
      }
      if !s.cand && mods_match(s.held, &s.req) {
        s.cand = true;
        s.other = false;
        let mask = s.req[1] != 0 || s.req[3] != 0;
        drop(s);
        if mask {
          send(Ev::Mask);
        }
        send(Ev::Hk("down", false));
      } else if s.cand && !s.other {
        s.other = true;
        drop(s);
        send(Ev::Hk("other", true));
      }
    } else if s.cand {
      s.cand = false;
      let o = s.other;
      drop(s);
      send(Ev::Hk("up", o));
    }
    return false;
  }
  if down && s.cand && !s.other {
    s.other = true;
    drop(s);
    send(Ev::Hk("other", true));
  }
  false
}

/// The hook can miss releases (e.g. after Ctrl+Alt+Del, UAC or Win+L), so a modifier could look held forever.
/// The system state fixes that: a modifier the system says is up is dropped. That is only trusted once the
/// system has shown it really sees the keys (on some desktops GetAsyncKeyState always says "up").
fn sync_held(s: &mut St, cur: u8) {
  let mut sys = 0u8;
  for (vk, b) in [(0xA2, LCTRL), (0xA3, RCTRL), (0xA4, LALT), (0xA5, RALT), (0xA0, LSHIFT), (0xA1, RSHIFT), (0x5B, LWIN), (0x5C, RWIN)] {
    if b != cur && unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000 != 0 {
      sys |= b;
    }
  }
  if sys & s.held & !cur != 0 {
    s.async_ok = true;
  }
  if s.async_ok {
    s.held = (s.held & cur) | sys;
  }
}

static T0: OnceLock<Instant> = OnceLock::new();
fn now_ms() -> u64 {
  T0.get_or_init(Instant::now).elapsed().as_millis() as u64
}
/// when the hook last heard any key (ms since start)
static LAST_KEY: AtomicU64 = AtomicU64::new(0);
static HOOK_TID: AtomicU32 = AtomicU32::new(0);
const WM_REHOOK: u32 = WM_APP + 1;

/// Windows can drop a keyboard hook without a word (for example when the computer was too busy to answer in
/// time). The overlay loop ticks this: a modifier the system sees pressed that the hook never heard of
/// means the hook is gone, so it is set up again (the next press works).
#[derive(Default)]
pub struct Watch {
  down: bool,
  press: Option<u64>,
  polled: u64,
  fixed: u64,
  fixes: u32,
}
impl Watch {
  pub fn tick(&mut self) {
    let now = now_ms();
    if now < self.polled + 40 {
      return;
    }
    self.polled = now;
    let down = [0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C].iter().any(|v| unsafe { GetAsyncKeyState(*v) } as u16 & 0x8000 != 0);
    if down && !self.down {
      self.press = Some(now);
    }
    self.down = down;
    let Some(p) = self.press else { return };
    if now < p + 300 {
      return;
    }
    self.press = None;
    if LAST_KEY.load(Ordering::Relaxed) + 250 < p && now > self.fixed + 5000 {
      self.fixed = now;
      self.fixes += 1;
      if self.fixes <= 20 {
        crate::logx::log("keyboard hook missed a key: setting it up again");
      }
      let tid = HOOK_TID.load(Ordering::Relaxed);
      if tid != 0 {
        unsafe {
          let _ = PostThreadMessageW(tid, WM_REHOOK, WPARAM(0), LPARAM(0));
        }
      }
    }
  }
}

/// Starts the hook thread; `on_ev` runs on a separate dispatcher thread (never inside the hook).
pub fn start(on_ev: impl Fn(Ev) + Send + 'static) {
  DEBUG.store(std::env::var("RA_DEBUG").map(|v| v == "1").unwrap_or(false), Ordering::Relaxed);
  if debug() {
    crate::logx::log("debug log on (RA_DEBUG=1)");
  }
  let _ = now_ms();
  let (tx, rx) = channel::<Ev>();
  let _ = TX.set(Mutex::new(tx));
  std::thread::spawn(move || {
    while let Ok(e) = rx.recv() {
      match e {
        Ev::Mask => crate::paste::tap_mask(),
        Ev::Dbg(m) => crate::logx::log(&m),
        e => {
          if debug() {
            crate::logx::log(&format!("hook event {e:?}"));
          }
          on_ev(e)
        }
      }
    }
  });
  std::thread::spawn(|| unsafe {
    let hmod: HINSTANCE = GetModuleHandleW(None).map(|h| h.into()).unwrap_or_default();
    let tid = windows::Win32::System::Threading::GetCurrentThreadId();
    HOOK_TID.store(tid, Ordering::Relaxed);
    let install = || match SetWindowsHookExW(WH_KEYBOARD_LL, Some(proc_), Some(hmod), 0) {
      Ok(h) => {
        crate::logx::log(&format!("keyboard hook on (thread {tid})"));
        Some(h)
      }
      Err(e) => {
        crate::logx::log(&format!("keyboard hook failed: {e}"));
        None
      }
    };
    let mut hook = install();
    // a steady tick keeps this thread's queue awake
    let _ = SetTimer(None, 0, 5000, None);
    let mut m = MSG::default();
    loop {
      let r = GetMessageW(&mut m, None, 0, 0);
      if r.0 == 0 || r.0 == -1 {
        crate::logx::log(&format!("keyboard hook loop ended ({})", r.0));
        break;
      }
      if m.hwnd.0.is_null() {
        if m.message == WM_TIMER {
          if debug() {
            crate::logx::log(&format!("hook thread alive, keys seen {}", SEEN.load(Ordering::Relaxed)));
          }
          continue;
        }
        if m.message == WM_REHOOK {
          if let Some(h) = hook.take() {
            let _ = UnhookWindowsHookEx(h);
          }
          hook = install();
          continue;
        }
      }
      let _ = TranslateMessage(&m);
      DispatchMessageW(&m);
    }
  });
}
