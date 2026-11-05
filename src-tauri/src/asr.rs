//! «Мгновенный живой текст»: the optional local speech model. Downloaded on request (≈50 MB: the model and the
//! sherpa-onnx engine), checked file by file (size + SHA-256), loaded on a worker thread. The capsule streams the
//! sound to it (16 kHz pieces of ~0.1 s) and gets the words back at once as «asr» events.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::asr_core::{Asr, Stream};
use crate::{logx, sys, upd};

const TAG: &str = "ru1";
/// (address, mirror): the mirror keeps every file as «name.x» with each byte XOR MIRROR_KEY
/// (Firebase does not host .dll files on the free plan)
const BASES: [(&str, bool); 2] = [
  ("https://github.com/mishakozlov723-wq/retocker-absolute-download/releases/download/asr-ru1/", false),
  ("https://retocker-voice.web.app/asr/ru1/", true),
];
const MIRROR_KEY: u8 = 0x5a;
/// what is downloaded: (file, size, sha256)
const FILES: [(&str, u64, &str); 7] = [
  ("tokens.txt", 6388, "93bbbc0bae6b78c0bbb743d4aa9fded3bb5ff3aac5f0200e3a769a5a05e0fdf6"),
  ("joiner.onnx", 259417, "b55784b071ab7512eab4c7c44e4f5478284ef33c83562cc6a249b972515a31e5"),
  ("decoder.onnx", 2093080, "89b3088a9e20e1ef7f2e85ce1a3478afe6a9c4ac57369cabcc4beb8e95328ea0"),
  ("onnxruntime_providers_shared.dll", 104960, "551d0e1fe4c227d8542314ba718d52f4379e0c7bfe729a37c59833a884e27b4d"),
  ("sherpa-onnx-c-api.dll", 3667968, "ee2af9f49b8fc5dae135ad20c0b955cbab90d17b79cc1ad0db91e03b24962f68"),
  ("onnxruntime.dll", 17799168, "7f66f939a881baf4f46a2216496798edf4a1429878b646d12674aa62f27d8a25"),
  ("encoder.onnx", 26214060, "e0db705e94ec35d803b1df4f40cda23d064e1142977c80ab288430b109777a9d"),
];
/// the build check also downloads a short recording to recognise
const TEST_WAV: (&str, u64, &str) = ("test.wav", 436910, "a51b22a49ae98b67ec75e605428910eebc14c1e787ff78ddad4194bcf6b8427e");
const IDENT: &str = "com.retocker.absolute";
/// unloaded from memory after this long without dictation (loads again in about a second)
const IDLE: Duration = Duration::from_secs(20 * 60);

// ---------------------------------------------------------------- where it lives

/// a path the engine can open: sherpa-onnx wants plain (ASCII) paths, so a user folder with Cyrillic letters
/// is given by its short 8.3 name
fn ascii_path(p: &Path) -> Option<PathBuf> {
  let s = p.to_string_lossy();
  if s.is_ascii() {
    return Some(p.to_path_buf());
  }
  use std::os::windows::ffi::OsStrExt;
  let w: Vec<u16> = p.as_os_str().encode_wide().chain(Some(0)).collect();
  let mut buf = vec![0u16; 1024];
  let n = unsafe { windows::Win32::Storage::FileSystem::GetShortPathNameW(windows::core::PCWSTR(w.as_ptr()), Some(&mut buf)) } as usize;
  if n == 0 || n > buf.len() {
    return None;
  }
  let sp = String::from_utf16_lossy(&buf[..n]);
  sp.is_ascii().then(|| PathBuf::from(sp))
}

