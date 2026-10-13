// «Штурм»: генерация локаций (форма, площадь по числу противников, двери и ключи — решаемо, переход), переход на следующую
// (состояние отряда переносится), грузовик на 3-й, Enter — та же локация; подкрепление (и в «Выживании»); «покинуть боевую зону» — в хаб
window.__result = (() => {
  const { check, run } = T_;
  const squad = [{ slot: 0, human: true, name: 'Тест' }];
  const tick = (n, fn) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; updateWorld(1 / 60); if (fn && fn(i) === false) return; } };
  const floorN = () => map.grid.reduce((s, t, i) => s + (t === T.FLOOR || t === T.DOOR || t === T.LOW ? 1 : 0), 0);

  run('генерация', () => {
    const shapes = new Set(), bad = [];
    let a1 = 0, a8 = 0;
    for (let k = 0; k < 24; k++) {
      const base = 1000 + k * 37;
      startMap('assault', assaultSeed(base, 1), squad, false);
      shapes.add(map.assault.shape);
      a1 += floorN();
      if (G.enemies.length !== ASSAULT.enemies(1)) bad.push(['число', G.enemies.length]);
      const st = me();
      for (const e of G.enemies) if (los(e.x, e.y, st.x, st.y)) bad.push(['видит старт', k]);
      // ключи: каждый запертой двери — есть, и дойти до него можно, не открывая ни одной запертой
      const reach = bfsFrom(st.x, st.y, 1e9, true);
      for (const d of map.doors.filter((q) => q.locked)) {
        const key = map.keys.find((q) => q.id === d.key);
        if (!key) { bad.push(['нет ключа', d.key]); continue; }
        if (reach.f[tileIndex(key.x, key.y)] >= 1e9) bad.push(['ключ недоступен', d.key]);
      }
      const ex = map.exit;
      if (reach.f[(ex.y0) * map.w + ex.x0 + 1] >= 1e9) bad.push(['переход недоступен', k]);
      startMap('assault', assaultSeed(base, 8), squad, false);
      a8 += floorN();
    }
    check('противников — по номеру локации; никто не видит старт; ключи доступны; переход проходим', !bad.length, bad.slice(0, 5));
    check('формы разные (прямоугольник, квадрат, Г, Т, крест, П)', shapes.size >= 4, [...shapes]);
    check('больше противников — больше площадь (локация 8 против 1)', a8 > a1 * 1.3, [a1, a8]);
    check('противников на 8-й больше', ASSAULT.enemies(8) > ASSAULT.enemies(1), [ASSAULT.enemies(1), ASSAULT.enemies(8)]);
    startMap('assault', assaultSeed(55, 1), squad, false);
    const g1 = map.grid.join('');
    startMap('assault', assaultSeed(55, 1), squad, false);
    check('тот же seed — та же локация', map.grid.join('') === g1);
  });

  run('переход на следующую', () => {
    startMap('assault', assaultSeed(4321, 1), squad, true);
    const p = me();
    p.hp = 70; giveArmor(p, 'III'); p.armor.hp = 55; p.gun.mag = 9;
    const bot = G.players.find((q) => q.ai); bot.dead = true;
    G.enemies.forEach((e) => { e.dead = true; });
    tick(2);
    check('все уничтожены — переход открыт', G.surv.phase === 'exit', G.surv.phase);
    const ex = map.exit;
    p.x = p.px = (ex.x0 + 2.5) * TILE; p.y = p.py = (ex.y0 + 0.5) * TILE;
    tick(60 * 2 + 10);
    check('хост 2 с в переходе — локация 2', G.mapId === 'assault' && G.surv.stage === 2, G.surv.stage);
    const p2 = me(), b2 = G.players.find((q) => q.slot === bot.slot);
    check('здоровье, броня, патроны — как были', p2.hp === 70 && p2.armor && p2.armor.cls === 'III' && p2.armor.hp === 55 && p2.gun.mag === 9,
      [p2.hp, p2.armor, p2.gun.mag]);
    check('погибший товарищ — снова в строю (50 здоровья)', b2 && !b2.dead && b2.hp === 50, b2 && [b2.dead, b2.hp]);
    // Enter — та же локация, тем же составом
    const g2 = map.grid.join('');
    p2.hp = 10;
    restartRange();
    check('Enter — та же локация, отряд — как в её начале', map.grid.join('') === g2 && me().hp === 70 && G.surv.stage === 2);
  });

  run('грузовик на 3-й', () => {
    G.assaultCarry = null;                                      // без отряда из прошлого прогона
    startMap('assault', assaultSeed(4321, 3), squad, false);
    const p = me(); p.god = true;
    G.enemies.forEach((e) => { e.dead = true; });
    tick(2);
    check('3-я зачищена — грузовик', G.surv.phase === 'truck', G.surv.phase);
    tick(60 * (SURV.drive + SURV.medicWalk) + 30);
    check('стоит у старта (стоянка — препятствие)', G.surv.truck.state === 'park' && !walkable(map.truck.cx, Math.round(G.surv.truck.fy) + 3));
    const r = truckRear();
    p.x = p.px = r.x; p.y = p.py = r.y + M(0.3);
    doAct(p, 'supply'); tick(Math.round(SURV.supplyT * 60) + 3);
    check('пополнился — броня IIIA', p.armor && p.armor.cls === 'IIIA');
    tick(60 * 30, () => G.surv.phase === 'truck');
    check('уехал — переход открыт', G.surv.phase === 'exit', G.surv.phase);
    // покинуть боевую зону (хост) — в хаб
    G.surv.phase = 'fight'; G.enemies = []; startMap('assault', assaultSeed(4321, 3), squad, false);
    G.enemies.forEach((e) => { e.dead = true; }); tick(2); tick(60 * (SURV.drive + SURV.medicWalk) + 30);
    const r2 = truckRear(); me().x = me().px = r2.x; me().y = me().py = r2.y + M(0.3);
    doAct(me(), 'evac'); tick(2);
    check('«покинуть боевую зону» (хост) — весь отряд в хабе', G.mapId === 'hub');
  });

  run('подкрепление', () => {
    for (const mode of ['assault', 'surv']) {
      if (mode === 'assault') startMap('assault', assaultSeed(77, 2), squad, true);
      else { startMap('surv', 77, squad, true); G.surv.wave = 4; G.surv.phase = 'break'; G.surv.t = 0; tick(2); }
      G.players.forEach((q) => { q.god = true; });
      const s = G.surv, base = s.reinf.base;
      s.reinf.on = true;                                         // выпало (шанс 20%)
      const n0 = G.enemies.length;
      tick(60 * 2);
      check(`${mode}: до тревоги — не приходит`, G.enemies.length === n0 && s.reinf.alarmAt === null);
      const e0 = G.enemies.find((e) => !e.dead);
      e0.st = 2; e0.lastX = me().x; e0.lastY = me().y; e0.lastSeen = G.time;
      tick(2);
      check(`${mode}: тревога замечена — назначен момент в 3–60 с`, s.reinf.alarmAt !== null && s.reinf.at - s.reinf.alarmAt >= 3 && s.reinf.at - s.reinf.alarmAt <= 60);
      s.reinf.at = G.time + 0.5;                                   // не ждать (отряд может перебить всех раньше)
      tick(60, () => !s.reinf.done);
      const add = G.enemies.filter((e) => e.reinf);
      const squadNow = G.players.filter((q) => !q.dead);
      const seenAtSpawn = add.some((e) => squadNow.some((q) => los(q.x, q.y, e.x, e.y) && Math.hypot(q.x - e.x, q.y - e.y) < M(20)));
      check(`${mode}: после тревоги — отряд ≤ 30% от исходных (${base}), в тревоге, сообщение по рации`,
        add.length >= 1 && add.length <= Math.max(1, Math.floor(base * 0.3)) && add.every((e) => e.st === 2) && !!G.radioMsg,
        [add.length, base, G.radioMsg && G.radioMsg.text]);
      check(`${mode}: появились не на виду у отряда`, !seenAtSpawn);
    }
    // «Выживание»: шанс бросается в начале волны, после конца волны — не приходит
    startMap('surv', 78, squad, false);
    G.surv.wave = 0; G.surv.phase = 'break'; G.surv.t = 0; tick(2);
    check('«Выживание»: шанс — в начале волны', !!G.surv.reinf && G.surv.reinf.base === SURV.size(1));
    G.surv.reinf.on = true; G.enemies.forEach((e) => { e.dead = true; }); G.surv.toSpawn = 0; tick(2);
    check('волна кончилась — подкрепления уже не будет', G.surv.reinf.done && !G.enemies.some((e) => e.reinf));
  });
  return T_.checks;
})();
