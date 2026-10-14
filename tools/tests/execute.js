// Добивание: на ногах в отряде никого (все живые ранены) — к каждому раненому идёт ближайший противник (один на раненого),
// говорит фразу из ENEMY.execute.lines и стреляет в упор. Пока кто-то из отряда на ногах — не добивают.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const bot = G.players.find((q) => q.ai);
  const pool = G.enemies.slice();
  const X = ENEMY.execute;
  // ближайшая проходимая клетка
  const spot = (o, tx, ty) => {
    for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (walkable(tx + dx, ty + dy)) { at(o, tx + dx, ty + dy); return; }
  };
  const prep = (e, tx, ty) => {
    spot(e, tx, ty);
    Object.assign(e, { dead: false, down: false, hp: 100, st: 0, notice: 0, seeing: false, target: null, goal: null, patrol: null,
      peek: null, flank: null, role: null, doorFire: null, exec: null, execSkip: null, barked: {}, react: 0, lastSeen: -99 });
    e.home = { x: e.x, y: e.y, a: e.a };
    e.gun = makeGun('m4a1', ENEMY.mags); e.kit = [e.gun, null, null]; e.cur = 0;
  };
  const fell = (o, tx, ty) => {
    spot(o, tx, ty);
    Object.assign(o, { dead: false, down: false, hp: 100, god: false, armor: null }); G.state = 'play';
    damagePerson(o, 150, o.x + 100, o.y, Math.PI, null);
  };
  const sim = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateWorld(1 / 60); if (fn && fn(i) === false) return; } };
  const lines = () => (G.barks || []).map((b) => b.text).filter((t) => X.lines.includes(t));
  for (const k in keys) keys[k] = false;
  G.state = 'play';

  run('один раненый: добивает ближайший', () => {
    const [A, B, C] = pool;
    G.players = [p]; G.enemies = [A, B, C]; G.barks = [];
    fell(p, 36, 27);
    prep(A, 36, 19); prep(B, 36, 12); prep(C, 48, 27);
    const dA = Math.hypot(A.x - p.x, A.y - p.y);
    check('A ближе остальных', dA < Math.hypot(B.x - p.x, B.y - p.y) && dA < Math.hypot(C.x - p.x, C.y - p.y));
    sim(0.1);
    check('идёт A, остальные — нет', A.exec && A.exec.t === p && !B.exec && !C.exec, [!!A.exec, !!B.exec, !!C.exec]);
    let saidAt = -1, saidD = 0, deadAt = -1, others = false;
    sim(30, (i) => {
      if (B.exec || C.exec) others = true;
      if (saidAt < 0 && lines().length) { saidAt = i; saidD = Math.hypot(A.x - p.x, A.y - p.y) / PX_M; }
      if (p.dead) { deadAt = i; return false; }
    });
    check('подошёл вплотную и сказал фразу', saidAt >= 0 && saidD <= X.reach / PX_M + 0.2, [saidAt, saidD.toFixed(2), lines()]);
    check('раненый добит', p.dead, [p.down, p.bleed?.toFixed(1)]);
    check('добит после фразы, до конца кровотечения', deadAt > saidAt && deadAt / 60 < DOWN.bleed, [saidAt, deadAt]);
    check('другие к этому раненому не шли', !others);
  });

  run('двое раненых: по одному противнику на каждого', () => {
    const [A, B, C] = pool;
    G.players = [p, bot]; G.enemies = [A, B, C]; G.barks = [];
    fell(p, 30, 27); fell(bot, 42, 27);
    prep(A, 30, 21); prep(B, 42, 21); prep(C, 36, 13);
    sim(0.1);
    check('разные противники на разных раненых', A.exec && B.exec && A.exec.t === p && B.exec.t === bot && !C.exec,
      [A.exec && A.exec.t.id, B.exec && B.exec.t.id, !!C.exec]);
    let double = false;
    sim(30, () => {
      G.state = 'play';        // погиб последний человек — раунд кончился бы; здесь смотрим обоих
      const by = new Map();
      for (const e of G.enemies) if (e.exec) { if (by.has(e.exec.t)) double = true; by.set(e.exec.t, e); }
      if (p.dead && bot.dead) return false;
    });
    check('одного раненого никогда не добивают двое', !double);
    check('оба добиты', p.dead && bot.dead, [p.dead, bot.dead, bot.down, A.exec && A.exec.phase, B.exec && B.exec.phase]);
  });

  run('кто-то из отряда на ногах — не добивают', () => {
    const [A] = pool;
    G.players = [p, bot]; G.enemies = [A]; G.barks = [];
    fell(p, 30, 27);
    spot(bot, 60, 50); Object.assign(bot, { dead: false, down: false, hp: 100, god: true });
    prep(A, 30, 21);
    sim(3);
    check('не идёт добивать', !A.exec && !p.dead && !lines().length);
    bot.god = false;
  });

  run('неуязвимого ([) не добивают', () => {
    const [A] = pool;
    G.players = [p]; G.enemies = [A]; G.barks = [];
    fell(p, 30, 27); p.god = true;
    prep(A, 30, 21);
    sim(3);
    check('бессмертный раненый — без добивания', !A.exec && !p.dead);
    p.god = false;
  });

  run('патронов нет — ножом', () => {
    const [A] = pool;
    G.players = [p]; G.enemies = [A]; G.barks = [];
    fell(p, 30, 27);
    prep(A, 30, 24); A.gun.mag = 0; A.gun.chamber = 0; A.gun.pouch = [];
    sim(15, () => { if (p.dead) return false; });
    check('добит ножом', p.dead);
  });

  G.players.forEach((o) => { o.god = false; });
  return T_.checks;
})();
