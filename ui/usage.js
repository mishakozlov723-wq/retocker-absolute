'use strict';
// Approximate per-model counters for requests sent by this installation, grouped by local day.
(() => {
  const KEY = 'ra.groq.usage.v1';
  const models = ['whisper-large-v3', 'whisper-large-v3-turbo', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
  const day = (d = new Date()) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  function read() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
  }
  function today() { const x = read(); return x[day()] || {}; }
  function record(model, seconds = 0) {
    if (!models.includes(model)) return;
    try {
      const k = day(), x = read();
      // No audio, text, key, or request content is stored.
      const data = x[k] || (x[k] = {}), item = data[model] || (data[model] = { requests: 0, seconds: 0 });
      item.requests = (Number(item.requests) || 0) + 1;
      item.seconds = (Number(item.seconds) || 0) + Math.max(0, Number(seconds) || 0);
      // Only today's counters are needed; local calendar day, not an authoritative Groq reset time.
      for (const old of Object.keys(x)) if (old !== k) delete x[old];
      localStorage.setItem(KEY, JSON.stringify(x));
      if (window.RA && window.RA.emitTo) window.RA.emitTo('main', 'usage');
    } catch (_) { /* tracking must never interrupt dictation */ }
  }
  window.USAGE = { KEY, today, record };
})();
