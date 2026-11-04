//! Putting the text where the cursor is: through the clipboard (Ctrl+V, the old clipboard comes back after)
//! or by typing it letter by letter. Every injected key carries our mark, so our own hook ignores it.
use std::time::Duration;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::*;
use windows::Win32::System::Memory::*;
use windows::Win32::UI::Input::KeyboardAndMouse::*;

use crate::hook::MARK;

const CF_UNICODETEXT: u32 = 13;

fn key(vk: u16, up: bool) -> INPUT {
  let mut flags = KEYBD_EVENT_FLAGS(0);
  if up {
    flags |= KEYEVENTF_KEYUP;
  }
  // arrows, Insert, Delete etc. are "extended" keys
  if matches!(vk, 0x21..=0x28 | 0x2D | 0x2E | 0x5B | 0x5C | 0xA3 | 0xA5) {
    flags |= KEYEVENTF_EXTENDEDKEY;
  }
  INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: MARK } },
  }
}
fn uni(c: u16, up: bool) -> INPUT {
  let mut flags = KEYEVENTF_UNICODE;
  if up {
    flags |= KEYEVENTF_KEYUP;
  }
  INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: c, dwFlags: flags, time: 0, dwExtraInfo: MARK } },
  }
}
fn send(v: &[INPUT]) -> bool {
  if v.is_empty() {
    return true;
  }
  unsafe { SendInput(v, std::mem::size_of::<INPUT>() as i32) as usize == v.len() }
}

/// a harmless unassigned key: pressed while Win or Alt is held it keeps Start / the menu bar from opening
pub fn tap_mask() {
  send(&[key(0xE8, false), key(0xE8, true)]);
}

fn down(vk: i32) -> bool {
  unsafe { GetAsyncKeyState(vk) as u16 & 0x8000 != 0 }
}

/// let go of whatever modifiers are still held (the hotkey), so Ctrl+V doesn't turn into Ctrl+Shift+Alt+V
fn release_mods() {
  // give the fingers a moment first
  for _ in 0..25 {
    if ![0x10, 0x11, 0x12, 0x5B, 0x5C].iter().any(|v| down(*v)) {
      return;
    }
    std::thread::sleep(Duration::from_millis(20));
  }
  let mut v = Vec::new();
  let win = down(0x5B) || down(0x5C);
  if win || down(0x12) {
    v.push(key(0xE8, false));
    v.push(key(0xE8, true));
  }
  for vk in [0xA0u16, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C] {
    if down(vk as i32) {
      v.push(key(vk, true));
    }
  }
  send(&v);
}

struct Saved(Vec<(u32, Vec<u8>)>);

fn skip_format(f: u32) -> bool {
  // GDI handles and owner-drawn formats can't be copied as plain memory; the rest is synthesized again
  matches!(f, 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E) || (0x300..=0x3FF).contains(&f) || (0x200..=0x2FF).contains(&f)
}

/// formats that only point back at the program that copied (OLE objects) — a copy of them would be broken
fn ole_format(f: u32) -> bool {
  if f < 0xC000 {
    return false;
  }
  let mut buf = [0u16; 64];
  let n = unsafe { GetClipboardFormatNameW(f, &mut buf) };
  let name = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
  matches!(name.as_str(), "Ole Private Data" | "DataObject" | "ExcludeClipboardContentFromMonitorProcessing" | "CanIncludeInClipboardHistory" | "CanUploadToCloudClipboard")
}

fn open(owner: HWND) -> bool {
  for _ in 0..20 {
    if unsafe { OpenClipboard(Some(owner)) }.is_ok() {
      return true;
    }
    std::thread::sleep(Duration::from_millis(15));
  }
  false
}