fn root() -> PathBuf {
  if let Ok(d) = std::env::var("RA_ASR_DIR") {
    if !d.trim().is_empty() {
      return PathBuf::from(d.trim());
    }
  }
  let a = sys::local_appdata().join(IDENT).join("asr");
  let _ = std::fs::create_dir_all(&a);
  if ascii_path(&a).is_some() {
    return a;
  }
  // no short names on this disk: a plain folder in ProgramData instead (removed with the settings)
  let pd = std::env::var("ProgramData").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("C:\\ProgramData"));
  pd.join("Retocker Voice").join("asr")
}
fn dir() -> PathBuf {
  root().join(TAG)
}
/// folders to remove when the user deletes the program with its settings
pub fn wipe_dirs() -> Vec<PathBuf> {
  let pd = std::env::var("ProgramData").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("C:\\ProgramData"));
  vec![pd.join("Retocker Voice")]
}
/// the installer leaves this when «download the model» was ticked; the app picks it up on start
pub fn want_marker() -> PathBuf {
  sys::local_appdata().join(IDENT).join("asr-want")
}

pub fn installed() -> bool {
  let d = dir();
  d.join("ready").is_file() && FILES.iter().all(|(f, n, _)| std::fs::metadata(d.join(f)).map(|m| m.len() == *n).unwrap_or(false))
}
fn size_on_disk() -> u64 {
  std::fs::read_dir(dir()).map(|r| r.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()).unwrap_or(0)
}

// ---------------------------------------------------------------- download

#[derive(Default, Clone)]
struct Dl {
  busy: bool,
  got: u64,
  total: u64,
  err: String,
}
static DL: Mutex<Dl> = Mutex::new(Dl { busy: false, got: 0, total: 0, err: String::new() });
static CANCEL: AtomicBool = AtomicBool::new(false);

fn sha_file(p: &Path) -> Option<String> {
  let mut f = std::fs::File::open(p).ok()?;
  let mut h = Sha256::new();
  let mut buf = vec![0u8; 256 * 1024];
  loop {
    let n = f.read(&mut buf).ok()?;
    if n == 0 {
      break;
    }
    h.update(&buf[..n]);
  }
  Some(h.finalize().iter().map(|x| format!("{x:02x}")).collect())
}

/// one file into the folder (kept if it is already there and right); progress(bytes of this file so far)
fn get_file(d: &Path, (name, size, sha): (&str, u64, &str), progress: &mut dyn FnMut(u64)) -> Result<(), String> {
  let dst = d.join(name);
  if std::fs::metadata(&dst).map(|m| m.len() == size).unwrap_or(false) && sha_file(&dst).as_deref() == Some(sha) {
    progress(size);
    return Ok(());
  }
  let part = d.join(format!("{name}.part"));
  let mut last = String::from("нет связи");
  for (base, mirror) in BASES {
    if CANCEL.load(Ordering::SeqCst) {
      return Err("cancel".into());
    }
    let url = if mirror { format!("{base}{name}.x") } else { format!("{base}{name}") };
    let r = (|| -> Result<(), String> {
      let resp = upd::agent().get(&url).call().map_err(|e| match e {
        ureq::Error::Status(c, _) => format!("сервер ответил {c}"),
        ureq::Error::Transport(t) => t.to_string(),
      })?;
      let mut rd = resp.into_reader().take(size + 1);
      let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
      let mut h = Sha256::new();
      let (mut got, mut buf) = (0u64, vec![0u8; 128 * 1024]);
      loop {
        if CANCEL.load(Ordering::SeqCst) {
          return Err("cancel".into());
        }
        let n = rd.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
          break;
        }
        if mirror {
          buf[..n].iter_mut().for_each(|b| *b ^= MIRROR_KEY);
        }
        out.write_all(&buf[..n]).map_err(|e| format!("не записалось на диск: {e}"))?;
        h.update(&buf[..n]);
        got += n as u64;
        progress(got.min(size));
      }
      drop(out);
      let hs: String = h.finalize().iter().map(|x| format!("{x:02x}")).collect();
      if got != size || hs != sha {
        return Err(format!("файл {name} пришёл испорченным"));
      }
      std::fs::rename(&part, &dst).map_err(|e| e.to_string())
    })();
    match r {
      Ok(()) => return Ok(()),
      Err(e) => {
        let _ = std::fs::remove_file(&part);
        if e == "cancel" {
          return Err(e);
        }
        logx::log(&format!("asr: {url}: {e}"));
        last = e;
      }
    }
  }
  Err(last)
}

