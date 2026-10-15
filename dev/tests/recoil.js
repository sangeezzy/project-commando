// Отдача (только у игрока): увод ствола по горизонтали из параметров оружия (пуля, порох, v0, масса, ствол, дульное устройство),
// стойка (прицел и присед — перемножаются), модификации с флагом recoil; два варианта (P): 'aim' — увод прицела вместе со взглядом
// без возврата, 'barrel' — увод ствола, взгляд на месте, стрелок возвращает ствол. Разброс (bloom) у игрока — меньше.
window.__result = (() => {
  const { check, step, at, run, dummy } = T_;
  const p = me();
  G.enemies.forEach(dummy);
  const shot = (t, st = {}) => { const g0 = p.gun; p.gun = makeGun(t); Object.assign(p, { ads: 0, crouch: false, speed: 0 }, st); const v = recoilShot(p); p.gun = g0; return v; };
  const fire = (n) => { for (let i = 0; i < n; i++) { p.gun.chamber = 1; p.gun.mag = 20; p.gun.cd = 0; fireRound(p, 0); } };
  const reset = () => { OPTS.cam = 'std'; G.state = 'play';
    Object.assign(p, { recoilYaw: 0, aimRot: 0, ads: 0, crouch: false, crouchToggle: false, dead: false, down: false, hp: 100, god: true });
    at(p, 36, 27); p.a = 0; mouse.r = false; G.bullets = []; };

  run('сила отдачи из параметров оружия', () => {
    const v = Object.fromEntries([...PRIMARY_IDS, ...PISTOL_IDS, ...MG_IDS].map((t) => [t, shot(t)]));
    check('у всего оружия есть данные отдачи', [...PRIMARY_IDS, ...PISTOL_IDS, ...MG_IDS].every((t) => RECOIL_W[t] && v[t] > 0), v);
    check('АКМ (7,62×39) уводит сильнее АК-74 (5,45, дульный тормоз)', v.akm > v.ak74 * 1.5, [v.akm.toFixed(2), v.ak74.toFixed(2)]);
    check('АК-74 мягче M4A1', v.ak74 < v.m4a1, [v.ak74.toFixed(2), v.m4a1.toFixed(2)]);
    check('FAL (7,62×51) сильнее M4A1', v.fal > v.m4a1 * 1.3, [v.fal.toFixed(2), v.m4a1.toFixed(2)]);
    check('пулемёты (тяжёлые) мягче автоматов: M249 < M4A1, РПК-74 < АК-74', v.m249 < v.m4a1 * 0.7 && v.rpk74 < v.ak74, [v.m249.toFixed(2), v.rpk74.toFixed(2)]);
    check('ружьё — сильнее всех полноразмерных', PRIMARY_IDS.every((t) => t === 'w1300' || v.w1300 > v[t]), v.w1300.toFixed(2));
    check('пистолеты (лёгкие, короткий ствол) уводит сильнее автоматов', PISTOL_IDS.every((t) => v[t] > v.akm), PISTOL_IDS.map((t) => v[t].toFixed(2)));
    check('станковые пулемёты почти не уводит', MG_IDS.every((t) => v[t] < v.m249), MG_IDS.map((t) => v[t].toFixed(2)));
    // длина ствола: тот же патрон и масса, ствол длиннее — меньше
    const bl0 = RECOIL_W.m4a1.bl;
    RECOIL_W.m4a1.bl = bl0 * 2; const vLong = shot('m4a1'); RECOIL_W.m4a1.bl = bl0;
    check('длиннее ствол — меньше увод', vLong < v.m4a1, [vLong.toFixed(2), v.m4a1.toFixed(2)]);
  });

  run('стойка: прицел, присед, ходьба — перемножаются', () => {
    const s0 = shot('m4a1'), sA = shot('m4a1', { ads: 1 }), sC = shot('m4a1', { crouch: true }), sAC = shot('m4a1', { ads: 1, crouch: true });
    check('без прицела сильнее, чем с прицелом (×hip / ×ads)', Math.abs(sA / s0 - RECOIL.ads / RECOIL.hip) < 1e-9 && s0 > sA * 2, (s0 / sA).toFixed(3));
    check('присев меньше', Math.abs(sC / s0 - RECOIL.crouch) < 1e-9, (sC / s0).toFixed(3));
    check('прицел и присед — произведение', Math.abs(sAC / s0 - RECOIL.ads / RECOIL.hip * RECOIL.crouch) < 1e-9, (sAC / s0).toFixed(3));
    const sW = shot('m4a1', { speed: M(SPEED.walk) }), sWA = shot('m4a1', { speed: M(SPEED.walk), ads: 1 });
    check('на ходу сильнее (полный шаг ×(1 + move))', Math.abs(sW / s0 - (1 + RECOIL.move)) < 1e-9, (sW / s0).toFixed(3));
    check('на ходу с прицелом — тоже произведение', Math.abs(sWA / sA - (1 + RECOIL.move)) < 1e-9);
    check('ручной пулемёт присев — свой множитель (сошки, вес)', Math.abs(shot('rpk74', { crouch: true }) / shot('rpk74') - RECOIL_W.rpk74.crouch) < 1e-9);
  });

  run('модификации: флаг recoil', () => {
    const g = makeGun('m4a1');
    check('у оружия есть список модификаций', Array.isArray(g.mods) && !g.mods.length);
    const s0 = shot('m4a1');
    const g0 = p.gun; p.gun = makeGun('m4a1'); p.ads = 0; p.crouch = false; p.speed = 0;
    p.gun.mods = ['light'];
    check('модификация без флага recoil — отдачу не меняет', Math.abs(recoilShot(p) - s0) < 1e-9);
    p.gun.mods = ['brake'];
    check('с флагом recoil (дульный тормоз) — меньше', Math.abs(recoilShot(p) / s0 - WEAPON_MODS.brake.yaw) < 1e-9);
    p.gun.mods = ['brake', 'grip'];
    const k = recoilMods(p.gun);
    check('несколько — перемножаются (увод, постоянная часть, возврат)', Math.abs(k.yaw - WEAPON_MODS.brake.yaw * WEAPON_MODS.grip.yaw) < 1e-9 &&
      Math.abs(k.side - WEAPON_MODS.brake.side) < 1e-9 && Math.abs(k.ret - WEAPON_MODS.grip.ret) < 1e-9, k);
    p.gun = g0;
  });

  run('вариант «увод ствола» (barrel)', () => {
    reset(); OPTS.recoil = 'barrel';
    p.gun = makeGun('akm'); p.cur = 0; p.kit[0] = p.gun;
    const a0 = p.a;
    fire(9);
    const yPrev = p.recoilYaw;           // последняя пуля летит по стволу до своего увода
    fire(1);
    check('взгляд не изменился', p.a === a0);
    check('ствол увело', Math.abs(p.recoilYaw) > 0.002, p.recoilYaw.toFixed(4));
    // направление: у АКМ постоянная часть — вправо (в среднем по многим выстрелам)
    const keep = p.recoilYaw; let sum = 0;
    for (let i = 0; i < 400; i++) { p.recoilYaw = 0; recoilKick(p); sum += p.recoilYaw; }
    p.recoilYaw = keep;
    check('АКМ в среднем уводит вправо (side)', sum / 400 > 0.3 * recoilShot(p) * RECOIL_W.akm.side * MRAD, (sum / 400 / MRAD).toFixed(2));
    const b = G.bullets[G.bullets.length - 1], ba = Math.atan2(b.vy, b.vx);
    check('пуля летит по стволу (взгляд + увод)', Math.abs(angDiff(ba, p.a + yPrev)) < 1e-6, [ba, p.a + yPrev]);
    const sp = aimScreenPoint(p), s = worldToScreen(p.x, p.y);
    check('перекрестие — по стволу', Math.abs(angDiff(Math.atan2(sp.y - s.y, sp.x - s.x), Math.atan2(mouse.y - s.y, mouse.x - s.x) + p.recoilYaw)) < 1e-6);
    const y1 = p.recoilYaw;
    step(60);
    check('за 1 с стрелок вернул ствол (< 5%)', Math.abs(p.recoilYaw) < Math.abs(y1) * 0.05, [y1.toFixed(4), p.recoilYaw.toFixed(5)]);
    const s2 = worldToScreen(p.x, p.y);
    check('взгляд — ровно на курсор (без поправки)', Math.abs(angDiff(p.a, Math.atan2(mouse.y - s2.y, mouse.x - s2.x))) < 0.01);
  });

  run('вариант «увод прицела» (aim)', () => {
    reset(); OPTS.recoil = 'aim';
    p.gun = makeGun('akm'); p.kit[0] = p.gun;
    fire(10);
    check('обычная камера: поправка прицела накопилась, ствол не уведён', Math.abs(p.aimRot) > 0.002 && !p.recoilYaw, [p.aimRot, p.recoilYaw]);
    const r1 = p.aimRot;
    step(60);
    check('обратно не возвращается', p.aimRot === r1);
    const s = worldToScreen(p.x, p.y);
    check('взгляд = направление на курсор + поправка', Math.abs(angDiff(p.a, Math.atan2(mouse.y - s.y, mouse.x - s.x) + r1)) < 0.01);
    // камера по взгляду — уводит сам взгляд
    reset(); OPTS.recoil = 'aim'; OPTS.cam = 'look'; step(2);
    const a0 = p.a;
    fire(10);
    check('камера по взгляду: увело взгляд', Math.abs(angDiff(p.a, a0)) > 0.002 && !p.aimRot, [angDiff(p.a, a0)]);
    const a1 = p.a; step(60);
    check('и он остаётся (не возвращается)', Math.abs(angDiff(p.a, a1)) < 1e-9);
    reset();
  });

  run('P — переключение, только у игрока, разброс меньше', () => {
    reset(); OPTS.recoil = 'barrel'; p.recoilYaw = 0.01; p.aimRot = 0.02;
    pressed.KeyP = true; step(1);
    check('P — «увод прицела», увод сброшен', OPTS.recoil === 'aim' && !p.recoilYaw && !p.aimRot, [OPTS.recoil, p.recoilYaw, p.aimRot, G.state]);
    pressed.KeyP = true; step(1);
    check('P ещё раз — «увод ствола»', OPTS.recoil === 'barrel');
    const e = G.enemies[0];
    Object.assign(e, { dead: false, recoilYaw: 0 }); e.gun = makeGun('akm');
    for (let i = 0; i < 10; i++) { e.gun.chamber = 1; e.gun.mag = 20; fireRound(e, 0); }
    check('ИИ: отдачи (увода) нет', !e.recoilYaw && !e.aimRot);
    check('ИИ: разброс растёт по-прежнему (kick)', Math.abs(e.gun.bloom - Math.min(WEAPONS.akm.maxBloom, WEAPONS.akm.kick * 10)) < 1e-6, e.gun.bloom);
    reset(); p.gun = makeGun('akm'); p.ads = 1; p.gun.bloom = 0;
    fire(1);
    check('у игрока прирост разброса за выстрел — меньше (×bloomK)', Math.abs(p.gun.bloom - WEAPONS.akm.kick * RECOIL.bloomK) < 1e-6, p.gun.bloom);
    let err = null; try { p.recoilYaw = 0.05; render(1 / 60); } catch (er) { err = String(er); }
    check('кадр с уведённым стволом — без ошибок', !err, err);
    reset(); p.god = false;
  });
  return T_.checks;
})();
