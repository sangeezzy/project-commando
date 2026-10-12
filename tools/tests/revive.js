// Ранение: при здоровье ≤ 0 боец отряда (человек или бот) падает, ползёт, истекает кровью 20 с; товарищ поднимает (F держать / бот сам),
// пока поднимают — кровотечение стоит. Противники погибают сразу. Лежачих противники не обстреливают; по раненому — добивание.
window.__result = (() => {
  const { check, run, at, step } = T_;
  const p = me();
  const bots = G.players.filter((q) => q.ai);
  const squad = G.players.slice();
  const tick = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateWorld(1 / 60); if (fn && fn(i) === false) return; } };
  const reset = (o) => { Object.assign(o, { dead: false, down: false, hp: 100, bleed: 0, rev: 0, reviving: 0, crouch: false }); G.state = 'play'; };
  const hit = (o, dmg) => damagePerson(o, dmg, o.x + 100, o.y, Math.PI, null);
  G.enemies = [];
  for (const k in keys) keys[k] = false;

  run('падает раненым', () => {
    at(p, 36, 27); reset(p);
    hit(p, 120);
    check('здоровье 0 — не погиб, а ранен', p.down && !p.dead && p.hp === 0);
    check('истекает кровью 20 с', Math.abs(p.bleed - DOWN.bleed) < 1e-9, p.bleed);
    check('стрелять не может', !canShoot(p));
    // ползёт: W 1 с
    const y0 = p.y;
    G.cam.x = p.x; G.cam.y = p.y; keys.KeyW = true; step(60); keys.KeyW = false;
    const v = (y0 - p.y) / PX_M;
    check('может медленно ползти (~0,5 м/с)', v > 0.3 && v < 0.65, v.toFixed(2));
    const mag = p.gun.mag; mouse.l = true; step(20); mouse.l = false;
    check('раненый не стреляет', p.gun.mag === mag);
  });

  run('без помощи — смерть через 20 с', () => {
    G.players = [p];
    at(p, 36, 27); reset(p); hit(p, 120);
    tick(19);
    check('через 19 с ещё жив', p.down && !p.dead, p.bleed.toFixed(1));
    tick(1.2);
    check('через 20 с — погиб', p.dead && !p.down);
    G.players = squad;
  });

  run('человек поднимает бота', () => {
    const [b] = bots;
    G.players = [p, b];
    at(p, 36, 27); reset(p); at(b, 37, 27); reset(b); b.leader = p.slot;
    hit(b, 150);
    check('союзный бот тоже падает раненым', b.down && !b.dead);
    tick(3);
    const bleed0 = b.bleed;
    keys.KeyF = true;
    let pausedOk = true, moved = false;
    const x0 = p.x;
    G.cam.x = p.x; G.cam.y = p.y;
    tick(2, () => { if (b.bleed !== bleed0) pausedOk = false; });
    check('пока поднимают — кровотечение стоит', pausedOk && b.rev > 0.4, [b.bleed.toFixed(2), b.rev.toFixed(2)]);
    keys.KeyD = true; step(10); keys.KeyD = false;
    if (Math.abs(p.x - x0) > 1) moved = true;
    check('поднимающий стоит на месте и не стреляет', !moved && !canShoot(p));
    tick(2.5);
    keys.KeyF = false;
    check('за 4 с поднят: на ногах, здоровье 25', !b.down && !b.dead && b.hp === DOWN.reviveHp, [b.down, b.hp]);
    // бросил поднимать — таймер снова идёт
    at(b, 37, 27); hit(b, 100); tick(1);
    keys.KeyF = true; tick(1); keys.KeyF = false;
    const r = b.rev, bl = b.bleed;
    tick(1);
    check('бросил поднимать — кровотечение пошло, прогресс тает', b.bleed < bl - 0.9 && b.rev < r, [b.bleed.toFixed(1), b.rev.toFixed(2)]);
    G.players = squad;
  });

  run('бот поднимает человека', () => {
    const [b] = bots;
    G.players = [p, b];
    at(p, 36, 27); reset(p); at(b, 30, 27); reset(b);
    Object.assign(b, { st: 0, seeing: false, peek: null, flank: null, fm: null, regroup: false, goal: null });
    hit(p, 200);
    let up = -1;
    tick(15, (i) => { if (!p.down) { up = i / 60; return false; } });
    check('бот сам подходит и поднимает', up > 0 && !p.dead && p.hp === DOWN.reviveHp, up);
    check('успел до смерти, кровотечение останавливалось', up > 0 && up < DOWN.bleed);
    G.players = squad;
  });

  run('противники и раненые', () => {
    const e = makeEnemy(0, 0, 0, null);
    G.enemies = [e];
    at(e, 36, 20); e.a = Math.PI / 2; e.st = 2; e.notice = 1;
    G.players = [p];
    at(p, 36, 27); reset(p); hit(p, 200);
    check('лежачего раненого противник не обстреливает (не цель)', perceive(e) === null);
    hit(p, 10);
    check('попадание по раненому — добивание', p.dead);
    reset(p);
    hit(e, 500);
    check('противник при 0 — погибает сразу (не ранен)', e.dead && !e.down);
    G.enemies = []; G.players = squad;
  });

  run('конец раунда', () => {
    G.state = 'play';
    for (const q of squad) { reset(q); }
    G.players = squad;
    hit(p, 200);
    tick(0.1);
    check('человек ранен, а боты на ногах — игра идёт', G.state === 'play');
    for (const b of bots) hit(b, 200);
    tick(0.1);
    check('все ранены — ещё не конец: истекают кровью', G.state === 'play', G.state);
    tick(DOWN.bleed + 0.5);
    check('никто не поднял — все погибли, проигрыш', G.state === 'dead' && p.dead, G.state);
    G.state = 'play';
    for (const q of squad) reset(q);
    hit(bots[0], 200);
    G.cam.x = p.x; G.cam.y = p.y; at(p, Math.floor(bots[0].x / TILE), Math.floor(bots[0].y / TILE) + 1);
    render(1 / 60);
    check('кадр с раненым товарищем и подсказкой рисуется', true);
    hit(p, 200); render(1 / 60);
    check('кадр «вы ранены» рисуется', true);
  });
  return T_.checks;
})();
