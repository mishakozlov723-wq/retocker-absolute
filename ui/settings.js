'use strict';
// The settings window: pages on the left, a live preview of the capsule on top (the same engine as the real one).
(() => {
const RA = window.RA, { invoke, listen, log, esc, words_, pl } = RA;
window.onerror = (m, src, l) => log(`settings error: ${m} @${String(src || '').split('/').pop()}:${l}`);
window.addEventListener('unhandledrejection', e => log('settings unhandled: ' + ((e.reason && e.reason.message) || e.reason)));
addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
addEventListener('keydown', e => { if ((e.ctrlKey && /^[rpfgjsu]$/i.test(e.key)) || /^F(5|7)$/.test(e.key)) e.preventDefault(); }, true);
addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

const $ = s => document.querySelector(s);
let cap = null;
const S_ = () => cap.S;
window.RA_ENV = {
  mode: 'preview', stage: $('#pv'), task: 0, top: 46, observe: true, ignore: '.pvbar,.pvhint',
  onChange: () => { push(); refresh(); },
  copy: t => copy(t),
  onDemoInsert: () => {},
  ready: api => { cap = api; init(); }
};

/* ---------------- helpers */
function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const toastEl = $('#toast');
function toast(t, ms = 2600) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('on'), ms); }
async function copy(t) {
  try { if (RA.tauri) { const ok = await invoke('copy_text', { text: t }); if (ok) return true; } } catch (e) {}
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
  const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) {} a.remove(); return ok;
}
const openUrl = url => RA.tauri ? invoke('open_url', { url }) : window.open(url, '_blank');
// settings changed here: tell the real capsule (it also hears the storage event)
let pushT = 0;
function push() { clearTimeout(pushT); pushT = setTimeout(() => RA.emitTo('capsule', 'cfg'), 60); }
const UI = [];
function refresh() { UI.forEach(f => { try { f(); } catch (e) { log('ui: ' + e.message); } }); }
function set(k, v, pvk) { cap.opt({ [k]: v }); push(); refresh(); if (pvk) cap.preview(pvk); }
const I = (d, extra = '') => `<svg viewBox="0 0 24 16" style="width:24px;height:16px" ${extra}>${d}</svg>`;

/* ---------------- builders (append into the current page) */
let P = null;
const page = id => { P = $('#p-' + id); return P; };
function head(t, sub) { P.append(h('div', 'ph', `<h1>${t}</h1>${sub ? `<span>${sub}</span>` : ''}`)); }
function sec(t) { P.append(h('div', 'sec', t)); }
function lbl(t, sm, tip, badge) {
  const l = h('div', 'lbl'), tt = h('span', 't', t);
  if (badge) tt.append(h('span', 'new', badge));
  if (tip && window.TIPS) tt.append(window.TIPS.q(tip));
  l.append(tt); if (sm) l.append(h('small', '', sm));
  return l;
}
function row(cls, t, sm, o = {}) { const r = h(o.label ? 'label' : 'div', 'row' + (cls ? ' ' + cls : '')); r.append(lbl(t, sm, o.tip, o.badge)); return r; }
function dis(r, o) { if (o.dis) UI.push(() => r.classList.toggle('dis', !!o.dis())); }
function seg(k, t, opts, sm, o = {}) {
  const r = row('', t, sm, o), g = h('div', 'seg');
  opts.forEach(([v, n]) => { const b = h('button', '', n); b.onclick = () => { set(k, v, o.pv); if (o.after) o.after(v); }; b._v = v; g.append(b); });
  r.append(g); P.append(r);
  UI.push(() => [...g.children].forEach(b => b.classList.toggle('on', S_()[k] === b._v))); dis(r, o);
  return r;
}
function sw(k, t, sm, o = {}) {
  const r = row('', t, sm, { ...o, label: true }), i = h('input', 'sw'); i.type = 'checkbox';
  i.onchange = () => { set(k, i.checked, o.pv); if (o.after) o.after(i.checked); };
  r.append(i); P.append(r);
  UI.push(() => { i.checked = !!S_()[k]; }); dis(r, o);
  return r;
}
function rng(k, t, min, max, step, fmt, o = {}) {
  const r = h('div', 'row col'), top = h('div', 'rt'), val = h('span', 'val');
  top.append(lbl(t, o.sm, o.tip), val);
  const i = h('input', 'rng'); Object.assign(i, { type: 'range', min, max, step });
  const paint = () => { const v = S_()[k]; i.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%'); val.textContent = fmt(v); };
  i.oninput = () => { cap.opt({ [k]: +i.value }); push(); paint(); if (o.onin) o.onin(+i.value); };
  i.onchange = () => { refresh(); if (o.pv) cap.preview(o.pv); };
  r.append(top, i); P.append(r);
  UI.push(() => { i.value = S_()[k]; paint(); }); dis(r, o);
  return r;
}
function chips(k, t, opts, n, o = {}) {
  const r = h('div', 'row col'); r.append(lbl(t, o.sm, o.tip));
  const g = h('div', 'chips'); g.style.setProperty('--n', n);
  opts.forEach(([v, name, ico]) => { const b = h('button', 'chip' + (o.small ? ' sm' : ''), `<span class="ico">${ico}</span>${name}`); b._v = v; b.onclick = () => set(k, v, o.pv); g.append(b); });
  r.append(g); P.append(r);
  UI.push(() => [...g.children].forEach(b => b.classList.toggle('on', S_()[k] === b._v))); dis(r, o);
  return r;
}

/* ---------------- a dropdown in the app's style (instead of the system list)
   the button shows the choice (cut with «…» when long, the full name in its tooltip); the list shows full names
   (up to two lines) with a tick on the chosen one; mouse, keyboard (↑ ↓ Home End Enter Esc, first letter) */
let ddOpen = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function dd(o = {}) {
  const b = h('button', 'dd', '<span class="v"></span><svg viewBox="0 0 16 16"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>');
  b.type = 'button'; b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false');
  if (o.width) b.style.width = o.width;
  const st = { el: b, items: [], v: '', onchange: o.onchange || (() => {}) };
  st.paint = () => { const it = st.items.find(i => i.v === st.v) || st.items[0]; b.firstChild.textContent = it ? it.t : ''; b.title = it ? it.t + (it.sub ? ' · ' + it.sub : '') : ''; };
  st.set = v => { st.v = v; st.paint(); };
  st.setItems = (items, v) => { st.items = items; if (v !== undefined) st.v = v; st.paint(); if (ddOpen && ddOpen.st === st) { ddRender(); ddPlace(); } };
  b.onclick = () => (ddOpen && ddOpen.st === st ? ddClose() : ddShow(st));
  b.onkeydown = e => { if ((!ddOpen || ddOpen.st !== st) && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); ddShow(st); } };
  return st;
}
function ddShow(st) {
  ddClose(true);
  const L = h('div', 'ddl'); L.setAttribute('role', 'listbox');
  document.body.append(L);
  ddOpen = { st, L, act: Math.max(0, st.items.findIndex(i => i.v === st.v)) };
  ddRender(); ddPlace();
  st.el.classList.add('on'); st.el.setAttribute('aria-expanded', 'true');
  const a = L.children[ddOpen.act]; if (a) a.scrollIntoView({ block: 'nearest' });
  requestAnimationFrame(() => requestAnimationFrame(() => L.classList.add('on')));
}
function ddRender() {
  const { st, L } = ddOpen;
  L.innerHTML = '';
  st.items.forEach((it, i) => {
    const r = h('div', 'ddi' + (it.v === st.v ? ' sel' : '') + (i === ddOpen.act ? ' act' : ''),
      `<span class="tx"><span class="t">${esc(it.t)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span><svg viewBox="0 0 16 16"><path d="m3.8 8.4 2.7 2.7 5.7-5.8"/></svg>`);
    r.setAttribute('role', 'option'); r.title = it.t;
    r.onpointermove = () => { if (ddOpen && ddOpen.act !== i) ddAct(i, false); };
    r.onclick = () => ddPick(i);
    L.append(r);
  });
}
function ddPlace() {
  const { st, L } = ddOpen, r = st.el.getBoundingClientRect();
  const w = Math.max(r.width, 260);
  L.style.width = w + 'px';
  L.style.left = clamp(r.right - w, 8, innerWidth - w - 8) + 'px';
  L.style.maxHeight = '';
  const want = Math.min(L.scrollHeight + 2, 300), below = innerHeight - r.bottom - 12, above = r.top - 46;
  const down = below >= want || below >= above;
  L.style.maxHeight = Math.max(80, Math.min(300, down ? below : above)) + 'px';
  L.classList.toggle('up', !down);
  if (down) { L.style.top = (r.bottom + 4) + 'px'; L.style.bottom = ''; } else { L.style.bottom = (innerHeight - r.top + 4) + 'px'; L.style.top = ''; }
}
function ddAct(i, scroll) {
  if (!ddOpen) return;
  const { L } = ddOpen, n = L.children.length; if (!n) return;
  i = clamp(i, 0, n - 1); ddOpen.act = i;
  [...L.children].forEach((c, j) => c.classList.toggle('act', j === i));
  if (scroll) L.children[i].scrollIntoView({ block: 'nearest' });
}
function ddPick(i) {
  if (!ddOpen) return;
  const { st } = ddOpen, it = st.items[i];
  ddClose(); st.el.focus({ preventScroll: true });
  if (it && it.v !== st.v) { st.v = it.v; st.paint(); st.onchange(it.v); }
}
function ddClose(now) {
  if (!ddOpen) return;
  const { st, L } = ddOpen; ddOpen = null;
  st.el.classList.remove('on'); st.el.setAttribute('aria-expanded', 'false');
  if (now) { L.remove(); return; }
  L.classList.remove('on'); L.style.pointerEvents = 'none'; setTimeout(() => L.remove(), 160);
}
addEventListener('pointerdown', e => { if (ddOpen && !ddOpen.L.contains(e.target) && !ddOpen.st.el.contains(e.target)) ddClose(); }, true);
addEventListener('keydown', e => {
  if (!ddOpen) return;
  const k = e.key, n = ddOpen.st.items.length;
  if (k === 'Escape' || k === 'Tab') { e.preventDefault(); e.stopPropagation(); const el = ddOpen.st.el; ddClose(); el.focus({ preventScroll: true }); return; }
  if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); ddAct(ddOpen.act + (k === 'ArrowDown' ? 1 : -1), true); return; }
  if (k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') { e.preventDefault(); e.stopPropagation(); ddAct(k === 'Home' ? 0 : k === 'End' ? n - 1 : ddOpen.act + (k === 'PageDown' ? 6 : -6), true); return; }
  if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); ddPick(ddOpen.act); return; }
  if (k.length === 1 && /\S/.test(k)) {
    const its = ddOpen.st.items, q = k.toLowerCase();
    for (let j = 1; j <= n; j++) { const x = (ddOpen.act + j) % n; if (String(its[x].t).toLowerCase().startsWith(q)) { ddAct(x, true); break; } }
  }
}, true);
addEventListener('resize', () => ddClose(true));
addEventListener('blur', () => ddClose(true));

