// Занос спорткара (300 л. с., задний привод, гоночная резина): на открытом поле — газ с рулём, руль без газа, туда-сюда, тормоз с рулём,
// прямо; с противобуксовочной (tc) и стабилизацией (esc) не разворачивает ни на асфальте, ни на грунте; без них — разворачивает; седан — нет.
window.__result = (() => {
  const { check } = T_;
  startMap('race', 0, [{ slot: 0, human: true, name: 'Тест' }], false);
  const p = me();
  // открытое поле: все клетки — пол (стен нет), машины карты убраны в сторону; старт — середина, носом на восток
  const grid0 = map.grid.slice();
  for (let i = 0; i < map.grid.length; i++) map.grid[i] = T.FLOOR;
  for (const q of map.cars) { q.parked = false; q.stamp = []; q.x = -1e5; q.y = -1e5; }
  const x0 = 12 * TILE, y0 = map.h * TILE / 2, a0 = 0;          // у западного края, носом на восток: места на разгон хватает
  const run = (model, tc, fm, plan) => {
    const c = map.cars.find((q) => q.model === model);
    const V = VEHICLES[model], tc0 = V.tc, esc0 = V.esc;
    V.tc = tc; V.esc = tc ? esc0 : 0;
    const fl0 = map.fl.slice(); map.fl.fill(fm || FM.ASPHALT);
    for (const q of map.cars) if (q !== c && !q.parked) { q.vx = q.vy = 0; }
    unparkCar(c);
    Object.assign(c, { x: x0, y: y0, a: a0, vx: 0, vy: 0, w: 0, steer: 0, hp: V.engineHp, ax: 0, fyF: 0, fyR: 0 });
    if (p.veh) exitCar(p, true);
    enterCar(p, c, 0);
    let worst = 0, spun = false, t = 0;
    for (const [dur, ctrl] of plan) {
      for (let i = 0; i < dur * 60; i++) {
        c.ctrl = { ...ctrl };
        stepCar(c, 1 / 60); G.time += 1 / 60; t += 1 / 60;
        if (carSpeed(c) > M(3)) { const sl = Math.abs(angDiff(Math.atan2(c.vy, c.vx), c.a)) * 57.3; worst = Math.max(worst, sl); if (sl > 60) spun = true; }
      }
    }
    map.fl.set(fl0); V.tc = tc0; V.esc = esc0;
    exitCar(p, true); c.x = -1e5; c.y = -1e5;
    return `${Math.round(worst)}°${spun ? ' РАЗВОРОТ' : ''}, ${Math.round(carSpeed(c) / PX_M * 3.6)} км/ч`;
  };
  const plans = {
    'с места: газ + руль в пол 4 с': [[4, { thr: 1, steer: 1, hb: 0 }]],
    'разгон 3 с, потом руль в пол с газом 2 с': [[3, { thr: 1, steer: 0, hb: 0 }], [2, { thr: 1, steer: 1, hb: 0 }]],
    'разгон 5 с, руль в пол без газа 2 с': [[5, { thr: 1, steer: 0, hb: 0 }], [2, { thr: 0, steer: 1, hb: 0 }]],
    'разгон 5 с, руль туда-сюда с газом': [[5, { thr: 1, steer: 0, hb: 0 }], [0.6, { thr: 1, steer: 1, hb: 0 }], [0.6, { thr: 1, steer: -1, hb: 0 }], [0.6, { thr: 1, steer: 1, hb: 0 }]],
    'разгон 5 с, тормоз + руль': [[5, { thr: 1, steer: 0, hb: 0 }], [1.5, { thr: -1, steer: 1, hb: 0 }]],
    'прямо газ 6 с': [[6, { thr: 1, steer: 0, hb: 0 }]],
  };
  const out = {};
  for (const [name, plan] of Object.entries(plans)) {
    out[name] = {
      'спорткар без tc, асфальт': run('sport', 0, 0, plan),
      'спорткар tc+esc, асфальт': run('sport', 0.85, 0, plan),
      'спорткар без tc, грунт': run('sport', 0, FM.DIRT, plan),
      'спорткар tc+esc, грунт': run('sport', 0.85, FM.DIRT, plan),
      'седан, асфальт': run('sedan', 0, 0, plan),
    };
  }
  map.grid.set(grid0);
  const spun = (s) => s.includes('РАЗВОРОТ');
  const vals = Object.values(out);
  check('спорткар (противобуксовочная и стабилизация): ни в одном сценарии не разворачивает — асфальт и грунт',
    vals.every((o) => !spun(o['спорткар tc+esc, асфальт']) && !spun(o['спорткар tc+esc, грунт'])), out);
  check('без них — разворачивает (газ с рулём): тест ловит занос', vals.some((o) => spun(o['спорткар без tc, асфальт'])) && vals.some((o) => spun(o['спорткар без tc, грунт'])));
  check('седан (без систем) — не разворачивает', vals.every((o) => !spun(o['седан, асфальт'])));
  const sp = Object.values(out)[5];
  check('с системами по-прежнему быстрый: за 6 с — больше 100 км/ч', parseInt(sp['спорткар tc+esc, асфальт'].split(', ')[1], 10) > 100, sp['спорткар tc+esc, асфальт']);
  return T_.checks;
})();
