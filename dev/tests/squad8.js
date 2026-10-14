// Отряд 2–8 мест (лобби, карта, цвета), замедление от брони, выбор у грузовика (стволы — открытые к волне, броня — до привезённой).
window.__result = (() => {
  const { check, run, at, step, tick } = T_;
  const solo = [{ slot: 0, human: true, name: 'Тест' }];

  run('места в отряде', () => {
    check('лобби: 2 и 8 мест', emptySlots(2).length === 2 && emptySlots(8).length === 8 && emptySlots(1).length === 2 && emptySlots(12).length === 8);
    const sel = document.getElementById('slotsN');
    check('в главном меню — выбор 2–8', !!sel && [...sel.options].map((o) => o.value).join() === '2,3,4,5,6,7,8');
    sel.value = '6'; sel.dispatchEvent(new Event('change'));
    check('выбор запоминается и задаёт размер лобби', Lobby.size === 6 && emptySlots().length === 6);
    for (const n of [2, 8]) {
      G.squadSize = n;
      startMap('clear', 7, solo, true);
      check(`${n} мест: на карте ${n} бойцов (люди + боты), разные цвета`, G.players.length === n && new Set(G.players.map((q) => SLOT_COLORS[q.slot])).size === n,
        G.players.length);
    }
    G.squadSize = 8;
    startMap('assault', assaultSeed(4242, 1, firstCount(8)), solo, true);
    const f = assaultFirst(G.mapSeed);
    check('«Штурм» на 8: первая локация — 0,8–1,2 × 8 противников', G.enemies.length === f && f >= 6 && f <= 10, [G.enemies.length, f]);
    startMap('assault', assaultSeed(G.mapSeed, 2), solo, true);
    check('вторая локация — на 2 больше первой (размер — в seed)', G.enemies.length === f + 2 && assaultStage(G.mapSeed) === 2, [G.enemies.length, f]);
    G.squadSize = 4;
    sel.value = '4'; sel.dispatchEvent(new Event('change'));
  });

  run('замедление от брони', () => {
    startRange();
    const p = me();
    G.enemies = [];
    const run1 = (cls) => {
      at(p, 36, 40); giveArmor(p, cls); p.sprintLock = 0; p.crouchToggle = false;
      const y0 = p.y; G.cam.x = p.x; G.cam.y = p.y;
      keys.KeyW = true; step(60); keys.KeyW = false; step(1);
      return (y0 - p.y) / PX_M;
    };
    const v0 = run1(null), v1 = run1('IIIA'), v4 = run1('IV');
    check('IIIA — чуть медленнее (−2%), IV — заметнее (−10%), не сильно', v1 < v0 && v4 < v1 && v4 > v0 * 0.85 && Math.abs(v4 / v0 - ARMOR.IV.speed) < 0.03,
      [v0.toFixed(2), v1.toFixed(2), v4.toFixed(2)]);
    giveArmor(p, null);
    const e = makeEnemy(36 * TILE, 30 * TILE, 0, null);
    const mv = (cls) => { e.x = 36 * TILE; e.y = 30 * TILE; giveArmor(e, cls); const x0 = e.x; for (let i = 0; i < 30; i++) moveDir(e, 0, 2, 1 / 60); return e.x - x0; };
    check('ИИ в броне тоже медленнее', mv('IV') < mv(null) * 0.95);
  });

  run('грузовик: выбор оружия и брони', () => {
    startMap('surv', 5, solo, false);
    const p = me(), s = G.surv;
    s.trucks = 2; s.wave = 3;
    let off = truckOffer(p);
    check('волна 3: из стволов — ружьё (и свои), броня — до III', off.prim.includes('w1300') && !off.prim.includes('m249') && !off.prim.includes('ak74') &&
      off.armors.join() === ',IIIA,III', [off.prim, off.armors]);
    truckSupply(p, ['w1300', '', 'tt', 'IIIA']);
    check('взял ружьё + ТТ, броня IIIA', p.kit.map((k) => k && k.t).join() === 'w1300,,tt' && p.armor.cls === 'IIIA', p.kit.map((k) => k && k.t));
    truckSupply(p, ['m249', '', 'm1911', 'IV']);
    check('неоткрытый ствол и непривезённая броня — не дают (стволы те же, броня — лучшая доступная)', p.kit[0].t === 'w1300' && p.armor.cls === 'III',
      [p.kit[0].t, p.armor.cls]);
    truckSupply(p, ['w1300', '', 'tt', '']);
    check('можно и без брони (быстрее)', !p.armor);
    s.wave = 9; s.trucks = 4;
    off = truckOffer(p);
    check('волна 9: открыты все стволы, броня до IV', PRIMARY_IDS.every((t) => off.prim.includes(t)) && off.armors[4] === 'IV');
    truckSupply(p, ['m249', 'fal', 'hipower', 'III+']);
    check('взял M249 + FN FAL + Hi-Power, III+, полный боекомплект', p.kit.map((k) => k && k.t).join() === 'm249,fal,hipower' && p.armor.cls === 'III+' &&
      ammoTotal(p.kit[0]) === WEAPONS.m249.mag * WEAPONS.m249.mags);
    truckSupply(p, null);
    check('без выбора (боты): те же стволы, лучшая броня', p.kit[0].t === 'm249' && p.armor.cls === 'IV');
    // меню у борта: списки собраны из доступного
    s.wave = 5; s.trucks = 1;
    giveKit(p, 'm4a1', null);
    openTruckMenu();
    const opts = (id) => [...document.getElementById(id).options].map((o) => o.value);
    check('меню у борта: стволы волны 5 (+ свои), пистолеты, броня до IIIA', opts('tmW1').includes('ak74') && !opts('tmW1').includes('m249') && !opts('tmW1').includes('fal') &&
      opts('tmP').join() === PISTOL_IDS.join() && opts('tmArmor').join() === ',IIIA', [opts('tmW1'), opts('tmArmor')]);
    closeTruckMenu();
  });

  run('волны: оружие противников — по той же лестнице', () => {
    const e = makeEnemy(0, 0, 0, null), rnd = makeRng(3);
    const seen = (n) => { const out = new Set(); for (let i = 0; i < 300; i++) { kitForWave(e, n, rnd); for (const k of e.kit.slice(0, 2)) if (k) out.add(k.t); } return out; };
    const w5 = seen(5), w9 = seen(9);
    check('волна 5: без пулемётов и FAL', !w5.has('m249') && !w5.has('fal') && !w5.has('rpk74') && w5.has('m4a1'), [...w5]);
    check('волна 9: и M249', w9.has('m249') && w9.has('fal'), [...w9]);
  });
  return T_.checks;
})();
