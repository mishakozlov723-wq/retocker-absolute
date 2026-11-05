'use strict';
// The capsule: one engine for the real overlay (mode 'overlay') and the preview in the settings (mode 'preview').
// Geometry is a set of springs (Motion); one draw() per frame turns them into the shapes.
(() => {
const ENV = window.RA_ENV || {};
const OVERLAY = ENV.mode === 'overlay';
const RA = window.RA;
const { animate, motionValue, frame, cancelFrame } = window.Motion;
const root = document.documentElement;
const stage = ENV.stage || document.body;
stage.classList.add('stage');
stage.insertAdjacentHTML('beforeend', `
<div class="guide"></div>
<div class="shd" id="pShd" aria-hidden="true"></div>
<svg class="shape" id="pSvg" aria-hidden="true"><defs><linearGradient id="pGl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3d" stop-opacity=".9"/><stop offset="1" stop-color="#232325" stop-opacity=".86"/></linearGradient></defs><rect id="pRect"/><rect id="pRectA"/></svg>
<div class="pc" id="pc" aria-hidden="true"><div class="pci" id="pci">
  <div class="lh"><i class="ldot" id="lDot"></i><span id="lTitle">Слушаю…</span><span class="grow"></span><span class="lcnt" id="lCnt"></span></div>
  <div class="lb" id="lBody"><div class="lt" id="lText"></div></div>
  <div class="lf" id="lFoot"><span class="lk" id="lKeys">Enter — вставить · Esc — отмена</span><span class="grow"></span><button class="lbtn" data-k="copy">Копировать</button><button class="lbtn pri" data-k="insert">Вставить</button></div>
</div></div>
<div class="shd" id="cShd" aria-hidden="true"></div>
<div class="glow" id="glow"></div>
<svg class="shape" id="cSvg" aria-hidden="true"><defs><linearGradient id="cGl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3d" stop-opacity=".9"/><stop offset="1" stop-color="#232325" stop-opacity=".86"/></linearGradient></defs><rect id="cRect"/></svg>
<div class="cc" id="cc">
  <div class="g" id="gMini"><div class="gi g-mini"><i></i><i></i><i></i><i></i><i></i></div></div>
  <div class="g" id="gHint"><div class="gi g-hint"><span id="hintTxt">Ctrl+Win</span><b id="hintB">говорить</b></div></div>
  <div class="g" id="gRec">
    <div class="rp" id="recL"><button class="c-x" data-k="cancel" title="Отменить (Esc)"><svg viewBox="0 0 16 16"><path d="m5 5 6 6m0-6-6 6"/></svg></button><button class="c-dot" data-k="dot" title="Показать текст"><b id="cRing"></b><i id="cDot"></i></button></div>
    <div class="rp" id="recC"><canvas class="c-wave" id="wave"></canvas></div>
    <div class="rp" id="recR"><span class="c-time" id="time">0:00</span><button class="c-ok" data-k="ok" title="Готово"><svg viewBox="0 0 16 16"><path d="m4 8.4 2.7 2.7L12 5.6"/></svg></button></div>
  </div>
  <div class="g" id="gProc"><div class="gi g-proc"><span class="p-shimmer" id="procTxt">Причёсываю…</span><span class="p-dots"><i></i><i></i><i></i></span><span class="p-ring"></span></div></div>
  <div class="g" id="gRev"><div class="gi g-rev"><kbd>Enter</kbd><span>вставить</span></div></div>
  <div class="g" id="gDone"><div class="gi g-done"><svg viewBox="0 0 16 16"><path id="tick" d="m4 8.4 2.7 2.7L12 5.6"/></svg><span id="doneTxt">Вставлено</span></div></div>
  <div class="g" id="gErr"><div class="gi g-err"><i class="edot"></i><span id="errTxt">Нет связи — попробуй ещё раз</span></div></div>
</div>`);
const $ = s => stage.querySelector(s);
const guide = $('.guide');
const cSvg = $('#cSvg'), cRect = $('#cRect'), cShd = $('#cShd'), pSvg = $('#pSvg'), pRect = $('#pRect'), pRectA = $('#pRectA'), pShd = $('#pShd');
const cc = $('#cc'), glowEl = $('#glow'), pc = $('#pc'), pci = $('#pci');
const lText = $('#lText'), lTitle = $('#lTitle'), lCnt = $('#lCnt'), lBody = $('#lBody'), lDot = $('#lDot');
const wave = $('#wave'), wctx = wave.getContext('2d'), timeEl = $('#time'), procTxt = $('#procTxt'), doneTxt = $('#doneTxt'), hintTxt = $('#hintTxt'), hintB = $('#hintB'), errTxt = $('#errTxt');
const recL = $('#recL'), recC = $('#recC'), recR = $('#recR'), cDot = $('#cDot'), cRing = $('#cRing'), tickPath = $('#tick');
let TASK = ENV.task || 0;
const CW = 800, CH = 120, PAD = 6, GAP = 5;
const TLEN = 12;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const { wc, words_, esc, lum, contrast, hexA, BGS } = RA;
const f2 = v => String(Math.round(v * 100) / 100), f3 = v => String(Math.round(v * 1000) / 1000), f4 = v => String(Math.round(v * 10000) / 10000);

/* ---------------- settings */
let S = RA.load();
const save = () => RA.save(S);

/* ---------------- motion styles (springs; everything is divided by the speed setting) */
const STY = {
  smooth: { vd: .38, b: .1, inS: .96, outS: .96, blur: 0, pvd: .44, pb: .08 },
  spring: { vd: .46, b: .34, inS: .9, outS: .92, blur: 0, pvd: .52, pb: .26 },
  island: { vd: .44, b: .24, inS: .9, outS: .92, blur: 7, pvd: .48, pb: .2 },
  drop: { vd: .48, b: .2, inS: .82, outS: .8, blur: 0, pvd: .5, pb: .18 },
  fade: { vd: .26, b: 0, inS: 1, outS: 1, blur: 0, pvd: .3, pb: 0 }
};
const K = () => S.speed / 100;
const sty = () => STY[S.anim] || STY.smooth;
const DUR = () => sty().vd * 1000 / K();
// springs for pixel values / for unit values (opacity, scale); tiny rest thresholds = no visible snap at the end
const SPR = (vd, b, delay = 0) => ({ type: 'spring', visualDuration: vd / K(), bounce: b, delay: delay / K(), restDelta: .02, restSpeed: .5 });
const SPRu = (vd, b, delay = 0) => ({ type: 'spring', visualDuration: vd / K(), bounce: b, delay: delay / K(), restDelta: .0004, restSpeed: .004 });
const TW = (d, delay = 0, ease = [.25, .1, .25, 1]) => ({ duration: d / K(), delay: delay / K(), ease });

/* ---------------- simulated speech for the preview: [как распознал Whisper, как причесал ('' = убрать)] */
const DEMO = [['Ну', ''], ['смотри,', 'Смотри,'], ['эээ,', ''], ['сегодня'], ['биткоин'], ['пробил'], ['сопротивление'], ['на'], ['ста', '120 000.'], ['двадцати', ''], ['тысячах,', ''], ['ммм,', ''], ['я', ''], ['думаю', 'Думаю'], ['зайти'], ['в'], ['лонг'], ['на'], ['откате,', 'откате:'], ['стоп'], ['поставлю'], ['под'], ['вчерашним'], ['минимумом,'], ['а'], ['тейк', 'тейк —'], ['на'], ['ста', '130 000.'], ['тридцати.', '']];
const FILL = /^(ну|э+м*|м+|а+|хм+)[,.!?…]*$/i;
function buildSim() {
  let t = 420; const sch = [];
  DEMO.forEach(([w, c]) => {
    const fill = /^(ну|эээ|ммм)/i.test(w) && c === '';
    const syl = Math.max(1, (w.match(/[аеёиоуыэюя]/gi) || []).length);
    const hum = /^(эээ|ммм)/.test(w);
    const dur = hum ? 480 + Math.random() * 120 : 100 + syl * 84 + Math.random() * 36;
    sch.push({ w, c, fill, t0: t, t1: t + dur, syl: hum ? 1 : syl, hum, amp: hum ? .3 : .6 + Math.random() * .35 });
    t += dur + (/[,.]$/.test(w) ? 220 + Math.random() * 110 : 40 + Math.random() * 50);
  });
  return { sch, end: t, i: 0 };
}
function simLevel(ms, sim) {
  const base = .02 + .025 * Math.random();
  const s = sim.sch;
  while (sim.i < s.length - 1 && ms > s[sim.i].t1 + 400) sim.i++;
  for (let j = Math.max(0, sim.i - 1); j < Math.min(s.length, sim.i + 3); j++) {
    const w = s[j];
    if (ms >= w.t0 && ms < w.t1) {
      const p = (ms - w.t0) / (w.t1 - w.t0);
      if (w.hum) return Math.max(base, w.amp * (.8 + .2 * Math.sin(ms / 45)) * Math.min(1, p * 5, (1 - p) * 5));
      const f = p * w.syl % 1;
      return Math.max(base, w.amp * Math.pow(Math.sin(Math.PI * f), .75) * (.78 + .22 * Math.random()));
    }
  }
  return base;
}

/* ---------------- state */
let state = 'idle', hover = false, panelOpen = false, rec = null, words = [], lv = 0, flow = 0, idleT = 0, pv = false, pvT = [];
let dragging = false, hidden = false, errAct = null, editing = false;
let SW = 800, SH = 600, SX = 0, SY = 0;
function measureStage() { const r = stage.getBoundingClientRect(); SW = stage.clientWidth; SH = stage.clientHeight; SX = r.left; SY = r.top; }

/* ---------------- motion values: every frame one draw() turns them into geometry */
let drawQ = false;
const req = () => { if (!drawQ) { drawQ = true; frame.render(draw); } };
const mv = v => { const m = motionValue(v); m.on('change', req); return m; };
const G = { w: mv(42), h: mv(6), s: mv(1), px: mv(0), py: mv(0), dx: mv(0), op: mv(.85), br: mv(0), sq: mv(0), gl: mv(0) };
const P = { x: mv(0), y: mv(0), w: mv(0), h: mv(0), r: mv(18), op: mv(0), k: mv(1) };
const PC = { op: mv(0), dy: mv(0), sc: mv(1), bl: mv(0) };
const TK = mv(1);
const GR = {};
[['gMini', 'mini'], ['gHint', 'hint'], ['gRec', 'rec'], ['gProc', 'proc'], ['gRev', 'rev'], ['gDone', 'done'], ['gErr', 'err']].forEach(([id, key]) => {
  const el = $('#' + id);
  GR[key] = { key, el, inner: el.firstElementChild, op: mv(0), sc: mv(1), bl: mv(0), on: false };
});
let curG = null, tz = { w: 42, h: 6 }, recLay = { w: 36, wR: 0, cOff: 0 };

// cached writers: touch the DOM only when a value really changed
function setA(el, k, v) { v = f2(v); const c = el._a || (el._a = {}); if (c[k] !== v) { c[k] = v; el.setAttribute(k, v); } }
function setS(el, k, v) { const c = el._s || (el._s = {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } }
const dpr = () => window.devicePixelRatio || 1;
const snap = v => Math.round(v * dpr()) / dpr();

/* ---------------- apply settings */
let BW = 1, WAVE = '#fff', glowAmt = .25, ACC = '#fff';
function apply(o = {}) {
  const V = (n, v) => root.style.setProperty(n, v);
  const glass = S.bg === 'glass';
  const bgHex = S.bg === 'custom' ? S.bgc : (BGS.find(b => b[0] === S.bg) || BGS[0])[1] || '#1e1e1e';
  const light = !glass && lum(bgHex) > .4;
  const T = light ? '0,0,0' : '255,255,255';
  V('--c-bg', glass ? '#2c2c2e' : bgHex); V('--c-bgs', glass ? '#1e1e1e' : bgHex);
  V('--c-tx', `rgba(${T},${light ? .86 : .93})`); V('--c-tx2', `rgba(${T},.52)`);
  const ln = `rgba(${T},${light ? .11 : glass ? .17 : .1})`;
  V('--c-ln', ln); V('--c-btn', `rgba(${T},${light ? .065 : .08})`); V('--c-btnh', `rgba(${T},${light ? .11 : .14})`);
  cRect.setAttribute('fill', glass ? 'url(#cGl)' : bgHex); pRect.setAttribute('fill', glass ? 'url(#pGl)' : bgHex);
  BW = S.border ? 1 : 0;
  for (const r of [cRect, pRect]) { r.setAttribute('stroke', S.border ? ln : 'none'); r.setAttribute('stroke-width', BW || 0); r._a = {}; }
  pRectA._a = {};
  const sh = light ? .45 : 1;
  V('--shk', sh);
  cShd.style.display = pShd.style.display = S.shadow ? '' : 'none';
  let acc = S.acc; const ref = glass ? '#2c2c2e' : bgHex;
  if (contrast(acc, ref) < 1.7) acc = light ? '#1f1f1f' : '#ffffff';
  ACC = acc; pRectA.setAttribute('fill', acc);
  const wv = S.wcol === 'accent' ? acc : S.wcol === 'text' ? (light ? '#1f1f1f' : '#ffffff') : (light ? '#7a7a7a' : '#9a9a9a');
  V('--acc', acc); V('--wave', wv); WAVE = wv;
  glowAmt = S.glow / 100;
  V('--glowc', hexA(acc, .6)); V('--dotglow', hexA(acc, Math.min(1, glowAmt * .9)));
  V('--k', K()); V('--fs', S.fs + 'px');
  stage.classList.toggle('top', S.pos === 'top');
  stage.dataset.pdot = S.pdot ? 1 : 0;
  Object.assign(cc.dataset, { live: S.live, timer: S.timer ? 1 : 0, btns: S.btns ? 1 : 0, wave: S.wave, proc: S.proc, pdot: S.pdot ? 1 : 0 });
  hintTxt.textContent = RA.hkLabel(S.hk); hintB.textContent = S.mode === 'hold' ? 'зажми и говори' : 'говорить';
  procTxt.textContent = S.clean ? 'Причёсываю…' : 'Распознаю…';
  measureSpace();
  layoutWave();
  if (o.instant) G.s.jump(S.scale / 100); else if (Math.abs(G.s.get() - S.scale / 100) > .0005) animate(G.s, S.scale / 100, SPRu(.32, .12));
  retarget({ instant: o.instant });
  if (panelOpen) updatePanel();
  req();
}
let spFor = '';
function measureSpace() {
  const f = `${S.fs}px Manrope`; if (spFor === f) return;
  const c = document.createElement('canvas').getContext('2d'); c.font = `500 ${f}`;
  const em = c.measureText(' ').width / S.fs; if (em > 0) { lText.style.setProperty('--sp', em.toFixed(3) + 'em'); spFor = f; }
}

/* ---------------- sizes & placement */
function waveWidth() { return { bars: S.bars * 6 - 3, tape: 72, line: 66, dots: S.bars * 7 - 3, pulse: 0 }[S.wave]; }
let waveFor = '';
let bars = [], rnd = [], tape = [], tapeT = 0, rndT = 0;
function layoutWave() {
  const w = waveWidth(), d = dpr() * Math.max(1, S.scale / 100), key = w + '|' + d;
  if (key === waveFor) return; waveFor = key;
  wave.style.width = w + 'px'; wave.style.height = '24px';
  wave.width = Math.max(1, Math.round(w * d)); wave.height = Math.round(24 * d);
  wctx.setTransform(d, 0, 0, d, 0, 0);
  bars = new Array(Math.max(S.bars, 30)).fill(0); rnd = bars.map(() => Math.random()); tape = [];
}
// corner radius is a continuous function of the height, so it morphs smoothly too
function rad(h, w = 1e9) {
  let r;
  if (S.shape === 'pill') r = h / 2;
  else if (S.shape === 'round') { const t = clamp((h - 12) / 24, 0, 1); r = h / 2 + (11 - h / 2) * t; }
  else r = 2 + 5 * clamp((h - 6) / 30, 0, 1);
  return Math.max(0, Math.min(r, h / 2, w / 2));
}
function panelRad() { return { pill: 20, round: 16, square: 10 }[S.shape]; }
function groupFor() {
  if (state === 'idle') { if (hover && S.hint) return 'hint'; return S.idle === 'mini' ? 'mini' : null; }
  return { rec: 'rec', proc: 'proc', review: 'rev', done: 'done', err: 'err' }[state] || null;
}
function measureRec() {
  const wL = recL.offsetWidth, wC = S.wave === 'pulse' ? 0 : recC.offsetWidth, wR = (S.timer || S.btns) ? recR.offsetWidth : 0;
  const extra = !S.btns && !S.timer && S.wave !== 'pulse' ? 8 : 0;
  const w = Math.max(36, PAD + wL + (wC ? GAP + wC : 0) + (wR ? GAP + wR : 0) + PAD + extra);
  return { w, wR, cOff: -w / 2 + PAD + wL + GAP };
}
function layoutRec() {
  const w = recLay.w;
  setS(recL, 'transform', `translate(${f2(-w / 2 + PAD)}px,-50%)`);
  setS(recR, 'transform', `translate(${f2(w / 2 - PAD - recLay.wR)}px,-50%)`);
  setS(recC, 'transform', `translate(${f2(recLay.cOff)}px,-50%)`);
}
function target() {
  const g = groupFor();
  if (state === 'idle') {
    if (g === 'hint') return { w: Math.round(GR.hint.inner.offsetWidth), h: 30, g };
    const k = (S.idleSc || 100) / 100;
    if (S.idle === 'dot') return { w: Math.round(10 * k), h: Math.round(10 * k), g };
    if (S.idle === 'mini') return { w: Math.round(38 * k), h: Math.round(18 * k), g };
    return { w: Math.round(42 * k), h: Math.max(2, Math.round(6 * k)), g };
  }
  if (state === 'rec') { recLay = measureRec(); return { w: recLay.w, h: 36, g }; }
  return { w: Math.round(GR[g].inner.offsetWidth), h: 36, g };
}
function freeCenter(w, h, s) {
  const hw = w * s / 2, hh = h * s / 2;
  return { x: clamp(S.fx * SW, hw + 6, SW - hw - 6), y: clamp(S.fy * SH, hh + 6, SH - TASK - hh - 6) };
}
// centre of the capsule for a given (unscaled) height: bottom/top keep their edge fixed, free keeps the centre
function anchor(h, s) {
  if (S.pos === 'bottom') return { x: SW / 2, y: SH - TASK - S.off - h * s / 2 };
  if (S.pos === 'top') return { x: SW / 2, y: S.off + h * s / 2 };
  return freeCenter(tz.w, tz.h, S.scale / 100);
}
function capFinal() {
  const s = S.scale / 100, a = anchor(tz.h, s), w = tz.w * s, h = tz.h * s;
  return { x: a.x - w / 2, y: a.y - h / 2, w, h, cx: a.x, cy: a.y, r: rad(tz.h, tz.w) * s };
}
// the anchor changes (position setting, offset, stage size): stay where we are and glide to the new spot
function moveAnchor(fn) {
  const ox = D.cx - G.dx.get(), oy = D.cy;
  fn();
  const s = G.s.get(), a = anchor(D.h / s, s);
  G.px.jump(ox - a.x); G.py.jump(oy - a.y);
  animate(G.px, 0, SPR(.5, .16)); animate(G.py, 0, SPR(.5, .16));
  if (panelOpen) updatePanel();
}

/* ---------------- morphing */
function retarget(o = {}) {
  const z = target(), prevG = curG;
  const same = z.w === tz.w && z.h === tz.h;
  tz = { w: z.w, h: z.h };
  if (z.g) { GR[z.g].tw = z.w; GR[z.g].th = z.h; }
  if (z.g === 'rec') layoutRec();
  if (o.instant) {
    G.w.jump(z.w); G.h.jump(z.h); G.sq.jump(0); G.px.jump(0); G.py.jump(0);
    for (const k in GR) { const g = GR[k]; g.op.jump(k === z.g ? 1 : 0); g.sc.jump(1); g.bl.jump(0); }
    curG = z.g; TK.jump(1);
  } else {
    if (!same || G.w.isAnimating() || G.h.isAnimating()) morph(z);
    if (z.g !== prevG) {
      // back to rest: the content shrinks with the shape and fades out by the end — the opening played backwards
      const sync = state === 'idle' && z.g !== 'hint' && prevG && prevG !== 'hint' && prevG !== 'mini';
      if (prevG) exitG(GR[prevG], sync);
      if (z.g) enterG(GR[z.g], sync ? sty().vd * .75 : 0);
      curG = z.g; if (z.g === 'done') { TK.jump(0); animate(TK, 1, TW(.34, .12, [.3, 0, .2, 1])); }
    }
  }
  setOp(o.instant);
  breath();
  req();
}
function morph(z) {
  const st = sty(), w0 = G.w.get(), h0 = G.h.get();
  if (S.anim === 'drop') {
    // a drop: swells up first, then spreads sideways; on the way back it pulls in first, then sinks
    if (z.h > h0 + .5) { animate(G.h, z.h, SPR(.26, .3)); animate(G.w, z.w, SPR(.48, .2, .07)); }
    else if (z.h < h0 - .5) { animate(G.w, z.w, SPR(.3, .1)); animate(G.h, z.h, SPR(.34, .2, .08)); }
    else {
      animate(G.w, z.w, SPR(st.vd, st.b)); animate(G.h, z.h, SPR(st.vd, st.b));
      if (Math.abs(z.w - w0) > 16 && z.h >= 20) animate(G.sq, [0, 1, -.35, 0], { duration: .52 / K(), times: [0, .32, .68, 1], ease: 'easeInOut' });
    }
  } else { animate(G.w, z.w, SPR(st.vd, st.b)); animate(G.h, z.h, SPR(st.vd, st.b)); }
}
function enterG(g, late = 0) {
  const st = sty(), d = (S.anim === 'drop' ? .06 : .03) + late;
  if (g.op.get() < .05) { g.sc.jump(st.inS); g.bl.jump(st.blur); }
  animate(g.op, 1, TW(.22, d, [.3, 0, .2, 1]));
  animate(g.sc, 1, SPRu(st.vd * .92, Math.min(.42, st.b + .06), d * .5));
  if (g.bl.get() > 0) animate(g.bl, 0, TW(.3, d, [.2, .7, .2, 1]));
}
function exitG(g, sync) {
  const st = sty();
  if (sync) {
    animate(g.op, 0, TW(st.vd * .9, 0, [.6, 0, .85, .3]));
    animate(g.sc, st.outS, TW(st.vd, 0, [.4, 0, .6, 1]));
    if (st.blur) animate(g.bl, 4, TW(st.vd * .9, 0, [.6, 0, .85, .3]));
    return;
  }
  animate(g.op, 0, TW(.11, 0, [.4, 0, 1, 1]));
  animate(g.sc, st.outS, TW(.16, 0, [.4, 0, 1, 1]));
  if (st.blur) animate(g.bl, 4, TW(.14));
}
function capOpTarget() {
  if (state !== 'idle' || dragging) return 1;
  if (hidden) return 0;
  if (hover) return 1;
  return S.idle === 'hidden' ? 0 : S.idleOp / 100;
}
function setOp(instant) {
  const t = capOpTarget();
  if (instant) G.op.jump(t); else if (Math.abs(G.op.get() - t) > .001) animate(G.op, t, TW(t > G.op.get() ? .18 : .3, 0, [.3, 0, .2, 1]));
}
let brA = null;
function breath() {
  const want = S.breathe && state === 'idle' && !hover && !dragging && !hidden && S.idle !== 'hidden' && !pv;
  if (want && !brA) brA = animate(G.br, [0, 1, 0], { duration: 3.8 / K(), ease: 'easeInOut', repeat: Infinity, delay: .6 / K() });
  else if (!want && brA) { brA.stop(); brA = null; animate(G.br, 0, TW(.3)); }
}
function shake() { animate(G.dx, [0, -7, 6, -4, 2, 0], { duration: .42 / K(), ease: 'easeInOut' }); }

/* ---------------- one draw per frame */
const D = { x: 0, y: 0, w: 42, h: 6, cx: 0, cy: 0, r: 3 };
function draw() {
  drawQ = false;
  const s = G.s.get();
  let w = Math.max(0, G.w.get()), h = Math.max(0, G.h.get());
  const br = G.br.get();
  if (br) { if (S.idle === 'dot' && state === 'idle') { w *= 1 + br * .35; h *= 1 + br * .35; } else w *= 1 + br * .28; }
  const sq = G.sq.get(); if (sq) { h *= 1 - .07 * sq; w *= 1 + .025 * sq; }
  const a = anchor(h, s);
  const cx = a.x + G.px.get() + G.dx.get(), cy = a.y + G.py.get();
  const W = w * s, H = h * s, r = rad(h, w), x = cx - W / 2, y = cy - H / 2;
  D.x = x; D.y = y; D.w = W; D.h = H; D.cx = cx; D.cy = cy; D.r = r * s;
  const op = G.op.get(), hb = BW / 2;
  setA(cRect, 'x', x + hb); setA(cRect, 'y', y + hb); setA(cRect, 'width', Math.max(0, W - BW)); setA(cRect, 'height', Math.max(0, H - BW)); setA(cRect, 'rx', Math.max(0, r * s - hb));
  const o3 = f3(op);
  setS(cSvg, 'opacity', o3); setS(cc, 'opacity', o3);
  if (S.shadow) { setS(cShd, 'transform', `translate(${f2(x)}px,${f2(y)}px)`); setS(cShd, 'width', f2(W) + 'px'); setS(cShd, 'height', f2(H) + 'px'); setS(cShd, 'borderRadius', f2(r * s) + 'px'); setS(cShd, 'opacity', o3); }
  // content rides with the shape; snapped to whole pixels when nothing moves, so text stays crisp
  const still = !(G.h.isAnimating() || G.px.isAnimating() || G.py.isAnimating() || G.dx.isAnimating() || G.s.isAnimating() || G.sq.isAnimating() || dragging);
  const tx = still ? snap(cx) : cx, ty = still ? snap(cy) : cy;
  setS(cc, 'transform', `translate(${f2(tx)}px,${f2(ty)}px) scale(${f4(s)})`);
  setS(cc, 'clipPath', `inset(${f2(CH / 2 - h / 2)}px ${f2(CW / 2 - w / 2)}px round ${f2(r)}px)`);
  for (const k in GR) drawG(GR[k], w, h);
  setS(glowEl, 'width', f2(W) + 'px'); setS(glowEl, 'height', f2(H) + 'px'); setS(glowEl, 'borderRadius', f2(r * s) + 'px');
  glowDraw();
  if (pVis) drawPanel();
  hitReport();
}
function drawG(g, w, h) {
  let o = g.op.get(), fit;
  if (g.key === 'hint') {
    // the hint keeps its size and shows up once the capsule has room for it (no tiny text growing out of the line)
    const room = Math.min((w - 6) / Math.max(1, (g.tw || w) - 24), (h - 4) / 17);
    fit = Math.min(1, room);
    const t = clamp((room - .86) / .14, 0, 1); o *= t * t * (3 - 2 * t);
  } else if (g.key === 'mini') fit = Math.min((S.idleSc || 100) / 100, w / 38, h / 18); // grows with «Размер в покое»
  else fit = Math.min(1, w / (g.tw || w || 1), h / (g.th || h || 1));
  const on = o > .003;
  if (on !== g.on) { g.on = on; g.el.classList.toggle('on', on); }
  if (!on) return;
  setS(g.el, 'opacity', f3(o));
  setS(g.el, 'transform', `scale(${f4(Math.max(0, fit * g.sc.get()))})`);
  const b = g.bl.get(); setS(g.el, 'filter', b > .05 ? `blur(${f2(b)}px)` : 'none');
  if (g.key === 'done') setS(tickPath, 'strokeDashoffset', f2(TLEN * (1 - TK.get())));
}
function glowDraw() {
  const o = G.gl.get() * glowAmt * (.3 + .7 * lv) * G.op.get();
  setS(glowEl, 'opacity', f3(o));
  if (o > .001) setS(glowEl, 'transform', `translate(${f2(D.x)}px,${f2(D.y)}px) scale(${f4(1 + lv * .06)})`);
}

/* ---------------- overlay: tell the app where the capsule is, so only it catches the mouse */
let hitKey = '', hitT = 0, hitR = [];
function hitReport() {
  if (!ENV.onHit) return;
  const d = dpr(), R = [];
  if (!(hidden && state === 'idle')) { const m = state === 'idle' ? 14 : 4; R.push([(D.x - m) * d, (D.y - m) * d, (D.w + 2 * m) * d, (D.h + 2 * m) * d]); }
  if (pVis && P.op.get() > .05) R.push([P.x.get() * d, P.y.get() * d, Math.max(0, P.w.get()) * d, Math.max(0, P.h.get()) * d]);
  const key = R.map(r => r.map(v => Math.round(v)).join(',')).join(';');
  if (key === hitKey) return;
  hitKey = key; hitR = R;
  if (!hitT) hitT = setTimeout(() => { hitT = 0; ENV.onHit(hitR); }, 24);
}

/* ---------------- live panel: an SVG shape that grows out of the capsule (or out of the record dot) + its content */
let pVis = false, pBox = { w: 420, h: 100 }, pT = null, pOpenT = 0, pTok = 0;
function drawPanel() {
  const x = P.x.get(), y = P.y.get(), w = Math.max(0, P.w.get()), h = Math.max(0, P.h.get());
  const r = Math.max(0, Math.min(P.r.get(), w / 2, h / 2)), hb = BW / 2;
  setA(pRect, 'x', x + hb); setA(pRect, 'y', y + hb); setA(pRect, 'width', Math.max(0, w - BW)); setA(pRect, 'height', Math.max(0, h - BW)); setA(pRect, 'rx', Math.max(0, r - hb));
  // «panel out of the dot»: an accent-coloured copy on top that fades out while it grows (and back in when it shrinks)
  const k = P.k.get();
  if (k > .002) { setA(pRectA, 'x', x); setA(pRectA, 'y', y); setA(pRectA, 'width', w); setA(pRectA, 'height', h); setA(pRectA, 'rx', r); }
  setS(pRectA, 'opacity', k > .002 ? f3(k) : '0');
  const po3 = f3(P.op.get());
  setS(pSvg, 'opacity', po3);
  if (S.shadow) { setS(pShd, 'transform', `translate(${f2(x)}px,${f2(y)}px)`); setS(pShd, 'width', f2(w) + 'px'); setS(pShd, 'height', f2(h) + 'px'); setS(pShd, 'borderRadius', f2(r) + 'px'); setS(pShd, 'opacity', f3(P.op.get() * (1 - k * .7))); }
  // content keeps its real size (no scaling = no re-rendered, shimmering text); the shape opens around it like a
  // shutter: pinned to the top edge and the centre, clipped by the shape, moved in whole device pixels
  const tx = snap(x + w / 2 - pBox.w / 2), ty = snap(y);
  setS(pc, 'transform', `translate(${f2(tx)}px,${f2(ty)}px)`);
  const cl = x - tx, ct = y - ty;
  setS(pc, 'clipPath', `inset(${f2(Math.max(0, ct))}px ${f2(Math.max(0, pBox.w - cl - w))}px ${f2(Math.max(0, pBox.h - ct - h))}px ${f2(Math.max(0, cl))}px round ${f2(r)}px)`);
  const po = PC.op.get();
  setS(pci, 'opacity', f3(po * Math.min(1, P.op.get() * 1.5)));
  const dy = PC.dy.get();
  setS(pci, 'transform', Math.abs(dy) < .01 ? 'none' : `translate(0px,${f2(Math.round(dy * dpr()) / dpr())}px)`);
  const b = PC.bl.get(); setS(pci, 'filter', b > .05 ? `blur(${f2(b)}px)` : 'none');
}
function setMode() {
  pc.dataset.mode = state === 'review' ? 'review' : state === 'rec' ? 'rec' : 'proc';
  lTitle.textContent = state === 'review' ? 'Проверь текст' : state === 'rec' ? 'Слушаю…' : (S.clean ? 'Причёсываю…' : 'Распознаю…');
}
function panelTarget() {
  const pw = Math.min(S.pw, SW - 24);
  if (pci._w !== pw) { pci.style.width = pw + 'px'; pci._w = pw; }
  const c = capFinal();
  const above = c.cy > (SH - TASK) / 2, top = ENV.top || 8;
  // not enough room (the small preview in the settings): the text scrolls instead of the panel growing past the edge
  const avail = above ? c.y - 10 - top : SH - TASK - 8 - (c.y + c.h + 10);
  const chrome = pci.offsetHeight - lBody.offsetHeight, bm = Math.max(40, Math.floor(avail - chrome));
  const mh = bm < 210 ? bm + 'px' : '';
  if (lBody.style.maxHeight !== mh) lBody.style.maxHeight = mh;
  const ph = pci.offsetHeight;
  pBox = { w: pw, h: ph };
  const x = clamp(c.cx - pw / 2, 12, SW - 12 - pw);
  let y = above ? c.y - 10 - ph : c.y + c.h + 10;
  y = clamp(y, top, SH - TASK - 8 - ph);
  return { x, y, w: pw, h: ph, r: panelRad(), above };
}
function showPanel() { if (!pVis) { pVis = true; pSvg.style.visibility = pShd.style.visibility = 'visible'; pc.style.visibility = 'visible'; pc.removeAttribute('aria-hidden'); } }
function hidePanel() {
  pVis = false; pSvg.style.visibility = pShd.style.visibility = 'hidden'; pc.style.visibility = 'hidden'; pc.setAttribute('aria-hidden', 'true');
  P.op.jump(0); PC.op.jump(0); P.k.jump(0); pT = null;
}
function toPanel(t, mode) {
  const st = sty();
  if (mode !== 'jump' && pT && ['x', 'y', 'w', 'h', 'r'].every(k => Math.abs(pT[k] - t[k]) < .5)) return;
  pT = t;
  if (mode === 'jump') { P.x.jump(t.x); P.y.jump(t.y); P.w.jump(t.w); P.h.jump(t.h); P.r.jump(t.r); return; }
  const opening = performance.now() < pOpenT;
  const sp = opening || mode === 'open' ? SPR(st.pvd, st.pb) : SPR(.3, .06);
  if (mode === 'open' && S.anim === 'drop') {
    animate(P.y, t.y, SPR(.34, .24)); animate(P.h, t.h, SPR(.34, .24));
    animate(P.x, t.x, SPR(.5, .18, .05)); animate(P.w, t.w, SPR(.5, .18, .05));
  } else { animate(P.x, t.x, sp); animate(P.y, t.y, sp); animate(P.w, t.w, sp); animate(P.h, t.h, sp); }
  animate(P.r, t.r, sp);
}
function openPanel() {
  if (panelOpen) return;
  panelOpen = true; cc.dataset.open = 1; pTok++;
  setMode(); showPanel();
  const t = panelTarget(), st = sty(), fresh = P.op.get() < .02;
  pOpenT = performance.now() + st.pvd * 1000 / K();
  P.k.jump(0);
  if (fresh) {
    if (S.anim === 'fade') { P.x.jump(t.x); P.w.jump(t.w); P.h.jump(t.h); P.r.jump(t.r); P.y.jump(t.y + (t.above ? 8 : -8)); P.op.jump(0); }
    else { P.x.jump(D.x + 2); P.y.jump(D.y + 2); P.w.jump(Math.max(0, D.w - 4)); P.h.jump(Math.max(0, D.h - 4)); P.r.jump(Math.max(0, D.r - 2)); P.op.jump(1); }
    PC.op.jump(0); PC.dy.jump(t.above ? 12 : -12); PC.sc.jump(1); PC.bl.jump(st.blur ? 6 : 0);
    pT = null;
  }
  if (S.anim === 'fade') { animate(P.op, 1, TW(.22, 0, [.3, 0, .2, 1])); animate(P.y, t.y, SPR(.32, 0)); pT = t; ['x', 'w', 'h', 'r'].forEach(k => animate(P[k], t[k], SPR(.32, 0))); }
  else { P.op.jump(1); toPanel(t, 'open'); }
  animate(PC.op, 1, TW(.26, S.anim === 'fade' ? .02 : .04, [.3, 0, .2, 1]));
  animate(PC.dy, 0, SPR(st.pvd * .95, Math.min(.3, st.pb + .05), .03));
  if (PC.bl.get() > 0) animate(PC.bl, 0, TW(.3, .05));
  req();
}
function closePanel(instant) {
  if (!panelOpen && !pVis) return;
  panelOpen = false; cc.dataset.open = 0;
  const my = ++pTok;
  if (instant) { [P.x, P.y, P.w, P.h, P.r, P.k, PC.dy, PC.sc, PC.bl].forEach(v => v.stop()); hidePanel(); req(); return; }
  animate(PC.op, 0, TW(.09, 0, [.4, 0, 1, 1]));
  const st = sty();
  if (S.anim === 'fade') {
    animate(P.y, P.y.get() + (P.y.get() < D.y ? 6 : -6), SPR(.3, 0));
    animate(P.op, 0, TW(.18)).then(() => { if (my === pTok) hidePanel(); });
    return;
  }
