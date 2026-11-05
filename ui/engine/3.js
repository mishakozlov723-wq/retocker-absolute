  const over = overCap(e, state === 'idle' ? 14 : 3) && !e.target.closest('#pc' + (ENV.ignore ? ',' + ENV.ignore : ''));
  setCursor(over && !e.target.closest('.cc button') ? 'grab' : '');
  const h = state === 'idle' && over;
  if (h !== hover) { hover = h; retarget(); }
});
function endPress(e) {
  if (!press) return;
  const p = press; press = null;
  try { stage.releasePointerCapture(p.id); } catch (x) {}
  if (p.drag) {
    dragging = false; guide.classList.remove('on'); setCursor('grab');
    const c = freeCenter(tz.w, tz.h, S.scale / 100); S.fx = c.x / SW; S.fy = c.y / SH;
    save(); changed(); setOp(); breath(); req();
    return;
  }
  if (e.type === 'pointerup') action(p.k);
}
stage.addEventListener('pointerup', endPress);
stage.addEventListener('pointercancel', endPress);
stage.addEventListener('pointerleave', () => { if (!press) { setCursor(''); if (hover) { hover = false; retarget(); } } });
function action(k) {
  if (pv) { clearPreview(); toIdle(); return; }
  if (state === 'idle') { startRec(); return; }
  if (state === 'rec') {
    if (k === 'cancel') return cancel();
    if (k === 'ok') return finish();
    if (k === 'dot' && S.live !== 'off') return togglePanel();
    return finish();
  }
  if (state === 'done') { if (lastText && ENV.copy) { ENV.copy(lastText); doneTxt.textContent = 'Скопировано'; retarget(); clearTimeout(idleT); idleT = setTimeout(toIdle, 1400); } else toIdle(); return; }
  if (state === 'err') {
    const a = errAct;
    if (a === 'retry' && lastAudio) return retry();
    if ((a === 'key' || a === 'mic') && ENV.openSettings) ENV.openSettings(a === 'key' ? 'key' : 'control');
    toIdle();
  }
}
pc.addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  if (b.dataset.k === 'insert') insert(lText.innerText);
  if (b.dataset.k === 'copy') {
    const t = lText.innerText.trim();
    Promise.resolve(ENV.copy ? ENV.copy(t) : navigator.clipboard.writeText(t)).then(() => { b.textContent = 'Скопировано'; setTimeout(() => { b.textContent = 'Копировать'; }, 1400); }, () => {});
  }
});
lText.addEventListener('pointerdown', () => { if (state === 'review' && OVERLAY && !editing) { setEditing(true); setTimeout(() => lText.focus({ preventScroll: true }), 60); } });
lText.addEventListener('keydown', e => {
  if (state !== 'review') return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); insert(lText.innerText); }
  else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  e.stopPropagation();
});
lText.addEventListener('input', () => { if (state === 'review') { const n = wc(lText.innerText); lCnt.textContent = n ? words_(n) : ''; updatePanel(); } });
window.addEventListener('blur', () => { if (OVERLAY && editing) setEditing(false); });

/* ---------------- hotkey (events come from the keyboard hook of the app) */
let held = false, hkT = 0;
const canStart = () => ['idle', 'done', 'err'].includes(state);
function toggle() { if (canStart()) startRec(); else if (state === 'rec') finish(); }
function hk(t, other) {
  const modOnly = RA.isModOnly(S.hk), hold = S.mode === 'hold';
  if (t === 'down') {
    if (pv) { clearPreview(); toIdle(); }
    if (hold) {
      if (!canStart()) return;
      // Ctrl+Win and the like are also parts of other shortcuts: wait a moment to be sure (the mic is already on)
      if (modOnly) { if (OVERLAY && !(ENV.check && ENV.check())) micOpen(); clearTimeout(hkT); hkT = setTimeout(() => { hkT = 0; held = true; startRec(); }, 130); }
      else { held = true; startRec(); }
    } else if (!modOnly) toggle();
    else if (canStart() && OVERLAY && !(ENV.check && ENV.check())) micOpen();
    return;
  }
  if (t === 'other') {
    if (hkT) { clearTimeout(hkT); hkT = 0; }
    if (!rec && warm) micClose(warm);
    if (held) { held = false; if (state === 'rec') cancel(); }
    return;
  }
  if (t === 'up') {
    if (hkT) { clearTimeout(hkT); hkT = 0; if (!rec && warm) micClose(warm); return; }
    if (hold) { if (held) { held = false; if (state === 'rec') finish(); } return; }
    if (modOnly) { if (!other) toggle(); else if (!rec && warm) micClose(warm); }
  }
}
function key(k) {
  if (k === 'esc' && ['rec', 'proc', 'review', 'err'].includes(state)) cancel();
  else if (k === 'enter' && state === 'review') insert(lText.innerText);
}

