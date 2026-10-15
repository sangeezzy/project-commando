// Огонь по своим (Lobby.ff, галочка в лобби — решает хост): выключен — пули проходят сквозь бойцов отряда и ранят противника за ними,
// нож и машина своих не ранят; включён — ранят. Противников — в любом случае. Лобби: галочка у хоста, гостю — в сообщении.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me(), bot = G.players.find((q) => q.ai), e = G.enemies[0];
  for (const k in keys) keys[k] = false;
  G.enemies = [e]; G.players = [p, bot];
  // открытая линия: p — бот — противник по оси x
  let row = -1;
  for (let ty = 3; ty < map.h - 3 && row < 0; ty++) {
    let ok = true;
    for (let tx = 10; tx <= 20; tx++) if (tileAt(tx, ty) !== T.FLOOR) { ok = false; break; }
    if (ok) row = ty;
  }
  const prep = () => {
    for (const o of [p, bot, e]) Object.assign(o, { dead: false, down: false, hp: 100, god: false, armor: null, veh: null, lean: 0, leanPx: 0, crouch: false });
    at(p, 10, row); at(bot, 13, row); at(e, 18, row);
    p.a = 0; G.bullets = [];
  };
  const shoot = () => {
    prep();
    fireRound(p, 0);
    for (let i = 0; i < 30; i++) { G.time += 1 / 60; updateBullets(1 / 60); }
  };
  const stab = () => {
    prep(); at(bot, 10.9, row);
    startMelee(p);
    for (let i = 0; i < 40; i++) { G.time += 1 / 60; updateMelee(p, 1 / 60); }
  };
  check('нашлась открытая линия 10 клеток', row > 0, row);

  run('огонь по своим включён (по умолчанию)', () => {
    Lobby.ff = true;
    shoot();
    check('пуля ранит своего бота на линии', bot.hp < 100 || bot.down, bot.hp);
    check('противник за ним цел (пуля осталась в боте)', e.hp === 100, e.hp);
    stab();
    check('нож ранит своего', bot.hp < 100 || bot.down, bot.hp);
  });

  run('огонь по своим выключен', () => {
    Lobby.ff = false;
    shoot();
    check('пуля проходит сквозь своего бота — он цел', bot.hp === 100 && !bot.down, bot.hp);
    check('и попадает в противника за ним', e.hp < 100 || e.dead, e.hp);
    prep();
    const b = { owner: p.id, side: 'p', t: WEAPONS.m4a1, e: 1, dist: 0, sx: p.x, sy: p.y, vx: 1, vy: 0 };
    hitPerson(bot, b);
    check('hitPerson (пуля сквозь машину) по своему — без урона', bot.hp === 100, bot.hp);
    hitPerson(e, b);
    check('по противнику — урон', e.hp < 100 || e.dead, e.hp);
    stab();
    check('нож своего не ранит', bot.hp === 100, bot.hp);
    // противник своих пулей ранит по-прежнему (огонь по своим — только про отряд)
    prep(); at(e, 16, row); e.a = Math.PI; e.gun.mag = 30; e.gun.chamber = 1;
    fireRound(e, 0);
    for (let i = 0; i < 30; i++) { G.time += 1 / 60; updateBullets(1 / 60); }
    check('противник по отряду — урон', bot.hp < 100 || bot.down, bot.hp);
    Lobby.ff = true;
  });

  run('машина: свой водитель своего не ранит', () => {
    if (!map.cars || !map.cars.length) { check('на карте есть машина', false); return; }
    const c = map.cars[0];
    Lobby.ff = false;
    prep();
    c.seats[0] = p.id; p.veh = c; p.seat = 0;
    Object.assign(c, { a: 0, vx: M(10), vy: 0, w: 0 });
    unparkCar(c);
    const hit = (q) => { q.carHitAt = undefined; at(q, 0, 0); q.x = c.x + vSize(c).hl + PR - 2; q.y = c.y; for (let i = 0; i < 3; i++) { c.x += c.vx / 60; carPeople(c, 1 / 60); } };
    hit(bot);
    check('своего бота — без урона', bot.hp === 100, bot.hp);
    hit(e);
    check('противника — урон', e.hp < 100 || e.dead, e.hp);
    Lobby.ff = true;
    bot.hp = 100; bot.down = false;
    hit(bot);
    check('огонь по своим включён — своего ранит', bot.hp < 100 || bot.down, bot.hp);
    c.seats[0] = 0; p.veh = null; p.seat = -1;
    c.vx = 0;
  });

  run('лобби: галочка у хоста, гостю — из сообщения', () => {
    const role = G.role;
    G.role = 'host';
    renderLobby();
    check('галочка есть и включена у хоста', lobbyFFChk && lobbyFFChk.checked && !lobbyFFChk.disabled);
    lobbyFFChk.checked = false; lobbyFFChk.dispatchEvent(new Event('change'));
    check('снята — Lobby.ff = false, запомнено', Lobby.ff === false && localStorage.getItem('pcr-ff') === '0');
    G.role = 'guest';
    onGuestData({ t: 'lobby', slots: Lobby.slots, bots: true, ff: 1 });
    check('гость берёт значение хоста', Lobby.ff === true);
    renderLobby();
    check('у гостя галочка недоступна', lobbyFFChk.disabled);
    G.role = role;
    try { localStorage.removeItem('pcr-ff'); } catch (err) { /* ignore */ }
    Lobby.ff = true;
  });
  return T_.checks;
})();
