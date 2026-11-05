// Retocker Voice: dictation for Windows. Speak — the text appears where the cursor is.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asr;
mod asr_core;
mod hook;
mod logx;
mod paste;
mod setup;
mod sys;
mod upd;
mod win;

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// the same for every window: they share one WebView2 browser, which needs identical arguments
const ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding";

static OVL: AtomicIsize = AtomicIsize::new(0);
static FOCUSED: AtomicBool = AtomicBool::new(false);
static HITS: Mutex<Vec<[i32; 4]>> = Mutex::new(Vec::new());
/// started by an update: the version it updated to (the settings say «Обновлено до …»)
static UPDATED: OnceLock<String> = OnceLock::new();

fn ovl() -> windows::Win32::Foundation::HWND {
  win::hwnd_of(OVL.load(Ordering::SeqCst))
}

fn perm(_: tauri::Webview, k: PermissionKind) -> PermissionResponse {
  match k {
    PermissionKind::Microphone | PermissionKind::Autoplay | PermissionKind::ClipboardRead => PermissionResponse::Allow,
    _ => PermissionResponse::Default,
  }
}

fn show_main(app: &AppHandle, page: Option<&str>) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    if let Ok(h) = w.hwnd() {
      win::force_front(h);
    }
    if let Some(p) = page {
      let _ = app.emit_to("main", "page", p);
    }
  }
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn set_hotkey(combo: String, mode: String) -> bool {
  hook::set_hotkey(&combo, mode == "hold")
}

#[tauri::command]
fn set_keys(esc: bool, enter: bool) {
  hook::set_keys(esc, enter);
}

#[tauri::command]
fn hk_record(on: bool) {
  hook::set_record(on);
}

#[tauri::command]
fn set_paused(on: bool) {
  hook::set_paused(on);
}

/// rectangles of the capsule / panel in physical pixels, relative to the overlay window
#[tauri::command]
fn set_hit(rects: Vec<[f64; 4]>) {
  let v = rects.iter().map(|r| [r[0].floor() as i32, r[1].floor() as i32, r[2].ceil() as i32, r[3].ceil() as i32]).collect();
  *HITS.lock().unwrap_or_else(|e| e.into_inner()) = v;
}

#[tauri::command]
async fn paste(text: String, method: String, keep: bool) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    if FOCUSED.swap(false, Ordering::SeqCst) {
      win::give_focus_back(ovl());
      std::thread::sleep(Duration::from_millis(90));
    }
    let r = paste::paste(ovl(), &text, &method, keep);
    if let Err(e) = &r {
      logx::log(&format!("paste failed: {e}"));
    }
    r
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
fn copy_text(text: String) -> bool {
  paste::copy_text(ovl(), &text)
}

#[tauri::command]
fn fg_app() -> win::FgApp {
  win::note_front();
  win::fg_app()
}

/// the overlay takes the keyboard (editing the text in review) or gives it back
#[tauri::command]
fn focus_overlay(on: bool) {
  if on {
    if !FOCUSED.swap(true, Ordering::SeqCst) {
      win::take_focus(ovl());
    }
  } else if FOCUSED.swap(false, Ordering::SeqCst) {
    win::give_focus_back(ovl());
  }
}

#[tauri::command]
fn show_settings(app: AppHandle, page: Option<String>) {
  show_main(&app, page.as_deref());
}

#[tauri::command]
fn quit(app: AppHandle) {
  app.exit(0);
}

#[tauri::command]
fn app_info(app: AppHandle) -> serde_json::Value {
  json!({
    "version": app.package_info().version.to_string(),
    "autostart": win::autostart_get(),
    "logs": logx::dir().map(|d| d.display().to_string()).unwrap_or_default(),
    "updated": UPDATED.get().cloned().unwrap_or_default(),
    "installed": setup::installed_dir().is_some(),
  })
}

/// is there a newer version (the signed manifest of the download page)
#[tauri::command]
async fn upd_check(app: AppHandle) -> Result<serde_json::Value, String> {
  let cur = app.package_info().version.to_string();
  tauri::async_runtime::spawn_blocking(move || {
    upd::check().map(|m| {
      json!({ "version": m.version, "notes": m.notes, "size": m.size, "url": m.url, "newer": upd::newer(&m.version, &cur),
        "can": !m.sha256.is_empty() && !m.sig.is_empty() && !m.url.is_empty() })
    })
  })
  .await
  .map_err(|e| e.to_string())?
}

/// download, check, replace, restart (progress comes as «upd» events)
#[tauri::command]
fn upd_install(app: AppHandle) {
  std::thread::spawn(move || {
    let _ = upd::install(app);
  });
}

#[tauri::command]
fn autostart(on: bool) -> bool {
  win::autostart_set(on) && win::autostart_get() == on
}

