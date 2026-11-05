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
    // after speech
    review: false, clean: true, smart: true,
    // control
    hk: 'Ctrl+Win', mode: 'hold', pos: 'bottom', off: 22, fx: .5, fy: .62, hideFs: true,
    // recognition & insertion
    lang: 'ru', dict: '', mic: '', paste: 'clip', keepClip: true
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
  const ACCS = [['#ffffff', 'Белый'], ['#a8a8a8', 'Серебро'], ['#d9c7a7', 'Песок'], ['#7fd1ae', 'Мята'], ['#7fb4f0', 'Небо'], ['#b49cf0', 'Лаванда'], ['#f09cc0', 'Роза'], ['#f0b46a', 'Янтарь'], ['#f08a7a', 'Коралл']];

  function load() {
    const S = { ...DEF };
    try { const v = localStorage.getItem(KEY); if (v) Object.assign(S, JSON.parse(v)); } catch (e) {}
    for (const k in S) if (!(k in DEF)) delete S[k];
    return S;
  }
  function save(S) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

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

  const T = window.__TAURI__;
  const invoke = (cmd, args) => T ? T.core.invoke(cmd, args) : Promise.reject(new Error('no tauri'));
  const listen = (ev, fn) => T ? T.event.listen(ev, fn) : Promise.resolve(() => {});
  const emitTo = (label, ev, p) => T ? T.event.emitTo(label, ev, p === undefined ? null : p).catch(() => {}) : Promise.resolve();
  const log = m => { try { invoke('log', { msg: String(m) }).catch(() => {}); } catch (e) {} };

  window.RA = { KEY, DEF, PK, PRESETS, BGS, ACCS, load, save, AUTH, auth, setAuth, isProxy, hasKey, STATS, stats, addStat, dayKey,
    pl, words_, wc, esc, hkPart, hkParts, hkLabel, isModOnly, rgb, lum, contrast, hexA, invoke, listen, emitTo, log, tauri: !!T };
})();
