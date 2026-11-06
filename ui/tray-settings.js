'use strict';
// Add the Windows startup option after the existing settings pages have been built.
(() => {
  const ready = window.RA_ENV.ready;
  window.RA_ENV.ready = api => {
    ready(api);
    const auto = document.getElementById('auto');
    if (!auto) return;
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = '<div class="lbl"><span class="t">Запускать в трее</span><small>При запуске окно и капсула скрыты. Вызови диктовку клавишей или открой программу из трея</small></div><input class="sw" type="checkbox">';
    auto.closest('.row').after(row);
    const input = row.querySelector('input');
    const toast = text => {
      const el = document.getElementById('toast');
      el.textContent = text; el.classList.add('on');
      clearTimeout(el._trayTimer); el._trayTimer = setTimeout(() => el.classList.remove('on'), 2600);
    };
    window.RA.invoke('app_info').then(info => { input.checked = !!info.startInTray; }).catch(() => {});
    input.onchange = async () => {
      const want = input.checked;
      input.disabled = true;
      let ok = false;
      try { ok = await window.RA.invoke('set_start_in_tray', { on: want }); } catch (e) {}
      input.disabled = false;
      if (!ok) { input.checked = !want; toast('Не получилось изменить запуск в трее'); }
      else toast(want ? 'При следующем запуске откроюсь в трее' : 'Запуск в трее выключен');
    };
  };
})();
