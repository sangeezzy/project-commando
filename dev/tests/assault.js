// «Штурм»: генерация локаций (форма, площадь по числу противников, двери и ключи — решаемо, переход), переход на следующую
// (состояние отряда переносится, погибшие — нет; их привозит грузовик), грузовик на 3-й, Enter в забеге не перезапускает;
// подкрепление (и в «Выживании»); забег: счёт, итоги, «покинуть боевую зону» — победа, Backspace и гибель — поражение, всё — в хаб
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
      if (G.enemies.length !== assaultEnemies(G.mapSeed)) bad.push(['число', G.enemies.length]);
      const st = me();
      for (const e of G.enemies) if (los(e.x, e.y, st.x, st.y)) bad.push(['видит старт', k]);
      // ключи: каждый запертой двери — есть, и дойти до него можно, не открывая ни одной запертой
      const reach = bfsFrom(st.x, st.y, 1e9, true);
      for (const d of map.doors.filter((q) => q.locked)) {
        const key = map.keys.find((q) => q.id === d.key);
        if (!key) { bad.push(['нет ключа', d.key]); continue; }
        if (reach.f[tileIndex(key.x, key.y)] >= 1e9) bad.push(['ключ недоступен', d.key]);
      }
      const ex = map.exit, g = map.gate;
      // ворота — не двери: в map.doors их нет, ряд клеток — стена до зачистки
      if (!g || g.open || g.y !== ex.y1 + 1 || g.x0 !== ex.x0 || g.x1 !== ex.x1) bad.push(['нет ворот', k]);
      else for (let x = g.x0; x <= g.x1; x++) if (tileAt(x, g.y) !== T.WALL || map.doorAt.has(g.y * map.w + x)) bad.push(['ворота — не стена / дверь', k, x]);
      if (reach.f[(ex.y0) * map.w + ex.x0 + 1] < 1e9) bad.push(['в переход — мимо ворот', k]);
      if (reach.f[(ex.y1 + 2) * map.w + ex.x0 + 1] >= 1e9) bad.push(['до ворот не дойти', k]);
      openAssaultGate();
      if (bfsFrom(st.x, st.y, 1e9, true).f[(ex.y0) * map.w + ex.x0 + 1] >= 1e9) bad.push(['переход недоступен', k]);
      startMap('assault', assaultSeed(base, 8), squad, false);
      a8 += floorN();
    }
    check('противников — по номеру локации; никто не видит старт; ключи доступны; переход — за запертыми воротами, проходим', !bad.length, bad.slice(0, 5));
    check('формы разные (прямоугольник, квадрат, Г, Т, крест, П)', shapes.size >= 4, [...shapes]);
    check('больше противников — больше площадь (локация 8 против 1)', a8 > a1 * 1.3, [a1, a8]);
    check('противников на 8-й больше', ASSAULT.enemies(8) > ASSAULT.enemies(1), [ASSAULT.enemies(1), ASSAULT.enemies(8)]);
    startMap('assault', assaultSeed(55, 1), squad, false);
    const g1 = map.grid.join('');
    startMap('assault', assaultSeed(55, 1), squad, false);
    check('тот же seed — та же локация', map.grid.join('') === g1);
  });

  run('ворота перехода — не двери', () => {
    startMap('assault', assaultSeed(777, 1), squad, false);
    const g = map.gate, p = me();
    p.x = p.px = ((g.x0 + g.x1 + 1) / 2) * TILE; p.y = p.py = (g.y + 1.5) * TILE;
    check('перед воротами — ни двери (F), ни выбивания', !doorNear(p) && touchUseLabel(p) === null, touchUseLabel(p));
    check('закрытые: не видно и не пройти', !los(p.x, p.y, p.x, (g.y - 1) * TILE) && solidTile(g.x0 + 2, g.y));
    // гость: фаза перехода пришла снимком — ворота открываются у него сами
    G.surv.phase = 'exit';
    assaultGateSync();
    check('фаза «переход» (гость) — ворота открыты', g.open && !solidTile(g.x0 + 2, g.y) && los(p.x, p.y, p.x, (g.y - 1) * TILE));
  });

  run('переход на следующую', () => {
    startMap('assault', assaultSeed(4321, 1), squad, true);
    const p = me();
    p.hp = 70; giveArmor(p, 'III'); p.armor.hp = 55; p.gun.mag = 9;
    const bot = G.players.find((q) => q.ai); bot.dead = true;
    G.enemies.forEach((e) => { e.dead = true; });
    tick(2);
    check('все уничтожены — переход открыт', G.surv.phase === 'exit', G.surv.phase);
    const gt = map.gate;
    check('ворота перехода открылись (клетки — пол)', gt.open && [...Array(gt.x1 - gt.x0 + 1)].every((_, i) => tileAt(gt.x0 + i, gt.y) === T.FLOOR));
    let gerr = null; try { render(1 / 60); G.time += GATE_T; render(1 / 60); } catch (e) { gerr = String(e); }
    check('ворота рисуются (закрываются / открываются) без ошибок', !gerr, gerr);
    const ex = map.exit;
    p.x = p.px = (ex.x0 + 2.5) * TILE; p.y = p.py = (ex.y0 + 0.5) * TILE;
    tick(60 * 2 + 10);
    check('хост 2 с в переходе — локация 2', G.mapId === 'assault' && G.surv.stage === 2, G.surv.stage);
    const p2 = me(), b2 = G.players.find((q) => q.slot === bot.slot);
    check('здоровье, броня, патроны — как были', p2.hp === 70 && p2.armor && p2.armor.cls === 'III' && p2.armor.hp === 55 && p2.gun.mag === 9,
      [p2.hp, p2.armor, p2.gun.mag]);
    check('погибший товарищ на новую локацию не попал', b2 && b2.dead, b2 && [b2.dead, b2.hp]);
    check('счёт забега: зачищена 1 локация', G.run && G.run.cleared === 1, G.run);
    // Enter в забеге — ничего (забег кончается только в хабе)
    const seq = G.seq;
    restartRange();
    check('Enter в забеге не перезапускает', G.seq === seq && G.surv.stage === 2);
    // погода: следующая локация начинает с текущей и плавно переходит к своей (как волны «Выживания»)
    G.weather.vis = 0.37; G.weather.rain = 0.61;
    nextStage();
    check('погода на новой локации — плавно от прошлой (не скачком)', Math.abs(G.weather.vis - 0.37) < 0.01 && Math.abs(G.weather.rain - 0.61) < 0.01,
      [G.weather.vis.toFixed(2), G.weather.rain.toFixed(2), G.weather.kind]);
    tick(60 * 10);
    const W = WEATHER[G.weather.kind];
    check('…и за ~10 с подходит к погоде новой локации', Math.abs(G.weather.vis - W.vis) < 0.1, [G.weather.vis.toFixed(2), W.vis]);
    // грузовик привозит погибшего
    G.surv.phase = 'fight'; G.surv.stage = 3; p2.god = true;
    G.enemies.forEach((e) => { e.dead = true; });
    tick(2); tick(60 * SURV.drive + 10);
    const b3 = G.players.find((q) => q.slot === bot.slot);
    check('грузовик приехал — погибший снова в строю у борта, здоровье полное', G.surv.truck && G.surv.truck.state === 'park' && !b3.dead && b3.hp === HP &&
      Math.hypot(b3.x - truckRear().x, b3.y - truckRear().y) < M(5), [b3.dead, b3.hp]);
  });

  run('забег: счёт и итоги', () => {
    // из хаба — всегда 1-я локация
    startMap('hub', 0, squad, true);
    const ex = HUB_EXITS.find((e) => e.map === 'assault');
    me().x = me().px = (ex.x0 + 2.5) * TILE; me().y = me().py = (ex.y0 + 0.5) * TILE;
    tick(60 * HUB_HOLD + 10);
    check('из хаба — «Штурм» с 1-й локации, счёт с нуля', G.mapId === 'assault' && G.surv.stage === 1 && G.run && G.run.cleared === 0 && G.run.kills === 0,
      [G.mapId, G.surv && G.surv.stage, G.run]);
    const sq = G.players.length, f1 = assaultFirst(G.mapSeed);
    check('противников на 1-й — 0,8–1,2 × отряда (в seed), с пистолетами', G.enemies.length === f1 && f1 >= Math.round(sq * 0.8) && f1 <= Math.round(sq * 1.2) &&
      G.enemies.every((e) => !e.kit[0]), [G.enemies.length, f1, sq]);
    me().god = true;
    killPerson(G.enemies[0]); killPerson(G.enemies[1]);
    const bot = G.players.find((q) => q.ai); killPerson(bot);
    check('убито 2, потеря 1', G.run.kills === 2 && G.run.losses === 1, G.run);
    // Backspace — поражение, итоги в хабе
    pressed.Backspace = true; T_.step(1);
    check('Backspace — в хаб, итоги: поражение, убито 2, потерь 1', G.mapId === 'hub' && G.runResult && !G.runResult.win && G.runResult.kills === 2 && G.runResult.losses === 1 && !G.run,
      G.runResult);
    G.cam.x = me().x; G.cam.y = me().y; render(1 / 60);
    // новый забег — счёт с нуля
    startMap('assault', assaultSeed(99, 1), squad, true);
    check('новый забег — счёт с нуля, итоги убраны', G.run && G.run.kills === 0 && G.run.losses === 0 && !G.runResult);
    // гибель отряда — экран, потом хаб с поражением
    me().god = false; killPerson(me());
    tick(2);
    check('отряд погиб — экран итогов', G.state === 'dead');
    G.cam.x = me().x; G.cam.y = me().y; G.stateT = 2; render(1 / 60);
    for (let i = 0; i < 60 * (RUN_DEAD_T + 1) && G.mapId !== 'hub'; i++) T_.step(1);
    check(`через ${RUN_DEAD_T} с — хаб, поражение`, G.mapId === 'hub' && G.runResult && !G.runResult.win && G.runResult.losses >= 1, [G.mapId, G.runResult]);
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
    const dr = truckDriver(); p.x = p.px = dr.x; p.y = p.py = dr.y;
    doAct(p, 'truckgo');                                         // отпустить у водительской двери
    tick(60 * 30, () => G.surv.phase === 'truck');
    check('уехал — переход открыт', G.surv.phase === 'exit', G.surv.phase);
    // покинуть боевую зону (хост) — в хаб
    G.surv.phase = 'fight'; G.enemies = []; G.run = null; startMap('assault', assaultSeed(4321, 3), squad, false);
    G.enemies.forEach((e) => { e.dead = true; }); tick(2); tick(60 * (SURV.drive + SURV.medicWalk) + 30);
    const r2 = truckRear(); me().x = me().px = r2.x; me().y = me().py = r2.y + M(0.3);
    doAct(me(), 'evac'); tick(2);
    check('«покинуть боевую зону» (хост) — весь отряд в хабе, итоги: успех, зачищено 1', G.mapId === 'hub' && G.runResult && G.runResult.win && G.runResult.cleared === 1, G.runResult);
  });

  run('подкрепление', () => {
    for (const mode of ['assault', 'surv']) {
      if (mode === 'assault') startMap('assault', assaultSeed(77, 2), squad, true);
      else { startMap('surv', 77, squad, true); G.surv.wave = 4; G.surv.phase = 'break'; G.surv.t = 0; tick(2); }
      G.players.forEach((q) => { q.god = true; });
      const s = G.surv, base = s.reinf.base;
      s.reinf.on = true;                                         // выпало (шанс 20%)
      const n0 = G.enemies.length;
      // 2 с все стоят на месте: появились вне видимости отряда — тревогу поднять некому (а не «повезло с местом появления»)
      const pos = allPeople().map((o) => [o, o.x, o.y]);
      tick(60 * 2, () => { for (const [o, x, y] of pos) { o.x = o.px = x; o.y = o.py = y; } });
      check(`${mode}: до тревоги — не приходит`, G.enemies.length === n0 && s.reinf.alarmAt === null, [n0, G.enemies.length, s.reinf.alarmAt, G.enemies.filter((e) => e.st === 2).length]);
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
    check('«Выживание»: шанс — в начале волны', !!G.surv.reinf && G.surv.reinf.base === SURV.size(1, G.surv.first));
    G.surv.reinf.on = true; G.enemies.forEach((e) => { e.dead = true; }); G.surv.toSpawn = 0; tick(2);
    check('волна кончилась — подкрепления уже не будет', G.surv.reinf.done && !G.enemies.some((e) => e.reinf));
  });
  return T_.checks;
})();
