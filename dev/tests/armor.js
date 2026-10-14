// Броня (NIJ): кто что держит, износ по калибру, изношенная и разбитая плита, отображение; быстрая перезарядка (RR) — у игрока и у ИИ
window.__result = (() => {
  const { check, run, at, dummy } = T_;
  const p = me();
  G.enemies.forEach(dummy);
  const shoot = (o, t, n = 400) => {
    // n попаданий оружием t: сколько плита удержала, сколько пробита, сколько мимо плиты; средний урон по удержанным
    let stop = 0, thr = 0, miss = 0;
    for (let i = 0; i < n; i++) { o.armor.hp = 100; const r = armorHit(o, WEAPONS[t], 1); if (r === 'stop') stop++; else if (r === 'through') thr++; else miss++; }
    return { stop, thr, miss };
  };

  run('кто что держит', () => {
    const o = makeEnemy(0, 0, 0, null);
    giveArmor(o, 'IIIA');
    const a = shoot(o, 'm1911'), b = shoot(o, 'w1300'), c = shoot(o, 'akm'), d = shoot(o, 'm4a1');
    check('IIIA держит .45 и картечь, плита закрывает ~70% попаданий', a.thr === 0 && b.thr === 0 && a.stop > 240 && a.stop < 320, [a, b]);
    check('IIIA не держит винтовочные (7,62×39, 5,56)', c.stop === 0 && d.stop === 0 && c.thr > 240, [c, d]);
    giveArmor(o, 'III');
    const e = shoot(o, 'akm'), f = shoot(o, 'm4a1');
    check('III держит 7,62×39, но не 5,56 M855', e.thr === 0 && e.stop > 0 && f.stop === 0, [e, f]);
    giveArmor(o, 'III+');
    check('III+ держит и 5,56 M855', shoot(o, 'm4a1').thr === 0);
    giveArmor(o, 'IV');
    check('IV держит всё, что есть в игре', ['m1911', 'w1300', 'akm', 'm4a1'].every((t) => shoot(o, t).thr === 0));
  });

  run('износ и урон', () => {
    const o = makeEnemy(0, 0, 0, null);
    giveArmor(o, 'IV');
    const wear = (t) => { o.armor.hp = 100; let n = 0; while (o.armor.hp === 100 && n < 50) { armorHit(o, WEAPONS[t], 1); n++; } return 100 - o.armor.hp; };
    check('износ по калибру: 7,62×39 > 5,56 > .45 > дробина', wear('akm') > wear('m4a1') && wear('m4a1') > wear('m1911') && wear('m1911') > wear('w1300'),
      ['akm', 'm4a1', 'm1911', 'w1300'].map(wear));
    giveArmor(o, 'IIIA');
    // плита закрывает корпус с вероятностью ARMOR_HIT.cover — стрелять, пока не попадёт в неё (было: один выстрел, 30% — мимо плиты)
    let pen = 0;
    for (let i = 0; i < 50 && !pen; i++) { o.armor.hp = 100; if (armorHit(o, WEAPONS.m4a1, 1)) pen = 100 - o.armor.hp; }
    o.armor.hp = 100;
    let s = 0; while (o.armor.hp === 100) { if (armorHit(o, WEAPONS.m1911, 1)) s = 100 - o.armor.hp; }
    check('пробитая плита изнашивается сильнее удержавшей (на тот же калибр)', pen > 0 && pen >= WEAPONS.m4a1.armorDmg * ARMOR_HIT.overK - 0.01, [pen, s]);
    // изношенная (ниже 25) иногда не держит даже «свою» угрозу; разбитая — не защищает совсем
    giveArmor(o, 'IIIA');
    let thr = 0, tot = 0;
    for (let i = 0; i < 600; i++) { o.armor.hp = 10; const r = armorHit(o, WEAPONS.m1911, 1); if (r) tot++; if (r === 'through') thr++; }
    check('изношенная (10 из 100) пробивается .45 часто', thr / tot > 0.4 && thr / tot < 0.8, (thr / tot).toFixed(2));
    o.armor.hp = 0;
    let any = 0; for (let i = 0; i < 100; i++) if (armorHit(o, WEAPONS.m1911, 1)) any++;
    check('разбитая — не защищает', any === 0);
    // урон бойцу через hitPerson: удержала — заброневой удар (мало), пробила — меньше, чем без брони
    const t = makeEnemy(10 * TILE, 10 * TILE, 0, null); G.enemies.push(t); dummy(t);
    const avg = (cls, wt, n = 200) => { let sum = 0; for (let i = 0; i < n; i++) { t.hp = 1e6; t.dead = false; t.down = false; giveArmor(t, cls); hitPerson(t, { t: WEAPONS[wt], dist: 0, e: 1, sx: 0, sy: 0, vx: 1, vy: 0, owner: -1 }); sum += 1e6 - t.hp; } return sum / n; };
    const none = avg(null, 'm1911'), iiia = avg('IIIA', 'm1911'), thrA = avg('IIIA', 'akm'), noneA = avg(null, 'akm');
    check('.45 по IIIA — в среднем гораздо меньше урона, чем без брони', iiia < none * 0.5, [iiia.toFixed(1), none.toFixed(1)]);
    check('АКМ сквозь IIIA — меньше, чем без брони, но заметно', thrA < noneA && thrA > noneA * 0.5, [thrA.toFixed(1), noneA.toFixed(1)]);
    G.enemies = G.enemies.filter((q) => q !== t);
  });

  run('отображение', () => {
    giveArmor(p, 'III'); p.armor.hp = 40;
    G.cam.x = p.x; G.cam.y = p.y;
    render(1 / 60);
    check('броня в интерфейсе и на модели рисуется без ошибок', true);
    giveArmor(p, null);
  });

  run('быстрая перезарядка (RR)', () => {
    giveKit(p, 'm4a1', null); at(p, 36, 27);
    const g = p.gun;
    g.mag = 12;
    const mags0 = g.pouch.length;
    pressed.KeyR = true; T_.step(1);
    check('R — обычная перезарядка', g.reloadT > 0 && !g.quick && g.reloadDur === WEAPONS.m4a1.reloadTac);
    T_.step(6);
    pressed.KeyR = true; T_.step(1);
    check('второе R за 0,35 с — быстрая: ×0,7, прошедшее засчитано', g.quick && Math.abs(g.reloadDur - WEAPONS.m4a1.reloadTac * RELOAD_QUICK.k) < 1e-6, [g.quick, g.reloadDur]);
    T_.step(Math.round(WEAPONS.m4a1.reloadTac * RELOAD_QUICK.k * 60) + 2);
    check('магазин с 12 патронами выброшен (в подсумок не вернулся)', g.reloadT === 0 && g.pouch.length === mags0 - 1 && !g.pouch.includes(12), [g.pouch.length, mags0, g.pouch]);
    // обычная: неполный возвращается
    g.mag = 12; const m1 = g.pouch.length;
    pressed.KeyR = true; T_.step(1); T_.step(Math.round(WEAPONS.m4a1.reloadTac * 60) + 2);
    check('обычная: неполный магазин — в подсумок', g.pouch.length === m1 && g.pouch.includes(12), g.pouch);
    // ружьё: двойное R — без быстрой
    giveKit(p, 'w1300', null); p.gun.mag = 3;
    pressed.KeyR = true; T_.step(1); pressed.KeyR = true; T_.step(1);
    check('у помпового ружья быстрой нет', !p.gun.quick && p.gun.reloadT > 0);
    giveKit(p, 'm4a1', null);
    // ИИ: пусто, угроза рядом, магазинов ≥ 3 — быстрая; в укрытии и далеко — обычная
    const e = G.enemies[1];
    giveKit(e, 'm4a1', null); Object.assign(e, { _dummy: false, st: 2, seeing: true, target: p, lastSeen: G.time, cover: null, dead: false });
    at(e, 36, 22); e.gun.mag = 0; e.gun.chamber = 0; e.kit[2].chamber = 0; e.kit[2].mag = 0;   // пистолет тоже пуст — менять не на что
    aiEmpty(e);
    check('ИИ: пусто, цель в 5 м — быстрая перезарядка', e.gun.reloadT > 0 && e.gun.quick, [e.gun.reloadT, e.gun.quick]);
    giveKit(e, 'm4a1', null); e.cover = { x: e.x, y: e.y }; at(e, 36, 7); e.cover = { x: e.x, y: e.y }; e.gun.mag = 0; e.gun.chamber = 0;
    aiEmpty(e);
    check('ИИ: в укрытии, цель далеко — обычная', e.gun.reloadT > 0 && !e.gun.quick);
  });
  return T_.checks;
})();
