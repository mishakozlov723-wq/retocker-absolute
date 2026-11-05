/* ---------------- text model */
function addWord(t, meta = {}) {
  const el = document.createElement('span'); el.className = 'w';
  const k = K(), still = meta.still;
  el.textContent = t;
  const last = words.length ? words[words.length - 1].el : null;
  lText.append(el);
  // a word that opens a new line waits a beat, so the panel has already grown when it shows up (no clipped letters)
  const d0 = (!still && panelOpen && last && el.offsetTop > last.offsetTop + 2 ? 110 / k : 0) + (meta.delay || 0);
  if (S.reveal === 'letters' && !still) el.innerHTML = [...t].map((c, j) => `<span class="ch" style="animation-delay:${Math.round(d0 + j * 22 / k)}ms">${esc(c)}</span>`).join('');
  if (!still) {
    if (S.reveal === 'words') el.animate([{ opacity: 0, transform: 'translateY(.32em)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 420 / k, delay: d0, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
    else if (S.reveal === 'fade') el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600 / k, delay: d0, easing: 'ease-out', fill: 'backwards' });
  }
  const w = { el, t, c: meta.c, fill: !!meta.fill };
  words.push(w); updCount();
  if (panelOpen && !still) { updatePanel(); lBody.scrollTo({ top: lBody.scrollHeight, behavior: 'smooth' }); }
  return w;
}
// "magic move": words that keep their line glide to their new places; a word that lands on another line
// dissolves where it was and fades in at its new place, riding along with the word before it (so it never
// flies across the text or runs into its neighbours); removed words dissolve where they were
function magic(rm, sw) {
  const k = K(), alive = words.filter(w => !w.dead);
  if (!alive.length) return;
  const lh = parseFloat(getComputedStyle(lText).lineHeight) || 24, SL = Math.round(lh * .55);
  const pos = new Map(alive.map(w => {
    const cs = getComputedStyle(w.el), m = cs.transform && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform) : null;
    return [w, { x: w.el.offsetLeft + (m ? m.m41 : 0), y: w.el.offsetTop + (m ? m.m42 : 0), ly: w.el.offsetTop, w: w.el.offsetWidth, t: w.t, op: +cs.opacity, st: w.el.classList.contains('strike') }];
  }));
  const ghost = p => {
    const g = document.createElement('span'); g.className = 'w ghost' + (p.st ? ' strike' : ''); g.textContent = p.t;
    g.style.left = p.x + 'px'; g.style.top = p.y + 'px'; g.style.opacity = p.op; lText.append(g);
    return g;
  };
  const dissolve = (p, dl = 0, d = 170) => {
    const g = ghost(p);
    g.animate([{ opacity: p.op, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.96)', filter: 'blur(1.5px)' }],
      { duration: d / k, delay: dl / k, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' }).finished.then(() => g.remove(), () => g.remove());
  };
  const swSet = new Set(sw), rmPos = rm.map(w => pos.get(w));
  for (const w of rm) { w.dead = true; w.el.getAnimations().forEach(a => a.cancel()); w.el.remove(); }
  for (const w of sw) { w.el.getAnimations().forEach(a => a.cancel()); w.el.classList.remove('strike'); w.el.textContent = w.c; w.t = w.c; w.c = undefined; }
  words = words.filter(w => !w.dead);
  for (const w of words) if (!swSet.has(w)) w.el.getAnimations().forEach(a => { if (a.effect && a.effect.getKeyframes().some(f => f.transform)) a.cancel(); });
  const L = words.map(w => ({ w, p: pos.get(w), nx: w.el.offsetLeft, ny: w.el.offsetTop }));
  rmPos.forEach((p, i) => p && dissolve(p, i * 16));
  const spring = SPR(.44, .06);
  let prev = null;
  L.forEach(({ w, p, nx, ny }, i) => {
    if (!p) return;
    const dl = Math.min(i * 5, 80) / 1000 / k, dx = p.x - nx, dy = p.y - ny, same = Math.abs(p.ly - ny) < lh / 2, swapped = swSet.has(w);
    let ox, oy;
    if (same && (!swapped || Math.abs(dx) <= Math.max(40, p.w * 1.2))) {
      ox = dx; oy = dy;
      if (swapped) { // short hop: the old spelling glides along and cross-fades into the new one
        const g = ghost(p);
        animate(g, { transform: ['translate(0px,0px)', `translate(${-dx}px,${-dy}px)`] }, { ...spring, delay: dl });
        g.animate([{ opacity: p.op, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(1.5px)' }], { duration: 200 / k, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' }).finished.then(() => g.remove(), () => g.remove());
        w.el.animate([{ opacity: 0, filter: 'blur(1.5px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 300 / k, delay: 40 / k, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
      }
    } else { // lands somewhere else: dissolve there, appear here attached to the word before it
      const pr = prev && Math.abs(prev.ny - ny) < lh / 2 ? prev : null;
      ox = (pr ? pr.ox : 0) + (ny < p.ly ? SL : 0); oy = pr ? pr.oy : 0;
      dissolve(p, 0, 150);
      w.el.animate([{ opacity: 0, filter: 'blur(1.5px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 300 / k, delay: (90 + Math.min(i * 5, 80)) / k, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
    }
    if (Math.abs(ox) > .5 || Math.abs(oy) > .5)
      animate(w.el, { transform: [`translate(${ox}px,${oy}px)`, 'translate(0px,0px)'] }, { ...spring, delay: dl }).then(() => { w.el.style.transform = ''; });
    prev = { ny, ox, oy };
  });
  updCount();
  if (panelOpen) updatePanel();
}
// new recognised text: what is the same stays, the changed tail dissolves, new words write themselves in
function setLiveText(txt) {
  const nw = String(txt || '').trim().split(/\s+/).filter(Boolean);
  const alive = words.filter(w => !w.dead);
  let i = 0; while (i < alive.length && i < nw.length && alive[i].t === nw[i]) i++;
  if (i < alive.length) magic(alive.slice(i), []);
  const k = K(), n = nw.length - i, step = n > 1 ? Math.min(70, 900 / n) / k : 0;
  for (let j = 0; i < nw.length; i++, j++) addWord(nw[i], { delay: j * step });
  updCount();
}

/* ---------------- cleaning: every word gets its clean form (c: '' = goes away), then magic() shows the change */
const FILLW = /^[(«"„]*(э+м*|э(-э)+|м{2,}|хм+|а{3,}|ну)[,.!?…»")]*$/i;
const ENDP = /[.!?…]["»)]*$/;
const cap1 = t => t.replace(/^([(«"„]*)(\p{Ll})/u, (m, a, b) => a + b.toUpperCase());
const normW = t => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
// local cleaning (no internet needed): fillers out, capitals at sentence starts, punctuation carried over
function planLocal() {
  const ws = words.filter(w => !w.dead);
  let start = true, keep = null;
  ws.forEach((w, i) => {
    w.c = undefined; w.fill = false;
    const t = w.t, n = normW(t);
    const filler = FILLW.test(t) && (n !== 'ну' || start);
    if (filler) {
      w.fill = true; w.c = '';
      const p = (t.match(/[.!?…]+["»)]*$/) || [])[0];
      if (p && keep && !/[.!?…,:;]["»)]*$/.test(keep.c ?? keep.t)) keep.c = (keep.c ?? keep.t) + p;
      if (p) start = true;
      return;
    }
    if (start) { const u = cap1(t); if (u !== t) w.c = u; }
    start = ENDP.test(t); keep = w;
  });
}
// any cleaned text (e.g. from the language model): line it up with the spoken words, word by word (LCS)
function planTo(clean) {
  const ws = words.filter(w => !w.dead), cs = String(clean || '').trim().split(/\s+/).filter(Boolean);
  const a = ws.map(w => normW(w.t)), b = cs.map(normW), n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] && a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  ws.forEach(w => { w.c = ''; w.fill = false; });
  let i = 0, j = 0, gw = [], gc = [], last = null, pend = '';
  const flush = () => {
    if (gw.length) { gw[0].c = gc.join(' '); for (let x = 1; x < gw.length; x++) gw[x].c = ''; if (!gc.length) gw.forEach(w => { if (FILLW.test(w.t)) w.fill = true; }); }
    else if (gc.length) { if (last) last.c = last.c + ' ' + gc.join(' '); else pend = gc.join(' '); }
    gw = []; gc = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] && a[i] === b[j]) {
      flush();
      ws[i].c = (pend ? pend + ' ' : '') + cs[j]; pend = ''; last = ws[i]; i++; j++;
    } else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) gw.push(ws[i++]);
    else gc.push(cs[j++]);
  }
  flush();
  if (pend) { if (ws.length) ws[ws.length - 1].c = (ws[ws.length - 1].c ? ws[ws.length - 1].c + ' ' : '') + pend; }
  ws.forEach(w => { if (w.c === w.t) w.c = undefined; });
}
const cleanOf = list => list.filter(w => w.c !== '' && !w.fill).map(w => w.c ?? w.t).join(' ').replace(/\s+([,.!?:;…»)])/g, '$1').trim();
async function cleanAnim(f) {
  const k = K(), ws = words.filter(w => !w.dead);
  const fills = ws.filter(w => w.fill);
  fills.forEach((w, i) => setTimeout(() => w.el.classList.add('strike'), i * 90 / k));
  if (fills.length) await sleep((360 + fills.length * 90) / k);
  if (f !== flow) return;
  const rm = ws.filter(w => w.fill || w.c === ''), sw = ws.filter(w => !w.fill && w.c && w.c !== w.t);
  if (rm.length || sw.length) { magic(rm, sw); await sleep(620 / k); }
}

/* ---------------- recording */
const MIME = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
const MAXREC = 10 * 60 * 1000;
let actx = null, warm = null, lastAudio = null, lastText = '';
// Whisper's well-known inventions on silence or noise
const HALL = /(субтитр\S*\s+(сделал|создавал|делал|подготовил)\S*.*|редактор субтитров.*|корректор\s+\S+\.?\s*\S*|продолжение следует\.*|спасибо за (просмотр|внимание)[.!]*|подписывайтесь на (канал|наш канал)[.!]*|ставьте лайки.*|dimatorzok|amara\.org.*|thanks for watching[.!]*)\s*$/i;
function stripHall(t) {
  t = String(t || '').trim();
  for (let i = 0; i < 3; i++) { const n = t.replace(HALL, '').trim(); if (n === t) break; t = n; }
  return /^[\s.,!?…-]*$/.test(t) ? '' : t;
}
// the microphone opens on the very first key press and records at once (so the first word is never cut)
function micOpen() {
  if (warm && !warm.dead) return warm;
  const w = { chunks: [], peak: 0, vox: 0, dead: false };
  w.p = (async () => {
    const dev = S.mic;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: dev ? { deviceId: { exact: dev } } : true }); }
    catch (e) { if (!dev) throw e; stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    if (w.dead) { stream.getTracks().forEach(t => t.stop()); throw new Error('closed'); }
    w.stream = stream;
    try {
      actx = actx || new AudioContext(); if (actx.state === 'suspended') actx.resume();
      w.src = actx.createMediaStreamSource(stream); w.an = actx.createAnalyser(); w.an.fftSize = 1024; w.src.connect(w.an); w.buf = new Float32Array(1024);
    } catch (e) { RA.log('analyser: ' + e.message); }
    w.mr = new MediaRecorder(stream, MIME ? { mimeType: MIME, audioBitsPerSecond: 32000 } : {});
    w.mr.ondataavailable = e => { if (e.data && e.data.size) w.chunks.push(e.data); };
    w.mr.start(250);
    w.tRec = performance.now();
    return w;
  })();
  w.p.catch(() => {});
  warm = w;
  return w;
}
function micClose(w) {
  if (!w) return;
  w.dead = true;
  try { if (w.mr && w.mr.state !== 'inactive') { w.mr.ondataavailable = null; w.mr.onstop = null; w.mr.stop(); } } catch (e) {}
  if (w.stream) w.stream.getTracks().forEach(t => t.stop());
  try { w.src && w.src.disconnect(); } catch (e) {}
  if (warm === w) warm = null;
}
async function micStop(w) {
  if (w.mr && w.mr.state !== 'inactive') await new Promise(res => { const t = setTimeout(res, 1500); w.mr.onstop = () => { clearTimeout(t); res(); }; try { w.mr.stop(); } catch (e) { res(); } });
  const type = ((w.mr && w.mr.mimeType) || MIME || 'audio/webm').split(';')[0];
  const blob = new Blob(w.chunks, { type });
  micClose(w);
  return blob;
}
const blobOf = w => new Blob(w.chunks, { type: ((w.mr && w.mr.mimeType) || MIME || 'audio/webm').split(';')[0] });
function micLevel(w) {
  if (!w || !w.an) return 0;
  w.an.getFloatTimeDomainData(w.buf); let s = 0; for (let i = 0; i < w.buf.length; i++) s += w.buf[i] * w.buf[i];
  const db = 20 * Math.log10(Math.sqrt(s / w.buf.length) + 1e-6);
  return clamp((db + 54) / 40, 0, 1);
}
function micErr(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Нет доступа к микрофону';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Микрофон не найден';
  if (n === 'NotReadableError') return 'Микрофон занят другой программой';
  return 'Микрофон не включился';
}
function clearPreview() { pvT.forEach(clearTimeout); pvT = []; pv = false; }
function endRec() {
  const r = rec; if (!r) return; rec = null;
  clearTimeout(r.pt); clearTimeout(r.mx);
  if (r.w) micClose(r.w);
}
function clearText() { lText.getAnimations({ subtree: true }).forEach(a => a.cancel()); lText.contentEditable = 'false'; lText.textContent = ''; words = []; updCount(); lBody.scrollTop = 0; }
function startRec(o = {}) {
  clearTimeout(idleT); flow++; endRec();
  closePanel(true);
  clearText(); setEditing(false);
  const real = OVERLAY && !o.preview;
  const r = { t0: performance.now(), sim: buildSim(), next: 0, preview: !!o.preview, words: o.words !== false && !real, loop: !!o.loop, real };
  rec = r; hover = false; timeEl.textContent = '0:00';
  setState('rec');
  if (!r.preview) sound('start');
  if (real) {
    r.w = micOpen();
    r.w.p.catch(e => { if (rec === r && e.message !== 'closed') { RA.log('mic: ' + (e.name || '') + ' ' + e.message); fail(micErr(e), 'mic'); } });
    if (ENV.onStart) ENV.onStart();
    partialLoop(r);
    r.mx = setTimeout(() => { if (rec === r && state === 'rec') finish(); }, MAXREC);
  }
  if (S.live === 'always' || o.panel) setTimeout(() => { if (rec === r && state === 'rec') openPanel(); }, 170 / K());
  return r;
}
// live text while speaking: the recording so far goes to Groq every few seconds (only while the text is visible)
function partialLoop(r, now) {
  clearTimeout(r.pt);
  const el = (performance.now() - r.t0) / 1000, gap = now ? 0 : Math.max(3, el * .35) * 1000 + (r.back || 0);
  r.pt = setTimeout(async () => {
    if (rec !== r || state !== 'rec') return;
    const w = r.w;
    if (panelOpen && ENV.recognize && w && w.chunks.length > 3 && !r.busy && w.peak > .2) {
      r.busy = true; r.lastP = performance.now();
      try {
        const t = await ENV.recognize(blobOf(w), { partial: true });
        if (rec === r && state === 'rec' && t != null) { const s = stripHall(t); if (s) setLiveText(s); }
        r.back = 0;
      } catch (e) { r.back = e.code === 429 ? Math.min(30000, (r.back || 4000) * 2) : Math.min(15000, (r.back || 2000) * 1.5); }
      r.busy = false;
    }
    if (rec === r) partialLoop(r);
  }, gap);
}
async function finish() {
  if (state !== 'rec' || !rec) return;
  const r = rec, f = ++flow, k = K();
  clearTimeout(r.pt); clearTimeout(r.mx);
  rec = null;
  if (r.real) {
    const dur = (performance.now() - r.t0) / 1000;
    let blob = null, w = null;
    try { w = await r.w.p; } catch (e) { if (f === flow) fail(micErr(e), 'mic'); return; }
    if (f !== flow) { micClose(w); return; }
    // a tap that was too short or silence: no request, no error — just back to rest
    if (dur < .5 || w.peak < .2) { micClose(w); sound('cancel'); setState('idle'); shake(); RA.log(`skipped: ${dur.toFixed(2)}s peak ${w.peak.toFixed(2)}`); return; }
    sound('stop');
    setState('proc');
    blob = await micStop(w);
    if (f !== flow) return;
    lastAudio = { blob, dur };
    return recognize(f, blob, dur);
  }
  sound('stop');
  if (r.w) micClose(r.w);
  setState('proc');
  if (!words.length) { await sleep(500 / k); if (f === flow) fail('Ничего не услышал'); return; }
  await sleep(850 / k);
  if (f !== flow) return;
  return polishAndGo(f, false);
}
async function recognize(f, blob, dur) {
  let txt;
  try { txt = await ENV.recognize(blob, { sec: dur }); }
  catch (e) { if (f === flow) fail(e.message || 'Не получилось распознать', e.act || 'retry'); return; }
  if (f !== flow) return;
  txt = stripHall(txt);
  if (!txt) { fail('Ничего не услышал'); return; }
  setLiveText(txt);
  await sleep(panelOpen ? 260 : 0);
  if (f !== flow) return;
  return polishAndGo(f, true, dur);
}
async function polishAndGo(f, real, dur = 0) {
  const k = K();
  if (S.clean) {
    if (real) {
      let done = false;
      if (ENV.polish) {
        const raw = words.filter(w => !w.dead).map(w => w.t).join(' ');
        try { const c = await ENV.polish(raw); if (f !== flow) return; if (c) { planTo(c); done = true; } } catch (e) { RA.log('polish: ' + e.message); }
      }
      if (!done) planLocal();
    }
    if (panelOpen) { await cleanAnim(f); if (f !== flow) return; if (!S.review) await sleep(real ? 380 : 650 / k); }
    else if (!real) await sleep(600 / k);
  } else if (panelOpen && !S.review) await sleep(real ? 300 : 500 / k);
  if (f !== flow) return;
  const list = words.filter(w => !w.dead);
  const text = S.clean ? cleanOf(list) : list.map(w => w.t).join(' ');
  if (S.review) toReview(text); else insert(text, dur);
}
function retry() {
  if (!lastAudio) { toIdle(); return; }
  clearTimeout(idleT); const f = ++flow;
  clearText(); setState('proc');
  if (S.live === 'always') openPanel();
  recognize(f, lastAudio.blob, lastAudio.dur);
}
function fail(msg, act) {
  flow++; endRec(); closePanel(); setEditing(false);
  errAct = act || null;
  errTxt.textContent = msg + (act === 'retry' && lastAudio ? ' · нажми — ещё раз' : act === 'key' ? ' · открыть настройки' : '');
  setState('err'); sound('err');
  RA.log('error: ' + msg);
  idleT = setTimeout(toIdle, act === 'retry' ? 9000 : act ? 6000 : 2600);
}
function toReview(text) {
  setState('review');
  lText.getAnimations({ subtree: true }).forEach(a => a.finish());
  lText.querySelectorAll('.ghost').forEach(g => g.remove());
  lText.textContent = text; words = text.split(/\s+/).filter(Boolean).map(t => ({ t })); updCount();
  lText.contentEditable = 'true';
  setMode();
  if (!panelOpen) openPanel(); else updatePanel();
  $('#lFoot').animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300 / K(), delay: 80 / K(), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
  if (!OVERLAY) setTimeout(() => { if (state !== 'review') return; lText.focus({ preventScroll: true }); const sel = getSelection(); sel.selectAllChildren(lText); sel.collapseToEnd(); }, 80);
}
// review: a click into the text takes the keyboard (the overlay normally never has it)
function setEditing(on) {
  if (on === editing) return;
  editing = on;
  if (OVERLAY && ENV.focus) ENV.focus(on);
  arm();
}
function insert(text, dur = 0) {
  text = String(text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  flow++; lText.contentEditable = 'false';
  const wasEditing = editing; editing = false;
  if (!text) { if (wasEditing && ENV.focus) ENV.focus(false); toIdle(); return; }
  lastText = text;
  const n = wc(text);
  doneTxt.textContent = 'Вставлено · ' + words_(n);
  setState('done'); closePanel(); sound('done');
  if (ENV.onInsert) Promise.resolve(ENV.onInsert(text, { words: n, sec: dur })).catch(e => {
    RA.log('insert: ' + (e && e.message || e));
    if (ENV.copy) Promise.resolve(ENV.copy(text)).catch(() => {});
    errTxt.textContent = 'Не вставилось — текст скопирован'; errAct = null; setState('err'); sound('err');
    clearTimeout(idleT); idleT = setTimeout(toIdle, 3200);
  });
  else if (ENV.onDemoInsert) ENV.onDemoInsert(text);
  idleT = setTimeout(toIdle, 1800);
}
function cancel() {
  flow++; clearTimeout(idleT); clearTimeout(hkT); hkT = 0; held = false; endRec(); sound('cancel');
  closePanel(); lText.contentEditable = 'false'; setEditing(false);
  setState('idle');
  shake();
}
function toIdle() { clearTimeout(idleT); flow++; endRec(); closePanel(); lText.contentEditable = 'false'; setEditing(false); setState('idle'); }
function arm() {
  if (!ENV.arm) return;
  const e = ['rec', 'proc', 'review'].includes(state) && !editing, n = state === 'review' && !editing;
  const key = e + '|' + n; if (arm._k === key) return; arm._k = key;
  ENV.arm(e, n);
}
function setState(s, o = {}) {
  state = s;
  procTxt.textContent = S.clean ? 'Причёсываю…' : 'Распознаю…';
  if (s !== 'idle') hover = false;
  if (s !== 'err') errAct = null;
  retarget({ instant: o.instant });
  const gl = s === 'rec' || s === 'proc' ? 1 : 0;
  if (Math.abs(G.gl.get() - gl) > .001) animate(G.gl, gl, TW(gl ? .4 : .3, 0, [.3, 0, .2, 1]));
  lvStart();
  if (panelOpen) updatePanel();
  arm();
  if (ENV.onState) ENV.onState(s);
}

/* ---------------- sounds */
let sctx = null;
function sound(t) {
  if (!S.sounds) return;
  try {
    sctx = sctx || new AudioContext(); if (sctx.state === 'suspended') sctx.resume();
    const tones = { start: [[587, 0], [880, .075]], stop: [[880, 0], [587, .075]], done: [[784, 0], [1175, .06]], cancel: [[392, 0], [294, .08]], err: [[311, 0], [311, .14]] }[t] || [];
    const now = sctx.currentTime;
    for (const [f, dt] of tones) {
      const o = sctx.createOscillator(), g = sctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + dt); g.gain.linearRampToValueAtTime(.07, now + dt + .012); g.gain.exponentialRampToValueAtTime(.0001, now + dt + .18);
      o.connect(g).connect(sctx.destination); o.start(now + dt); o.stop(now + dt + .2);
    }
  } catch (e) {}
}

/* ---------------- voice level + wave: one frame-rate independent loop (same look at 60, 144, 165 Hz) */
function rr(x, y, w, h, r) { wctx.beginPath(); if (wctx.roundRect) wctx.roundRect(x, y, w, h, r); else wctx.rect(x, y, w, h); wctx.fill(); }
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
function drawWave(now, dt) {
  const W = waveWidth(), H = 24; if (!W) return;
  wctx.clearRect(0, 0, W, H); wctx.fillStyle = WAVE; wctx.strokeStyle = WAVE;
  if (now - rndT > 85) { rndT = now; for (let i = 0; i < rnd.length; i++) rnd[i] = .35 + .65 * Math.random(); }
  if (S.wave === 'bars' || S.wave === 'dots') {
    const n = S.bars, mid = (n - 1) / 2, step = S.wave === 'bars' ? 6 : 7, a = ease(25, dt);
    for (let i = 0; i < n; i++) {
      const d = mid ? Math.abs(i - mid) / mid : 0, env = 1 - d * d * .6;
      bars[i] += (Math.min(1, lv * 1.3) * env * (.5 + .5 * rnd[i]) - bars[i]) * a;
      if (S.wave === 'bars') { const h = 3 + bars[i] * 19; rr(i * step, (H - h) / 2, 3, h, 1.5); }
      else { const h = 4 + bars[i] * 14; wctx.globalAlpha = .55 + .45 * Math.min(1, bars[i] * 2.2); rr(i * step, (H - h) / 2, 4, h, 2); wctx.globalAlpha = 1; }
    }
  } else if (S.wave === 'tape') {
    if (now - tapeT > 45) { tapeT = now; tape.push(Math.min(1, lv * 1.3) * (.7 + .3 * Math.random())); if (tape.length > 40) tape.shift(); }
    const step = 3, n = Math.floor((W + 1) / step), sub = clamp((now - tapeT) / 45, 0, 1) * step;
    for (let i = 0; i < n; i++) {
      const v = tape[tape.length - n + i] || 0, h = 2 + v * 20, x = i * step - sub + step;
      if (x > W - 1) continue;
      wctx.globalAlpha = clamp(.25 + .75 * (x / W), 0, 1); rr(x, (H - h) / 2, 2, h, 1);
    }
    wctx.globalAlpha = 1;
  } else if (S.wave === 'line') {
    const t = now / 1000, amp = 1 + Math.min(1, lv * 1.25) * 9.5;
    wctx.lineWidth = 1.8; wctx.lineCap = 'round'; wctx.lineJoin = 'round';
    for (const [a, ph, al] of [[1, 0, 1], [-.6, 1.3, .38]]) {
      wctx.globalAlpha = al; wctx.beginPath();
      for (let x = 1; x <= W - 1; x += 1) { const u = x / W, taper = Math.sin(Math.PI * u); const y = H / 2 + a * amp * taper * Math.sin(u * Math.PI * 3.2 + t * 7 + ph); x === 1 ? wctx.moveTo(x, y) : wctx.lineTo(x, y); }
      wctx.stroke();
    }
    wctx.globalAlpha = 1;
  }
}
let lvOn = false;
function lvStart() { if (!lvOn && (state === 'rec' || lv > .002)) { lvOn = true; frame.update(lvTick, true); } }
function lvTick(fd) {
  const now = fd.timestamp, dt = Math.min(.05, (fd.delta || 16.7) / 1000);
  if (state === 'rec' && rec) {
    const r = rec, ms = Math.max(0, now - r.t0);
    let tg;
    if (r.real) { const raw = micLevel(r.w); tg = raw; if (r.w) { if (raw > r.w.peak) r.w.peak = raw; if (raw > .3) r.w.vox += dt; } }
    else tg = simLevel(r.loop ? ms % (r.sim.end + 600) : ms, r.sim);
    if (r.loop && ms % (r.sim.end + 600) < 30) r.sim.i = 0;
    tg = Math.min(1, tg * S.sens / 100);
    lv += (tg - lv) * ease(tg > lv ? 40 : 9, dt);
    if (!r.real && r.words) {
      const sc = r.sim.sch;
      while (r.next < sc.length && ms > sc[r.next].t1 + 260) { const w = sc[r.next++]; addWord(w.w, { c: w.c, fill: w.fill }); }
      if (r.next >= sc.length && ms > r.sim.end + 300) r.done = true;
    }
    const sec = Math.floor(ms / 1000), tt = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    if (timeEl.textContent !== tt) timeEl.textContent = tt;
    drawWave(now, dt);
  } else {
    lv += (0 - lv) * ease(9, dt);
    if (lv < .002) { lv = 0; cancelFrame(lvTick); lvOn = false; }
  }
  setS(cDot, 'transform', `scale(${f3(1 + lv * .32)})`);
  if (S.wave === 'pulse') setS(cRing, 'transform', `scale(${f3(1 + lv * 1.6)})`);
  setS(lDot, 'transform', `scale(${f3(1 + lv * .45)})`);
  glowDraw();
}

/* ---------------- capsule pointer: click / drag / hover (hit test by geometry) */
let press = null;
function overCap(e, m) { const x = e.clientX - SX, y = e.clientY - SY; return x >= D.x - m && x <= D.x + D.w + m && y >= D.y - m && y <= D.y + D.h + m; }
function setCursor(c) { stage.classList.toggle('grab', c === 'grab'); stage.classList.toggle('grabbing', c === 'grabbing'); }
const changed = () => { if (ENV.onChange) ENV.onChange(S); };
stage.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('#pc' + (ENV.ignore ? ',' + ENV.ignore : ''))) return;
  if (!overCap(e, state === 'idle' ? 14 : 3)) return;
  const kEl = e.target.closest('[data-k]');
  press = { x: e.clientX, y: e.clientY, k: kEl && cc.contains(kEl) ? kEl.dataset.k : 'body', drag: false, id: e.pointerId };
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stage.addEventListener('pointermove', e => {
  if (press) {
    if (!press.drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
      press.drag = true; dragging = true;
      press.ox = e.clientX - SX - D.cx; press.oy = e.clientY - SY - D.cy;
      if (S.pos !== 'free') { S.pos = 'free'; changed(); }
      G.px.jump(0); G.py.jump(0);
      setCursor('grabbing'); setOp(); breath();
    }
    if (press.drag) {
      let cx = e.clientX - SX - press.ox, cy = e.clientY - SY - press.oy;
      const sn = Math.abs(cx - SW / 2) < 10; if (sn) cx = SW / 2;
      guide.classList.toggle('on', sn);
      S.fx = clamp(cx / SW, 0, 1); S.fy = clamp(cy / SH, 0, 1);
      req();
      if (panelOpen) updatePanel({ jump: true });
    }
    return;
  }
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