/* ---------------- window, navigation */
document.querySelectorAll('.wb').forEach(b => b.onclick = () => invoke('win_ctl', { a: b.dataset.w }).catch(() => {}));
const PV_PAGES = ['caps', 'text'];
let cur = '';
function go(id) {
  if (!$('#p-' + id)) id = 'home';
  if (id === cur) return;
  cur = id;
  document.querySelectorAll('.ni').forEach(b => b.classList.toggle('on', b.dataset.p === id));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + id));
  $('#pvw').classList.toggle('on', PV_PAGES.includes(id));
  $('#scroll').scrollTop = 0; ddClose(true);
  if (cap) { cap.toIdle(); requestAnimationFrame(() => cap.measure()); }
  if (SHOW[id]) SHOW[id]();
  if (id !== 'ctl') micTest(false);
  if (id !== 'text') asrTryRun(false);
}
const SHOW = {};
document.querySelectorAll('.ni').forEach(b => b.onclick = () => go(b.dataset.p));

/* ---------------- preview bar: jump to a state */
function buildPreviewBar() {
  const bar = h('div', 'pvbar');
  const st = [['idle', 'Покой'], ['rec', 'Запись'], ['proc', 'Распознаю'], ['review', 'Проверка'], ['done', 'Готово'], ['err', 'Ошибка']];
  st.forEach(([s, n]) => { const b = h('button', '', n); b.onclick = () => { if (s === 'idle') cap.toIdle(); else cap.demo(s); }; b.dataset.s = s; bar.append(b); });
  bar.append(h('i'));
  const play = h('button', '', '▶ Показать'); play.title = 'Показать всё по очереди'; play.onclick = () => { cap.toIdle(); cap.preview('morph'); }; bar.append(play);
  $('#pv').append(bar, h('div', 'pvhint', 'Нажми на капсулу — она оживёт'));
  const sync = () => bar.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === cap.state));
  setInterval(sync, 200);
}

