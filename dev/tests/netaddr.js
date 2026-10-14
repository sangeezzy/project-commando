// Разбор адреса хоста для прямого подключения: локальная сеть / Radmin VPN (ws, порт 8000 по умолчанию; схема и путь отбрасываются).
window.__result = (() => {
  const { check } = T_;
  const cases = [
    ['192.168.1.5', 'ws://192.168.1.5:8000/ws'],
    ['26.53.111.132:9000', 'ws://26.53.111.132:9000/ws'],
    ['http://26.53.111.132:8000/', 'ws://26.53.111.132:8000/ws'],
    ['http://26.53.111.132:8000/index.html?x=1', 'ws://26.53.111.132:8000/ws'],
    ['  my-host.example.org  ', 'ws://my-host.example.org:8000/ws'],
  ];
  for (const [inp, want] of cases) {
    const got = wsTarget(inp);
    check(`«${inp.trim()}» → ${want}`, got && got.url === want, got && got.url);
  }
  check('пустой адрес — подсказка, а не попытка', wsTarget('   ') === null);
  return T_.checks;
})();
