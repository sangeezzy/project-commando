// Игра внутри приложения для телефона (?app=1, dev/android): нет «Создать комнату», подсказка для входа к хосту,
// адрес хоста запоминается, «Назад» (appBack): в игре — меню ≡, ещё раз — закрыть, в главном меню — свернуть приложение.
window.__result = (() => {
  const { check, run, step } = T_;
  const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
  check('режим приложения: класс app', document.documentElement.classList.contains('app'));
  check('кнопка «Создать комнату на этом телефоне»', shown('#btnHostLocal') && /ТЕЛЕФОНЕ/.test(document.getElementById('btnHostLocal').textContent));
  check('подсказка для телефона видна, для ПК — нет', shown('.help.apponly') && !shown('.help.noapp'));
  check('иконка и manifest подключены', !!document.querySelector('link[rel=manifest]') && !!document.querySelector('link[rel=apple-touch-icon]'));

  run('«Назад»', () => {
    check('в игре', G.state === 'play');
    check('в игре — меню ≡', appBack() === true && touchMenuOpen());
    check('меню открыто — закрыть', appBack() === true && !touchMenuOpen());
    keys.Tab = true;
    check('открыты характеристики — закрыть', appBack() === true && !keys.Tab);
    const st = G.state, m = map;
    G.state = 'menu';
    check('в главном меню — не обработано (свернуть приложение)', appBack() === false);
    G.state = st;
  });

  run('адрес хоста запоминается', () => {
    const el = document.getElementById('addr');
    el.value = '192.168.0.77:8000';
    const was = window.joinLocal;
    window.joinLocal = () => {};       // не подключаться по-настоящему
    try { joinLocal = () => {}; } catch (e) { /* ignore */ }
    document.getElementById('btnJoinLocal').click();
    let saved = null;
    try { saved = localStorage.getItem('pcr-addr'); } catch (e) { /* ignore */ }
    check('сохранён в localStorage', saved === '192.168.0.77:8000', saved);
    try { joinLocal = was; } catch (e) { /* ignore */ }
    try { localStorage.removeItem('pcr-addr'); } catch (e) { /* ignore */ }
  });
  run('хост на телефоне: сервер в приложении', () => {
    const calls = [];
    let ok = true;
    window.CommandoApp = {
      startServer: () => { calls.push('start'); return JSON.stringify(ok ? { ok: true, port: 8001, addrs: ['192.168.43.1:8001'] } : { ok: false, err: 'порт занят' }); },
      stopServer: () => { calls.push('stop'); },
    };
    const was = window.hostWs;
    let target = null;
    window.hostWs = (tg) => { target = tg; };
    hostLocal();
    check('«Создать комнату» — сервер телефона запущен, хост подключается к нему', calls[0] === 'start' && target && target.url === 'ws://127.0.0.1:8001/ws', [calls, target]);
    ok = false; target = null;
    hostLocal();
    check('сервер не запустился — сообщение, без подключения', !target && /телефоне: порт занят/.test(document.getElementById('status').textContent), document.getElementById('status').textContent);
    window.hostWs = was;
    G.role = 'host';
    leaveToMenu('');
    check('хост вышел в меню — сервер телефона остановлен', calls[calls.length - 1] === 'stop', calls);
    delete window.CommandoApp;
  });
  return T_.checks;
})();
