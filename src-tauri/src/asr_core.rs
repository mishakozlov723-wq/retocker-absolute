//! The local speech model: sherpa-onnx (its C API, a DLL that comes with the model download, loaded at run time)
//! with a small streaming Russian model (Vosk). Speech goes in as it is spoken, the words come out at once.
//! Kept free of Tauri and Windows so it can be tried on any machine.
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;

use libloading::{Library, Symbol};

// the config structs exactly as in sherpa-onnx v2.0.1 c-api.h (zeros / nulls mean «the default»)
#[repr(C)]
struct Transducer {
  encoder: *const c_char,
  decoder: *const c_char,
  joiner: *const c_char,
}
#[repr(C)]
struct Two {
  a: *const c_char,
  b: *const c_char,
}
#[repr(C)]
struct One {
  model: *const c_char,
}
#[repr(C)]
struct ModelCfg {
  transducer: Transducer,
  paraformer: Two,
  zipformer2_ctc: One,
  tokens: *const c_char,
  num_threads: i32,
  provider: *const c_char,
  debug: i32,
  model_type: *const c_char,
  modeling_unit: *const c_char,
  bpe_vocab: *const c_char,
  tokens_buf: *const c_char,
  tokens_buf_size: i32,
  nemo_ctc: One,
  t_one_ctc: One,
}
#[repr(C)]
struct Feat {
  sample_rate: i32,
  feature_dim: i32,
}
#[repr(C)]
struct Fst {
  graph: *const c_char,
  max_active: i32,
}
#[repr(C)]
struct Hr {
  dict_dir: *const c_char,
  lexicon: *const c_char,
  rule_fsts: *const c_char,
}
#[repr(C)]
struct RecCfg {
  feat: Feat,
  model: ModelCfg,
  decoding_method: *const c_char,
  max_active_paths: i32,
  enable_endpoint: i32,
  rule1_min_trailing_silence: f32,
  rule2_min_trailing_silence: f32,
  rule3_min_utterance_length: f32,
  hotwords_file: *const c_char,
  hotwords_score: f32,
  ctc_fst: Fst,
  rule_fsts: *const c_char,
  rule_fars: *const c_char,
  blank_penalty: f32,
  hotwords_buf: *const c_char,
  hotwords_buf_size: i32,
  hr: Hr,
}
#[repr(C)]
struct RecResult {
  text: *const c_char,
}

type P = *const c_void;
struct Fns {
  create: unsafe extern "C" fn(*const RecCfg) -> P,
  destroy: unsafe extern "C" fn(P),
  stream: unsafe extern "C" fn(P) -> P,
  destroy_stream: unsafe extern "C" fn(P),
  accept: unsafe extern "C" fn(P, i32, *const f32, i32),
  ready: unsafe extern "C" fn(P, P) -> i32,
  decode: unsafe extern "C" fn(P, P),
  result: unsafe extern "C" fn(P, P) -> *const RecResult,
  free_result: unsafe extern "C" fn(*const RecResult),
  finished: unsafe extern "C" fn(P),
  endpoint: unsafe extern "C" fn(P, P) -> i32,
  reset: unsafe extern "C" fn(P, P),
}

pub struct Asr {
  f: Fns,
  rec: P,
  _lib: Library,
}
// used from one worker thread at a time
unsafe impl Send for Asr {}

pub struct Stream {
  s: P,
  /// the text of the phrases already closed by a pause
  done: String,
  pub last: String,
}
unsafe impl Send for Stream {}

pub const FILES: [&str; 4] = ["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"];

fn cs(p: &Path) -> Result<CString, String> {
  CString::new(p.to_string_lossy().as_bytes()).map_err(|e| e.to_string())
}

