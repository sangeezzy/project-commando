// Движение: бег в любую сторону, взгляд на бегу — за мышкой; вбок немного медленнее, назад заметно медленнее.
window.__result = (() => {
  const { check, run, at, step } = T_;
  const p = me();
  G.enemies = [];
  const KEYS = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
  const dirs = [['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyS', 'KeyA'], ['KeyS', 'KeyD']];
  run('бег во все стороны', () => {
    const res = [];
    for (const d of dirs) {
      at(p, 36, 27);
      for (const k in keys) keys[k] = false;
      keys.ShiftLeft = true; for (const k of d) keys[k] = true;
      // курсор в разных местах, в том числе за спиной относительно бега
      mouse.x = VW / 2 + 150; mouse.y = VH / 2 - 90;
      G.cam.x = p.x; G.cam.y = p.y;
      const x0 = p.x, y0 = p.y;
      step(30);
      const v = Math.hypot(p.x - x0, p.y - y0) / 0.5 / PX_M;
      const w = screenToWorld(mouse.x, mouse.y);
      const aim = Math.atan2(w.y - p.y, w.x - p.x);
      const dx = d.reduce((s, k) => s + KEYS[k][0], 0), dy = d.reduce((s, k) => s + KEYS[k][1], 0);
      const along = ((p.x - x0) * dx + (p.y - y0) * dy) / Math.hypot(dx, dy) / Math.hypot(p.x - x0, p.y - y0);
      res.push({ d: d.join('+'), v: +v.toFixed(2), sprint: p.sprint, face: Math.abs(angDiff(p.a, aim)) < 0.02, along: +along.toFixed(3) });
    }
    for (const k in keys) keys[k] = false;
    check('бег работает во всех 8 направлениях', res.every((r) => r.sprint && r.v > 0.5 * SPEED.sprint), res.map((r) => r.d + ':' + r.v));
    check('бежит туда, куда нажаты клавиши', res.every((r) => r.along > 0.99), res.map((r) => r.along));
    check('на бегу смотрит за мышкой, как при шаге', res.every((r) => r.face), res.map((r) => r.d + ':' + r.face));
    check('на бегу не стреляет', !canShoot(p));
  });
  run('скорость по направлению взгляда', () => {
    // взгляд строго вверх (курсор над бойцом)
    function speed(ks, sprint) {
      at(p, 36, 27);
      for (const k in keys) keys[k] = false;
      keys.ShiftLeft = sprint; for (const k of ks) keys[k] = true;
      G.cam.x = p.x; G.cam.y = p.y; mouse.x = VW / 2; mouse.y = VH / 2 - 200;
      const x0 = p.x, y0 = p.y;
      step(30);
      for (const k in keys) keys[k] = false;
      return Math.hypot(p.x - x0, p.y - y0) / 0.5 / PX_M;
    }
    for (const [sprint, base, name] of [[false, SPEED.walk, 'шаг'], [true, SPEED.sprint, 'бег']]) {
      const fw = speed(['KeyW'], sprint), side = speed(['KeyD'], sprint), back = speed(['KeyS'], sprint), diag = speed(['KeyW', 'KeyD'], sprint), bdiag = speed(['KeyS', 'KeyD'], sprint);
      const r = [fw, diag, side, bdiag, back].map((v) => +(v / base).toFixed(2));
      check(`${name}: вперёд — полная скорость`, Math.abs(r[0] - 1) < 0.03, r);
      check(`${name}: вбок немного медленнее (~85%)`, Math.abs(r[2] - MOVE_DIR.side) < 0.03, r);
      check(`${name}: назад заметно медленнее (~60%)`, Math.abs(r[4] - MOVE_DIR.back) < 0.03, r);
      check(`${name}: по диагоналям — плавно между ними`, r[0] > r[1] && r[1] > r[2] && r[2] > r[3] && r[3] > r[4], r);
    }
  });
  return T_.checks;
})();
