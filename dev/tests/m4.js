// M4A1: темп, режимы, магазины и патронник, перезарядки, скорость пули, разброс, отдача, урон.
window.__result = (() => {
  const { check, run, at } = T_;
  const W = WEAPONS.m4a1;
  const p = me();
  G.enemies = [];
  RECOIL.on = false;                    // чистая баллистика: увод ствола отдачей — в тесте recoil
  const sim =(n, dt, fn) => { for (let i = 0; i < n; i++) { fn && fn(i); updateGun(p, dt); G.time += dt; } };
  run('темп и режимы', () => {
    p.gun = makeGun('m4a1', W.mags);
    const g = p.gun;
    check('старт: 29 в магазине + 1 в патроннике, 6 запасных по 30', g.mag === 29 && g.chamber === 1 && g.pouch.length === 6 && g.pouch.every((n) => n === 30), [g.mag, g.chamber, g.pouch]);
    let shots = 0;
    sim(60, 1 / 60, (i) => { if (pullTrigger(p, true, i === 0, 0)) shots++; });
    check('автоматический: за 1 с очереди 13–14 выстрелов (800 выстр/мин)', shots >= 13 && shots <= 14, shots);
    p.gun = makeGun('m4a1', W.mags); p.gun.mode = 'semi';
    shots = 0;
    sim(60, 1 / 60, (i) => { if (pullTrigger(p, true, i === 0, 0)) shots++; });
    check('одиночный: зажатый спуск — один выстрел', shots === 1, shots);
    shots = 0;
    sim(60, 1 / 60, (i) => { if (pullTrigger(p, true, i % 6 === 0, 0)) shots++; });
    check('одиночный: 10 нажатий за 1 с — 10 выстрелов', shots === 10, shots);
  });
  run('магазин и перезарядка', () => {
    p.gun = makeGun('m4a1', W.mags);
    const g = p.gun;
    let n = 0;
    sim(100, 0.1, () => { if (pullTrigger(p, true, true, 0)) n++; });
    check('30 выстрелов, затем затвор на задержке', n === 30 && g.mag === 0 && g.chamber === 0, [n, g.mag, g.chamber]);
    check('пустой: перезарядка с задержки затвора 2,9 с', startReload(p) && Math.abs(g.reloadT - 2.9) < 1e-9, g.reloadT);
    sim(Math.round(2.8 / 0.05), 0.05);
    check('через 2,8 с ещё не готово', g.reloadT > 0, g.reloadT);
    sim(4, 0.05);
    check('после: 29 + 1, пустой магазин выброшен, запасных 5', g.reloadT === 0 && g.mag === 29 && g.chamber === 1 && g.pouch.length === 5, [g.mag, g.chamber, g.pouch]);
    n = 0;
    sim(19, 0.1, () => { if (pullTrigger(p, true, true, 0)) n++; });
    check('отстреляли 19: осталось 10 + 1', g.mag === 10 && g.chamber === 1, [g.mag, g.chamber]);
    startReload(p);
    check('тактическая перезарядка 2,3 с', Math.abs(g.reloadT - 2.3) < 1e-9, g.reloadT);
    sim(50, 0.05);
    check('после: 30 + 1, неполный магазин (10) остался в подсумке', g.mag === 30 && g.chamber === 1 && g.pouch.includes(10) && g.pouch.length === 5, [g.mag, g.pouch]);
    check('с полным магазином перезарядка не начинается', !startReload(p));
    check('всего патронов: 31 + 4×30 + 10', ammoTotal(g) === 161, ammoTotal(g));
    // все полные магазины расстреляны — последним берётся неполный
    for (let k = 0; k < 4; k++) { g.mag = 0; startReload(p); sim(60, 0.05); }
    g.mag = 0; startReload(p); sim(60, 0.05);
    check('последним в ход идёт неполный магазин', g.mag === 10 && g.pouch.length === 0, [g.mag, g.pouch]);
    g.mag = 0;
    check('без магазинов перезарядка невозможна', !startReload(p));
  });
  run('баллистика', () => {
    p.gun = makeGun('m4a1', W.mags);
    at(p, 36, 27); p.a = 0; p.ads = 1; p.crouch = false;
    G.bullets = [];
    fireRound(p, 0);
    const b = G.bullets[0];
    updateBullets(0.01);
    const moved = (b.x - p.x) / PX_M;
    check('начальная скорость 910 м/с (за 0,01 с — 9,1 м)', Math.abs(moved - 9.1) < 0.2, moved.toFixed(2));
    G.bullets = [];
    p.gun.bloom = 0;
    const sigma = playerSpread(p);
    check('разброс с прицелом стоя ≈ 3,5 мрад (1 ствол + 2,5 стрелок)', Math.abs(sigma - 3.5) < 0.01, sigma);
    const errs = [];
    for (let i = 0; i < 2000; i++) {
      p.gun.chamber = 1; p.gun.mag = 10;
      fireRound(p, sigma);
      const b2 = G.bullets.pop();
      errs.push(Math.atan2(b2.vy, b2.vx) / MRAD);
    }
    const sd = Math.sqrt(errs.reduce((s, v) => s + v * v, 0) / errs.length);
    check('выстрелы ложатся с σ ≈ 3,5 мрад (≈10 см на 30 м)', Math.abs(sd - 3.5) < 0.35, sd.toFixed(2));
    p.ads = 0; p.gun.bloom = 0;
    check('от бедра разброс ≈ 25 мрад', Math.abs(playerSpread(p) - 25) < 0.01, playerSpread(p));
    p.crouch = true; p.ads = 1;
    check('присев с прицелом точнее, чем стоя', playerSpread(p) < 3.5, playerSpread(p));
    p.crouch = false; p.speed = M(SPEED.walk);
    check('на ходу разброс растёт', playerSpread(p) > 10, playerSpread(p));
    p.speed = 0; p.gun.bloom = 0;
    for (let i = 0; i < 10; i++) { p.gun.chamber = 1; fireRound(p, 0); }
    G.bullets = [];
    check('очередь 10 выстрелов раскачивает оружие (разброс ≥ 20 мрад; у игрока прирост ×RECOIL.bloomK)', p.gun.bloom >= 20 &&
      Math.abs(p.gun.bloom - Math.min(W.maxBloom, 10 * W.kick * RECOIL.bloomK)) < 1e-6, p.gun.bloom.toFixed(1));
    updateGun(p, 0.5);
    check('за 0,5 с отдача почти гаснет', p.gun.bloom < 2, p.gun.bloom.toFixed(2));
  });
  run('урон', () => {
    const hits = [];
    let oneShot = 0;
    for (let k = 0; k < 600; k++) {
      const t = makePerson('e', 0, 0);
      t.st = 0;
      let n = 0;
      while (!t.dead && n < 10) { hitPerson(t, { t: W, dist: M(20), e: 1, sx: 300, sy: 0, vx: -1, vy: 0, owner: p.id }); n++; }
      hits.push(n); if (n === 1) oneShot++;
    }
    const mean = hits.reduce((s, v) => s + v, 0) / hits.length;
    check('незащищённого человека выводит из строя в среднем 2–2,5 попадания', mean > 1.9 && mean < 2.6, mean.toFixed(2));
    check('примерно каждое 7-е попадание сразу смертельно', oneShot / 600 > 0.09 && oneShot / 600 < 0.2, (oneShot / 600).toFixed(3));
    check('никому не нужно больше 3 попаданий', Math.max(...hits) <= 3, Math.max(...hits));
  });
  return T_.checks;
})();