/* ---------------- page: the capsule */
function buildCaps() {
  page('caps'); head('Капсула', 'как она выглядит и двигается');
  sec('Готовые стили');
  {
    const r = h('div', 'pres');
    RA.PRESETS.forEach(p => {
      const v = p.v, glass = v.bg === 'glass', bg = glass ? 'rgba(255,255,255,.1)' : (RA.BGS.find(b => b[0] === v.bg) || RA.BGS[0])[1];
      const light = !glass && RA.lum(bg) > .4, acc = RA.contrast(v.acc, glass ? '#262626' : bg) < 1.7 ? (light ? '#1f1f1f' : '#fff') : v.acc;
      const wv = v.wcol === 'accent' ? acc : v.wcol === 'text' ? '#fff' : '#9a9a9a';
      const bars = v.wave === 'pulse' ? '' : [5, 9, 12, 8, 5].map(x => `<i style="height:${x}px;background:${wv}"></i>`).join('');
      const b = h('button', 'pre', `<span class="mini" style="background:${bg}"><b style="background:${acc};${v.wave === 'pulse' ? 'margin:0;box-shadow:0 0 0 3px ' + acc + '33' : ''}"></b>${bars}</span>${p.name}`);
      b.onclick = () => { cap.toIdle(); cap.opt({ ...p.v }); push(); refresh(); cap.preview('morph'); };
      r.append(b);
      UI.push(() => b.classList.toggle('on', RA.PK.every(k => S_()[k] === p.v[k])));
    });
    P.append(r);
  }
  sec('Вид');
  { // background
    const r = h('div', 'row col'), top = h('div', 'rt'), nm = h('span', 'swn'); top.append(lbl('Фон капсулы'), nm);
    const g = h('div', 'sws');
    RA.BGS.forEach(([v, c, n]) => { const b = h('button', 'swc' + (v === 'glass' ? ' glass' : '')); if (c) b.style.background = c; b.title = n; b._v = v; b.onclick = () => set('bg', v, 'rec'); g.append(b); });
    const pk = h('label', 'swc pick'); pk.title = 'Свой цвет'; const pi = h('input'); pi.type = 'color'; pk.append(pi); g.append(pk);
    pi.oninput = () => { cap.opt({ bgc: pi.value, bg: 'custom' }); push(); refresh(); };
    r.append(top, g); P.append(r);
    UI.push(() => { const S = S_(); [...g.children].forEach(b => b.classList.toggle('on', b === pk ? S.bg === 'custom' : S.bg === b._v)); pi.value = S.bgc; pk.style.background = S.bg === 'custom' ? S.bgc : ''; nm.textContent = S.bg === 'custom' ? 'Свой' : (RA.BGS.find(b => b[0] === S.bg) || [0, 0, ''])[2]; });
  }
  { // accent
    const r = h('div', 'row col'), top = h('div', 'rt'), nm = h('span', 'swn'); top.append(lbl('Акцент', 'Точка записи и свечение'), nm);
    const g = h('div', 'sws');
    RA.ACCS.forEach(([c, n]) => { const b = h('button', 'swc'); b.style.background = c; b.title = n; b._v = c; b.onclick = () => set('acc', c, 'rec'); g.append(b); });
    const pk = h('label', 'swc pick'); pk.title = 'Свой цвет'; const pi = h('input'); pi.type = 'color'; pk.append(pi); g.append(pk);
    pi.oninput = () => { cap.opt({ acc: pi.value }); push(); refresh(); };
    r.append(top, g); P.append(r);
    UI.push(() => { const S = S_(), known = RA.ACCS.find(a => a[0] === S.acc); [...g.children].forEach(b => b.classList.toggle('on', b === pk ? !known : S.acc === b._v)); pi.value = /^#[0-9a-f]{6}$/i.test(S.acc) ? S.acc : '#ffffff'; pk.style.background = known ? '' : S.acc; nm.textContent = known ? known[1] : 'Свой'; });
  }
  seg('wcol', 'Цвет волны', [['accent', 'Акцент'], ['text', 'Как текст'], ['gray', 'Серый']], '', { pv: 'rec' });
  chips('shape', 'Форма', [['pill', 'Таблетка', I('<rect x="3" y="4" width="18" height="8" rx="4"/>')], ['round', 'Мягкая', I('<rect x="3" y="3" width="18" height="10" rx="3"/>')], ['square', 'Строгая', I('<rect x="3" y="3" width="18" height="10" rx="1"/>')]], 3, { small: true, pv: 'rec' });
  rng('scale', 'Размер', 80, 140, 5, v => v + '%', { pv: 'rec' });
  sw('border', 'Обводка', 'Тонкая светлая рамка по краю');
  sw('shadow', 'Тень', 'Капсула как будто парит над окнами');
  rng('glow', 'Свечение при записи', 0, 100, 5, v => v ? v + '%' : 'нет', { pv: 'rec', sm: 'Мягкий ореол акцентного цвета, дышит с голосом' });

  sec('Анимация');
  chips('anim', 'Как капсула меняет форму', [
    ['smooth', 'Плавно', I('<path d="M3 12.5C10 12.5 9 3.5 21 3.5"/>')],
    ['spring', 'Пружина', I('<path d="M3 12.5C7 12.5 8 1.5 12.5 2.5S15 7 17 6s2.5-2.5 4-2.5"/>')],
    ['drop', 'Капля', I('<circle cx="6.5" cy="8" r="3.2"/><rect x="12" y="4.8" width="10" height="6.4" rx="3.2"/>')],
    ['island', 'Остров', I('<rect x="3" y="3.5" width="18" height="9" rx="4.5"/><circle cx="8.5" cy="8" r="1.4" fill="currentColor" stroke="none"/><path d="M12 8h5" opacity=".55"/>')],
    ['fade', 'Тихо', I('<rect x="3" y="4.5" width="18" height="7" rx="3.5" stroke-dasharray="2 2.6"/>')]
  ], 5, { pv: 'morph', sm: 'Нажми — сразу покажу' });
  rng('speed', 'Скорость анимаций', 50, 200, 10, v => v === 100 ? 'обычная' : v < 100 ? 'медленнее · ' + v + '%' : 'быстрее · ' + v + '%', { pv: 'morph' });
  chips('idle', 'Когда молчишь', [
    ['line', 'Линия', I('<path d="M7 8h10" stroke-width="3"/>')],
    ['dot', 'Точка', I('<circle cx="12" cy="8" r="2.6" fill="currentColor" stroke="none"/>')],
    ['mini', 'Мини-волна', I('<rect x="4" y="3.5" width="16" height="9" rx="4.5"/><path d="M9.5 7v2M12 5.8v4.4M14.5 7v2"/>')],
    ['hidden', 'Скрыта', I('<path d="M7 8h10" stroke-width="3" stroke-dasharray="1.2 3" opacity=".55"/>')]
  ], 4, { sm: 'Скрыта — появится, если навести мышку', tip: 'idle' });
  rng('idleSc', 'Размер в покое', 50, 200, 10, v => v + '%', { sm: 'Насколько крупная линия, точка или мини-волна, пока молчишь', dis: () => S_().idle === 'hidden', onin: () => { if (cap.state !== 'idle') cap.toIdle(); } });
  sw('breathe', 'Дыхание', 'Медленно сужается и расширяется', { dis: () => S_().idle === 'hidden' });
  rng('idleOp', 'Яркость в покое', 20, 100, 5, v => v + '%', { dis: () => S_().idle === 'hidden' });
  sw('hint', 'Подсказка при наведении', 'Показывает горячую клавишу');

  sec('Волна');
  chips('wave', 'Как выглядит голос', [
    ['bars', 'Столбики', I('<path d="M5 6v4M9 3.5v9M13 5v6M17 2.5v11M21 6v4"/>')],
    ['tape', 'Лента', I('<path d="M3 7.2v1.6M6 6.5v3M9 7v2M12 5v6M15 3v10M18 5.5v5M21 4.5v7" stroke-width="1.5"/>')],
    ['line', 'Линия', I('<path d="M2 8c2.6-5.5 4.6-5.5 7 0s4.6 5.5 7 0 4.4-5 6-1"/>')],
    ['dots', 'Точки', I('<g fill="currentColor" stroke="none"><circle cx="5" cy="8" r="1.7"/><rect x="8.8" y="4.5" width="3.4" height="7" rx="1.7"/><rect x="13.8" y="2.5" width="3.4" height="11" rx="1.7"/><circle cx="21" cy="8" r="1.7"/></g>')],
    ['pulse', 'Пульс', I('<circle cx="12" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="5.6" opacity=".45"/>')]
  ], 5, { pv: 'rec' });
  rng('bars', 'Сколько столбиков', 5, 20, 1, v => v, { pv: 'rec', dis: () => !['bars', 'dots'].includes(S_().wave) });
  rng('sens', 'Чувствительность', 50, 200, 10, v => v + '%', { pv: 'rec', sm: 'Насколько сильно волна прыгает от голоса' });

  sec('Во время записи');
  sw('timer', 'Таймер', 'Сколько секунд идёт запись', { pv: 'rec' });
  sw('btns', 'Кнопки ✕ и ✓', 'Отменить или закончить мышкой', { pv: 'rec' });
  chips('proc', 'Пока распознаёт', [
    ['shimmer', 'Надпись', I('<path d="M4 8h16" stroke-width="3" opacity=".35"/><path d="M9 8h5" stroke-width="3"/>')],
    ['dots', 'Точки', I('<g fill="currentColor" stroke="none"><circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8" opacity=".5"/></g>')],
    ['ring', 'Кольцо', I('<circle cx="12" cy="8" r="5" opacity=".3"/><path d="M12 3a5 5 0 0 1 5 5"/>')]
  ], 3, { pv: 'proc' });
  sw('sounds', 'Звуки', 'Тихий «дзынь» в начале и в конце');
}

/* ---------------- «Мгновенный живой текст»: the speech model on this computer (downloaded here, once) */
const capLight = () => { const S = S_(); if (S.bg === 'glass') return false; return RA.lum(S.bg === 'custom' ? S.bgc : (RA.BGS.find(b => b[0] === S.bg) || RA.BGS[0])[1] || '#1e1e1e') > .4; };
let asrSt = { installed: false }, asrTry = null, asrTryN = 0, asrPaint = () => {};
const asrStatus = () => RA.tauri ? invoke('asr_status').then(s => { asrSt = s || {}; asrPaint(); }).catch(() => {}) : Promise.resolve();
function asrOut(t, last) {
  const el = $('#asrOut'); if (!el) return;
  const w = String(t || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) { el.innerHTML = '<span class="ph">' + (asrTry ? 'Говори — слова появятся здесь…' : 'Ничего не услышал — попробуй ещё раз, погромче') + '</span>'; return; }
  const n = last ? w.length : Math.max(0, w.length - 2);
  el.innerHTML = esc(w.slice(0, n).join(' ')) + (n < w.length ? ' <span class="tent">' + esc(w.slice(n).join(' ')) + '</span>' : '');
}
async function asrTryRun(on) {
  const b = $('#asrTry');
  if (!on) {
    if (!asrTry) return;
    const t = asrTry; asrTry = null; clearTimeout(t.to);
    try { t.node.disconnect(); } catch (e) {}
    t.stream.getTracks().forEach(x => x.stop()); try { t.ctx.close(); } catch (e) {}
    if (b) b.textContent = 'Попробовать на своём голосе';
    const txt = await invoke('asr_finish', { id: t.id }).catch(() => '');
    if (asrTryN === t.n) asrOut(txt || t.txt, true);
    return;
  }
  if (asrTry) return;
  try {
    const dev = S_().mic;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: dev ? { deviceId: { exact: dev } } : true }); }
    catch (e) { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    const ctx = new AudioContext(), n = ++asrTryN, id = 0x7f000000 + n;
    const t = asrTry = { stream, ctx, id, n, txt: '', node: null };
    $('#asrOut').hidden = false; asrOut('');
    if (b) b.textContent = 'Хватит';
    if (!(await invoke('asr_start', { id }).catch(() => false))) { toast('Модель не найдена — скачай её ещё раз'); asrTryRun(false); asrStatus(); return; }
    t.node = await RA.pcmTap(ctx, ctx.createMediaStreamSource(stream), pcm => { if (asrTry === t) RA.asrFeed(id, pcm); });
    t.to = setTimeout(() => { if (asrTry === t) asrTryRun(false); }, 30000);
  } catch (e) { asrTry = null; if (b) b.textContent = 'Попробовать на своём голосе'; toast('Микрофон не включился: ' + (e.name === 'NotAllowedError' ? 'нет доступа' : e.name === 'NotFoundError' ? 'не найден' : e.message)); }
}
function buildFast() {
  const r = h('div', 'row col fast'), top = h('div', 'rt');
  const tg = h('input', 'sw'); tg.type = 'checkbox'; tg.title = 'Включить или выключить';
  tg.onchange = () => { set('fast', tg.checked); if (tg.checked) cap.preview('fix'); };
  top.append(lbl('Мгновенный живой текст', 'Слова появляются сразу, пока говоришь. Их слышит сам компьютер, без интернета — а итоговый текст всё равно пишет Groq', '', 'новое'), tg);
  const mid = h('div', 'rt mid'), st = h('div', 'status', '<i></i><span></span>'), bx = h('div', 'btns');
  const bGet = h('button', 'btn pri', 'Скачать · ≈50 МБ'), bCan = h('button', 'btn', 'Отмена'), bTry = h('button', 'btn', 'Попробовать на своём голосе'), bDel = h('button', 'btn', 'Удалить');
  bTry.id = 'asrTry';
  bGet.onclick = () => { asrSt = { ...asrSt, busy: true, err: null, got: 0, total: asrSt.need || 0 }; asrPaint(); invoke('asr_get').catch(e => { asrSt.busy = false; asrSt.err = String(e); asrPaint(); }); };
  bCan.onclick = () => invoke('asr_cancel').catch(() => {});
  bTry.onclick = () => asrTryRun(!asrTry);
  bDel.onclick = async () => {
    if (!bDel._arm) { bDel._arm = true; bDel.textContent = 'Точно удалить?'; setTimeout(() => { bDel._arm = false; asrPaint(); }, 3000); return; }
    bDel._arm = false; await asrTryRun(false);
    try { await invoke('asr_del'); toast('Модель удалена'); } catch (e) { toast('Не получилось удалить: ' + e); }
    push(); asrStatus();
  };
  bx.append(bGet, bCan, bTry, bDel); mid.append(st, bx);
  const bar = h('div', 'pbar', '<b></b>');
  const out = h('div', 'asrout'); out.id = 'asrOut'; out.hidden = true;
  r.append(top, mid, bar, out); P.append(r);
  const stx = (cls, t) => { st.className = 'status' + (cls ? ' ' + cls : ''); st.lastChild.textContent = t; };
  asrPaint = () => {
    const s = asrSt, inst = !!s.installed, busy = !!s.busy;
    tg.hidden = !inst; bGet.hidden = inst || busy; bCan.hidden = !busy; bTry.hidden = bDel.hidden = !inst || busy; bar.hidden = !busy;
    if (!inst) { out.hidden = true; }
    if (!bDel._arm) bDel.textContent = 'Удалить модель' + (s.size ? ' · ' + mb(s.size) + ' МБ' : '');
    bGet.textContent = s.err ? 'Попробовать ещё раз' : 'Скачать · ≈50 МБ';
    if (!RA.tauri) stx('', 'Работает только в самой программе');
    else if (busy) { const p = s.total ? Math.min(1, (s.got || 0) / s.total) : 0; bar.firstChild.style.width = (p * 100).toFixed(1) + '%'; stx('wait', 'Скачиваю… ' + Math.round(p * 100) + '%' + (s.total ? ` · ${mb(s.got || 0)} из ${mb(s.total)} МБ` : '')); }
    else if (s.err) stx('bad', 'Не получилось скачать: ' + s.err);
    else if (inst && s.loadErr) stx('bad', 'Модель не запускается: ' + s.loadErr);
    else if (inst) stx(S_().fast ? 'ok' : '', S_().fast ? (S_().live === 'off' ? 'Включено — но живой текст выключен выше' : 'Включено · модель на компьютере') : 'Выключено · модель на компьютере');
    else stx('', 'Нужно один раз скачать модель распознавания');
  };
  UI.push(() => { tg.checked = !!S_().fast; asrPaint(); });
  listen('asr_dl', e => {
    const p = e.payload || {};
    if (p.state === 'run') { asrSt = { ...asrSt, busy: true, err: null, got: p.got, total: p.total }; asrPaint(); }
    else { if (p.state === 'err') asrSt.err = p.err || 'ошибка'; else if (p.state === 'cancel') toast('Загрузка отменена'); else if (p.state === 'done') toast('Готово — теперь слова появляются сразу'); asrStatus().then(() => { if (p.state === 'err') { asrSt.err = asrSt.err || p.err || 'ошибка'; asrPaint(); } }); }
  });
  listen('asr', e => { const p = e.payload || {}; if (asrTry && p.id === asrTry.id) { asrTry.txt = p.text || ''; asrOut(asrTry.txt); } });
  asrStatus();
}
function buildFixc() {
  const r = h('div', 'row col'), top = h('div', 'rt'), nm = h('span', 'swn'); top.append(lbl('Цвет исправлений', 'Когда Groq поправит слово, оно на миг подсветится этим цветом'), nm);
  const g = h('div', 'sws');
  RA.FIXC.forEach(([v, , , n]) => { const b = h('button', 'swc' + (v === 'off' ? ' off' : '')); b.title = n; b._v = v; b.onclick = () => set('fixc', v, 'fix'); g.append(b); });
  r.append(top, g); P.append(r);
  UI.push(() => {
    const S = S_(), L = capLight(), c = RA.FIXC.find(x => x[0] === S.fixc) || RA.FIXC[0];
    [...g.children].forEach(b => { const x = RA.FIXC.find(y => y[0] === b._v); b.classList.toggle('on', b._v === c[0]); if (x[0] === 'acc') b.style.background = S.acc; else if (x[1]) b.style.background = L ? x[2] : x[1]; });
    nm.textContent = c[3]; r.classList.toggle('dis', S.live === 'off');
  });
}