#[tauri::command]
fn open_url(url: String) {
  if url.starts_with("https://") || url.starts_with("http://") {
    win::open_url(&url);
  }
}

#[tauri::command]
fn open_logs() {
  if let Some(d) = logx::dir() {
    win::open_url(&d.display().to_string());
  }
}

#[tauri::command]
fn log(msg: String) {
  logx::log(&format!("js: {}", msg.chars().take(2000).collect::<String>()));
}

/// custom title bar buttons of the settings window
#[tauri::command]
fn win_ctl(window: WebviewWindow, a: String) {
  match a.as_str() {
    "min" => {
      let _ = window.minimize();
    }
    "max" => {
      if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
      } else {
        let _ = window.maximize();
      }
    }
    _ => {
      let _ = window.hide();
    }
  }
}

// ---------------------------------------------------------------- overlay: click-through + placement

fn overlay_loop(app: AppHandle) {
  std::thread::spawn(move || {
    let h = ovl();
    let mut area = win::work_area();
    win::place(h, area);
    let mut interactive = false;
    let mut lock = false;
    let mut was_down = false;
    let mut fs = false;
    let mut last_area = Instant::now();
    let mut last_top = Instant::now();
    let mut last_fs = Instant::now();
    let mut watch = hook::Watch::default();
    loop {
      std::thread::sleep(Duration::from_millis(12));
      watch.tick();
      let (cx, cy) = win::cursor();
      let (x, y) = (cx - area.left, cy - area.top);
      let inside = HITS.lock().map(|r| r.iter().any(|q| x >= q[0] && y >= q[1] && x < q[0] + q[2] && y < q[1] + q[3])).unwrap_or(false);
      let down = win::lbutton();
      if down && !was_down {
        lock = inside; // a press that starts on the capsule keeps it ours until release (dragging)
      }
      if !down {
        lock = false;
      }
      was_down = down;
      let want = inside || lock;
      if want != interactive {
        interactive = want;
        win::set_clickthrough(h, !want);
        let _ = app.emit_to("capsule", "hit", json!({ "inside": want }));
      }
      if last_area.elapsed() > Duration::from_millis(1000) {
        last_area = Instant::now();
        let a = win::work_area();
        if a != area {
          area = a;
          win::place(h, area);
          logx::log(&format!("work area {}x{} at {},{}", a.right - a.left, a.bottom - a.top, a.left, a.top));
        }
      }
      if last_fs.elapsed() > Duration::from_millis(500) {
        last_fs = Instant::now();
        let f = win::fullscreen_front();
        if f != fs {
          fs = f;
          let _ = app.emit_to("capsule", "fs", json!({ "on": f }));
        }
      }
      if last_top.elapsed() > Duration::from_millis(2500) {
        last_top = Instant::now();
        if !fs {
          win::keep_on_top(h);
        }
      }
    }
  });
}

fn main() {
  let args: Vec<String> = std::env::args().collect();
  // helpers started with administrator rights for a folder like Program Files: copy, then quit (no window)
  if let Some(t) = setup::arg_after(&args, "--apply-update") {
    std::process::exit(upd::apply_elevated(&t));
  }
  if let Some(d) = setup::arg_after(&args, "--install-files") {
    std::process::exit(setup::install_files_elevated(&d));
  }
  logx::init(sys::local_appdata().join("com.retocker.absolute").join("logs"));
  std::panic::set_hook(Box::new(|p| logx::log(&format!("panic: {p}"))));
  // RA_DEBUG only (the build check): download the local speech model, recognise a test recording, report
  if let Some(out) = setup::arg_after(&args, "--asr-selftest") {
    if std::env::var("RA_DEBUG").map(|v| v == "1").unwrap_or(false) {
      std::process::exit(asr::selftest(&out));
    }
  }
  // after an update the new copy starts while the old one is still quitting: wait for it
  if let Some(pid) = setup::arg_after(&args, "--wait-pid").and_then(|s| s.parse::<u32>().ok()) {
    let gone = sys::wait_pid(pid, 20000);
    logx::log(&format!("waited for the old copy ({pid}): {}", if gone { "gone" } else { "still there" }));
  }
  if let Some(v) = setup::arg_after(&args, "--updated") {
    let _ = UPDATED.set(v);
  }
  let ctx = tauri::generate_context!();
  let ver = ctx.package_info().version.to_string();
  let mode = setup::mode(&args);
  if mode != setup::Mode::App && args.iter().any(|a| a == "--silent" || a == "/S") {
    std::process::exit(setup::silent(mode, &ver, &args));
  }
  if !sys::webview2_ensure() {
    std::process::exit(1);
  }
  if mode != setup::Mode::App {
    logx::log(&format!("{mode:?} v{ver}"));
    setup::run_ui(mode, ctx);
    return;
  }
  upd::cleanup_old();
  run_app(ctx, args.iter().any(|a| a == "--autostart"));
}

