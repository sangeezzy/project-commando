// ИИ противников: слух, постепенное обнаружение, поле зрения, бой, укрытия, перезарядка.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const all = G.enemies.slice();
  // секунд, пока враг не перейдёт в бой (99 — не заметил за max)
  function timeToNotice(e, max = 6) {
    for (let i = 0; i < max * 60; i++) { G.time += 1 / 60; updateAI(1 / 60); trackSpeed(p, 1 / 60); if (e.st === 2) return i / 60; }
    return 99;
  }
  function fresh(e, tx, ty, a) {
    at(e, tx, ty); e.a = e.want = a; e.st = 0; e.notice = 0; e.seeing = false; e.patrol = null;
    e.home = { x: e.x, y: e.y, a }; e.look = a; e.lookT = 99; e.lastSeen = -99; e.cover = null; e.goal = null; e.investigate = false;
    e.gun = makeGun('m4a1', ENEMY.mags);
  }
  run('слух', () => {
    p.gun.chamber = 1; p.a = 0;
    fireRound(p, 0); G.bullets = [];
    check('выстрел слышат все противники на полигоне', G.enemies.every((e) => e.st === 2), G.enemies.map((e) => e.st));
  });
  run('обнаружение', () => {
    p.hp = 1e9; p.gun.lastShot = -99;   // вспышка недавнего выстрела выдаёт сразу
    const e = all[0];
    G.enemies = [e];
    at(p, 36, 30); p.crouch = false;
    fresh(e, 16, 30, 0);
    check('на 20 м в открытую видно', sightLine(e, p));
    const tStand = timeToNotice(e);
    check('стоящего на 20 м замечает не сразу: ~1–2 с', tStand > 0.8 && tStand < 2.2, tStand.toFixed(2));
    fresh(e, 16, 30, 0); p.crouch = true;
    const tCrouch = timeToNotice(e);
    check('присевшего — заметно дольше', tCrouch > tStand * 1.4, tCrouch.toFixed(2));
    p.crouch = false;
    fresh(e, 32, 30, 0);
    const tNear = timeToNotice(e);
    check('вблизи (4 м) — почти сразу', tNear < 0.6, tNear.toFixed(2));
    fresh(e, 16, 30, Math.PI);
    const tBack = timeToNotice(e, 5);
    check('спиной к игроку на 20 м — не замечает', tBack === 99, tBack);
    // кирпичная стена (10, 24..31)
    fresh(e, 6, 27, 0); at(p, 14, 27);
    check('за стеной не замечает', timeToNotice(e, 4) === 99);
  });
  run('бой', () => {
    // здесь проверяем одиночный бой без случайных обходов (обходы — в тесте squad)
    const fl = { ...ENEMY.flank };
    ENEMY.flank.rate = 0; ENEMY.flank.huntChance = 0;
    const e = all[1];
    G.enemies = [e];
    // блок (24..27, 20): противник севернее в 3 м, игрок южнее в 14 м
    fresh(e, 25, 17, Math.PI / 2);
    at(p, 25, 31); p.crouch = false; p.hp = 1e9;
    const shot0 = e.gun.lastShot;
    timeToNotice(e);
    let tookCover = false, fired = false;
    for (let i = 0; i < 5 * 60; i++) {
      G.time += 1 / 60; updateAI(1 / 60); updateBullets(1 / 60);
      if (e.gun.lastShot > shot0) fired = true;
      if (e.cover && Math.hypot(e.cover.x - e.x, e.cover.y - e.y) < 8) tookCover = true;
    }
    check('заметив, открывает огонь', fired);
    check('занимает укрытие за бетонным блоком', tookCover && Math.floor(e.y / TILE) === 19, [e.x / TILE, e.y / TILE, e.cover]);
    check('попадает по стоящему в открытую на 12 м', p.hp < 1e9, Math.round(1e9 - p.hp));
    e.gun.mag = 0; e.gun.chamber = 0;
    let reloadCrouched = false, hidden = false;
    for (let i = 0; i < 60; i++) {
      G.time += 1 / 60; updateAI(1 / 60);
      if (e.gun.reloadT > 0 && e.crouch) { reloadCrouched = true; hidden = !sightLine(p, e); }
    }
    check('пустой магазин — перезаряжается, пригнувшись за укрытием', reloadCrouched);
    check('пригнувшегося за укрытием противника не видно', hidden);
    // игрок ушёл за стену — противник идёт проверить
    at(p, 6, 27); p.crouch = false;
    for (let i = 0; i < 10 * 60; i++) { G.time += 1 / 60; updateAI(1 / 60); }
    check('потеряв цель, идёт к последнему месту', Math.hypot(e.x - 25.5 * TILE, e.y - 31.5 * TILE) < M(6) || e.searchT > 0, [e.x / TILE, e.y / TILE]);
    Object.assign(ENEMY.flank, fl);
  });
  run('свои на линии огня', () => {
    const a = all[2], b = all[3];
    G.enemies = [a, b];
    fresh(a, 36, 36, -Math.PI / 2); fresh(b, 36, 33, -Math.PI / 2);
    at(p, 36, 27);
    check('не стреляет, если свой на линии огня', friendlyInLine(a, p) && !friendlyInLine(b, p));
  });
  return T_.checks;
})();
