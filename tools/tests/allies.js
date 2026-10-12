// Союзные боты: не застревают в стенах, не поднимают сквозь стену, узнают о противнике от своих (человек видит / стреляет),
// при угрозе держатся у ведущего в укрытии (а не уходят искать), не бегут поднимать раненого под огнём; метки замеченных противников.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const bots = G.players.filter((q) => q.ai);
  const squad = G.players.slice();
  const enemies0 = G.enemies.slice();
  const tick = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateWorld(1 / 60); if (fn && fn(i) === false) return; } };
  const calm = (o, tx, ty, a = 0) => {
    at(o, tx, ty); Object.assign(o, { a, want: a, st: 0, notice: 0, seeing: false, target: null, lastSeen: -99, alertAt: -99, goal: null, cover: null,
      gSpot: null, peek: null, flank: null, role: null, regroup: false, investigate: false, doorFire: null, dead: false, down: false, hp: 100,
      reviveSkip: null, unstuckT: 0, stuckT: 0, searchT: 0, patrol: null, home: { x: o.x, y: o.y, a } });
  };
  for (const k in keys) keys[k] = false;

  run('не застревает в стене', () => {
    const [b] = bots;
    G.enemies = []; G.players = [p, b];
    calm(b, 21, 13); at(p, 30, 30);
    const x0 = b.x, y0 = b.y;
    // упорно идёт на запад, в стену кирпичного здания
    for (let i = 0; i < 90; i++) { G.time += 1 / 60; moveDir(b, Math.PI, ENEMY.speed.walk, 1 / 60); }
    check('упёрся — через ~0,6 с шагает в сторону', Math.hypot(b.x - x0, b.y - y0) > M(0.5), (Math.hypot(b.x - x0, b.y - y0) / PX_M).toFixed(2));
    G.players = squad;
  });

  run('не поднимает сквозь стену', () => {
    const [d, a] = bots;
    G.enemies = []; G.players = [p, d, a];
    at(p, 8, 12); calm(d, 21, 13); calm(a, 19, 13);
    damagePerson(d, 200, d.x + 50, d.y, 0, null);
    a.reviveWant = true;
    updateDowned(1 / 60);
    check('рядом, но за стеной — подъём не идёт', d.rev === 0 && !a.reviving, [d.rev, a.reviving]);
    let up = false;
    tick(15, () => { if (!d.down) { up = true; return false; } });
    check('обходит стену и поднимает', up && !d.dead);
    G.players = squad;
  });

  run('узнаёт о противнике от своих', () => {
    const e = enemies0[0];
    G.enemies = [e]; G.players = squad; G.intel = { p: new Map(), e: new Map() };
    for (const b of bots) calm(b, 36, 40, Math.PI / 2);      // далеко, смотрят в другую сторону
    calm(e, 36, 16, Math.PI / 2); e.hp = 1e6; e.st = 0;
    at(p, 36, 27); p.a = -Math.PI / 2; p.crouch = false; p.hp = 1e9;
    tick(0.3);
    const b = bots[0];
    check('игрок видит противника — боты знают (по рации)', b.st === 2 && Math.hypot(b.lastX - e.x, b.lastY - e.y) < M(2), [b.st, (b.lastX / TILE).toFixed(1), (b.lastY / TILE).toFixed(1)]);
    check('метка замеченного противника есть у отряда', G.intel.p.has(e.id));
    // выстрел игрока: бот смотрит туда, куда стреляет игрок (а не на самого игрока)
    G.enemies = []; G.intel = { p: new Map(), e: new Map() };
    calm(b, 30, 33, 0);
    at(p, 36, 27); p.a = 0; p.gun.chamber = 1; p.gun.mag = 10;
    fireRound(p, 0); G.bullets = [];
    check('игрок стреляет — бот берёт точку по линии его огня', b.st === 2 && b.lastX > p.x + M(5), [(b.lastX / TILE).toFixed(1), (p.x / TILE).toFixed(1)]);
  });

  run('при угрозе — у ведущего, в укрытии (настройка guard.hold)', () => {
    ENEMY.guard.hold = true;
    G.enemies = []; G.players = squad; G.intel = { p: new Map(), e: new Map() };
    at(p, 33, 26); p.a = -Math.PI / 2; p.crouch = false;
    for (const [i, b] of bots.entries()) { calm(b, 35 + i, 29, 0); alertEnemy(b, 32.5 * TILE, 15.5 * TILE, true); b.lastSeen = G.time; }
    tick(6);
    const d = bots.map((b) => Math.hypot(b.x - p.x, b.y - p.y) / PX_M);
    check('угроза далеко — не уходят искать, остаются у ведущего', d.every((v) => v < ENEMY.guard.radius + 1.5), d.map((v) => v.toFixed(1)));
    const covered = bots.filter((b) => b.crouch && coverToward(b.x, b.y, 32.5 * TILE, 15.5 * TILE));
    check('заняли укрытия (присели за блоками) лицом к угрозе', covered.length >= 2, bots.map((b) => [b.crouch, coverToward(b.x, b.y, 32.5 * TILE, 15.5 * TILE)]));
    check('смотрят в сторону угрозы', bots.every((b) => Math.abs(angDiff(b.a, Math.atan2(15.5 * TILE - b.y, 32.5 * TILE - b.x))) < 0.6));
    // угроза рядом с ведущим — идут искать как обычно
    for (const b of bots) { alertEnemy(b, 36.5 * TILE, 31.5 * TILE, true); b.lastSeen = G.time; }
    check('угроза рядом с ведущим — разрешено искать', !guarding(bots[0]));
    ENEMY.guard.hold = false;
  });

  run('под огнём раненого не поднимают, пока не критично', () => {
    const [d, a] = bots;
    const e = enemies0[1];
    G.enemies = [e]; G.players = [p, d, a];
    at(p, 6, 27);
    calm(d, 36, 27); calm(a, 30, 35, 0);
    damagePerson(d, 200, d.x + 50, d.y, 0, null);
    // противник на виду у раненого, отряд о нём знает
    calm(e, 36, 17, Math.PI / 2); e.hp = 1e6;
    G.intel = { p: new Map([[e.id, { id: e.id, x: e.x, y: e.y, t: G.time, sent: G.time }]]), e: new Map() };
    check('место простреливается — бот не идёт', downedToHelp(a) === null);
    d.bleed = 4;
    check('кровотечение критическое — идёт, несмотря на риск', downedToHelp(a) === d);
    G.players = squad; G.enemies = [];
  });

  run('отрисовка', () => {
    G.players = squad;
    const e = enemies0[2]; G.enemies = [e]; calm(e, 40, 22); e.va = 0;
    G.intel = { p: new Map([[e.id, { id: e.id, x: e.x, y: e.y, t: G.time - 2, sent: 0 }]]), e: new Map() };
    at(p, 36, 27); G.cam.x = p.x; G.cam.y = p.y;
    render(1 / 60);
    check('кадр с метками замеченных противников рисуется', true);
  });
  return T_.checks;
})();
