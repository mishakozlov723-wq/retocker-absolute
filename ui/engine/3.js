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
