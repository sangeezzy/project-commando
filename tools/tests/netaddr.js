// Разбор адреса хоста для прямого подключения: локальная сеть / Radmin VPN (ws, порт 8000), ссылка туннеля (wss, без порта).
window.__result = (() => {
  const { check } = T_;
  const cases = [
    ['192.168.1.5', 'ws://192.168.1.5:8000/ws'],
    ['26.53.111.132:9000', 'ws://26.53.111.132:9000/ws'],
    ['http://26.53.111.132:8000/', 'ws://26.53.111.132:8000/ws'],
    ['https://abc-def.trycloudflare.com', 'wss://abc-def.trycloudflare.com/ws'],
    ['https://abc-def.trycloudflare.com/index.html?x=1', 'wss://abc-def.trycloudflare.com/ws'],
    ['  my-host.example.org  ', 'ws://my-host.example.org:8000/ws'],
    ['https://game.example.org:8443', 'wss://game.example.org:8443/ws'],
  ];
  for (const [inp, want] of cases) {
    const got = wsTarget(inp);
    check(`«${inp.trim()}» → ${want}`, got && got.url === want, got && got.url);
  }
  check('пустой адрес — подсказка, а не попытка', wsTarget('   ') === null);
  return T_.checks;
})();