/* ---------------- page: text */
function buildText() {
  page('text'); head('Текст', 'живой текст, причёска, вставка');
  SHOW.text = asrStatus;
  sec('Живой текст');
  buildFast();
  seg('live', 'Показывать текст во время речи', [['off', 'Нет'], ['tap', 'По клику'], ['always', 'Всегда']], 'По клику — нажми на точку в капсуле', { pv: 'live', tip: 'live' });
  sw('pdot', 'Точка растёт', 'Пока текст открыт, точка становится больше — вместо колечка', { pv: 'dot', tip: 'pdot', dis: () => S_().live === 'off' });
  seg('reveal', 'Как появляются слова', [['letters', 'Буквы'], ['words', 'Слова'], ['fade', 'Плавно']], '', { pv: 'live', dis: () => S_().live === 'off' });
  buildFixc();
  rng('fs', 'Размер текста', 12, 18, 1, v => v + ' px', { pv: 'live', dis: () => S_().live === 'off' && !S_().review });
  rng('pw', 'Ширина панели', 300, 560, 10, v => v + ' px', { pv: 'live', dis: () => S_().live === 'off' && !S_().review });

  sec('После речи');
  sw('clean', 'Причесать текст', 'Убрать «эээ», «ну», поставить заглавные буквы', { tip: 'clean' });
  sw('smart', 'Умная причёска', 'Groq поправит запятые, оговорки и числа — по смыслу', { tip: 'smart', dis: () => !S_().clean });
  sw('review', 'Проверить перед вставкой', 'Сначала окно с текстом: поправил — Enter', { tip: 'review' });
  sw('revBtn', 'Кнопка «Проверю перед вставкой»', 'В панели с текстом во время речи: нажал — после диктовки откроется окно проверки, только в этот раз', { dis: () => S_().review || S_().live === 'off' });

  sec('Вставка');
  seg('paste', 'Как вставлять', [['clip', 'Через буфер'], ['type', 'Печатать']], 'Печатать — для программ, где не работает Ctrl+V', { tip: 'paste' });
  sw('keepClip', 'Вернуть буфер обмена', 'После вставки в буфере снова то, что было до неё', { tip: 'keepClip', dis: () => S_().paste !== 'clip' });

  sec('Распознавание');
  {
    const r = row('', 'Язык речи', 'На каком языке ты говоришь');
    const s = dd({ width: '200px', onchange: v => set('lang', v) });
    s.setItems([['ru', 'Русский'], ['auto', 'Определять самому', 'Groq поймёт язык сам'], ['en', 'English'], ['uk', 'Українська'], ['de', 'Deutsch'], ['es', 'Español'], ['kk', 'Қазақша']].map(([v, t, sub]) => ({ v, t, sub })));
    r.append(s.el); P.append(r);
    UI.push(() => { s.set(S_().lang); });
  }
  {
    const r = h('div', 'row col'); r.append(lbl('Словарь', 'Имена, тикеры, термины — через запятую. Groq будет писать их правильно', 'dict'));
    const t = h('textarea', 'in'); t.placeholder = 'Например: BTCUSDT, Bybit, тейк-профит, шорт, Миша Козлов'; t.rows = 3; t.spellcheck = false;
    let tt = 0; t.oninput = () => { clearTimeout(tt); tt = setTimeout(() => { cap.opt({ dict: t.value }); push(); }, 300); };
    r.append(t); P.append(r);
    UI.push(() => { if (document.activeElement !== t) t.value = S_().dict || ''; });
  }
}

