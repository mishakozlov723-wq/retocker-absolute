'use strict';
// The «Профили» page of the settings window: whole sets of settings; one can turn on by itself in chosen programs.
// Built with the helpers of settings.js (passed in C).
window.PROFUI = C => {
const { RA, $, h, page, head, sec, row, dd, toast, push, refresh, SHOW } = C, cap = C.cap, cur = C.cur;
const X = '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>';
function profNav() { const p = RA.profs(), c = p && p.list.find(x => x.id === p.cur); $('#profName').textContent = c ? c.name : ''; }
function profEdit(f) { const p = RA.profs(); if (!p) return; f(p); RA.setProfs(p); paintProf(); }
function profUse(id) { if (!RA.useProf(id, true)) return; cap().reload(); push(); refresh(); paintProf(); }
function buildProf() { SHOW.prof = paintProf; }
function paintProf() {
  profNav(); if (cur() !== 'prof') return;
  const P = page('prof'); const keep = P.querySelector('input:focus'); if (keep && keep.dataset.k) return; // typing a name: don't redraw under the cursor
  P.innerHTML = ''; head('Профили', 'свои настройки для разных программ');
  let p = RA.profs();
  if (!p) P.append(h('div', 'note', '<div><b>Профиль — это все настройки разом:</b> вид капсулы, текст, клавиша. Сохрани текущие под именем, сделай другой — и переключайся одним нажатием. А если привязать профиль к программе, в ней он включится сам.</div>'));
  sec('Новый профиль');
  const r = row('', 'Сохранить текущие настройки как профиль', 'Он сразу включится — дальше меняй настройки, они запишутся в него');
  const f = h('div', 'fld'), nm = h('input', 'in'); nm.placeholder = 'Например: Телеграм'; nm.style.width = '170px'; nm.maxLength = 40; nm.spellcheck = false;
  const add = h('button', 'btn pri', 'Сохранить'); f.append(nm, add); r.append(f); P.append(r);
  const create = () => {
    const name = nm.value.trim() || 'Профиль ' + ((p ? p.list.length : 1) + 1);
    const S = { ...cap().S }, mk = n => ({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, apps: [], v: { ...S } });
    const q = RA.profs() || { list: [mk('Основной')] }; if (!q.base) q.base = q.list[0].id;
    const x = mk(name); q.list.push(x); q.cur = x.id; RA.setProfs(q);
    toast('Профиль «' + name + '» сохранён и включён'); paintProf();
  };
  add.onclick = create; nm.onkeydown = e => { if (e.key === 'Enter') create(); };
  if (!p) return;
  sec('Мои профили');
  const used = Object.keys(RA.stats().apps).filter(n => n !== 'Другое').sort((a, b) => a.localeCompare(b, 'ru'));
  const box = h('div', 'pfs'); P.append(box);
  const tied = p.list.some(x => x.apps.length);
  p.list.forEach(x => {
    const on = x.id === p.cur, c = h('div', 'pf' + (on ? ' on' : '')), t = h('div', 'pft');
    const n = h('input', 'pn'); n.value = x.name; n.maxLength = 40; n.spellcheck = false; n.dataset.k = x.id; n.title = 'Нажми, чтобы переименовать';
    n.onchange = () => { const v = n.value.trim(); if (!v) { n.value = x.name; return; } delete n.dataset.k; profEdit(q => { q.list.find(y => y.id === x.id).name = v; }); };
    n.onkeydown = e => { if (e.key === 'Enter') n.blur(); if (e.key === 'Escape') { n.value = x.name; n.blur(); } };
    n.onblur = () => { delete n.dataset.k; };
    t.append(n);
    if (tied && x.id === p.base) t.append(h('span', 'tag', 'в остальных программах'));
    t.append(on ? h('div', 'status ok', '<i></i><span>Включён</span>') : Object.assign(h('button', 'btn', 'Включить'), { onclick: () => profUse(x.id) }));
    if (p.list.length > 1) {
      const del = h('button', 'btn ix', X); del.title = 'Удалить профиль';
      del.onclick = () => {
        if (!del._sure) { del._sure = 1; del.classList.add('red'); del.innerHTML = 'Удалить?'; del.style.width = 'auto'; del.style.padding = '0 10px'; setTimeout(() => { if (del.isConnected) paintProf(); }, 3000); return; }
        const q = RA.profs(); q.list = q.list.filter(y => y.id !== x.id); RA.setProfs(q);
        if (on) profUse(RA.profs().base); else paintProf();
      };
      t.append(del);
    }
    c.append(t);
    const a = h('div', 'pfa'); a.append(h('span', '', 'Включается сам в:'));
    x.apps.forEach(name => {
      const ch = h('span', 'ac'); ch.append(name); const rm = h('button', '', X); rm.title = 'Убрать';
      rm.onclick = () => profEdit(q => { const y = q.list.find(z => z.id === x.id); y.apps = y.apps.filter(z => z !== name); });
      ch.append(rm); a.append(ch);
    });
    const tie = name => { name = String(name || '').trim(); if (!name) return; profEdit(q => q.list.forEach(y => { y.apps = y.apps.filter(z => RA.appKey(z) !== RA.appKey(name)); if (y.id === x.id) y.apps.push(name); })); };
    const free = used.filter(u => !x.apps.some(z => RA.appKey(z) === RA.appKey(u)));
    if (free.length) {
      const s = dd({ onchange: v => { if (v) tie(v); } });
      s.setItems([{ v: '', t: '+ Программа' }, ...free.map(u => ({ v: u, t: u }))], ''); a.append(s.el);
    }
    const own = h('input', 'in'); own.placeholder = free.length ? 'или впиши название' : 'Впиши программу, напр. Telegram'; own.spellcheck = false; own.maxLength = 60;
    own.onkeydown = e => { if (e.key === 'Enter') tie(own.value); };
    own.onchange = () => tie(own.value);
    a.append(own);
    if (!x.apps.length) a.append(h('span', 'tag', tied ? '' : '— пока нигде, только вручную'));
    c.append(a); box.append(c);
  });
  P.append(h('div', 'note', '<div>Всё, что меняешь в настройках, сохраняется во <b>включённый</b> профиль. Словарь, слова-паразиты и микрофон — общие для всех. Программы берутся из тех, куда ты уже диктовал; можно вписать и свою — как она называется в «Главная → Где диктуешь».</div>'));
}
return { buildProf, paintProf, profNav };
};
