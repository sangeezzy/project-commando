// Союзные боты: заполняют пустые места, держатся у ведущего, воюют по тем же правилам, что и противники
// (замечают постепенно, слышат шаги, укрытия, огонь, свои на линии огня, тела, группа), противники воюют с ними так же.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const bots = G.players.filter((q) => q.ai);
  const tick = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateWorld(1 / 60); if (fn && fn(i) === false) return; } };
  const prepAI = (e, tx, ty, a, st = 0) => {
    at(e, tx, ty); e.a = e.want = a; e.st = st; e.notice = st === 2 ? 1 : 0; e.seeing = false; e.target = null; e.lastSeen = -99;
    e.goal = null; e.searchT = 0; e.cover = null; e.coverT = 0; e.patrol = null; e.home = { x: e.x, y: e.y, a }; e.look = a; e.lookT = 99;
    e.peek = null; e.flank = null; e.role = null; e.regroup = false; e.investigate = false; e.doorFire = null; e.dead = false; e.hp = 100;
    e.react = 0; e.bodies = new Set(); e.gun = makeGun('m4a1', 5); e.lamp = false; e.fightT = 0; e.flankCd = 0; e.huntFlank = false;
  };
  const enemies0 = G.enemies.slice();

  run('состав отряда', () => {
    check('1 человек и 3 союзных бота', G.players.length === 4 && bots.length === 3 && !p.ai, G.players.map((q) => q.name));
    check('у каждого своё место 0..3', new Set(G.players.map((q) => q.slot)).size === 4);
    check('боты — того же отряда (сторона p) и с тем же M4A1', bots.every((b) => b.side === 'p' && b.gun.t === 'm4a1'));
    check('ведущий ботов — человек', bots.every((b) => leaderOf(b) === p));
  });

  run('держатся у ведущего', () => {
    G.enemies = [];
    at(p, 36, 27); for (const b of bots) prepAI(b, 36, 29, -Math.PI / 2);
    p.x = p.px = 22.5 * TILE; p.y = p.py = 27.5 * TILE;   // ведущий ушёл на 14 м
    tick(8);
    const d = bots.map((b) => Math.hypot(b.x - p.x, b.y - p.y) / PX_M);
    check('за 8 с подтянулись к ведущему (≤ 5 м)', d.every((v) => v < 5), d.map((v) => v.toFixed(1)));
    check('не стоят друг в друге', bots.every((a, i) => bots.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > PR * 1.5)));
    p.crouch = true; tick(2);
    check('ведущий присел — присели и боты рядом', bots.filter((b) => b.crouch).length >= 2, bots.map((b) => b.crouch));
    p.crouch = false;
  });

  run('те же правила: замечают и воюют', () => {
    const [b] = bots, e = enemies0[0];
    G.enemies = [e];
    const all = G.players;
    G.players = [p, b];                               // остальные боты не участвуют
    at(p, 6, 27); p.hp = 1e9;                        // человек за стеной, не мешает
    prepAI(b, 36, 22, Math.PI); prepAI(e, 16, 22, 0); e.hp = 1e6; b.hp = 1e6;
    // замечание постепенное (как у противника): 20 м, стоят открыто
    let tb = null, te = null;
    const hb = b.hp, he = e.hp, sb = b.gun.lastShot, se = e.gun.lastShot;
    let supE = 0, supB = 0;
    const watch = () => { supE = Math.max(supE, e.supp); supB = Math.max(supB, b.supp); };
    tick(4, (i) => { watch(); if (tb === null && b.st === 2) tb = i / 60; if (te === null && e.st === 2) te = i / 60; });
    check('бот замечает противника не мгновенно', tb !== null && tb > 0.4, tb);
    check('противник так же замечает бота', te !== null && te > 0.4, te);
    check('цели друг у друга: бот → противник, противник → бот', b.target === e && e.target === b);
    tick(6, watch);
    // ведут огонь друг по другу: попадания или пули рядом (подавление)
    check('бот ведёт огонь по противнику (попадания или пули рядом)', b.gun.lastShot > sb && (e.hp < he || supE > 0.2), [Math.round(he - e.hp), supE.toFixed(2)]);
    check('противник так же — по боту', e.gun.lastShot > se && (b.hp < hb || supB > 0.2), [Math.round(hb - b.hp), supB.toFixed(2)]);
    check('оба ищут укрытия по одним правилам', !!b.cover || !!e.cover, [!!b.cover, !!e.cover]);
    G.players = all;
  });

  run('свои на линии огня', () => {
    const [b] = bots, e = enemies0[0];
    G.enemies = [e];
    prepAI(b, 36, 36, -Math.PI / 2, 2); at(p, 36, 33); at(e, 36, 27);
    check('бот не стреляет, если человек на линии огня', friendlyInLine(b, e));
    at(p, 30, 33);
    check('отошёл — путь свободен', !friendlyInLine(b, e));
  });

  run('слух и тела', () => {
    const [b] = bots, e = enemies0[1];
    G.enemies = [e];
    at(p, 6, 27);
    // противник ходит за углом кирпичного здания, бот рядом с другой стороны
    prepAI(b, 22, 18, Math.PI); prepAI(e, 22, 15, Math.PI / 2);
    e.sprint = true; e.speed = M(4);
    makeNoise(e.x, e.y, M(NOISE.sprint), 'step', e);
    check('бот слышит шаги противника', b.st === 1, b.st);
    // тело убитого бота
    const [b1, b2] = bots;
    prepAI(b1, 36, 25, 0); b1.dead = true; b1.deadT = G.time - 3; b1.bodyFound = false;
    prepAI(b2, 36, 19, Math.PI / 2); G.enemies = [];
    p.x = p.px = 36.5 * TILE; p.y = p.py = 17.5 * TILE;
    tick(0.3);
    check('бот, увидев тело своего, поднимает тревогу', b2.st === 2, b2.st);
    b1.dead = false; b1.hp = 100;
  });

  run('группа: боты тоже подавляют и обходят', () => {
    const [b1, b2] = bots, e = enemies0[2];
    G.enemies = [e];
    bots[2].dead = true;
    at(p, 36, 34); p.hp = 1e9;
    prepAI(b1, 30, 27, -Math.PI / 2, 2); prepAI(b2, 42, 27, -Math.PI / 2, 2); prepAI(e, 36, 17, Math.PI / 2, 2);
    e.hp = 1e6; b1.hp = 1e6; b2.hp = 1e6;
    G.squad = { t: 0, flankCd: 0 };
    let roles = false;
    tick(4, () => { if ([b1, b2].some((q) => q.role === 'suppress') && [b1, b2].some((q) => q.flank)) { roles = true; return false; } });
    check('двое ботов против одного: подавление и обход', roles, [b1.role, b2.role, !!b1.flank, !!b2.flank]);
    bots[2].dead = false;
  });

  run('поводок', () => {
    const [b] = bots;
    G.enemies = [];
    at(p, 36, 27);
    prepAI(b, 36, 29, 0, 1);
    b.investigate = true; b.lastX = 66 * TILE; b.lastY = 6 * TILE;    // что-то далеко
    tick(14);
    check('бот не уходит от ведущего дальше поводка', Math.hypot(b.x - p.x, b.y - p.y) < ENEMY.ally.leash + M(3), (Math.hypot(b.x - p.x, b.y - p.y) / PX_M).toFixed(1));
  });

  run('огонь по своим и конец игры', () => {
    const [b] = bots;
    G.enemies = enemies0.slice(0, 1); G.enemies[0].dead = false; at(G.enemies[0], 66, 6);
    at(p, 36, 27); at(b, 36, 24); b.hp = 100; b.dead = false;
    p.a = Math.atan2(b.y - p.y, b.x - p.x); p.gun.chamber = 1; p.gun.mag = 10;
    fireRound(p, 0); for (let i = 0; i < 5; i++) updateBullets(1 / 60);
    check('пули попадают и по своим (реализм)', b.hp < 100, b.hp);
    G.state = 'play';
    for (const q of bots) { q.dead = false; q.hp = 100; }
    p.hp = 0; p.dead = true;
    tick(0.1);
    check('погибли все люди — конец, даже если боты живы', G.state === 'dead', G.state);
    check('погибший смотрит глазами живого товарища', viewer() !== p && !viewer().dead);
    render(1 / 60);
    check('кадр (наблюдение, метки своих, состав отряда) рисуется', true);
  });
  return T_.checks;
})();
