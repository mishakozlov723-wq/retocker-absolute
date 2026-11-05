'use strict';
// The real capsule over the screen: hotkey events from the app, the microphone, Groq, pasting, statistics.
(() => {
  const RA = window.RA, { invoke, listen, log } = RA;
  window.onerror = (m, src, l) => log(`error: ${m} @${String(src || '').split('/').pop()}:${l}`);
  window.addEventListener('unhandledrejection', e => log('unhandled: ' + ((e.reason && e.reason.message) || e.reason)));
  // no browser behaviours on the overlay
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', e => { if ((e.ctrlKey && /^[rpfgjsu+=-]$/i.test(e.key)) || /^F(5|7|12)$/.test(e.key)) e.preventDefault(); }, true);
  addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  let app = null, cap = null, sent = '', lastState = 'idle';
  function syncHotkey(S) {
    const k = S.hk + '|' + S.mode; if (k === sent) return; sent = k;
    invoke('set_hotkey', { combo: S.hk, mode: S.mode }).then(ok => { if (!ok) log('bad hotkey ' + S.hk); }).catch(() => {});
  }
  const appName = a => (a && (a.name || a.exe || '').trim()) || '';

  // «Мгновенный живой текст»: the local model (downloaded in the settings) hears the raw sound and answers at once
  let locOk = false, locId = 0, locCb = null;
  const locCheck = () => invoke('asr_status').then(st => {
    locOk = !!st.installed;
    if (locOk && RA.load().fast) invoke('asr_warm').catch(() => {});
  }).catch(() => {});
  const local = {
    on: () => locOk && RA.load().fast,
    start: cb => { const id = ++locId; locCb = cb; invoke('asr_start', { id }).then(ok => { if (!ok) { locOk = false; log('asr: not installed'); } }).catch(() => {}); return id; },
    feed: (id, pcm) => { if (id === locId) RA.asrFeed(id, pcm); },
    finish: id => invoke('asr_finish', { id })
  };

  window.RA_ENV = {
    mode: 'overlay',
    stage: document.getElementById('stage'),
    task: 0,
    onHit: rects => invoke('set_hit', { rects }).catch(() => {}),
    arm: (esc, enter) => invoke('set_keys', { esc, enter }).catch(() => {}),
    focus: on => invoke('focus_overlay', { on }).catch(() => {}),
    copy: text => invoke('copy_text', { text }),
    openSettings: page => invoke('show_settings', { page }).catch(() => {}),
    onStart: () => { app = null; invoke('fg_app').then(a => { app = a; }).catch(() => {}); },
    onInsert: async (text, m) => {
      const S = RA.load();
      await invoke('paste', { text, method: S.paste, keep: !!S.keepClip });
      RA.addStat(m.words, Math.round(m.sec || 0), appName(app));
      RA.emitTo('main', 'stats');
    },
    check: () => (RA.auth().vk ? '' : 'Нет ключа Groq'),
    onChange: S => syncHotkey(S),
    onState: s => { if (s !== lastState) { lastState = s; log('state ' + s); } },
    local,
    recognize: (blob, o) => window.VOICE.recognize(blob, o),
    polish: text => window.VOICE.polish(text),
    ready: api => {
      cap = api;
      syncHotkey(api.S);
      listen('hk', e => cap.hk(e.payload.t, !!e.payload.other));
      listen('key', e => cap.key(e.payload.k));
      listen('hit', e => cap.hitInside(!!e.payload.inside));
      listen('fs', e => cap.setHidden(!!e.payload.on));
      listen('cfg', () => { cap.reload(); syncHotkey(cap.S); locCheck(); });
      listen('asr', e => { const p = e.payload || {}; if (p.id === locId && locCb) locCb(p.text || ''); });
      listen('asr_dl', e => { if (e.payload && e.payload.state === 'done') locCheck(); });
      locCheck();
      // a profile tied to a program turns on by itself when that program comes to the front (only while idle)
      let profApp = '';
      setInterval(() => {
        if (lastState !== 'idle' || !RA.profFor({ name: '?' })) return;
        invoke('fg_app').then(a => {
          const k = a && RA.appKey(a.exe || a.name); if (!k || /^retocker/.test(k) || k === profApp) return;
          profApp = k; const id = RA.profFor(a), p = RA.profs();
          if (!id || !p || id === p.cur || lastState !== 'idle') return;
          RA.useProf(id); cap.reload(); syncHotkey(cap.S); locCheck();
          log('profile ' + id + ' for ' + k);
        }).catch(() => {});
      }, 700);
      addEventListener('storage', e => { if (e.key === RA.KEY) syncHotkey(RA.load()); });
      log(`capsule up ${innerWidth}x${innerHeight} dpr ${devicePixelRatio} hk ${api.S.hk} ${api.S.mode}`);
    }
  };
})();