/* ---------------- page: control */
const SIDE_MODS = ['LCtrl', 'RCtrl', 'LAlt', 'RAlt', 'LShift', 'RShift', 'LWin', 'RWin'];
const GEN = n => n.replace(/^[LR](Ctrl|Alt|Shift|Win)$/, '$1');
const ORDER = ['Ctrl', 'Alt', 'Shift', 'Win'];
const ALONE = /^(F\d{1,2}|Insert|Pause|ScrollLock|CapsLock|Menu|PrintScreen|Mute|VolDown|VolUp|Play|Next|Prev|Stop)$/;
let hkRec = null;
function hkHtml(c) { return RA.hkParts(c).map(p => `<kbd>${esc(p)}</kbd>`).join('<span>+</span>'); }
function hkStart(btn) {
  if (hkRec) { hkStop(); return; }
  hkRec = { btn, mods: [], peak: [], main: false, t: setTimeout(hkStop, 19000) };
  btn.classList.add('rec'); btn.textContent = 'Нажми клавиши…';
  invoke('hk_record', { on: true }).catch(() => {});
}
function hkStop() { if (!hkRec) return; clearTimeout(hkRec.t); hkRec.btn.classList.remove('rec'); hkRec = null; invoke('hk_record', { on: false }).catch(() => {}); refresh(); }
function hkShow() { if (!hkRec) return; hkRec.btn.innerHTML = hkRec.mods.length ? hkHtml([...new Set(hkRec.mods.map(GEN))].join('+')) + '<span>+ …</span>' : 'Нажми клавиши…'; }
function hkSet(c) { hkStop(); cap.opt({ hk: c }); push(); refresh(); toast('Горячая клавиша: ' + RA.hkLabel(c)); }
function hkEvent(p) {
  if (!hkRec) return;
  const { name, down, m } = p;
  if (m) {
    if (down) { if (!hkRec.mods.includes(name)) hkRec.mods.push(name); if (hkRec.mods.length > hkRec.peak.length) hkRec.peak = hkRec.mods.slice(); hkShow(); return; }
    hkRec.mods = hkRec.mods.filter(x => x !== name);
    if (!hkRec.main && hkRec.peak.length) {
      const pk = hkRec.peak;
      let c;
      if (pk.length === 1) {
        c = pk[0];
        if (/Shift$/.test(c)) { toast('Один Shift нельзя — он нужен для печати. Добавь ещё клавишу'); hkRec.peak = []; hkShow(); return; }
        if (/Win$/.test(c)) { toast('Один Win нельзя — он открывает меню «Пуск». Добавь ещё клавишу'); hkRec.peak = []; hkShow(); return; }
      } else c = ORDER.filter(o => pk.some(x => GEN(x) === o)).join('+');
      hkSet(c);
    }
    if (!hkRec || !hkRec.mods.length) { if (hkRec) { hkRec.peak = []; hkRec.main = false; hkShow(); } }
    return;
  }
  if (!down) return;
  if (name === 'Esc' && !hkRec.mods.length) { hkStop(); return; }
  const mods = ORDER.filter(o => hkRec.mods.some(x => GEN(x) === o));
  if (!mods.length && !ALONE.test(name)) { toast('Одна такая клавиша помешает печатать — добавь Ctrl, Alt или Win'); return; }
  if (['Enter', 'Tab', 'Backspace', 'Esc'].includes(name) && mods.length === 1 && mods[0] === 'Shift') { toast('Это сочетание нужно для печати — выбери другое'); return; }
  hkRec.main = true;
  hkSet([...mods, name].join('+'));
}
let mic = null;
async function micTest(on) {
  const btn = $('#micBtn'), meter = $('#micMeter');
  if (!on) { if (mic) { cancelAnimationFrame(mic.raf); mic.stream.getTracks().forEach(t => t.stop()); try { mic.ctx.close(); } catch (e) {} mic = null; } if (btn) btn.textContent = 'Проверить'; if (meter) meter.firstChild.style.width = '0'; return; }
  try {
    const dev = S_().mic;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: dev ? { deviceId: { exact: dev } } : true }); }
    catch (e) { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(1024);
    mic = { stream, ctx };
    btn.textContent = 'Хватит';
    const tick = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-6); meter.firstChild.style.width = Math.max(0, Math.min(100, (db + 54) / 40 * 100)) + '%'; mic.raf = requestAnimationFrame(tick); };
    tick();
    listMics();
  } catch (e) { toast('Микрофон не включился: ' + (e.name === 'NotAllowedError' ? 'нет доступа' : e.name === 'NotFoundError' ? 'не найден' : e.message)); }
}
let micDD = null;
async function listMics() {
  const s = micDD; if (!s) return;
  let ds = [];
  try { ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) {}
  if (ds.length && !ds.some(d => d.label)) {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) {}
  }
  const curv = S_().mic;
  // the Windows default shows which device it is right now («По умолчанию - Микрофон (Realtek…)»)
  const dl = (ds.find(d => d.deviceId === 'default') || {}).label || '';
  const dn = dl.replace(/^[^-–—]*[-–—]\s*/, '').trim();
  const items = [{ v: '', t: 'Как в Windows', sub: dn ? 'Сейчас: ' + dn : 'Тот, что выбран в Windows' }];
  ds.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').forEach((d, i) => items.push({ v: d.deviceId, t: d.label || 'Микрофон ' + (i + 1) }));
  s.setItems(items, items.some(i => i.v === curv) ? curv : '');
}
function buildCtl() {
  page('ctl'); head('Управление', 'клавиша, место, микрофон');
  sec('Клавиша');
  {
    const r = row('', 'Горячая клавиша', 'Нажми и введи своё сочетание. Можно только модификаторы: Ctrl+Win, правый Alt…', { tip: 'hotkey' });
    const b = h('button', 'hk'); b.onclick = () => hkStart(b);
    r.append(b); P.append(r);
    UI.push(() => { if (!hkRec) b.innerHTML = hkHtml(S_().hk); });
  }
  seg('mode', 'Режим', [['hold', 'Удерживать'], ['toggle', 'Нажать']], 'Удерживать — говоришь, пока держишь. Нажать — вкл/выкл', { tip: 'mode' });
  sec('Где капсула');
  seg('pos', 'Положение', [['bottom', 'Снизу'], ['top', 'Сверху'], ['free', 'Где оставил']], 'Капсулу можно перетащить мышкой', { tip: 'pos', after: v => { if (v === 'free') toast('Перетащи капсулу мышкой куда удобно'); } });
  rng('off', 'Отступ от края', 8, 80, 2, v => v + ' px', { dis: () => S_().pos === 'free' });
  sw('hideFs', 'Прятать в полноэкранных', 'Игры, фильмы, презентации — капсулы не видно (клавиша работает)', { tip: 'hideFs' });
  sec('Микрофон');
  {
    const r = row('', 'Микрофон', 'Чем слушать');
    const box = h('div', 'fld'); box.style.width = '330px';
    micDD = dd({ onchange: v => { set('mic', v); if (mic) { micTest(false); micTest(true); } } });
    micDD.el.style.flex = '1'; micDD.setItems([{ v: '', t: 'Как в Windows', sub: 'Тот, что выбран в Windows' }], '');
    const m = h('div', 'meter', '<b></b>'); m.id = 'micMeter'; m.style.width = '60px';
    const b = h('button', 'btn', 'Проверить'); b.id = 'micBtn'; b.onclick = () => micTest(!mic);
    box.append(micDD.el, m, b); r.append(box); P.append(r);
  }
  sec('Windows');
  {
    const r = row('', 'Запускать вместе с Windows', 'Капсула будет готова сразу после включения компьютера', { label: true });
    const i = h('input', 'sw'); i.type = 'checkbox'; i.id = 'auto';
    i.onchange = async () => { const want = i.checked; let ok = false; try { ok = await invoke('autostart', { on: want }); } catch (e) {} if (!ok) { i.checked = !want; toast('Не получилось изменить автозапуск'); } else toast(want ? 'Буду запускаться вместе с Windows' : 'Автозапуск выключен'); };
    r.append(i); P.append(r);
  }
  SHOW.ctl = () => { listMics(); invoke('app_info').then(a => { $('#auto').checked = !!a.autostart; }).catch(() => {}); };
}

