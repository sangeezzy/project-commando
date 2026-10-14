// Стационарные пулемёты (M2, ПКМ, ДШК): характеристики, занять / оставить (F), сектор, огонь и лента, ИИ (за пулемётом стреляет,
// идёт занять свободный, один стрелок на пулемёт, цель вне сектора — уходит), союзный бот, «Штурм» с 10-й локации, снимок для сети.
window.__result = (() => {
  const { check, run, step, tick } = T_;
  const W = WEAPONS;
  const solo = [{ slot: 0, human: true, name: 'Тест' }];
  const put = (o, x, y) => { o.x = o.px = x; o.y = o.py = y; o.speed = 0; };

  run('характеристики', () => {
    check('M2: 12,7×99 (.50 BMG), ~500 выстр/мин, 890 м/с, лента 100', /12,7×99/.test(W.m2.cal) && W.m2.rpm >= 450 && W.m2.rpm <= 600 && W.m2.v0 === 890 && W.m2.mag === 100);
    check('ПКМ: 7,62×54R, 650 выстр/мин, 825 м/с, лента 200', /7,62×54/.test(W.pkm.cal) && W.pkm.rpm === 650 && W.pkm.v0 === 825 && W.pkm.mag === 200);
    check('ДШК: 12,7×108, 600 выстр/мин, 850 м/с, лента 50', /12,7×108/.test(W.dshk.cal) && W.dshk.rpm === 600 && W.dshk.v0 === 850 && W.dshk.mag === 50);
    check('боезапас ограничен, но большой (сотни патронов)', MG_IDS.every((t) => W[t].mag * W[t].mags >= 400 && W[t].mag * W[t].mags <= 1000));
    check('12,7 пробивает любую броню в игре (IV — тоже)', W.m2.threat > ARMOR.IV.lvl && W.dshk.threat > ARMOR.IV.lvl && W.pkm.threat <= ARMOR.III.lvl);
    check('пулемёты не носятся (нет в наборах и на столе)', MG_IDS.every((t) => !PRIMARY_IDS.includes(t) && !PISTOL_IDS.includes(t)));
  });

  run('игрок: занять, сектор, огонь, оставить', () => {
    startMap('big', 0, solo, false);
    const p = me();
    check('полигон ×1,5: три пулемёта у старта', map.mgs.length === 3 && map.mgs.map((m) => m.t).join() === MG_IDS.join());
    const m = map.mgs.find((q) => q.t === 'm2'), s = mgSeat(m);
    put(p, s.x + 6, s.y + 4);
    G.cam.x = p.x; G.cam.y = p.y;
    pressed.KeyF = true; step(1);
    check('у места стрелка — F занимает пулемёт', p.mg === m && m.user === p.id && p.gun === m.gun && p.gun.t === 'm2');
    const x0 = p.x, y0 = p.y;
    keys.KeyW = true; keys.KeyD = true; step(30); keys.KeyW = false; keys.KeyD = false;
    check('за пулемётом не ходит', Math.hypot(p.x - x0, p.y - y0) < 1, [p.x - x0, p.y - y0]);
    mouse.x = VW / 2; mouse.y = VH / 2 + 200; step(2);          // мышь — назад (на юг): ствол — только в секторе
    check('ствол — только в секторе станка', Math.abs(angDiff(p.a, m.a)) <= m.arc + 1e-6, [p.a.toFixed(2), m.a.toFixed(2)]);
    mouse.x = VW / 2; mouse.y = VH / 2 - 200; step(2);
    const ammo0 = m.gun.mag + m.gun.chamber;
    mouse.l = true; mouse.lPressed = true; step(40); mouse.l = false; step(1);
    check('огонь из пулемёта: лента тратится', m.gun.mag + m.gun.chamber < ammo0 - 5, [ammo0, m.gun.mag]);
    pressed.Digit3 = true; step(2);
    check('смена оружия за пулемётом не работает', p.mg === m && p.gun === m.gun);
    m.gun.mag = 0; m.gun.chamber = 0;
    pressed.KeyR = true; step(1);
    check('R — смена короба с лентой (7 с), быстрой нет', m.gun.reloadT > 0 && Math.abs(m.gun.reloadDur - W.m2.reloadEmpty) < 0.01 && quickReload(p) === false, m.gun.reloadDur);
    step(60 * 8.2);
    check('короб сменён — лента полная', m.gun.mag === W.m2.mag - 1 && m.gun.chamber === 1, m.gun.mag);
    pressed.KeyF = true; step(1);
    check('F ещё раз — оставил, в руках своё оружие', !p.mg && !m.user && p.gun === p.kit[p.cur]);
    // ранен за пулемётом — пулемёт свободен
    mgMount(p, m);
    damagePerson(p, 500, p.x, p.y - 100, Math.PI / 2, null);
    tick(1);
    check('ранен за пулемётом — пулемёт свободен', p.down && !p.mg && !m.user);
    reviveUp(p); p.hp = 100;
  });

  run('ИИ за пулемётом', () => {
    startRange();
    const p = me();
    p.god = true;
    const [A, B] = G.enemies;
    G.enemies = [A];
    put(p, 36 * TILE, 40 * TILE);
    const m = addMG('pkm', p.x, p.y - M(14), Math.PI / 2);          // смотрит на юг — на игрока
    const s = mgSeat(m);
    put(A, s.x, s.y);
    Object.assign(A, { st: 0, notice: 0, seeing: false, a: Math.PI / 2, patrol: null, home: { x: s.x, y: s.y, a: Math.PI / 2 } });
    mgMount(A, m);
    const a0 = m.gun.mag + m.gun.chamber;
    tick(60 * 4);
    check('стрелок видит игрока в секторе — стреляет очередями', m.gun.mag + m.gun.chamber < a0 - 8 && A.mg === m, [a0, m.gun.mag]);
    // игрок ушёл за спину пулемёта — стрелок оставляет пулемёт
    put(p, s.x, s.y - M(9));
    p.crouch = false;
    A.seeing = false; alertEnemy(A, p.x, p.y, true);   // скрылся, зашёл за спину и выстрелил — стрелок услышал, где он
    let left = false;
    for (let i = 0; i < 60 * 6 && !left; i++) { tick(1); if (!A.mg) left = true; }
    check('цель вне сектора — оставляет пулемёт', left && !m.user);
    // свободный пулемёт: противник в бою (цель в секторе) идёт и занимает его; второй — не мешает
    put(p, 36 * TILE, 40 * TILE);
    G.enemies = [A, B];
    put(A, s.x + M(5), s.y - M(2)); put(B, s.x - M(5), s.y - M(2));
    for (const e of [A, B]) { Object.assign(e, { st: 2, notice: 1, seeing: false, target: p, lastX: p.x, lastY: p.y, lastSeen: G.time, dead: false, hp: 100, mgSeekT: 0, mgClaim: 0 }); }
    let users = new Set();
    for (let i = 0; i < 60 * 8; i++) { tick(1); if (m.user) users.add(m.user); if ([A, B].filter((e) => e.mg).length > 1) users.add('два'); }
    check('свободный пулемёт: в бою противник сам занимает его', !!m.user && [A, B].some((e) => e.mg === m), [m.user]);
    check('один пулемёт — один стрелок', !users.has('два'));
    p.god = false;
  });

  run('союзный бот', () => {
    startMap('big', 0, solo, true);
    const p = me(), bot = G.players.find((q) => q.ai);
    const m = map.mgs[0], s = mgSeat(m);
    put(bot, s.x + M(3), s.y + M(1));
    put(p, s.x + M(2), s.y + M(2));
    G.enemies = [];
    const e = makeEnemy(s.x, s.y - M(20), Math.PI / 2, null);
    e.hp = 1e9; G.enemies.push(e);
    Object.assign(bot, { st: 2, seeing: false, target: e, lastX: e.x, lastY: e.y, lastSeen: G.time, mgSeekT: 0 });
    let mounted = false;
    for (let i = 0; i < 60 * 6 && !mounted; i++) { tick(1); if (bot.mg) mounted = true; }
    check('союзный бот в бою занимает пулемёт рядом с ведущим', mounted);
  });

  run('«Штурм»: пулемёт с 10-й локации', () => {
    const was = MG.chance;
    MG.chance = 1;
    let placed = 0, bad = [];
    for (let k = 0; k < 6; k++) {
      startMap('assault', assaultSeed(3000 + k * 17, 10), solo, false);
      if (!map.mgs.length) continue;
      placed++;
      const m = map.mgs[0], s = mgSeat(m), st = map.start;
      const team = spawnOffs().map(([ox, oy]) => ({ x: (st.x + ox) * TILE, y: (st.y + oy) * TILE }));
      if (team.some((q) => los(q.x, q.y, m.x, m.y) || los(q.x, q.y, s.x, s.y))) bad.push([k, 'виден со старта']);
      if (team.some((q) => mgInArc(m, q.x, q.y) && sightLine({ x: m.x, y: m.y }, q))) bad.push([k, 'отряд в секторе']);
      if (team.some((q) => Math.hypot(q.x - m.x, q.y - m.y) < MG.minStart)) bad.push([k, 'близко']);
      const g = G.enemies.find((e) => e.mg === m);
      if (!g || m.user !== g.id) bad.push([k, 'нет стрелка']);
      if (castRay(m.x, m.y, Math.cos(m.a), Math.sin(m.a), M(40), (cx, cy) => opaqueT(tileAt(cx, cy))) < M(12)) bad.push([k, 'смотрит в стену']);
    }
    check('шанс 100%: пулемёт со стрелком почти всегда находит место', placed >= 5, placed);
    check('место: не видно со старта, отряд не в секторе, обзор вперёд ≥ 12 м', !bad.length, bad);
    startMap('assault', assaultSeed(3000, 9), solo, false);
    check('9-я локация — пулемётов нет', !map.mgs.length);
    MG.chance = was;
    let n = 0;
    for (let k = 0; k < 40; k++) { startMap('assault', assaultSeed(5000 + k * 31, 12), solo, false); if (map.mgs.length) n++; }
    check('шанс — около 30% (40 локаций)', n >= 5 && n <= 20, n);
  });

  run('сеть: снимок пулемётов', () => {
    startMap('big', 0, solo, false);
    const p = me(), m = map.mgs[1];
    mgMount(p, m);
    m.gun.mag = 77;
    const st = map.mgs.map(mgState);
    map.mgs = []; p.mg = null; p.gun = p.kit[p.cur];
    applyMgState(st);
    check('пулемёты и стрелок доходят: тип, лента, кто за ним', map.mgs.length === 3 && map.mgs[1].t === m.t && map.mgs[1].gun.mag === 77 &&
      p.mg === map.mgs[1] && p.gun === map.mgs[1].gun);
    let err = null;
    try { render(1 / 60); } catch (e) { err = String(e); }
    check('кадр с пулемётами и стрелком — без ошибок', !err, err);
  });
  return T_.checks;
})();
