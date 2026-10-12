// Лобби: персонажи не повторяются, хост ждёт готовности, свободных персонажей берут боты;
// игрок может войти в идущую игру на место бота, а при выходе его место снова занимает бот.
window.__result = (() => {
  const { check, run } = T_;
  run('лобби', () => {
    G.role = 'host';
    G.state = 'lobby';
    Lobby.slots = emptySlots();
    Object.assign(Lobby.slots[0], { human: true, name: 'Хост' });
    Object.assign(Lobby.slots[1], { human: true, name: 'Гость' });
    pickChar(0, 1);
    pickChar(1, 1);
    check('занятого персонажа выбрать нельзя', Lobby.slots[0].ch === 1 && Lobby.slots[1].ch === -1);
    pickChar(1, 2);
    check('свободного — можно', Lobby.slots[1].ch === 2);
    startGameFromLobby();
    check('гость не готов — игра не начинается', G.state === 'lobby');
    Lobby.slots[1].ready = true;
    startGameFromLobby();
    check('все готовы — игра началась', G.state === 'play' && map.hub);
    const chars = G.players.map((p) => [p.idx, p.ch, p.bot]);
    check('люди со своими персонажами, остальных взяли боты', pById(0).ch === 1 && !pById(0).bot && pById(1).ch === 2 && !pById(1).bot &&
      pById(2).bot && pById(3).bot && new Set(G.players.map((p) => p.ch)).size === 4, chars);

    // вход в идущую игру
    const fake = { open: true, peer: 'fake-peer', send() {}, close() {} };
    onHello(fake, { name: 'Новичок', peer: 'fake-peer' });
    const took = G.players.find((p) => p.name === 'Новичок');
    check('новый игрок занял место бота', took && !took.bot && took.net && fake.idx === took.idx, took && [took.idx, took.ch]);
    onGuestLeft(fake);
    check('вышел — место снова у бота', took.bot && !Net.conns.has(took.idx));
    const fake2 = { open: true, peer: 'p2', send() {}, close() {} }, fake3 = { open: true, peer: 'p3', send() {}, close() {} };
    let full = false;
    const fake4 = { open: true, peer: 'p4', send(m) { if (m.t === 'full') full = true; }, close() {} };
    onHello(fake2, { name: 'Два' }); onHello(fake3, { name: 'Три' });
    pById(1).bot = false; Net.conns.set(1, { open: true, send() {}, close() {} });
    onHello(fake4, { name: 'Четыре' });
    check('мест больше нет — «комната заполнена»', full);
    Net.conns.clear();
    G.role = 'solo';
  });
  return T_.checks;
})();