/// everything the model needs; emit(got, total) as it goes
fn download_all(extra: &[(&str, u64, &str)], emit: &dyn Fn(u64, u64)) -> Result<(), String> {
  let d = dir();
  std::fs::create_dir_all(&d).map_err(|e| format!("не получилось создать папку: {e}"))?;
  let _ = std::fs::remove_file(d.join("ready"));
  let list: Vec<_> = FILES.iter().copied().chain(extra.iter().copied()).collect();
  let total: u64 = list.iter().map(|f| f.1).sum();
  let mut done = 0u64;
  let mut tick = Instant::now();
  for f in list {
    let base = done;
    get_file(&d, f, &mut |n| {
      if tick.elapsed() > Duration::from_millis(120) {
        tick = Instant::now();
        emit(base + n, total);
      }
    })?;
    done += f.1;
    emit(done, total);
  }
  std::fs::write(d.join("ready"), TAG).map_err(|e| e.to_string())?;
  Ok(())
}

pub fn start_download(app: AppHandle) {
  {
    let mut s = DL.lock().unwrap_or_else(|e| e.into_inner());
    if s.busy {
      return;
    }
    *s = Dl { busy: true, got: 0, total: FILES.iter().map(|f| f.1).sum(), err: String::new() };
  }
  CANCEL.store(false, Ordering::SeqCst);
  std::thread::spawn(move || {
    let t0 = Instant::now();
    let a = app.clone();
    let r = download_all(&[], &|got, total| {
      {
        let mut s = DL.lock().unwrap_or_else(|e| e.into_inner());
        s.got = got;
        s.total = total;
      }
      let _ = a.emit("asr_dl", json!({ "state": "run", "got": got, "total": total }));
    });
    let err = match &r {
      Ok(()) => String::new(),
      Err(e) if e == "cancel" => "cancel".into(),
      Err(e) => e.clone(),
    };
    logx::log(&format!("asr: download {} in {:.1}s", if err.is_empty() { "done" } else { &err }, t0.elapsed().as_secs_f32()));
    if !err.is_empty() {
      // nothing half-done stays behind
      let _ = std::fs::remove_dir_all(dir());
    }
    {
      let mut s = DL.lock().unwrap_or_else(|e| e.into_inner());
      s.busy = false;
      s.err = if err == "cancel" { String::new() } else { err.clone() };
    }
    let state = if err.is_empty() { "done" } else if err == "cancel" { "cancel" } else { "err" };
    let _ = app.emit("asr_dl", json!({ "state": state, "err": err }));
    if err.is_empty() {
      let _ = std::fs::remove_file(want_marker());
      send(Msg::Warm);
    }
  });
}

// ---------------------------------------------------------------- the worker

enum Msg {
  Warm,
  Start(u32),
  Feed(u32, Vec<f32>),
  Finish(u32, Sender<String>),
  Unload(Sender<()>),
}
static TX: OnceLock<Mutex<Sender<Msg>>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static LOAD_ERR: Mutex<String> = Mutex::new(String::new());

struct Engine {
  asr: Asr,
  #[allow(dead_code)]
  ort: Option<libloading::Library>,
}

fn load() -> Result<Engine, String> {
  let d = dir();
  if !installed() {
    return Err("модель не скачана".into());
  }
  let p = ascii_path(&d).ok_or("путь к модели с русскими буквами")?;
  let t0 = Instant::now();
  // our onnxruntime.dll first, by its full path: a different one (Windows has its own) is never picked up
  let ort = unsafe {
    libloading::os::windows::Library::load_with_flags(p.join("onnxruntime.dll"), libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH)
  }
  .map(libloading::Library::from)
  .map_err(|e| format!("onnxruntime.dll: {e}"))?;
  let asr = Asr::open(&p.join("sherpa-onnx-c-api.dll"), &p, 1)?;
  logx::log(&format!("asr: model loaded in {} ms", t0.elapsed().as_millis()));
  Ok(Engine { asr, ort: Some(ort) })
}