fn save(owner: HWND) -> Option<Saved> {
  if !open(owner) {
    return None;
  }
  let mut out = Vec::new();
  let mut total = 0usize;
  unsafe {
    let mut f = EnumClipboardFormats(0);
    while f != 0 {
      if !skip_format(f) && !ole_format(f) {
        if let Ok(h) = GetClipboardData(f) {
          let g = HGLOBAL(h.0);
          let n = GlobalSize(g);
          if n > 0 && total + n < 64 << 20 {
            let p = GlobalLock(g) as *const u8;
            if !p.is_null() {
              out.push((f, std::slice::from_raw_parts(p, n).to_vec()));
              total += n;
              let _ = GlobalUnlock(g);
            }
          }
        }
      }
      f = EnumClipboardFormats(f);
    }
    let _ = CloseClipboard();
  }
  Some(Saved(out))
}

unsafe fn put(f: u32, bytes: &[u8]) {
  if let Ok(g) = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)) {
    let p = GlobalLock(g) as *mut u8;
    if !p.is_null() {
      std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
      let _ = GlobalUnlock(g);
      if SetClipboardData(f, Some(HANDLE(g.0))).is_err() {
        let _ = GlobalFree(Some(g));
      }
    }
  }
}

fn reg(name: PCWSTR) -> u32 {
  unsafe { RegisterClipboardFormatW(name) }
}

/// our text on the clipboard; marked so Windows clipboard history (Win+V) and cloud sync skip it
fn set_text(owner: HWND, text: &str) -> Option<u32> {
  if !open(owner) {
    return None;
  }
  unsafe {
    let _ = EmptyClipboard();
    let mut w16: Vec<u16> = text.encode_utf16().collect();
    w16.push(0);
    let bytes = std::slice::from_raw_parts(w16.as_ptr() as *const u8, w16.len() * 2);
    put(CF_UNICODETEXT, bytes);
    let zero = 0u32.to_le_bytes();
    put(reg(w!("ExcludeClipboardContentFromMonitorProcessing")), &zero);
    put(reg(w!("CanIncludeInClipboardHistory")), &zero);
    put(reg(w!("CanUploadToCloudClipboard")), &zero);
    let _ = CloseClipboard();
    Some(GetClipboardSequenceNumber())
  }
}

fn restore(owner: HWND, s: Saved) {
  if !open(owner) {
    return;
  }
  unsafe {
    let _ = EmptyClipboard();
    for (f, b) in &s.0 {
      put(*f, b);
    }
    let _ = CloseClipboard();
  }
}

pub fn copy_text(owner: HWND, text: &str) -> bool {
  set_text(owner, text).is_some()
}

pub fn paste(owner: HWND, text: &str, method: &str, keep: bool) -> Result<(), String> {
  release_mods();
  if method == "type" {
    let mut v = Vec::with_capacity(text.len() * 2);
    for c in text.encode_utf16() {
      if c == '\n' as u16 {
        // Shift+Enter: a new line that never sends a chat message by accident
        v.extend([key(0x10, false), key(0x0D, false), key(0x0D, true), key(0x10, true)]);
      } else if c != '\r' as u16 {
        v.push(uni(c, false));
        v.push(uni(c, true));
      }
    }
    // in small portions: some apps drop keys when a huge burst arrives at once
    for ch in v.chunks(40) {
      if !send(ch) {
        return Err("Windows не дал напечатать текст (окно запущено от администратора?)".into());
      }
      std::thread::sleep(Duration::from_millis(4));
    }
    return Ok(());
  }
  let saved = if keep { save(owner) } else { None };
  let Some(seq) = set_text(owner, text) else { return Err("буфер обмена занят другой программой".into()) };
  std::thread::sleep(Duration::from_millis(30));
  let ok = send(&[key(0x11, false), key(0x56, false), key(0x56, true), key(0x11, true)]);
  if !ok {
    return Err("Windows не дал вставить текст (окно запущено от администратора?)".into());
  }
  if let Some(s) = saved {
    let h = owner.0 as isize;
    std::thread::spawn(move || {
      // the app reads the clipboard when it handles Ctrl+V; give slow ones time, then put the old content back
      std::thread::sleep(Duration::from_millis(650));
      // if something else has been copied meanwhile, leave it alone
      if unsafe { GetClipboardSequenceNumber() } == seq {
        restore(HWND(h as *mut _), s);
      }
    });
  }
  Ok(())
}