impl Asr {
  /// lib_path: the sherpa-onnx C API library; dir: the model files. On Windows both paths must be plain (ASCII).
  pub fn open(lib_path: &Path, dir: &Path, threads: i32) -> Result<Asr, String> {
    for f in FILES {
      if !dir.join(f).is_file() {
        return Err(format!("нет файла {f}"));
      }
    }
    let lib = open_lib(lib_path)?;
    let f = unsafe {
      macro_rules! sym {
        ($n:literal) => {{
          let s: Symbol<_> = lib.get(concat!($n, "\0").as_bytes()).map_err(|e| format!("{}: {e}", $n))?;
          *s
        }};
      }
      Fns {
        create: sym!("SherpaOnnxCreateOnlineRecognizer"),
        destroy: sym!("SherpaOnnxDestroyOnlineRecognizer"),
        stream: sym!("SherpaOnnxCreateOnlineStream"),
        destroy_stream: sym!("SherpaOnnxDestroyOnlineStream"),
        accept: sym!("SherpaOnnxOnlineStreamAcceptWaveform"),
        ready: sym!("SherpaOnnxIsOnlineStreamReady"),
        decode: sym!("SherpaOnnxDecodeOnlineStream"),
        result: sym!("SherpaOnnxGetOnlineStreamResult"),
        free_result: sym!("SherpaOnnxDestroyOnlineRecognizerResult"),
        finished: sym!("SherpaOnnxOnlineStreamInputFinished"),
        endpoint: sym!("SherpaOnnxOnlineStreamIsEndpoint"),
        reset: sym!("SherpaOnnxOnlineStreamReset"),
      }
    };
    let (enc, dec, joi, tok) = (cs(&dir.join(FILES[0]))?, cs(&dir.join(FILES[1]))?, cs(&dir.join(FILES[2]))?, cs(&dir.join(FILES[3]))?);
    let (cpu, greedy) = (CString::new("cpu").unwrap(), CString::new("greedy_search").unwrap());
    let n = std::ptr::null();
    let cfg = RecCfg {
      feat: Feat { sample_rate: 16000, feature_dim: 80 },
      model: ModelCfg {
        transducer: Transducer { encoder: enc.as_ptr(), decoder: dec.as_ptr(), joiner: joi.as_ptr() },
        paraformer: Two { a: n, b: n },
        zipformer2_ctc: One { model: n },
        tokens: tok.as_ptr(),
        num_threads: threads,
        provider: cpu.as_ptr(),
        debug: 0,
        model_type: n,
        modeling_unit: n,
        bpe_vocab: n,
        tokens_buf: n,
        tokens_buf_size: 0,
        nemo_ctc: One { model: n },
        t_one_ctc: One { model: n },
      },
      decoding_method: greedy.as_ptr(),
      max_active_paths: 4,
      enable_endpoint: 1,
      rule1_min_trailing_silence: 2.4,
      rule2_min_trailing_silence: 1.0,
      rule3_min_utterance_length: 20.0,
      hotwords_file: n,
      hotwords_score: 0.0,
      ctc_fst: Fst { graph: n, max_active: 0 },
      rule_fsts: n,
      rule_fars: n,
      blank_penalty: 0.0,
      hotwords_buf: n,
      hotwords_buf_size: 0,
      hr: Hr { dict_dir: n, lexicon: n, rule_fsts: n },
    };
    let rec = unsafe { (f.create)(&cfg) };
    if rec.is_null() {
      return Err("модель не открылась".into());
    }
    Ok(Asr { f, rec, _lib: lib })
  }

  pub fn stream(&self) -> Stream {
    Stream { s: unsafe { (self.f.stream)(self.rec) }, done: String::new(), last: String::new() }
  }

  fn text(&self, st: &Stream) -> String {
    unsafe {
      let r = (self.f.result)(self.rec, st.s);
      if r.is_null() {
        return String::new();
      }
      let t = if (*r).text.is_null() { String::new() } else { CStr::from_ptr((*r).text).to_string_lossy().trim().to_string() };
      (self.f.free_result)(r);
      t
    }
  }
  fn full(st: &Stream, cur: &str) -> String {
    match (st.done.is_empty(), cur.is_empty()) {
      (true, _) => cur.to_string(),
      (false, true) => st.done.clone(),
      _ => format!("{} {}", st.done, cur),
    }
  }

  /// more speech (any sample rate, mono, -1..1); the whole text so far
  pub fn feed(&self, st: &mut Stream, rate: i32, pcm: &[f32]) -> String {
    if st.s.is_null() {
      return st.last.clone();
    }
    unsafe {
      if !pcm.is_empty() {
        (self.f.accept)(st.s, rate, pcm.as_ptr(), pcm.len() as i32);
      }
      while (self.f.ready)(self.rec, st.s) != 0 {
        (self.f.decode)(self.rec, st.s);
      }
      let cur = self.text(st);
      if (self.f.endpoint)(self.rec, st.s) != 0 {
        // a pause closed the phrase: keep its text, start the next one clean
        if !cur.is_empty() {
          st.done = Self::full(st, &cur);
        }
        (self.f.reset)(self.rec, st.s);
        st.last = st.done.clone();
      } else {
        st.last = Self::full(st, &cur);
      }
    }
    st.last.clone()
  }

  /// the speech is over: the last words (a bit of silence pushes them out of the model)
  pub fn finish(&self, st: &mut Stream, rate: i32) -> String {
    if st.s.is_null() {
      return st.last.clone();
    }
    let tail = vec![0f32; (rate.max(8000) as usize) * 6 / 10];
    unsafe {
      (self.f.accept)(st.s, rate, tail.as_ptr(), tail.len() as i32);
      (self.f.finished)(st.s);
      while (self.f.ready)(self.rec, st.s) != 0 {
        (self.f.decode)(self.rec, st.s);
      }
    }
    let cur = self.text(st);
    st.last = Self::full(st, &cur);
    st.last.clone()
  }

  pub fn close(&self, st: &mut Stream) {
    if !st.s.is_null() {
      unsafe { (self.f.destroy_stream)(st.s) };
      st.s = std::ptr::null();
    }
  }
}

impl Drop for Asr {
  fn drop(&mut self) {
    unsafe { (self.f.destroy)(self.rec) };
  }
}

#[cfg(windows)]
fn open_lib(p: &Path) -> Result<Library, String> {
  // the DLLs it needs (onnxruntime) are found next to it
  use libloading::os::windows::{Library as WL, LOAD_WITH_ALTERED_SEARCH_PATH};
  unsafe { WL::load_with_flags(p, LOAD_WITH_ALTERED_SEARCH_PATH) }.map(Library::from).map_err(|e| e.to_string())
}
#[cfg(not(windows))]
fn open_lib(p: &Path) -> Result<Library, String> {
  unsafe { Library::new(p) }.map_err(|e| e.to_string())
}