fn worker(rx: std::sync::mpsc::Receiver<Msg>) {
  let mut eng: Option<Engine> = None;
  let mut st: Option<(u32, Stream, String)> = None;
  let ensure = |eng: &mut Option<Engine>| -> bool {
    if eng.is_none() {
      match load() {
        Ok(e) => {
          *eng = Some(e);
          LOAD_ERR.lock().unwrap_or_else(|e| e.into_inner()).clear();
        }
        Err(e) => {
          logx::log(&format!("asr: load failed: {e}"));
          *LOAD_ERR.lock().unwrap_or_else(|e| e.into_inner()) = e;
        }
      }
    }
    eng.is_some()
  };
  loop {
    let m = match rx.recv_timeout(IDLE) {
      Ok(m) => m,
      Err(RecvTimeoutError::Timeout) => {
        if st.is_none() && eng.is_some() {
          eng = None;
          logx::log("asr: unloaded (not used for a while)");
        }
        continue;
      }
      Err(RecvTimeoutError::Disconnected) => break,
    };
    match m {
      Msg::Warm => {
        ensure(&mut eng);
      }
      Msg::Start(id) => {
        if let (Some(e), Some((_, s, _))) = (&eng, st.as_mut()) {
          e.asr.close(s);
        }
        st = None;
        if ensure(&mut eng) {
          if let Some(e) = &eng {
            st = Some((id, e.asr.stream(), String::new()));
          }
        }
      }
      Msg::Feed(id, pcm) => {
        if let (Some(e), Some((sid, s, sent))) = (&eng, st.as_mut()) {
          if *sid == id {
            let t = e.asr.feed(s, 16000, &pcm);
            if t != *sent {
              *sent = t.clone();
              if let Some(a) = APP.get() {
                let _ = a.emit("asr", json!({ "id": id, "text": t }));
              }
            }
          }
        }
      }
      Msg::Finish(id, reply) => {
        let mut out = String::new();
        if let (Some(e), Some((sid, s, _))) = (&eng, st.as_mut()) {
          if *sid == id {
            out = e.asr.finish(s, 16000);
            e.asr.close(s);
            st = None;
          }
        }
        let _ = reply.send(out);
      }
      Msg::Unload(reply) => {
        if let (Some(e), Some((_, s, _))) = (&eng, st.as_mut()) {
          e.asr.close(s);
        }
        st = None;
        eng = None;
        let _ = reply.send(());
      }
    }
  }
}

fn send(m: Msg) {
  let tx = TX.get_or_init(|| {
    let (tx, rx) = channel();
    std::thread::Builder::new().name("asr".into()).spawn(move || worker(rx)).ok();
    Mutex::new(tx)
  });
  let _ = tx.lock().unwrap_or_else(|e| e.into_inner()).send(m);
}

