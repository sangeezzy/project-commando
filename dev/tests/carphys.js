// Анализ физики машин (не входит в обычный прогон): разгон, скорость, тормоза, повороты и поведение на газу по приводам.
// python dev/run_tests.py --only carphys
window.__result = (() => {
  const { check } = T_;
  const solo = [{ slot: 0, human: true, name: 'Тест' }];
  startMap('big', 0, solo, false);
  const c = map.cars[0];
  unparkCar(c);
  const x0 = c.x, y0 = c.y;
  const kmh = () => carSpeed(c) / PX_M * 3.6;
  const reset = (model, drive) => {
    Object.assign(c, { model, armor: 'civil', vx: 0, vy: 0, w: 0, steer: 0, a: 0, ax: 0, hp: VEHICLES[model].engineHp });
    c.seats[0] = me().id;
    c.drv = drive;
  };
  // «бесконечная дорога»: без стен (каждый шаг — обратно на место, скорость и курс сохраняются)
  const road = (ctrl, sec, fn) => {
    c.ctrl = ctrl;
    for (let i = 0; i < sec * 240; i++) { carDyn(c, 1 / 240); c.x = x0; c.y = y0; if (fn && fn(i / 240) === false) return i / 240; }
    return sec;
  };
  const out = {};
  for (const id of VEH_IDS) {
    const V = VEHICLES[id], r = {};
    reset(id); r.t100 = road({ thr: 1, steer: 0, hb: 0 }, 40, () => (kmh() >= 100 ? false : undefined)).toFixed(1);
    reset(id); road({ thr: 1, steer: 0, hb: 0 }, 120); r.vmax = Math.round(kmh());
    reset(id); road({ thr: 1, steer: 0, hb: 0 }, 20, () => (kmh() >= 50 ? false : undefined));
    let dist = 0; road({ thr: -1, steer: 0, hb: 0 }, 6, () => { dist += carSpeed(c) / 240; return kmh() < 0.3 ? false : undefined; }); r.brake50 = (dist / PX_M).toFixed(1);
    reset(id); c.vx = M(5); road({ thr: 0.15, steer: 1, hb: 0 }, 2); r.R18 = ((carSpeed(c) / PX_M) / Math.abs(c.w)).toFixed(1);
    // руль на 60 км/ч без газа и с полным газом: отношение поворота к «идеальному» (кинематическому) — <1 выносит носом, >1 — зад срывается
    const turn = (thr) => { reset(id); c.vx = M(16.7); road({ thr: 0.25, steer: 0, hb: 0 }, 1); let s = 0, n = 0;
      road({ thr, steer: 0.5, hb: 0 }, 2.5, (t) => { if (t > 1) { const u = (c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a)) / PX_M; s += c.w / (u * Math.tan(c.steer) / V.wb); n++; } }); return (s / n).toFixed(2); };
    r.coast = turn(0); r.power = turn(1);
    // предел: 40 км/ч, руль до упора, полный газ — угол заноса (кузов против движения) и отношение поворота: задний привод срывает зад
    reset(id); c.vx = M(11); road({ thr: 0.3, steer: 0, hb: 0 }, 0.5); let bs = 0, rs = 0, rn = 0;
    road({ thr: 1, steer: 1, hb: 0 }, 2, (t) => { const hv = Math.atan2(c.vy, c.vx); bs = Math.max(bs, Math.abs(angDiff(c.a, hv)));
      if (t > 0.5) { const u = (c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a)) / PX_M; if (u > 1) { rs += c.w / (u * Math.tan(c.steer) / V.wb); rn++; } } });
    r.limSlipDeg = Math.round(bs * 57.3); r.limTurn = rn ? (rs / rn).toFixed(2) : '—';
    // ливень (сцепление × 0,7): то же — и разгон с места (пробуксовка: у полного — меньше)
    G.weather = { rain: 1, vis: 1, hear: 1, fog: 0, kind: 'heavy' };
    reset(id); c.vx = M(11); road({ thr: 0.3, steer: 0, hb: 0 }, 0.5); bs = 0; rs = 0; rn = 0;
    road({ thr: 1, steer: 1, hb: 0 }, 2, (t) => { const hv = Math.atan2(c.vy, c.vx); bs = Math.max(bs, Math.abs(angDiff(c.a, hv)));
      if (t > 0.5) { const u = (c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a)) / PX_M; if (u > 1) { rs += c.w / (u * Math.tan(c.steer) / V.wb); rn++; } } });
    r.wetSlipDeg = Math.round(bs * 57.3); r.wetTurn = rn ? (rs / rn).toFixed(2) : '—';
    reset(id); r.wet0_50 = road({ thr: 1, steer: 0, hb: 0 }, 20, () => (kmh() >= 50 ? false : undefined)).toFixed(2);
    G.weather = null;
    reset(id); r.dry0_50 = road({ thr: 1, steer: 0, hb: 0 }, 20, () => (kmh() >= 50 ? false : undefined)).toFixed(2);
    // боковое ускорение — по повороту вектора скорости (а не кузова): в заносе кузов крутится быстрее, чем меняется направление движения
    reset(id); road({ thr: 1, steer: 0, hb: 0 }, 20, () => (kmh() >= 60 ? false : undefined)); let lat = 0, pv = Math.atan2(c.vy, c.vx), spin = 0;
    road({ thr: 0.3, steer: 1, hb: 0 }, 1.5, () => { const hv = Math.atan2(c.vy, c.vx); lat = Math.max(lat, Math.abs(angDiff(hv, pv)) * 240 * carSpeed(c) / PX_M); pv = hv;
      spin = Math.max(spin, Math.abs(angDiff(c.a, hv))); }); r.latG = (lat / 9.81).toFixed(2); r.slipDeg = Math.round(spin * 57.3);
    // ручник на 50 км/ч с рулём — зад заносит (угол между кузовом и движением)
    reset(id); road({ thr: 1, steer: 0, hb: 0 }, 20, () => (kmh() >= 50 ? false : undefined)); let hbs = 0;
    road({ thr: 0, steer: 1, hb: 1 }, 1, () => { hbs = Math.max(hbs, Math.abs(angDiff(c.a, Math.atan2(c.vy, c.vx)))); }); r.hbDeg = Math.round(hbs * 57.3);
    out[id + ' (' + V.drive + ')'] = r;
  }
  for (const k in out) check('физика: ' + k, true, out[k]);
  return T_.checks;
})();