/* ---------------- previews (settings window) */
function demoWords(clean) {
  clearText();
  for (const [t, c] of DEMO) { const fill = /^(ну|эээ|ммм)/i.test(t) && c === ''; if (clean && (fill || c === '')) continue; addWord(clean ? (c ?? t) : t, { c, fill, still: true }); }
}
function demo(s) {
  clearPreview(); toIdle(); flow++;
  if (s === 'rec') { startRec({ panel: S.live === 'always' }); return; }
  if (s === 'proc') { demoWords(false); setState('proc'); if (S.live !== 'off') openPanel(); }
  if (s === 'review') { demoWords(true); toReview(cleanOf(words)); }
  if (s === 'done') { doneTxt.textContent = 'Вставлено · ' + words_(22); setState('done'); }
  if (s === 'err') { errTxt.textContent = 'Нет связи — попробуй ещё раз'; setState('err'); sound('err'); }
}
function preview(kind) {
  if (OVERLAY || !(state === 'idle' || pv)) return;
  clearPreview(); pv = true; breath();
  const k = K(), T = (ms, fn) => pvT.push(setTimeout(fn, ms / k));
  const end = () => { pv = false; toIdle(); };
  if (kind === 'morph') {
    startRec({ preview: true, words: false, loop: true });
    T(1500, () => { endRec(); setState('proc'); });
    T(2600, () => { doneTxt.textContent = 'Вставлено · ' + words_(22); setState('done'); });
    T(3700, end);
  } else if (kind === 'rec') {
    startRec({ preview: true, words: false, loop: true });
    T(2200, end);
  } else if (kind === 'proc') {
    setState('proc'); T(1800, end);
  } else if (kind === 'live') {
    startRec({ preview: true, panel: true, loop: false });
    T(4600, end);
  } else if (kind === 'dot') {
    // the panel opens out of the dot and closes back into it
    startRec({ preview: true, loop: true });
    T(700, () => { if (state === 'rec') openPanel(); });
    T(3900, () => { if (state === 'rec') closePanel(); });
    T(5000, end);
  }
}

/* ---------------- settings changed elsewhere, fullscreen, hit, resize */
function reload(next) {
  const n = next || RA.load();
  const moved = ['pos', 'off'].some(k => n[k] !== S[k]) || (n.pos === 'free' && (n.fx !== S.fx || n.fy !== S.fy));
  if (moved && !dragging) moveAnchor(() => { S = n; }); else S = n;
  apply(); breath();
}
function setHidden(on) { const h = !!on && S.hideFs; if (h === hidden) return; hidden = h; setOp(); breath(); req(); }
function hitInside(on) { if (!on && !press) { setCursor(''); if (hover) { hover = false; retarget(); } } }
window.addEventListener('resize', () => { measureStage(); G.px.jump(0); G.py.jump(0); waveFor = ''; layoutWave(); req(); if (panelOpen) updatePanel({ jump: true }); });
if (ENV.observe) new ResizeObserver(() => { measureStage(); req(); if (panelOpen) updatePanel({ jump: true }); }).observe(stage);
window.addEventListener('storage', e => { if (e.key === RA.KEY) reload(); });

/* ---------------- start */
measureStage();
apply({ instant: true });
draw();
document.fonts && document.fonts.ready.then(() => { spFor = ''; measureSpace(); retarget({ instant: true }); });
const API = {
  hk, key, setHidden, hitInside, reload, preview, demo, startRec, finish, cancel, toIdle, insert, openPanel, closePanel, togglePanel, setState,
  opt(o) {
    const mv = ('pos' in o && o.pos !== S.pos) || ('off' in o && o.off !== S.off);
    if (mv) moveAnchor(() => { Object.assign(S, o); }); else Object.assign(S, o);
    save(); apply(); breath();
  },
  measure() { measureStage(); req(); },
  setTask(t) { TASK = t; req(); },
  get S() { return S; }, get state() { return state; }, get panelOpen() { return panelOpen; }, get lv() { return lv; }, get words() { return words; }, G, P, D
};
window.__cap = API;
if (ENV.ready) ENV.ready(API);
})();