/// on start: remember the app (for events); the installer may have asked for the model
pub fn init(app: &AppHandle) {
  let _ = APP.set(app.clone());
  if want_marker().is_file() {
    if installed() {
      let _ = std::fs::remove_file(want_marker());
    } else {
      logx::log("asr: the installer asked for the model — downloading");
      start_download(app.clone());
    }
  }
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn asr_status() -> serde_json::Value {
  let s = DL.lock().unwrap_or_else(|e| e.into_inner()).clone();
  json!({
    "installed": installed(), "busy": s.busy, "got": s.got, "total": s.total, "err": s.err,
    "size": size_on_disk(), "need": FILES.iter().map(|f| f.1).sum::<u64>(),
    "loadErr": LOAD_ERR.lock().unwrap_or_else(|e| e.into_inner()).clone(),
  })
}

#[tauri::command]
pub fn asr_get(app: AppHandle) {
  start_download(app);
}

#[tauri::command]
pub fn asr_cancel() {
  CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn asr_del() -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(|| {
    CANCEL.store(true, Ordering::SeqCst);
    let (tx, rx) = channel();
    send(Msg::Unload(tx));
    let _ = rx.recv_timeout(Duration::from_secs(5));
    let _ = std::fs::remove_file(want_marker());
    let d = dir();
    let mut r = Ok(());
    for _ in 0..10 {
      r = if d.exists() { std::fs::remove_dir_all(&d).map_err(|e| e.to_string()) } else { Ok(()) };
      if r.is_ok() {
        break;
      }
      std::thread::sleep(Duration::from_millis(300));
    }
    logx::log(&format!("asr: model deleted {:?}", r));
    r
  })
  .await
  .map_err(|e| e.to_string())?
}

/// load it now (the capsule asks when the feature is on), so the first dictation has words at once
#[tauri::command]
pub fn asr_warm() {
  if installed() {
    send(Msg::Warm);
  }
}

#[tauri::command]
pub fn asr_start(id: u32) -> bool {
  if !installed() {
    return false;
  }
  send(Msg::Start(id));
  true
}

/// raw body: the recording's id (u32, little endian), then 16-bit 16 kHz mono samples
#[tauri::command]
pub fn asr_feed(request: tauri::ipc::Request<'_>) {
  if let tauri::ipc::InvokeBody::Raw(b) = request.body() {
    if b.len() > 4 {
      let id = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
      let pcm: Vec<f32> = b[4..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect();
      send(Msg::Feed(id, pcm));
    }
  }
}

/// the speech is over: the full local text (the last words included)
#[tauri::command]
pub async fn asr_finish(id: u32) -> String {
  tauri::async_runtime::spawn_blocking(move || {
    let (tx, rx) = channel();
    send(Msg::Finish(id, tx));
    rx.recv_timeout(Duration::from_secs(4)).unwrap_or_default()
  })
  .await
  .unwrap_or_default()
}

// ---------------------------------------------------------------- the build check

/// RA_DEBUG only: download everything (from the real places), load it, recognise a test recording;
/// the result goes to `out` (the app has no console). Exit code 0 = it heard words.
pub fn selftest(out: &str) -> i32 {
  let mut rep = String::new();
  let mut line = |s: String| {
    logx::log(&format!("asr selftest: {s}"));
    rep.push_str(&s);
    rep.push('\n');
    let _ = std::fs::write(out, &rep);
  };
  line(format!("folder {}", dir().display()));
  let t0 = Instant::now();
  if let Err(e) = download_all(&[TEST_WAV], &|_, _| {}) {
    line(format!("download failed: {e}"));
    return 2;
  }
  line(format!("downloaded in {:.1}s, {} bytes on disk", t0.elapsed().as_secs_f32(), size_on_disk()));
  let e = match load() {
    Ok(e) => e,
    Err(e) => {
      line(format!("load failed: {e}"));
      return 3;
    }
  };
  let wav = std::fs::read(dir().join(TEST_WAV.0)).unwrap_or_default();
  let at = wav.windows(4).position(|w| w == b"data").map(|i| i + 8).unwrap_or(wav.len());
  let pcm: Vec<f32> = wav[at..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect();
  let mut st = e.asr.stream();
  let t1 = Instant::now();
  let mut first = None;
  for (i, c) in pcm.chunks(1600).enumerate() {
    let t = e.asr.feed(&mut st, 16000, c);
    if first.is_none() && !t.is_empty() {
      first = Some((i, t));
    }
  }
  let text = e.asr.finish(&mut st, 16000);
  e.asr.close(&mut st);
  let audio = pcm.len() as f32 / 16000.0;
  line(format!("first words after {:.1}s of speech: {:?}", first.as_ref().map(|f| f.0 as f32 / 10.0).unwrap_or(-1.0), first.map(|f| f.1).unwrap_or_default()));
  line(format!("recognised {audio:.1}s of speech in {} ms (rtf {:.3})", t1.elapsed().as_millis(), t1.elapsed().as_secs_f32() / audio.max(0.1)));
  line(format!("text: {text}"));
  let _ = std::fs::remove_file(dir().join(TEST_WAV.0));
  if text.split_whitespace().count() >= 10 {
    0
  } else {
    4
  }
}
