'use strict';
// «?» next to a setting: a small looping scene (mini capsule + fake cursor) and one line of text.
(() => {
  const RA = window.RA, esc = RA.esc;
  const hkKeys = () => RA.hkParts(RA.load().hk);
  const CUR = '<svg viewBox="0 0 16 16"><path d="M2.5 1.5v11.4l3-2.8 2 4.5 2.1-.9-2-4.4h4.2z"/></svg>';
  const BARS = '<i class="d"></i><i class="b"></i><i class="b"></i><i class="b"></i><i class="b"></i><i class="b"></i>';

  function scene(root) {
    root.innerHTML = `<div class="doc"><span class="ln" style="width:72%"></span><span class="tx"></span><span class="car"></span></div>
      <div class="mp"></div><div class="mc idle"></div><div class="key"></div><div class="lbl2"></div><div class="fs"></div><div class="cur">${CUR}</div>`;
    const q = s => root.querySelector(s);
    const mc = q('.mc'), mp = q('.mp'), key = q('.key'), cur = q('.cur'), tx = q('.doc .tx'), lb = q('.lbl2'), fs = q('.fs');
    const W = 252, H = 132;
    const sc = {
      W, H,
      cap(st, html) {
        mc.className = 'mc ' + st; mc.style.opacity = '';
        mc.innerHTML = html != null ? html : st === 'rec' ? BARS : st === 'proc' ? '<span style="letter-spacing:2px">•••</span>' : st === 'done' ? '✓ готово' : '';
        mc.style.width = st === 'done' ? '62px' : st === 'proc' ? '46px' : st === 'hint' ? '96px' : '';
      },
      capHide(on) { mc.style.opacity = on ? '0' : ''; },
      capAt(x, y) { if (x == null) { mc.style.left = ''; mc.style.top = ''; mc.style.bottom = ''; return; } mc.style.left = x + 'px'; mc.style.top = y + 'px'; mc.style.bottom = 'auto'; },
      panel(on, html, o = {}) {
        if (html != null) mp.innerHTML = html;
        if (o.dot) { // starts as the dot of the capsule
          mp.style.transition = 'none'; mp.style.width = '6px'; mp.style.height = '6px'; mp.style.left = (W / 2 - 26) + 'px'; mp.style.bottom = '19px'; mp.style.borderRadius = '50%'; mp.style.background = '#fff'; mp.style.padding = '0'; mp.style.opacity = '1'; mp.style.transform = 'none';
          mp.offsetWidth; mp.style.transition = '';
          mp.style.width = '150px'; mp.style.height = '44px'; mp.style.left = (W / 2 - 75) + 'px'; mp.style.bottom = '40px'; mp.style.borderRadius = '9px'; mp.style.background = ''; mp.style.padding = '';
          return;
        }
        if (o.toDot) { mp.style.width = '6px'; mp.style.height = '6px'; mp.style.left = (W / 2 - 26) + 'px'; mp.style.bottom = '19px'; mp.style.borderRadius = '50%'; mp.style.background = '#fff'; mp.style.padding = '0'; mp.innerHTML = ''; setTimeout(() => { mp.style.opacity = '0'; }, 380); return; }
        ['width', 'height', 'left', 'bottom', 'borderRadius', 'background', 'padding', 'opacity', 'transform'].forEach(k => { mp.style[k] = ''; });
        mp.classList.toggle('on', on);
      },
      words(list, o = {}) { // words appear one by one in the panel (or in the document)
        const box = o.doc ? tx : mp;
        box.innerHTML = '';
        list.forEach((w, i) => setTimeout(() => { const s = document.createElement('span'); s.className = 'w'; s.textContent = w + ' '; s.style.opacity = 0; box.append(s); requestAnimationFrame(() => { s.style.opacity = 1; }); }, i * (o.step || 170)));
      },
      strike(idx, box = mp) { const ws = box.querySelectorAll('.w'); idx.forEach(i => ws[i] && ws[i].classList.add('st')); },
      vanish(idx, box = mp) { const ws = box.querySelectorAll('.w'); idx.forEach(i => ws[i] && ws[i].classList.add('gone')); },
      swap(i, t, box = mp) { const w = box.querySelectorAll('.w')[i]; if (w) { w.style.opacity = 0; setTimeout(() => { w.textContent = t + ' '; w.style.opacity = 1; }, 200); } },
      docText(t, o = {}) {
        if (o.type) { tx.textContent = ''; [...t].forEach((c, i) => setTimeout(() => { tx.textContent += c; }, i * 45)); return; }
        tx.innerHTML = `<span class="w" style="opacity:0">${esc(t)}</span>`; requestAnimationFrame(() => { const s = tx.firstChild; if (s) s.style.opacity = 1; });
      },
      docClear() { tx.innerHTML = ''; },
      keys(list, down) {
        if (!list) { key.classList.remove('on'); return; }
        key.innerHTML = list.map(k => `<kbd class="${down ? 'dn' : ''}">${esc(k)}</kbd>`).join('');
        key.classList.add('on');
      },
      press(on) { key.querySelectorAll('kbd').forEach(k => k.classList.toggle('dn', on)); },
      cur(x, y, instant) { if (instant) { cur.style.transition = 'none'; cur.offsetWidth; } cur.style.transform = `translate(${x}px,${y}px)`; if (instant) { cur.offsetWidth; cur.style.transition = ''; } },
      click() { cur.classList.add('click'); setTimeout(() => cur.classList.remove('click'), 160); },
      label(t) { lb.textContent = t || ''; },
      fs(on, t) { fs.classList.toggle('on', on); fs.textContent = t || ''; },
      reset() { sc.cap('idle'); sc.capAt(); sc.capHide(false); sc.panel(false, ''); sc.keys(null); sc.label(''); sc.fs(false); sc.docClear(); sc.cur(W + 20, H + 20, true); }
    };
    sc.reset();
    return sc;
  }

  // the scenes: [pause before, action]
  const dotX = 252 / 2 - 24, capY = 132 - 22;
  const TIPS = {
    hotkey: { t: () => `Зажми <b>${hkKeys().map(esc).join(' + ')}</b> — капсула слушает. Отпусти — текст вставится там, где курсор.`, s: [
      [500, s => s.keys(hkKeys())], [400, s => { s.press(true); s.cap('rec'); }], [1700, s => { s.press(false); s.cap('proc'); }],
      [800, s => { s.cap('done'); s.docText('Завтра пробую лонг от поддержки.'); s.keys(null); }], [1300, s => s.cap('idle')], [1500, () => {}]] },
    mode: { t: () => '<b>Удерживать</b> — говоришь, пока держишь клавишу. <b>Нажать</b> — нажал, сказал, нажал ещё раз.', s: [
      [300, s => { s.label('Удерживать'); s.keys(hkKeys()); }], [400, s => { s.press(true); s.cap('rec'); }], [1500, s => { s.press(false); s.cap('done'); }], [900, s => s.cap('idle')],
      [600, s => s.label('Нажать')], [300, s => s.press(true)], [150, s => { s.press(false); s.cap('rec'); }], [1500, s => s.press(true)], [150, s => { s.press(false); s.cap('done'); }], [1000, s => { s.cap('idle'); s.keys(null); }], [900, () => {}]] },
    live: { t: () => 'Пока говоришь, над капсулой виден текст. <b>По клику</b> — нажми на точку в капсуле.', s: [
      [300, s => s.cap('rec')], [300, s => s.cur(dotX + 4, capY - 2)], [700, s => s.click()], [150, s => { s.panel(true, ''); s.words(['Смотри,', 'сегодня', 'биткоин', 'пробил', 'сопротивление…']); }],
      [2200, s => s.cap('done')], [200, s => s.panel(false)], [1000, s => s.cap('idle')], [900, s => s.cur(270, 150)], [600, () => {}]] },
    pdot: { t: () => 'Точка в капсуле <b>сама вырастает в панель</b> с текстом — и так же сжимается обратно.', s: [
      [300, s => s.cap('rec')], [300, s => s.cur(dotX + 4, capY - 2)], [700, s => s.click()], [120, s => s.panel(true, '', { dot: true })], [420, s => s.words(['Смотри,', 'сегодня', 'биткоин', 'пробил…'], { step: 150 })],
      [1900, s => s.click()], [100, s => s.panel(false, null, { toDot: true })], [1300, s => s.cur(270, 150)], [500, s => s.cap('idle')], [700, () => {}]] },
    clean: { t: () => 'Убирает «эээ», «ну» и лишние повторы, ставит заглавные буквы.', s: [
      [300, s => { s.panel(true, ''); s.cap('proc'); s.words(['ну', 'эээ', 'смотри,', 'завтра', 'лонг'], { step: 110 }); }], [1100, s => s.strike([0, 1])], [700, s => { s.vanish([0, 1]); s.swap(2, 'Смотри,'); }],
      [1300, s => { s.panel(false); s.cap('done'); s.docText('Смотри, завтра лонг'); }], [1300, s => s.cap('idle')], [900, () => {}]] },
    smart: { t: () => 'Groq поправит <b>по смыслу</b>: запятые, оговорки, числа — «сто двадцать тысяч» станет «120 000».', s: [
      [300, s => { s.panel(true, ''); s.cap('proc'); s.words(['биткоин', 'сто', 'двадцать', 'тысяч'], { step: 110 }); }], [1200, s => s.strike([1, 2, 3])], [700, s => { s.vanish([2, 3]); s.swap(1, '— 120 000.'); s.swap(0, 'Биткоин'); }],
      [1400, s => { s.panel(false); s.cap('done'); s.docText('Биткоин — 120 000.'); }], [1300, s => s.cap('idle')], [900, () => {}]] },
    review: { t: () => 'Сначала окно с текстом: <b>поправь</b>, если надо, и нажми <b>Enter</b> — вставится.', s: [
      [300, s => { s.cap('proc'); }], [600, s => { s.cap('hint', '<kbd style="font-size:8.5px;padding:0 4px">Enter</kbd>&nbsp;вставить'); s.panel(true, ''); s.words(['Завтра', 'пробую', 'лонг.'], { step: 60 }); }],
      [900, s => s.cur(120, 66)], [700, s => s.click()], [600, s => s.keys(['Enter'])], [300, s => s.press(true)], [150, s => { s.press(false); s.panel(false); s.cap('done'); s.docText('Завтра пробую лонг.'); }],
      [1200, s => { s.cap('idle'); s.keys(null); s.cur(270, 150); }], [900, () => {}]] },
    paste: { t: () => '<b>Через буфер</b> — мгновенно, как Ctrl+V. <b>Печатать</b> — по буквам, для упрямых программ.', s: [
      [300, s => { s.label('Через буфер'); s.cap('done'); s.docText('Стоп под минимумом.'); }], [1400, s => { s.docClear(); s.cap('idle'); }],
      [500, s => { s.label('Печатать'); s.cap('done'); s.docText('Стоп под минимумом.', { type: true }); }], [1800, s => s.cap('idle')], [900, () => {}]] },
    keepClip: { t: () => 'Вставка идёт через буфер обмена. После неё там снова то, что ты копировал раньше.', s: [
      [300, s => s.label('Буфер: ссылка')], [700, s => { s.cap('done'); s.label('Буфер: твой текст'); s.docText('Завтра пробую лонг.'); }], [900, s => s.label('Буфер: ссылка ✓')], [1300, s => s.cap('idle')], [1200, () => {}]] },
    pos: { t: () => 'Снизу, сверху или <b>где оставил</b> — просто перетащи капсулу мышкой.', s: [
      [300, s => s.cur(126, capY + 2)], [700, s => { s.click(); s.cap('hint', 'тащи'); }], [300, s => { s.capAt(170, 40); s.cur(200, 50); }], [900, s => s.cap('idle')], [1300, s => { s.capAt(); s.cur(270, 150); }], [900, () => {}]] },
    hideFs: { t: () => 'В играх и фильмах на весь экран капсулы не видно. Клавиша при этом работает.', s: [
      [500, s => s.fs(true, 'фильм на весь экран')], [300, s => s.capHide(true)], [1100, s => { s.keys(hkKeys()); s.press(true); s.capHide(false); s.cap('rec'); }], [1400, s => { s.press(false); s.cap('done'); s.keys(null); }],
      [800, s => s.capHide(true)], [1200, s => { s.fs(false); s.capHide(false); s.cap('idle'); }], [900, () => {}]] },
    dict: { t: () => 'Впиши слова, которые Groq путает: имена, тикеры, термины — и они будут писаться правильно.', s: [
      [300, s => { s.label('без словаря'); s.docText('Открыл шорт на Байбит'); }], [1400, s => { s.label('со словарём'); s.docText('Открыл шорт на Bybit'); }], [1700, s => s.docClear()], [500, () => {}]] },
    idle: { t: () => '<b>Скрыта</b> — капсулы не видно, пока не наведёшь на её место мышку.', s: [
      [300, s => s.capHide(true)], [900, s => s.cur(126, capY - 4)], [600, s => { s.capHide(false); s.cap('hint', hkKeys().join('+')); }], [1500, s => { s.cur(270, 150); }], [500, s => { s.cap('idle'); s.capHide(true); }], [1200, s => s.capHide(false)], [500, () => {}]] },
    proxy: { t: () => 'Если Groq не открывается из твоей сети, запросы пойдут через <b>твой Google-скрипт</b>. Ключ хранится только у тебя.', s: [
      [300, s => { s.label('капсула → Google → Groq'); s.cap('rec'); }], [1400, s => s.cap('proc')], [1000, s => { s.cap('done'); s.docText('Текст пришёл через Google'); }], [1400, s => s.cap('idle')], [800, () => {}]] }
  };

  let pop = null, sc = null, tok = 0, hideT = 0, showT = 0, curQ = null, stepT = 0;
  function run(steps, my) {
    let i = 0;
    const next = () => {
      if (my !== tok) return;
      if (i >= steps.length) { i = 0; sc.reset(); }
      const [d, f] = steps[i++];
      stepT = setTimeout(() => { if (my !== tok) return; try { f(sc); } catch (e) {} next(); }, d);
    };
    next();
  }
  function show(q) {
    const k = q.dataset.tip, T = TIPS[k]; if (!T) return;
    clearTimeout(hideT);
    if (curQ === q && pop.classList.contains('on')) return;
    if (curQ) curQ.classList.remove('on');
    curQ = q; q.classList.add('on');
    const my = ++tok; clearTimeout(stepT);
    pop.querySelector('p').innerHTML = T.t();
    sc = scene(pop.querySelector('.scn'));
    const r = q.getBoundingClientRect(), pw = 268, ph = pop.offsetHeight || 200;
    let x = r.left - 20, y = r.bottom + 8;
    if (x + pw > innerWidth - 10) x = innerWidth - 10 - pw;
    if (y + ph > innerHeight - 10) y = r.top - 8 - ph;
    pop.style.left = Math.max(10, x) + 'px'; pop.style.top = Math.max(40, y) + 'px';
    pop.classList.add('on');
    run(T.s, my);
  }
  function hide() { hideT = setTimeout(() => { tok++; clearTimeout(stepT); pop.classList.remove('on'); if (curQ) curQ.classList.remove('on'); curQ = null; }, 160); }
  function init() {
    pop = document.createElement('div'); pop.className = 'tip-pop'; pop.innerHTML = '<div class="scn"></div><p></p>';
    document.body.append(pop);
    document.addEventListener('mouseover', e => {
      const q = e.target.closest && e.target.closest('.q');
      if (q) { clearTimeout(hideT); clearTimeout(showT); showT = setTimeout(() => show(q), curQ ? 0 : 140); return; }
      if (curQ && !e.target.closest('.tip-pop')) { clearTimeout(showT); hide(); }
    });
    document.addEventListener('scroll', () => { if (curQ) { tok++; pop.classList.remove('on'); curQ.classList.remove('on'); curQ = null; } }, true);
  }
  function q(key) {
    const s = document.createElement('span'); s.className = 'q'; s.textContent = '?'; s.dataset.tip = key;
    s.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); show(s); });
    return s;
  }
  window.TIPS = { init, q, list: Object.keys(TIPS) };
})();