fn run_app(ctx: tauri::Context<tauri::Wry>, autostarted: bool) {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      // RA_DEBUG only (the build check): a second start with --test-update updates from RA_UPDATE_URL
      if args.iter().any(|a| a == "--test-update") && std::env::var("RA_DEBUG").map(|v| v == "1").unwrap_or(false) {
        let a = app.clone();
        std::thread::spawn(move || {
          let r = upd::check();
          logx::log(&format!("test update: manifest {:?}", r.as_ref().map(|m| m.version.clone())));
          let _ = upd::install(a);
        });
        return;
      }
      // RA_DEBUG only (the build check): a second start with --test-keys plays key events through the hook logic
      if let Some(i) = args.iter().position(|a| a == "--test-keys") {
        if hook::debug() {
          let spec = args.get(i + 1).cloned().unwrap_or_default();
          std::thread::spawn(move || hook::test_keys(&spec));
          return;
        }
      }
      show_main(app, None)
    }))
    .invoke_handler(tauri::generate_handler![
      set_hotkey, set_keys, hk_record, set_paused, set_hit, paste, copy_text, fg_app, focus_overlay, show_settings, quit,
      app_info, autostart, open_url, open_logs, log, win_ctl, upd_check, upd_install, asr::asr_status, asr::asr_get, asr::asr_cancel,
      asr::asr_del, asr::asr_warm, asr::asr_start, asr::asr_feed, asr::asr_finish
    ])
    .setup(move |app| {
      let h = app.handle().clone();
      if let Ok(d) = app.path().app_local_data_dir() {
        logx::init(d.join("logs"));
      }
      logx::log(&format!("start v{} autostart={autostarted} updated={}", app.package_info().version, UPDATED.get().map(|s| s.as_str()).unwrap_or("")));
      win::autostart_migrate();
      asr::init(&h);

      // the capsule: a transparent layer over the whole work area that lets clicks through except on the capsule
      let cap = WebviewWindowBuilder::new(app, "capsule", WebviewUrl::App("capsule.html".into()))
        .title("Retocker Voice — капсула")
        .inner_size(600.0, 400.0)
        .position(0.0, 0.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .additional_browser_args(ARGS)
        .on_permission_request(perm)
        .build()?;
      if let Ok(hw) = cap.hwnd() {
        OVL.store(hw.0 as isize, Ordering::SeqCst);
        win::overlay_styles(hw);
        win::place(hw, win::work_area());
      }

      // settings
      let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("settings.html".into()))
        .title("Retocker Voice")
        .inner_size(1000.0, 680.0)
        .min_inner_size(880.0, 560.0)
        .center()
        .decorations(false)
        .shadow(true)
        .visible(false)
        .background_color(tauri::window::Color(25, 25, 25, 255))
        .additional_browser_args(ARGS)
        .on_permission_request(perm)
        .build()?;
      {
        let m2 = main.clone();
        main.on_window_event(move |e| {
          if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = m2.hide();
          }
        });
      }

      // tray
      let open = MenuItem::with_id(app, "open", "Открыть Retocker Voice", true, None::<&str>)?;
      let stats = MenuItem::with_id(app, "stats", "Статистика", true, None::<&str>)?;
      let sep = PredefinedMenuItem::separator(app)?;
      let quit_i = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &stats, &sep, &quit_i])?;
      let mut tb = TrayIconBuilder::with_id("tray")
        .tooltip("Retocker Voice")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
          "open" => show_main(app, None),
          "stats" => show_main(app, Some("home")),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, e| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_main(tray.app_handle(), None);
          }
        });
      if let Some(i) = app.default_window_icon() {
        tb = tb.icon(i.clone());
      }
      tb.build(app)?;

      // keyboard
      let hh = h.clone();
      hook::start(move |e| match e {
        hook::Ev::Hk(t, other) => {
          let _ = hh.emit_to("capsule", "hk", json!({ "t": t, "other": other }));
        }
        hook::Ev::Key(k) => {
          let _ = hh.emit_to("capsule", "key", json!({ "k": k }));
        }
        hook::Ev::Rec { name, down, m } => {
          let _ = hh.emit_to("main", "rec", json!({ "name": name, "down": down, "m": m }));
        }
        _ => {}
      });
      hook::set_hotkey("Ctrl+Win", true);
      overlay_loop(h.clone());

      if !autostarted {
        let _ = main.show();
        let _ = main.set_focus();
      }
      Ok(())
    })
    .run(ctx)
    .expect("Retocker Voice could not start");
}
