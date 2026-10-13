// «Выживание»: карта по seed, волны (размер, появление вне видимости и не ближе 25 м, оружие по волнам, к центру),
// грузовик (когда приезжает, пауза, пополнение и броня, медик, боты сами, отъезд), эвакуация и конец
window.__result = (() => {
  const { check, run, at } = T_;
  const squad = [{ slot: 0, human: true, name: 'Тест' }];
  const tick = (n, fn) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; updateWorld(1 / 60); if (fn && fn(i) === false) return; } };

  run('карта', () => {
    startMap('surv', 31337, squad, true);
    const a = map.grid.join('');
    startMap('surv', 31337, squad, true);
    check('процедурная: тот же seed — та же карта, другой — другая', map.grid.join('') === a && (() => { startMap('surv', 31338, squad, true); return map.grid.join('') !== a; })());
    startMap('surv', 31337, squad, true);
    const { cx } = map.surv;
    let road = true;
    for (let y = 1; y < map.h - 1; y++) for (let x = cx - 2; x <= cx + 1; x++) if (!walkable(x, y)) road = false;
    check('80×60, дорога для грузовика свободна с юга до севера', map.w === 80 && map.h === 60 && road);
    check('отряд в центре, без брони; волны ещё нет', G.players.every((q) => !q.armor) && G.surv.wave === 0 && G.enemies.length === 0);
    check('погода выбрана', !!G.weather && WEATHER_IDS.includes(G.weather.kind), G.weather && G.weather.kind);
  });

  run('волны', () => {
    startMap('surv', 4242, squad, true);
    const p = me(); p.god = true;
    G.players.forEach((q) => { q.god = true; });
    const bad = [], spawnedAt = new Map();
    let all = 0;
    tick(60 * 26, () => {
      for (const e of G.enemies) {
        if (spawnedAt.has(e)) continue;
        spawnedAt.set(e, { x: e.x, y: e.y, t: G.time });
        all++;
        for (const q of G.players) {
          if (q.dead) continue;
          if (los(q.x, q.y, e.x, e.y)) bad.push(['видит', Math.round(e.x / TILE), Math.round(e.y / TILE)]);
          if (Math.hypot(q.x - e.x, q.y - e.y) < SURV.spawnMin - 2) bad.push(['близко', (Math.hypot(q.x - e.x, q.y - e.y) / PX_M).toFixed(1)]);
        }
      }
    });
    check('волна 1 — 4 противника; появились вне видимости отряда и не ближе 25 м', all === SURV.size(1) && !bad.length, [all, bad.slice(0, 4)]);
    const { cx, cy } = map.surv;
    const closer = [...spawnedAt].filter(([e, s0]) => Math.hypot(e.x - cx * TILE, e.y - cy * TILE) < Math.hypot(s0.x - cx * TILE, s0.y - cy * TILE) - M(3)).length;
    check('противники идут к центру (хотя бы половина за 18 с)', closer >= 2, closer);
    check('волна 1 — только пистолеты', [...spawnedAt.keys()].every((e) => !e.kit[0] && !e.kit[1] && e.gun.t === 'm1911'));
    check('размер растёт: 4, 6, 8, 10…', [1, 2, 3, 4, 5].map(SURV.size).join() === '4,6,8,10,12');
    check('грузовик — после волн 3, 6, 9, 12, дальше — каждой второй', [3, 6, 9, 12, 14, 16].every(SURV.truckDue) && ![1, 2, 4, 5, 13, 15].some(SURV.truckDue));
    // оружие по волнам (много раз)
    const rnd = makeRng(5), e = makeEnemy(0, 0, 0, null);
    const kinds = (n) => { const out = new Set(); for (let i = 0; i < 60; i++) { kitForWave(e, n, rnd); out.add(e.kit.map((k) => k && k.t).join()); } return [...out]; };
    const k3 = kinds(3), k5 = kinds(5);
    check('волны 3–4: пистолет или ружьё + пистолет', k3.every((s) => s === ',,m1911' || s === 'w1300,,m1911') && k3.length === 2, k3);
    check('волна 5+: наборы как на других картах (винтовки тоже)', k5.some((s) => s.includes('m4a1') || s.includes('akm')), k5.slice(0, 4));
  });

  run('грузовик', () => {
    startMap('surv', 777, squad, true);
    const p = me();
    G.players.forEach((q) => { q.god = true; q.hp = 60; });
    // волна 3 отбита — грузовик
    G.surv.wave = 2; G.surv.phase = 'break'; G.surv.t = 0;
    tick(2);
    G.enemies.forEach((e) => { e.dead = true; }); G.surv.toSpawn = 0;
    tick(2);
    check('после волны 3 — грузовик, броня — IIIA', G.surv.phase === 'truck' && G.surv.trucks === 1, [G.surv.phase, G.surv.trucks]);
    tick(60 * (SURV.drive + SURV.medicWalk) + 30);
    const tr = G.surv.truck;
    check('въехал и стоит; на месте стоянки — препятствие; медик вышел', tr.state === 'park' && !walkable(map.surv.cx, Math.round(tr.fy) + 3) && G.surv.medic.state === 'stand',
      [tr.state, G.surv.medic.state]);
    // пауза: волна не начинается, пока ждут
    tick(60 * 20);
    check('пока стоит грузовик — пауза (волна не начинается)', G.surv.phase === 'truck' && G.surv.wave === 3);
    // игрок: к заднему борту — пополнить; к медику — вылечиться
    const r = truckRear();
    p.x = p.px = r.x; p.y = p.py = r.y + M(0.3);
    p.gun.mag = 1; p.gun.pouch = [];
    doAct(p, 'supply');
    tick(Math.round(SURV.supplyT * 60) + 3);
    check('пополнил: полный боекомплект и броня IIIA целая', p.armor && p.armor.cls === 'IIIA' && p.armor.hp === 100 && p.gun.pouch.length === WEAPONS[p.gun.t].mags - 1,
      [p.armor, p.gun.pouch.length]);
    const md = G.surv.medic;
    // подождать, пока медик освободится (его могут занимать боты)
    tick(60 * 15, () => !md.heal);
    p.x = p.px = md.x + M(1); p.y = p.py = md.y;
    doAct(p, 'heal');
    check('у медика — лечение (медик занят им)', p.act && p.act.kind === 'heal' && md.heal === p.id);
    tick(Math.round(SURV.healT * 60) + 3);
    check('вылечен: здоровье полное', p.hp === HP);
    // боты отряда — сами: пополнились и вылечились, после этого грузовик уехал
    tick(60 * 60, () => G.surv.phase === 'truck');
    const bots = G.players.filter((q) => q.ai);
    check('боты сами пополнились (броня IIIA) и вылечились', bots.every((q) => q.armor && q.armor.cls === 'IIIA' && q.hp === HP), bots.map((q) => [q.armor && q.armor.cls, Math.round(q.hp)]));
    check('все готовы — грузовик уехал, стоянка снова свободна, перерыв', G.surv.phase === 'break' && walkable(map.surv.cx, map.surv.cy), G.surv.phase);
    // второй приезд — броня III
    G.surv.wave = 5; G.surv.phase = 'break'; G.surv.t = 0; tick(2);
    G.enemies.forEach((e) => { e.dead = true; }); G.surv.toSpawn = 0; tick(2);
    check('второй приезд — броня III', G.surv.trucks === 2 && ARMOR_ORDER[Math.min(G.surv.trucks, 4)] === 'III');
  });

  run('покинуть боевую зону', () => {
    startMap('surv', 778, squad, false);
    const p = me(); p.god = true;
    G.surv.wave = 2; G.surv.phase = 'break'; G.surv.t = 0; tick(2);
    G.enemies.forEach((e) => { e.dead = true; }); G.surv.toSpawn = 0; tick(2);
    tick(60 * (SURV.drive + SURV.medicWalk) + 30);
    const r = truckRear();
    p.x = p.px = r.x; p.y = p.py = r.y + M(0.3);
    doAct(p, 'evac');
    tick(5);
    check('хост выбрал «покинуть боевую зону» — весь отряд в хабе', G.mapId === 'hub' && !G.surv, [G.mapId, !!G.surv]);
    // гибель всего отряда — экран итогов с числом отбитых волн
    startMap('surv', 778, squad, false);
    G.surv.wave = 3; G.surv.phase = 'wave'; me().dead = true; tick(2);
    check('отряд погиб — конец', G.state === 'dead');
    G.cam.x = me().x; G.cam.y = me().y; G.stateT = 2; render(1 / 60);
    check('экран итогов рисуется', true);
  });
  return T_.checks;
})();
