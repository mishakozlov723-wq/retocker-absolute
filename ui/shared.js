'use strict';
// Shared by the capsule (overlay) and the settings window: settings, presets, helpers.
(() => {
  const KEY = 'ra.cfg';
  const DEF = {
    // look
    bg: 'graphite', bgc: '#2c2c2c', acc: '#ffffff', wcol: 'accent', shape: 'pill', scale: 100, border: true, shadow: true, glow: 25,
    anim: 'smooth', speed: 100, idle: 'line', idleSc: 100, breathe: false, idleOp: 85, hint: true,
    wave: 'bars', bars: 9, sens: 100,
    timer: true, btns: false, proc: 'shimmer', sounds: false,
    // live text
    live: 'tap', pdot: false, reveal: 'letters', fs: 15, pw: 420,
    // «Текст внутри капсулы»: no separate panel — the capsule itself grows into the block with the text
    inl: false,
    // the local speech model (when it is downloaded): words at once; the colour of the corrections afterwards
    fast: true, fixc: 'blue',
    // after speech
    review: false, revBtn: true, clean: true, smart: true,
    // «Мгновенный перевод»: the language the dictated text is translated into before it is inserted ('off' — as spoken)
    tr: 'off',
    // control
    hk: 'Ctrl+Win', mode: 'hold', pos: 'bottom', off: 22, fx: .5, fy: .62, hideFs: true,
    // recognition & insertion
    lang: 'ru', dict: '', fillers: '', mic: '', paste: 'clip', keepClip: true
  };
  const PK = ['bg', 'acc', 'wcol', 'shape', 'scale', 'border', 'shadow', 'glow', 'anim', 'speed', 'idle', 'breathe', 'idleOp', 'hint', 'wave', 'bars', 'sens', 'timer', 'btns', 'proc', 'live', 'reveal'];
  const BASE = Object.fromEntries(PK.map(k => [k, DEF[k]]));
  const PRESETS = [
    { id: 'notion', name: 'Ноушен', v: {} },
    { id: 'drop', name: 'Капля', v: { bg: 'coal', acc: '#7fb4f0', glow: 45, anim: 'drop', idle: 'mini', idleOp: 90, wave: 'dots', bars: 7, sens: 110, timer: false, proc: 'dots', reveal: 'words' } },
    { id: 'contrast', name: 'Контраст', v: { bg: 'coal', wcol: 'text', scale: 110, glow: 10, anim: 'spring', wave: 'bars', bars: 14, btns: true, proc: 'dots', idleOp: 100, reveal: 'words' } },
    { id: 'glass', name: 'Стекло', v: { bg: 'glass', acc: '#b49cf0', glow: 60, anim: 'island', wave: 'line', reveal: 'fade', idleOp: 90 } },
    { id: 'min', name: 'Минимум', v: { acc: '#a8a8a8', wcol: 'gray', glow: 0, anim: 'fade', idle: 'dot', idleOp: 70, hint: false, wave: 'pulse', timer: false, live: 'off', proc: 'ring', reveal: 'fade' } }
  ].map(p => ({ ...p, v: { ...BASE, ...p.v } }));
  const BGS = [['graphite', '#1f1f1f', 'Графит'], ['coal', '#0c0c0c', 'Уголь'], ['glass', null, 'Стекло'], ['light', '#f2f2f0', 'Светлый']];
  // the colour corrected words flash in when the final text comes: [id, on a dark panel, on a light one, name]
  const FIXC = [['blue', '#9cc3ff', '#2f6fd0', 'Голубой'], ['mint', '#8fe0b8', '#1f8f5c', 'Мята'], ['amber', '#ffd27a', '#b57800', 'Янтарь'], ['lilac', '#c9b3ff', '#6b4fd0', 'Лаванда'], ['rose', '#ffa8c8', '#c0396f', 'Роза'], ['acc', null, null, 'Как акцент'], ['off', null, null, 'Без подсветки']];
  // «Мгновенный перевод»: [code, the name in the settings, the name the language model is told]
  const TRL = [['en', 'English', 'English'], ['ru', 'Русский', 'Russian'], ['zh', '中文', 'Simplified Chinese'], ['es', 'Español', 'Spanish'], ['de', 'Deutsch', 'German'], ['fr', 'Français', 'French'],
    ['uk', 'Українська', 'Ukrainian'], ['kk', 'Қазақша', 'Kazakh'], ['tr', 'Türkçe', 'Turkish'], ['ja', '日本語', 'Japanese']];
  const ACCS = [['#ffffff', 'Белый'], ['#a8a8a8', 'Серебро'], ['#d9c7a7', 'Песок'], ['#7fd1ae', 'Мята'], ['#7fb4f0', 'Небо'], ['#b49cf0', 'Лаванда'], ['#f09cc0', 'Роза'], ['#f0b46a', 'Янтарь'], ['#f08a7a', 'Коралл']];

  function load() {
    const S = { ...DEF };
    try { const v = localStorage.getItem(KEY); if (v) Object.assign(S, JSON.parse(v)); } catch (e) {}
    for (const k in S) if (!(k in DEF)) delete S[k];
    return S;
  }
  // profiles: whole sets of settings; the one turned on keeps every change. {list:[{id,name,apps,v}], cur, base}
  const PROF = 'ra.prof';
  function profs() {
    try {
      const p = JSON.parse(localStorage.getItem(PROF) || 'null');
      if (!p || !Array.isArray(p.list) || !p.list.length) return null;
      p.list.forEach(x => { if (!Array.isArray(x.apps)) x.apps = []; });
      if (!p.list.some(x => x.id === p.cur)) p.cur = p.list[0].id;
      if (!p.list.some(x => x.id === p.base)) p.base = (p.list.find(x => !x.apps.length) || p.list[0]).id;
      return p;
    } catch (e) { return null; }
  }
  function setProfs(p) { try { if (p) localStorage.setItem(PROF, JSON.stringify(p)); else localStorage.removeItem(PROF); } catch (e) {} }
  function save(S) {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    const p = profs(); if (!p) return;
    const was = JSON.stringify(p);
    // the dictionary, filler phrases and microphone are the same in every profile
    p.list.forEach(x => { if (x.id === p.cur) x.v = { ...S }; else { x.v.dict = S.dict; x.v.fillers = S.fillers; x.v.mic = S.mic; } });
    if (JSON.stringify(p) !== was) setProfs(p);
  }
  // turn a profile on (manual: a profile without programs becomes the one for all the other programs)
  function useProf(id, manual) {
    const p = profs(), c = p && p.list.find(x => x.id === id); if (!c) return null;
    p.cur = id; if (manual && !c.apps.length) p.base = id; setProfs(p);
    const S = { ...DEF, ...c.v, fillers: load().fillers }; for (const k in S) if (!(k in DEF)) delete S[k];
    save(S); return S;
  }
  const appKey = s => String(s || '').trim().toLowerCase().replace(/\.exe$/, '');
  // which profile belongs in front of this program (null: no profile is tied to programs)
  function profFor(a) {
    const p = profs(); if (!p || !p.list.some(x => x.apps.length)) return null;
    const ks = [a && a.name, a && a.exe].map(appKey).filter(Boolean); if (!ks.length) return null;
    const m = p.list.find(x => x.apps.some(n => ks.includes(appKey(n))));
    return m ? m.id : p.base;
  }

  // the Groq key and the proxy address live only here, on this computer
  const AUTH = 'ra.auth';
  function auth() { try { return { vk: '', vu: '', ok: false, ...JSON.parse(localStorage.getItem(AUTH) || '{}') }; } catch (e) { return { vk: '', vu: '', ok: false }; } }
  function setAuth(a) { try { localStorage.setItem(AUTH, JSON.stringify(a)); } catch (e) {} }
  const isProxy = u => /^https:\/\/script\.google(usercontent)?\.com\/macros\/s\/[\w-]+\/exec/.test(String(u || '').trim());
  const hasKey = a => /^gsk_\w{20,}$/.test(String(a.vk || '').trim());

  // statistics: words per day, per program, totals
  const STATS = 'ra.stats';
  function stats() {
    try { const s = JSON.parse(localStorage.getItem(STATS) || '{}'); return { days: {}, apps: {}, w: 0, n: 0, sec: 0, ...s }; } catch (e) { return { days: {}, apps: {}, w: 0, n: 0, sec: 0 }; }
  }
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function addStat(words, sec, app) {
    const s = stats(), k = dayKey();
    const d = s.days[k] || (s.days[k] = { w: 0, n: 0, sec: 0 });
    d.w += words; d.n++; d.sec += sec;
    const name = String(app || '').trim() || 'Другое';
    const a = s.apps[name] || (s.apps[name] = { w: 0, n: 0 });
    a.w += words; a.n++;
    s.w += words; s.n++; s.sec += sec;
    try { localStorage.setItem(STATS, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  const pl = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const words_ = n => n + ' ' + pl(n, 'слово', 'слова', 'слов');
  // words as people count them: «120 000» is one word, a dash is none
  const wc = s => (String(s || '').match(/\d{1,3}(?:[\s\u00a0\u202f]\d{3}(?!\d))+|[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // hotkey names for people: RCtrl -> «Правый Ctrl»
  const SIDE = { L: 'Левый', R: 'Правый' };
  const hkPart = p => { const m = /^([LR])(Ctrl|Alt|Shift|Win)$/.exec(p); return m ? SIDE[m[1]] + ' ' + m[2] : p; };
  const hkParts = hk => String(hk || '').split('+').filter(Boolean).map(hkPart);
  const hkLabel = hk => hkParts(hk).join(' + ');
  const isModOnly = hk => String(hk || '').split('+').every(p => /^[LR]?(Ctrl|Alt|Shift|Win)$/.test(p));

  function rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function lum(h) { const c = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  const hexA = (h, a) => `rgba(${rgb(h).join(',')},${a})`;

  // the raw sound for the local model: 16 kHz, 16-bit pieces of 0.1 s from a microphone source node.
  // onpcm(Int16Array) is called for every piece; returns the node (disconnect it to stop)
  const TAPW = `registerProcessor('ra-tap', class extends AudioWorkletProcessor {
    constructor() { super(); this.r = sampleRate / 16000; this.acc = 0; this.n = 0; this.pos = 0; this.out = new Int16Array(1600); this.o = 0; }
    process(inp) {
      const c = inp[0] && inp[0][0]; if (!c) return true;
      for (let i = 0; i < c.length; i++) {
        this.acc += c[i]; this.n++; this.pos += 1;
        if (this.pos >= this.r) {
          this.pos -= this.r;
          const v = Math.max(-1, Math.min(1, this.acc / this.n)); this.acc = 0; this.n = 0;
          this.out[this.o++] = v < 0 ? v * 32768 : v * 32767;
          if (this.o === this.out.length) { this.port.postMessage(this.out, [this.out.buffer]); this.out = new Int16Array(1600); this.o = 0; }
        }
      }
      return true;
    }
  });`;
  const tapMods = new WeakMap();
  async function pcmTap(ctx, src, onpcm) {
    if (!tapMods.has(ctx)) tapMods.set(ctx, ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAPW], { type: 'application/javascript' }))));
    await tapMods.get(ctx);
    const node = new AudioWorkletNode(ctx, 'ra-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    node.port.onmessage = e => onpcm(e.data);
    src.connect(node);
    return node;
  }
  // one piece to the model: the recording's id first, then the samples (sent as raw bytes, not JSON)
  function asrFeed(id, pcm) {
    const b = new Uint8Array(4 + pcm.byteLength);
    new DataView(b.buffer).setUint32(0, id, true);
    b.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 4);
    return invoke('asr_feed', b).catch(() => {});
  }

  const T = window.__TAURI__;
  const invoke = (cmd, args) => T ? T.core.invoke(cmd, args) : Promise.reject(new Error('no tauri'));
  const listen = (ev, fn) => T ? T.event.listen(ev, fn) : Promise.resolve(() => {});
  const emitTo = (label, ev, p) => T ? T.event.emitTo(label, ev, p === undefined ? null : p).catch(() => {}) : Promise.resolve();
  const log = m => { try { invoke('log', { msg: String(m) }).catch(() => {}); } catch (e) {} };

  window.RA = { KEY, DEF, PK, PROF, profs, setProfs, useProf, profFor, appKey, PRESETS, BGS, ACCS, FIXC, TRL, pcmTap, asrFeed, load, save, AUTH, auth, setAuth, isProxy, hasKey, STATS, stats, addStat, dayKey,
    pl, words_, wc, esc, hkPart, hkParts, hkLabel, isModOnly, rgb, lum, contrast, hexA, invoke, listen, emitTo, log, tauri: !!T };
})();