/* ---------------- page: Groq key */
const PROXY_CODE = `// Retocker — посредник между программой и Groq (работает на серверах Google). Версия 2.
// Ключ Groq не хранится здесь: его присылает программа в каждом запросе.
function doGet() { return out({ ok: true, app: 'retocker-voice', v: 2, t: Date.now() }); }

function doPost(e) {
  var t0 = Date.now(), b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out({ error: 'bad json' }); }
  if (!b.key) return out({ error: 'no key' });
  var auth = { Authorization: 'Bearer ' + b.key };
  if (b.ping) {
    var p = UrlFetchApp.fetch('https://api.groq.com/openai/v1/models', { headers: auth, muteHttpExceptions: true });
    return out({ ok: p.getResponseCode() === 200, code: p.getResponseCode(), v: 2, ms: Date.now() - t0 });
  }
  if (b.chat) {
    var c = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'post', contentType: 'application/json', headers: auth, payload: JSON.stringify(b.chat), muteHttpExceptions: true });
    var cj = {};
    try { cj = JSON.parse(c.getContentText()); } catch (x) {}
    var msg = cj.choices && cj.choices[0] && cj.choices[0].message ? cj.choices[0].message.content : '';
    return out({ code: c.getResponseCode(), text: msg || '', error: cj.error ? cj.error.message : '', ms: Date.now() - t0 });
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(b.audio), b.mime || 'audio/webm', 'audio.' + (b.ext || 'webm'));
  var form = { file: blob, model: b.model || 'whisper-large-v3-turbo', response_format: 'json', temperature: '0' };
  if (b.lang) form.language = b.lang;
  if (b.prompt) form.prompt = b.prompt;
  var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'post', headers: auth, payload: form, muteHttpExceptions: true });
  var code = r.getResponseCode(), j = {};
  try { j = JSON.parse(r.getContentText()); } catch (x) {}
  return out({ code: code, text: j.text || '', error: j.error ? j.error.message : (code === 200 ? '' : r.getContentText().slice(0, 300)), ms: Date.now() - t0 });
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
function keyState() {
  const a = RA.auth();
  $('#keyDot').hidden = !!(a.vk && a.ok);
  return a;
}
function buildKey() {
  page('key'); head('Ключ Groq', 'без него текст не распознаётся');
  const warn = h('div', 'note warn', '<div><b>Ключа ещё нет.</b> Он бесплатный, займёт 2 минуты — инструкция ниже.</div>'); P.append(warn);
  sec('Подключение');
  const a = RA.auth();
  const r1 = h('div', 'row col'); r1.append(lbl('Ключ Groq', 'Начинается с gsk_. Хранится только на этом компьютере'));
  const f1 = h('div', 'fld'), k = h('input', 'in'); k.type = 'password'; k.placeholder = 'gsk_…'; k.spellcheck = false; k.autocomplete = 'off'; k.value = a.vk || '';
  const eye = h('button', 'eye', '<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>'); eye.title = 'Показать';
  eye.onclick = () => { k.type = k.type === 'password' ? 'text' : 'password'; };
  f1.append(k, eye); r1.append(f1); P.append(r1);
  const r2 = h('div', 'row col'); r2.append(lbl('Посредник (адрес)', 'Нужен, если Groq не открывается напрямую — например, из России. Иначе оставь пустым', 'proxy'));
  const u = h('input', 'in'); u.placeholder = 'https://script.google.com/macros/s/…/exec'; u.spellcheck = false; u.value = a.vu || '';
  r2.append(u); P.append(r2);
  const r3 = h('div', 'row'), st = h('div', 'status', '<i></i><span>Нажми «Проверить»</span>'), chk = h('button', 'btn pri', 'Проверить');
  r3.append(st, chk); P.append(r3);
  const showSt = (cls, t) => { st.className = 'status ' + cls; st.lastChild.textContent = t; };
  if (a.vk && a.ok) showSt('ok', 'Проверено — всё работает' + (a.vu ? ' через посредника' : ''));
  const store = ok => { const n = { ...RA.auth(), vk: k.value.trim(), vu: u.value.trim() }; if (ok !== undefined) n.ok = ok.ok; if (ok && ok.ok) n.chat = !!ok.chat; RA.setAuth(n); keyState(); warn.style.display = n.vk ? 'none' : ''; refreshHome(); };
  let tt = 0;
  [k, u].forEach(i => i.oninput = () => { clearTimeout(tt); tt = setTimeout(() => { store({ ok: false }); showSt('', 'Нажми «Проверить»'); }, 400); });
  chk.onclick = async () => {
    const key = k.value.trim(), url = u.value.trim();
    if (key && !/^gsk_/.test(key)) { showSt('bad', 'Ключ Groq начинается с gsk_ — проверь, что скопировал его'); return; }
    chk.disabled = true; showSt('wait', 'Проверяю…');
    const res = await window.VOICE.ping(key, url);
    chk.disabled = false;
    store(res);
    showSt(res.ok ? 'ok' : 'bad', res.msg + (res.ok && res.ms ? ` · ${res.ms} мс` : ''));
  };
  warn.style.display = a.vk ? 'none' : '';

  sec('Как получить ключ');
  {
    const d = h('details', 'det'); d.open = !a.vk;
    d.innerHTML = `<summary>Ключ Groq — бесплатно, 2 минуты</summary><div class="body"><ol class="steps">
      <li><span>Открой <b>console.groq.com/keys</b> и войди через Google.</span></li>
      <li><span>Нажми <b>Create API Key</b>, дай любое имя — например, Retocker.</span></li>
      <li><span>Скопируй ключ (он начинается с <b>gsk_</b>) и вставь в поле выше.</span></li>
      <li><span>Нажми <b>Проверить</b>. Если пишет «нужен посредник» — сделай его по инструкции ниже.</span></li></ol>
      <div class="btns" style="padding:4px 10px 0"><button class="btn" id="openGroq">Открыть console.groq.com</button></div></div>`;
    P.append(d);
    d.querySelector('#openGroq').onclick = () => openUrl('https://console.groq.com/keys');
  }
  {
    const d = h('details', 'det');
    d.innerHTML = `<summary>Посредник Google — если Groq не открывается</summary><div class="body"><ol class="steps">
      <li><span>Нажми <b>Скопировать код</b>, потом <b>Открыть Google Скрипты</b> — откроется новый проект.</span></li>
      <li><span>Сотри всё, что там написано, и вставь код (Ctrl+V). Нажми значок дискеты — сохранить.</span></li>
      <li><span>Справа сверху: <b>Начать развертывание → Новое развертывание</b>. Тип (шестерёнка) — <b>Веб-приложение</b>.</span></li>
      <li><span>«Запуск от имени» — <b>Я</b>, «У кого есть доступ» — <b>Все</b>. Нажми <b>Начать развертывание</b> и разреши доступ.</span></li>
      <li><span>Скопируй <b>URL веб-приложения</b> (кончается на /exec), вставь в поле «Посредник» выше и нажми <b>Проверить</b>.</span></li></ol>
      <div class="btns" style="padding:4px 10px 0"><button class="btn pri" id="cpCode">Скопировать код</button><button class="btn" id="openGas">Открыть Google Скрипты</button></div></div>`;
    P.append(d);
    d.querySelector('#cpCode').onclick = async () => toast((await copy(PROXY_CODE)) ? 'Код посредника скопирован' : 'Не получилось скопировать');
    d.querySelector('#openGas').onclick = () => openUrl('https://script.new');
  }
  {
    const d = h('details', 'det');
    d.innerHTML = `<summary>Уже есть посредник от Retocker Voice?</summary><div class="body"><ol class="steps">
      <li><span>Он подойдёт как есть — просто вставь его адрес. Распознавание будет работать.</span></li>
      <li><span>Для <b>умной причёски</b> его надо обновить: открой тот проект, сотри код и вставь новый (кнопка ниже).</span></li>
      <li><span><b>Начать развертывание → Управление развертываниями</b> → карандаш → Версия: <b>Новая версия</b> → <b>Начать развертывание</b>. Адрес не меняется.</span></li></ol>
      <div class="btns" style="padding:4px 10px 0"><button class="btn" id="cpCode2">Скопировать новый код</button><button class="btn" id="openGas2">Открыть мои скрипты</button></div></div>`;
    P.append(d);
    d.querySelector('#cpCode2').onclick = async () => toast((await copy(PROXY_CODE)) ? 'Код посредника скопирован' : 'Не получилось скопировать');
    d.querySelector('#openGas2').onclick = () => openUrl('https://script.google.com/home');
  }
}

/* ---------------- page: about */
const LATEST = 'https://retocker-voice.web.app/absolute/latest.json';
let info = { version: '', logs: '' }, upd = null, updRun = false;
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const updSt = (cls, t) => { const st = $('#updSt'); if (st) { st.className = 'status ' + cls; st.lastChild.textContent = t; } };
// the app asks the signed manifest itself (no browser rules in the way); a plain fetch only in the browser preview
async function checkUpdate(manual) {
  if (updRun) return;
  if (manual) updSt('wait', 'Проверяю…');
  try {
    let j;
    if (RA.tauri) j = await invoke('upd_check');
    else { const r = await fetch(LATEST + '?t=' + Date.now(), { cache: 'no-store' }); j = await r.json(); }
    if (!info.version) info = await invoke('app_info').catch(() => info);
    upd = j && j.version && info.version && newer(j.version, info.version) ? j : null;
    $('#updDot').hidden = !upd;
    if (upd) updSt('ok', 'Есть новая версия ' + upd.version + (upd.size ? ' · ' + upd.size : ''));
    else updSt('ok', 'У тебя последняя версия');
    const b = $('#updBtn'); if (b) { b.hidden = !upd; b.textContent = upd && upd.can ? 'Обновить до ' + upd.version : 'Скачать новую версию'; }
    const nt = $('#updNotes'); if (nt) { nt.hidden = !(upd && upd.notes); if (upd) nt.textContent = upd.notes || ''; }
    refreshHome();
  } catch (e) { if (manual) updSt('bad', 'Не получилось проверить — нет связи'); else updSt('', 'Проверю позже'); }
}
// «Обновить»: the app downloads the new version, checks its signature, puts it in place and restarts
function startUpdate() {
  if (!upd || updRun) return;
  if (!upd.can || !RA.tauri) { openUrl(upd.url); return; }
  updRun = true;
  $('#updBtn').hidden = true; $('#updChk').disabled = true; $('#updMan').hidden = true;
  $('#updBar').hidden = false; $('#updBar').firstChild.style.width = '0%';
  updSt('wait', 'Скачиваю…');
  invoke('upd_install').catch(e => updEv({ stage: 'error', msg: String(e) }));
}
const mb = n => (n / 1048576).toFixed(1).replace('.', ',');
function updEv(e) {
  const bar = $('#updBar');
  if (e.stage === 'down') {
    const p = Math.max(0, Math.min(1, e.p || 0));
    if (bar) bar.firstChild.style.width = (p * 100).toFixed(1) + '%';
    updSt('wait', 'Скачиваю… ' + Math.round(p * 100) + '%' + (e.total ? ` · ${mb(e.got || 0)} из ${mb(e.total)} МБ` : ''));
  } else if (e.stage === 'check') { if (bar) bar.firstChild.style.width = '100%'; updSt('wait', 'Проверяю подпись…'); }
  else if (e.stage === 'apply') updSt('wait', 'Устанавливаю… Windows может спросить разрешение');
  else if (e.stage === 'restart') updSt('ok', 'Перезапускаю…');
  else if (e.stage === 'error') {
    updRun = false;
    if (bar) bar.hidden = true;
    $('#updChk').disabled = false;
    const b = $('#updBtn'); if (b) b.hidden = !upd;
    $('#updMan').hidden = !upd;
    updSt('bad', 'Не получилось обновить: ' + (e.msg || 'ошибка'));
  }
}
function buildAbout() {
  page('about'); head('О программе');
  const c = h('div', 'card');
  c.innerHTML = `<div style="display:flex;align-items:center;gap:14px"><svg viewBox="0 0 64 64" style="width:44px;height:44px"><rect width="64" height="64" rx="15" fill="#2a2a2a" stroke="none"/><rect x="9" y="22" width="46" height="20" rx="10" fill="#fff" stroke="none"/><circle cx="20" cy="32" r="3.6" fill="#1c1c1c" stroke="none"/><path d="M29 29v6M35 26v12M41 28.5v7M47 30.5v3" stroke="#1c1c1c" stroke-width="3" stroke-linecap="round"/></svg>
    <div style="flex:1"><div style="font-size:16px;font-weight:750">Retocker Voice</div><div style="color:var(--tx2);font-size:12.5px">Говоришь — текст появляется там, где курсор. <span id="ver"></span></div></div></div>`;
  P.append(c);
  sec('Обновления');
  { const r = h('div', 'row col upd'), top = h('div', 'rt');
    const st = h('div', 'status', '<i></i><span id="updTx">Проверю при запуске</span>'); st.id = 'updSt';
    const bx = h('div', 'btns'); const b1 = h('button', 'btn', 'Проверить'); b1.id = 'updChk'; b1.onclick = () => checkUpdate(true);
    const b3 = h('button', 'btn', 'Скачать вручную'); b3.id = 'updMan'; b3.hidden = true; b3.title = 'Открыть страницу загрузки в браузере'; b3.onclick = () => upd && openUrl(upd.url);
    const b2 = h('button', 'btn pri', 'Обновить'); b2.id = 'updBtn'; b2.hidden = true; b2.onclick = startUpdate;
    bx.append(b2, b3, b1); top.append(st, bx);
    const nt = h('div', 'unotes'); nt.id = 'updNotes'; nt.hidden = true;
    const bar = h('div', 'pbar', '<b></b>'); bar.id = 'updBar'; bar.hidden = true;
    r.append(top, nt, bar); P.append(r); }
  sec('Как это работает');
  P.append(h('div', 'note', '<div>Программа живёт в <b>трее</b> (у часов). Крестик закрывает только это окно — капсула продолжает работать. Совсем выйти — правой кнопкой по значку в трее → <b>Выйти</b>.</div>'));
  sec('Если что-то не так');
  { const r = row('', 'Журнал работы', 'Пригодится, если что-то сломалось: там видно, что произошло'); const b = h('button', 'btn', 'Открыть папку'); b.onclick = () => invoke('open_logs').catch(() => {}); r.append(b); P.append(r); }
  { const r = row('', 'Сбросить настройки', 'Вид и поведение капсулы — как в начале. Ключ и статистика останутся'); const b = h('button', 'btn red', 'Сбросить');
    b.onclick = () => { if (!b._arm) { b._arm = true; b.textContent = 'Точно сбросить?'; setTimeout(() => { b._arm = false; b.textContent = 'Сбросить'; }, 3000); return; }
      b._arm = false; b.textContent = 'Сбросить'; cap.toIdle(); cap.opt({ ...RA.DEF }); push(); refresh(); toast('Настройки сброшены'); };
    r.append(b); P.append(r); }
  { const r = row('', 'Выйти из программы', 'Капсула исчезнет до следующего запуска'); const b = h('button', 'btn', 'Выйти'); b.onclick = () => invoke('quit').catch(() => {}); r.append(b); P.append(r); }
  SHOW.about = () => invoke('app_info').then(a => { info = a; $('#ver').textContent = 'Версия ' + a.version; }).catch(() => {});
}

/* ---------------- page: home (statistics) */
const fmtN = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function streak(days) {
  let n = 0; const d = new Date();
  if (!(days[RA.dayKey(d)] || {}).w) d.setDate(d.getDate() - 1);
  for (;;) { const k = RA.dayKey(d); if ((days[k] || {}).w > 0) { n++; d.setDate(d.getDate() - 1); } else break; }
  return n;
}
function dur(min) { if (min < 1) return 'меньше минуты'; if (min < 60) return Math.round(min) + ' мин'; const hh = Math.floor(min / 60), mm = Math.round(min % 60); return hh + ' ч' + (mm ? ' ' + mm + ' мин' : ''); }
// profiles: the page lives in prof.js
const { buildProf, paintProf, profNav } = window.PROFUI({ RA, $, h, page, head, sec, row, dd, toast, push, refresh, SHOW, cap: () => cap, cur: () => cur });

function buildHome() { page('home'); P.append(h('div', '', '')); SHOW.home = refreshHome; }
function refreshHome() {
  const el = $('#p-home'); if (!el || !cap) return;
  const st = RA.stats(), a = RA.auth(), S = S_();
  const today = (st.days[RA.dayKey()] || { w: 0 }).w;
  let week = 0; const d = new Date(); for (let i = 0; i < 7; i++) { week += (st.days[RA.dayKey(d)] || { w: 0 }).w; d.setDate(d.getDate() - 1); }
  const wpm = st.sec > 20 ? st.w / (st.sec / 60) : 0;
  const saved = Math.max(0, st.w / 40 - st.sec / 60);
  const hold = S.mode === 'hold', keys = hkHtml(S.hk);
  let html = `<div class="ph"><h1>Главная</h1></div>
    <div class="hero"><div class="grow"><h2>${hold ? 'Зажми' : 'Нажми'} ${keys} и говори</h2><p>${hold ? 'Отпусти — и текст появится там, где стоит курсор.' : 'Нажми ещё раз — и текст появится там, где стоит курсор.'} Можно и мышкой: нажми на капсулу внизу экрана.</p></div></div>`;
  if (!a.vk) html += `<div class="note warn" style="margin:8px 0 0"><div><b>Нужен ключ Groq</b> — без него текст не распознаётся. Бесплатно, 2 минуты.</div><button class="btn pri" data-go="key">Ввести ключ</button></div>`;
  else if (!a.ok) html += `<div class="note warn" style="margin:8px 0 0"><div><b>Ключ не проверен.</b> Открой «Ключ Groq» и нажми «Проверить».</div><button class="btn" data-go="key">Открыть</button></div>`;
  if (upd) html += `<div class="note" style="margin:8px 0 0"><div><b>Вышла версия ${esc(upd.version)}.</b> ${esc(upd.notes || '')}</div><button class="btn pri" data-upd>${upd.can && RA.tauri ? 'Обновить' : 'Скачать'}</button></div>`;
  html += `<div class="cards">
    <div class="sc"><small>Сегодня</small><b>${fmtN(today)}</b><span>${pl(today, 'слово', 'слова', 'слов')}</span></div>
    <div class="sc"><small>За неделю</small><b>${fmtN(week)}</b><span>${pl(week, 'слово', 'слова', 'слов')}</span></div>
    <div class="sc"><small>Всего</small><b>${fmtN(st.w)}</b><span>${st.n} ${pl(st.n, 'диктовка', 'диктовки', 'диктовок')}</span></div>
    <div class="sc"><small>Скорость</small><b>${wpm ? Math.round(wpm) : '—'}</b><span>слов в минуту</span></div>
    <div class="sc"><small>Серия</small><b>${streak(st.days)}</b><span>${pl(streak(st.days), 'день', 'дня', 'дней')} подряд</span></div></div>`;
  // the last 14 days
  const days = []; const dd = new Date(); dd.setDate(dd.getDate() - 13);
  for (let i = 0; i < 14; i++) { const k = RA.dayKey(dd); days.push({ k, w: (st.days[k] || { w: 0 }).w, d: dd.getDate(), dow: DOW[dd.getDay()], today: i === 13 }); dd.setDate(dd.getDate() + 1); }
  const mx = Math.max(10, ...days.map(x => x.w));
  html += `<div class="chart"><h3>Слова по дням <span>${saved >= 1 ? 'сэкономил ≈ ' + dur(saved) + ' на печати' : 'последние 2 недели'}</span></h3><div class="bars">` +
    days.map(x => `<div class="bar${x.today ? ' today' : ''}"><span class="tip">${x.dow}, ${x.d}: ${words_(x.w)}</span><i style="height:${Math.max(2, x.w / mx * 100)}%"></i><small>${x.d}</small></div>`).join('') + '</div></div>';
  const apps = Object.entries(st.apps).sort((p, q) => q[1].w - p[1].w).slice(0, 6), amx = Math.max(1, ...apps.map(x => x[1].w));
  html += `<div class="chart"><h3>Где диктуешь <span>по программам</span></h3>` + (apps.length ? `<div class="apps">` +
    apps.map(([n, v]) => `<div class="ap"><span title="${esc(n)}">${esc(n)}</span><div><i style="width:${Math.max(2, v.w / amx * 100)}%"></i></div><b>${fmtN(v.w)} ${pl(v.w, 'слово', 'слова', 'слов')}</b></div>`).join('') + '</div>'
    : `<div class="empty">Здесь появятся программы, в которые ты диктуешь</div>`) + '</div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  el.querySelectorAll('[data-upd]').forEach(b => b.onclick = () => { if (!upd) return; if (upd.can && RA.tauri) { go('about'); startUpdate(); } else openUrl(upd.url); });
}

/* ---------------- start */
function init() {
  buildPreviewBar(); buildHome(); buildCaps(); buildText(); buildCtl(); buildProf(); buildKey(); buildAbout(); profNav();
  if (window.TIPS) window.TIPS.init();
  refresh(); keyState();
  listen('page', e => go(String(e.payload || 'home')));
  listen('rec', e => hkEvent(e.payload));
  listen('stats', () => { if (cur === 'home') refreshHome(); });
  listen('upd', e => updEv(e.payload || {}));
  addEventListener('storage', e => {
    if (e.key === RA.KEY) { cap.reload(); refresh(); if (cur === 'home') refreshHome(); }
    if (e.key === RA.STATS && cur === 'home') refreshHome();
    if (e.key === RA.AUTH) keyState();
    if (e.key === RA.PROF) paintProf();
  });
  addEventListener('blur', () => { if (hkRec) hkStop(); });
  invoke('app_info').then(a => {
    info = a; $('#nfoot').innerHTML = `Версия <b>${esc(a.version)}</b>`;
    if (a.updated) setTimeout(() => toast('Обновлено до ' + a.updated, 4200), 500);
  }).catch(() => { $('#nfoot').innerHTML = 'Предпросмотр'; });
  go((location.hash || '').slice(1) || (RA.auth().vk ? 'home' : 'key'));
  setTimeout(() => checkUpdate(false), 1500);
  setInterval(() => checkUpdate(false), 6 * 3600 * 1000);
}
})();
