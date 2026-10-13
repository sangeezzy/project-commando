// Оружие: характеристики Colt M1911, Winchester 1300, АКМ; ружьё (картечь, помпа, по патрону); пробитие по патронам;
// смена (1, 2, 3; пистолет — быстро, полноразмерное в левой руке, за спину); нож (X); оружие ИИ (смена вместо перезарядки, по дистанции, нож)
window.__result = (() => {
  const { check, run, at, only, dummy } = T_;
  const p = me();
  const frames = (n, fn) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; updateWorld(1 / 60); if (fn) fn(i); } };
  const hold = (n, fn) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; if (fn) fn(i); updateGun(p, 1 / 60); } };
  G.enemies.forEach(dummy);
  p.god = true;                    // противники рядом могут стрелять — игрока не ранить посреди проверок

  run('характеристики', () => {
    const C = WEAPONS.m1911, A = WEAPONS.akm, S = WEAPONS.w1300;
    check('Colt M1911: .45 ACP, 7 в магазине, одиночный, 253 м/с', C.mag === 7 && C.modes.join() === 'semi' && C.v0 === 253 && C.cls === 'pistol');
    check('АКМ: 7,62×39, 30 в магазине, 600 выстр/мин, 715 м/с, авто/одиночный', A.mag === 30 && A.rpm === 600 && A.v0 === 715 && A.modes.join() === 'auto,semi');
    check('Winchester 1300: 12 калибр, 7+1, помпа, 9 дробин', S.mag === 7 && S.modes.join() === 'pump' && S.pellets === 9);
    check('урон: АКМ > M4A1 > Colt (по одной пуле)', A.dmg[0] > WEAPONS.m4a1.dmg[0] && WEAPONS.m4a1.dmg[0] > C.dmg[0]);
  });

  run('АКМ: темп и магазин', () => {
    giveKit(p, 'akm', null); at(p, 36, 27); p.sprintLock = 0;
    const g = p.gun, n0 = g.mag;
    let shots = 0;
    hold(60, () => { if (pullTrigger(p, true, false, 0)) shots++; });
    check('за 1 с очереди — ~10 выстрелов (600/мин)', shots >= 9 && shots <= 11, shots);
    check('патроны тратятся', g.mag === n0 - shots, [g.mag, n0, shots]);
    G.bullets = [];
  });

  run('ружьё: картечь, помпа, по патрону', () => {
    giveKit(p, 'w1300', null); at(p, 36, 27); p.sprintLock = 0;
    const g = p.gun;
    G.bullets = [];
    pullTrigger(p, true, true, 0);
    check('выстрел — 9 дробин', G.bullets.length === 9, G.bullets.length);
    let more = 0;
    hold(90, () => { if (pullTrigger(p, true, false, 0)) more++; });
    check('помпа: зажатый курок не стреляет второй раз', more === 0, more);
    hold(1, () => pullTrigger(p, true, true, 0));
    const cdOk = g.cd > 0.5 && g.cd < 0.7;
    check('новое нажатие — выстрел; цикл цевья ≈0,63 с', cdOk, g.cd.toFixed(2));
    // по патрону: в магазине 5 из 7, в запасе 24 — +1 за 0,5 с
    G.bullets = [];
    g.cd = 0; const m0 = g.mag, s0 = g.pouch[0];
    startReload(p);
    hold(Math.round(0.52 * 60));
    check('дозарядка: +1 патрон за 0,5 с', g.mag === m0 + 1 && g.pouch[0] === s0 - 1, [g.mag, m0, g.pouch[0]]);
    hold(1, () => pullTrigger(p, true, true, 0));
    check('курок прерывает дозарядку и стреляет', g.reloadT === 0 && G.bullets.length === 9, [g.reloadT, G.bullets.length]);
    // пустое: первый патрон — в патронник через окно (0,9 с)
    g.mag = 0; g.chamber = 0; g.cd = 0;
    startReload(p);
    check('пустое: первый патрон — в патронник за 0,9 с', g.reloadDur === WEAPONS.w1300.shellFirst, g.reloadDur);
    hold(Math.round(0.95 * 60));
    check('…и он в патроннике', g.chamber === 1 && g.mag === 0, [g.chamber, g.mag]);
    G.bullets = [];
  });

  run('пробитие по патронам', () => {
    const plywood = MAT[WM.PLYWOOD].pen;
    const e = (t) => Math.pow(plywood, WEAPONS[t].penExp);
    check('фанера: АКМ теряет меньше M4A1, Colt — больше, картечь — ещё больше', e('akm') > e('m4a1') && e('m4a1') > e('m1911') && e('m1911') > e('w1300'),
      ['akm', 'm4a1', 'm1911', 'w1300'].map((t) => e(t).toFixed(2)));
    check('бетон и кирпич не пробивает ничто (пуля гибнет)', MAT[WM.CONCRETE].pen === 0 && MAT[WM.BRICK].pen === 0);
  });

  run('смена оружия', () => {
    giveKit(p, 'm4a1', 'w1300'); at(p, 36, 27);
    G.enemies.forEach((q) => { q.x = 5 * TILE; q.y = 5 * TILE; });     // далеко и за стенами
    pressed.Digit3 = true;
    T_.step(1);
    check('3 — пистолет: смена началась', p.sw && p.sw.to === 2 && !canShoot(p));
    T_.step(Math.round(SWITCH.toPistol * 60) + 2);
    check(`пистолет в руках за ${SWITCH.toPistol} с, полноразмерное — в левой руке`, p.cur === 2 && p.gun.t === 'm1911' && p.off === 0, [p.cur, p.off]);
    pressed.Digit1 = true; T_.step(1);
    check(`обратно на полноразмерное из левой руки — ${SWITCH.fromHand} с`, p.sw && p.sw.dur === SWITCH.fromHand, p.sw);
    T_.step(Math.round(SWITCH.fromHand * 60) + 2);
    check('M4A1 снова в руках', p.cur === 0 && p.off === -1 && p.gun.t === 'm4a1');
    pressed.Digit3 = true; T_.step(Math.round(SWITCH.toPistol * 60) + 3);
    T_.step(Math.round((SWITCH.stowDelay + SWITCH.stow) * 60) + 10);
    check('противников не видно, не стреляет — полноразмерное убрано за спину', p.off === -1 && p.cur === 2, p.off);
    pressed.Digit1 = true; T_.step(1);
    check(`с пистолета на полноразмерное из-за спины — ${SWITCH.fromBack} с`, p.sw && p.sw.dur === SWITCH.fromBack, p.sw);
    T_.step(Math.round(SWITCH.fromBack * 60) + 2);
    pressed.Digit2 = true; T_.step(1);
    check(`одно полноразмерное на другое — ${SWITCH.primToPrim} с`, p.sw && p.sw.dur === SWITCH.primToPrim, p.sw);
    T_.step(Math.round(SWITCH.primToPrim * 60) + 2);
    check('2 — ружьё в руках', p.cur === 1 && p.gun.t === 'w1300');
    // противник на виду — полноразмерное остаётся в левой руке
    const e = G.enemies[0];
    at(e, 40, 27);
    pressed.Digit3 = true; T_.step(Math.round(SWITCH.toPistol * 60) + 3);
    T_.step(Math.round((SWITCH.stowDelay + SWITCH.stow) * 60) + 10);
    check('противник на виду — полноразмерное не убирает (в левой руке)', p.off === 1, p.off);
    e.x = 5 * TILE; e.y = 5 * TILE;
    pressed.Digit1 = true; T_.step(Math.round(SWITCH.fromBack * 60) + 3);
  });

  run('нож (X)', () => {
    giveKit(p, 'm4a1', null);
    Object.assign(p, { dead: false, down: false, hp: 100 }); G.state = 'play';
    const e = G.enemies[0];
    at(p, 36, 27); p.a = 0;
    G.cam.x = p.x; G.cam.y = p.y; mouse.x = VW / 2 + 300; mouse.y = VH / 2;      // смотрит вправо (взгляд — за курсором)
    e.hp = 100; e.dead = false; e.x = p.x + M(1); e.y = p.y;
    pressed.KeyX = true; T_.step(1);
    check('X — удар: пока бьёт, не стреляет', !!p.melee && !canShoot(p));
    T_.step(30);
    check('цель в 1 м перед собой — ранена или убита', e.hp < 100 || e.dead, [e.hp, e.dead]);
    check('удар закончился', !p.melee);
    e.hp = 100; e.dead = false; e.x = p.x + M(2.2);
    pressed.KeyX = true; T_.step(40);
    check('в 2,2 м — не достаёт', e.hp === 100);
    e.x = p.x - M(1);
    pressed.KeyX = true; T_.step(40);
    check('за спиной — не достаёт', e.hp === 100);
    e.x = 5 * TILE; e.y = 5 * TILE;
  });

  run('оружие ИИ', () => {
    const e = G.enemies[1];
    only(e);
    const reset = (kit2) => {
      giveKit(e, 'm4a1', kit2); e._dummy = false; e.hp = 100; e.dead = false; e.st = 2; e.notice = 1; e.cover = null; e.burst = 0; e.react = 0;
      e.target = p; e.seeing = true; e.lastSeen = G.time; e.lastX = p.x; e.lastY = p.y; e.wpnT = 0;
    };
    p.hp = 1e9; at(p, 36, 27);
    // пусто, цель в 5 м, не в укрытии — пистолет быстрее перезарядки
    reset(null); at(e, 36, 22); e.gun.mag = 0; e.gun.chamber = 0;
    aiEmpty(e);
    check('пусто, цель в 5 м — выхватывает пистолет (быстрее перезарядки)', e.sw && e.sw.to === 2, e.sw || e.gun.reloadT);
    // пусто, цель в 20 м, в укрытии — перезаряжается
    reset(null); at(e, 36, 7); e.cover = { x: e.x, y: e.y }; e.gun.mag = 0; e.gun.chamber = 0;
    aiEmpty(e);
    check('пусто, цель в 20 м, сам в укрытии — перезаряжается', !e.sw && e.gun.reloadT > 0, [e.sw, e.gun.reloadT]);
    // ружьё и винтовка: вблизи — ружьё, вдали — винтовка
    reset('w1300'); at(e, 36, 23);
    aiWeapons(e, 1 / 60, { t: p, d: M(4), off: 0, px: p.x, py: p.y });
    check('цель в 4 м — берёт ружьё', e.sw && e.sw.to === 1, e.sw);
    reset('w1300'); e.cur = 1; e.gun = e.kit[1];
    aiWeapons(e, 1 / 60, { t: p, d: M(35), off: 0, px: p.x, py: p.y });
    check('цель в 35 м с ружьём в руках — берёт винтовку', e.sw && e.sw.to === 0, e.sw);
    // вплотную, пусто — нож
    reset(null); e.x = p.x + M(1); e.y = p.y; e.gun.mag = 0; e.gun.chamber = 0;
    aiWeapons(e, 1 / 60, { t: p, d: M(1), off: 0, px: p.x, py: p.y });
    check('цель вплотную, магазин пуст — бьёт ножом', !!e.melee, e.melee);
    // случайный набор: пистолет всегда, 1–2 разных полноразмерных
    let ok = true;
    for (let i = 0; i < 40; i++) {
      randomKit(e);
      const k = e.kit;
      if (!k[0] || k[2].t !== 'm1911' || (k[1] && k[1].t === k[0].t) || !PRIMARY_IDS.includes(k[0].t)) ok = false;
    }
    check('случайный набор ИИ: пистолет, 1–2 разных полноразмерных', ok);
  });
  p.god = false;
  return T_.checks;
})();
