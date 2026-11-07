'use strict';
window.LIMITSUI = ({ $, page, SHOW, fmtN }) => {
/* ---------------- page: approximate Groq usage, tracked on this computer */
function buildLimits() { page('limits'); SHOW.limits = refreshLimits; }
function refreshLimits() {
  const el = $('#p-limits'), usage = window.USAGE ? window.USAGE.today() : {};
  if (!el) return;
  const amt = sec => { const m = Math.max(0, Math.floor(sec / 60)); return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'; };
  const meter = (title, model, type, sub) => {
    const v = usage[model] || {}, used = type === 'audio' ? Number(v.seconds) || 0 : Number(v.requests) || 0;
    const max = type === 'audio' ? 28800 : 1000, left = Math.max(0, max - used), pc = Math.min(100, Math.max(0, left / max * 100));
    const value = type === 'audio' ? '≈ ' + amt(left) : '≈ ' + fmtN(left);
    const info = type === 'audio' ? 'Отправлено ≈ ' + amt(used) + ' из 8 ч · запросов: ' + fmtN(v.requests || 0) + ' из 2 000' : 'Запросов: ' + fmtN(used) + ' из 1 000';
    return `<div class="limit-card"><div class="limit-top"><div><h3>${title}</h3><p>${sub}</p></div><span>СЕГОДНЯ</span></div><div class="limit-value">${value}<small> осталось</small></div><div class="limit-bar" role="progressbar" aria-label="Остаток: ${title}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pc)}"><i style="width:${pc}%"></i></div><div class="limit-caption">${info}</div></div>`;
  };
  el.innerHTML = `<div class="ph"><h1>Лимиты</h1><span>ориентировочно</span></div><p class="lead">Остаток за сегодня · учёт с обновления на этом компьютере.</p>
    <div class="sec">Распознавание</div>${meter('Диктовка', 'whisper-large-v3', 'audio', 'Whisper · итоговый текст')}${meter('Живой текст', 'whisper-large-v3-turbo', 'audio', 'Whisper Turbo · промежуточное распознавание')}
    <div class="sec">Умная причёска</div>${meter('Удаление запинок', 'openai/gpt-oss-120b', 'chat', 'GPT-OSS 120B')}${(usage['openai/gpt-oss-20b'] || {}).requests ? meter('Запасная модель', 'openai/gpt-oss-20b', 'chat', 'GPT-OSS 20B') : ''}
    <div class="limit-note">Учёт начинается после обновления. Лимиты Groq и расход в других приложениях могут отличаться.</div>`;
}

return { buildLimits, refreshLimits };
};
