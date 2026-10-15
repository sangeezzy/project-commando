// Отдача: увод прицела по горизонтали вместе со взглядом, обратно сам не возвращается (игрок тянет мышью; бот доворачивает к цели,
// но сразу после выстрела медленно). Сила — из параметров оружия (пуля, порох, v0, масса, ствол, дульное устройство, станок),
// стойка (от бедра / прицел, присед, ходьба — перемножаются), модификации с флагом recoil. У людей и союзных ботов; противники — флаг.
// Разброс за выстрел у тех, у кого есть отдача, — меньше.
window.__result = (() => {
  const { check, step, at, run, dummy } = T_;
  const p = me();
  const bot = G.players.find((q) => q.ai);
  G.enemies.forEach(dummy);
  const shot = (o, t, st = {}) => { const g0 = o.gun; o.gun = makeGun(t); Object.assign(o, { ads: 0, crouch: false, speed: 0 }, st); const v = recoilShot(o); o.gun = g0; return v; };
  const fire = (o, n) => { for (let i = 0; i < n; i++) { o.gun.chamber = 1; o.gun.mag = 20; o.gun.cd = 0; fireRound(o, 0); } };
  const reset = () => { OPTS.cam = 'std'; G.state = 'play';
    Object.assign(p, { aimRot: 0, ads: 0, crouch: false, crouchToggle: false, dead: false, down: false, hp: 100, god: true, speed: 0 });
    at(p, 36, 27); p.a = 0; mouse.r = false; G.bullets = []; };

  run('сила отдачи из параметров оружия', () => {
    const ids = [...PRIMARY_IDS, ...PISTOL_IDS, ...MG_IDS], v = Object.fromEntries(ids.map((t) => [t, shot(p, t)]));
    check('у всего оружия есть данные отдачи', ids.every((t) => RECOIL_W[t] && v[t] > 0), v);
    check('АКМ (7,62×39) уводит сильнее АК-74 (5,45, дульный тормоз)', v.akm > v.ak74 * 1.5, [v.akm.toFixed(2), v.ak74.toFixed(2)]);
    check('АК-74 мягче M4A1', v.ak74 < v.m4a1, [v.ak74.toFixed(2), v.m4a1.toFixed(2)]);
    check('FAL (7,62×51) сильнее M4A1', v.fal > v.m4a1 * 1.3, [v.fal.toFixed(2), v.m4a1.toFixed(2)]);
    check('пулемёты (тяжёлые) мягче автоматов: M249 < M4A1, РПК-74 < АК-74', v.m249 < v.m4a1 * 0.7 && v.rpk74 < v.ak74, [v.m249.toFixed(2), v.rpk74.toFixed(2)]);
    check('ружьё — сильнее всех полноразмерных', PRIMARY_IDS.every((t) => t === 'w1300' || v.w1300 > v[t]), v.w1300.toFixed(2));
    check('пистолеты (лёгкие, короткий ствол) уводит сильнее автоматов', PISTOL_IDS.every((t) => v[t] > v.akm), PISTOL_IDS.map((t) => v[t].toFixed(2)));
    check('станковые пулемёты почти не уводит', MG_IDS.every((t) => v[t] < v.m249), MG_IDS.map((t) => v[t].toFixed(2)));
    const bl0 = RECOIL_W.m4a1.bl;
    RECOIL_W.m4a1.bl = bl0 * 2; const vLong = shot(p, 'm4a1'); RECOIL_W.m4a1.bl = bl0;
    check('длиннее ствол — меньше увод', vLong < v.m4a1, [vLong.toFixed(2), v.m4a1.toFixed(2)]);
  });

  run('стойка: прицел, присед, ходьба — перемножаются', () => {
    const s0 = shot(p, 'm4a1'), sA = shot(p, 'm4a1', { ads: 1 }), sC = shot(p, 'm4a1', { crouch: true }), sAC = shot(p, 'm4a1', { ads: 1, crouch: true });
    check('без прицела сильнее, чем с прицелом (×hip / ×ads)', Math.abs(sA / s0 - RECOIL.ads / RECOIL.hip) < 1e-9 && s0 > sA * 2, (s0 / sA).toFixed(3));
    check('присев меньше', Math.abs(sC / s0 - RECOIL.crouch) < 1e-9, (sC / s0).toFixed(3));
    check('прицел и присед — произведение', Math.abs(sAC / s0 - RECOIL.ads / RECOIL.hip * RECOIL.crouch) < 1e-9, (sAC / s0).toFixed(3));
    const sW = shot(p, 'm4a1', { speed: M(SPEED.walk) }), sWA = shot(p, 'm4a1', { speed: M(SPEED.walk), ads: 1 });
    check('на ходу сильнее (полный шаг ×(1 + move))', Math.abs(sW / s0 - (1 + RECOIL.move)) < 1e-9, (sW / s0).toFixed(3));
    check('на ходу с прицелом — тоже произведение', Math.abs(sWA / sA - (1 + RECOIL.move)) < 1e-9);
    check('ручной пулемёт присев — свой множитель (сошки, вес)', Math.abs(shot(p, 'rpk74', { crouch: true }) / shot(p, 'rpk74') - RECOIL_W.rpk74.crouch) < 1e-9);
    check('ИИ целится в прицел: как игрок с прицелом', Math.abs(shot(bot, 'm4a1') - sA) < 1e-9, [shot(bot, 'm4a1'), sA]);
  });

  run('модификации: флаг recoil', () => {
    check('у оружия есть список модификаций', Array.isArray(makeGun('m4a1').mods) && !makeGun('m4a1').mods.length);
    const s0 = shot(p, 'm4a1');
    const g0 = p.gun; p.gun = makeGun('m4a1'); Object.assign(p, { ads: 0, crouch: false, speed: 0 });
    p.gun.mods = ['light'];
    check('модификация без флага recoil — отдачу не меняет', Math.abs(recoilShot(p) - s0) < 1e-9);
    p.gun.mods = ['brake'];
    check('с флагом recoil (дульный тормоз) — меньше', Math.abs(recoilShot(p) / s0 - WEAPON_MODS.brake.yaw) < 1e-9);
    p.gun.mods = ['brake', 'grip'];
    const k = recoilMods(p.gun);
    check('несколько — перемножаются (увод, постоянная часть)', Math.abs(k.yaw - WEAPON_MODS.brake.yaw * WEAPON_MODS.grip.yaw) < 1e-9 &&
      Math.abs(k.side - WEAPON_MODS.brake.side) < 1e-9, k);
    p.gun = g0;
  });

  run('игрок: увод прицела вместе со взглядом, без возврата', () => {
    reset();
    p.gun = makeGun('akm'); p.kit[0] = p.gun; p.cur = 0;
    fire(p, 9);
    const aPrev = p.a;
    fire(p, 1);
    const b = G.bullets[G.bullets.length - 1];
    check('пуля летит по взгляду (без отдельного увода ствола)', Math.abs(angDiff(Math.atan2(b.vy, b.vx), aPrev)) < 1e-6);
    check('обычная камера: поправка прицела накопилась', Math.abs(p.aimRot) > 0.002, p.aimRot);
    const r1 = p.aimRot;
    step(60);
    check('обратно сама не возвращается', p.aimRot === r1);
    const s = worldToScreen(p.x, p.y);
    check('взгляд = направление на курсор + поправка', Math.abs(angDiff(p.a, Math.atan2(mouse.y - s.y, mouse.x - s.x) + r1)) < 0.01);
    const sp = aimScreenPoint(p);
    check('перекрестие — там, куда смотрит ствол', Math.abs(angDiff(Math.atan2(sp.y - s.y, sp.x - s.x), p.a)) < 0.01);
    // направление: у АКМ постоянная часть — вправо (в среднем)
    let sum = 0;
    for (let i = 0; i < 400; i++) { p.aimRot = 0; recoilKick(p); sum += p.aimRot; }
    check('АКМ в среднем уводит вправо (side)', sum / 400 > 0.3 * recoilShot(p) * RECOIL_W.akm.side * MRAD, (sum / 400 / MRAD).toFixed(2));
    reset(); OPTS.cam = 'look'; step(2);
    const a0 = p.a;
    fire(p, 10);
    check('камера по взгляду: увело сам взгляд', Math.abs(angDiff(p.a, a0)) > 0.002 && !p.aimRot, [angDiff(p.a, a0)]);
    const a1 = p.a; step(60);
    check('и он остаётся (не возвращается)', Math.abs(angDiff(p.a, a1)) < 1e-9);
    reset();
    pressed.KeyP = true; step(1);
    check('P больше ничего не переключает', OPTS.recoil === undefined && !p.aimRot);
  });

  run('ИИ: отдача у союзных ботов и противников (флаги)', () => {
    check('флаги: у ботов и у противников', RECOIL.bots === true && RECOIL.enemies === true);
    Object.assign(bot, { dead: false, down: false, recoilT: 0 }); bot.gun = makeGun('akm'); bot.a = 0;
    fire(bot, 10);
    check('бот: прицел увело', Math.abs(angDiff(bot.a, 0)) > 0.002, bot.a);
    check('бот: сразу после выстрела доворачивает медленно (aiPull)', aiTurnRate(bot) === Math.min(ENEMY.turn, RECOIL.aiPull) && RECOIL.aiPull < ENEMY.turn);
    G.time += RECOIL.aiHold + 0.01;
    check('через aiHold — обычная скорость доворота', aiTurnRate(bot) === ENEMY.turn);
    bot.gun.bloom = 0; fire(bot, 1);
    check('бот: прирост разброса за выстрел меньше (×bloomK)', Math.abs(bot.gun.bloom - WEAPONS.akm.kick * RECOIL.bloomK) < 1e-6, bot.gun.bloom);
    const e = G.enemies[0];
    Object.assign(e, { dead: false, recoilT: 0 }); e.gun = makeGun('akm'); e.a = 0;
    fire(e, 10);
    check('противник: прицел увело, доворачивает медленно', Math.abs(angDiff(e.a, 0)) > 0.002 && aiTurnRate(e) === Math.min(ENEMY.turn, RECOIL.aiPull));
    e.gun.bloom = 0; fire(e, 1);
    check('противник: прирост разброса за выстрел меньше (×bloomK)', Math.abs(e.gun.bloom - WEAPONS.akm.kick * RECOIL.bloomK) < 1e-6, e.gun.bloom);
    // флаги выключают отдачу у своих групп
    RECOIL.enemies = false; e.a = 0; e.recoilT = 0;
    fire(e, 10);
    check('enemies = false — у противников без отдачи', e.a === 0 && aiTurnRate(e) === ENEMY.turn);
    RECOIL.enemies = true;
    RECOIL.bots = false; bot.a = 0; bot.recoilT = 0;
    fire(bot, 10);
    check('bots = false — у союзных ботов без отдачи', bot.a === 0);
    RECOIL.bots = true;
    let err = null; try { render(1 / 60); } catch (er) { err = String(er); }
    check('кадр без ошибок', !err, err);
    reset(); p.god = false;
  });
  return T_.checks;
})();
