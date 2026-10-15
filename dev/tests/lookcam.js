// Камера по взгляду (N, тест): взгляд — вверх экрана, боец — внизу посередине; мышь поворачивает, W — вперёд по взгляду
window.__result = (() => {
  const { check, step, at, run, dummy } = T_;
  const p = me();
  const press = (code) => { pressed[code] = true; step(1); };
  const move = (dx, dy) => canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, clientX: 5, clientY: 5 }));

  run('камера по взгляду', () => {
    G.enemies.forEach(dummy);
    at(p, 36, 27); p.a = 0;
    check('по умолчанию в камере по взгляду — лазер', OPTS.laser === true);
    OPTS.cam = 'std'; OPTS.laser = false;       // ниже — перекрестие (мышь по вертикали)
    press('KeyN');
    check('N — режим «по взгляду»', OPTS.cam === 'look');
    step(2);
    const s = worldToScreen(p.x, p.y);
    check('боец внизу посередине', Math.abs(s.x - VW / 2) < 1 && Math.abs(s.y - VH * (1 - CAM.bottom)) < 1, [s.x, s.y, VW, VH]);
    const f = worldToScreen(p.x + Math.cos(p.a) * 100, p.y + Math.sin(p.a) * 100);
    check('взгляд — вверх экрана', Math.abs(f.x - s.x) < 1 && f.y < s.y - 90 * G.zoom, [f.x, f.y]);
    const a0 = p.a;
    move(200, 0); step(1);
    check('мышь вправо — боец поворачивается вправо', Math.abs(angDiff(p.a, a0) - 200 * CAM.turn) < 1e-6, [a0, p.a]);
    check('курсор стоит на линии взгляда ', mouse.x === innerWidth / 2, [mouse.x, mouse.y]);
    const s2 = worldToScreen(p.x, p.y);
    check('после поворота боец там же на экране', Math.abs(s2.x - VW / 2) < 1 && Math.abs(s2.y - VH * (1 - CAM.bottom)) < 1, [s2.x, s2.y]);
    const y0 = mouse.y;
    move(0, -50); step(1);
    check('мышь вверх — прицел дальше вдоль взгляда', mouse.y === y0 - 50, [y0, mouse.y]);
    const x0 = p.x, yy0 = p.y, a1 = p.a;
    keys.KeyW = true; step(30); keys.KeyW = false;
    const d = Math.atan2(p.y - yy0, p.x - x0);
    check('W — вперёд по взгляду', Math.abs(angDiff(d, a1)) < 0.05 && Math.hypot(p.x - x0, p.y - yy0) > 10, [d, a1]);
    press('KeyN');
    check('N ещё раз — обычная камера', OPTS.cam === 'std');
    step(90);
    check('поворот камеры вернулся к нулю', Math.abs(G.camRot) < 0.01, G.camRot);
  });

  run('лазер вместо перекрестия (Shift+N)', () => {
    G.enemies.forEach(dummy);
    OPTS.cam = 'look'; OPTS.laser = false; at(p, 36, 27); p.a = 0;
    step(2);
    keys.ShiftLeft = true; press('KeyN'); keys.ShiftLeft = false;
    check('Shift+N — лазер, камера осталась по взгляду', OPTS.laser === true && OPTS.cam === 'look', [OPTS.laser, OPTS.cam]);
    const y0 = mouse.y;
    move(0, -80); step(1);
    check('мышь по вертикали прицел не двигает', mouse.y === y0, [y0, mouse.y]);
    const a0 = p.a;
    move(100, 0); step(1);
    check('мышь по горизонтали — по-прежнему поворот', Math.abs(angDiff(p.a, a0) - 100 * CAM.turn) < 1e-6);
    let err = null; try { render(1 / 60); } catch (e) { err = String(e); }
    check('кадр с лазером — без ошибок, точка лазера на экране', !err && G.laserDot && G.laserDot.y < VH * (1 - CAM.bottom), [err, G.laserDot]);
    // упирается в стену: перед бойцом стена в 3 м — точка не дальше неё
    let wx = -1;
    for (let tx = 2; tx < map.w - 2 && wx < 0; tx++) for (let ty = 2; ty < map.h - 2; ty++)
      if (tileAt(tx, ty) === T.WALL && [1, 2, 3, 4].every((d) => tileAt(tx - d, ty) === T.FLOOR)) { at(p, tx - 4, ty); wx = tx; break; }
    p.a = 0; p.leanPx = 0;
    const L = laserEnd(p);
    check('лазер упирается в стену', wx > 0 && Math.abs(L.x - wx * TILE) < 2 && Math.abs(L.y - p.y) < 1, [wx * TILE, L.x]);
    // упирается в человека на линии
    at(p, 36, 27); p.a = 0;
    const e = G.enemies[0]; e.dead = false; at(e, 42, 27);
    const L2 = laserEnd(p);
    check('лазер останавливается на человеке', walkable(42, 27) && Math.abs(L2.x - (e.x - PR)) < 1.5, [L2.x, e.x - PR]);
    e.dead = true;
    keys.ShiftLeft = true; press('KeyN'); keys.ShiftLeft = false;
    check('Shift+N ещё раз — перекрестие', OPTS.laser === false);
    render(1 / 60);
    check('без лазера точки нет', !G.laserDot);
    OPTS.cam = 'std';
  });

  run('с прицелом камера по взгляду отдаляется', () => {
    OPTS.cam = 'look'; at(p, 36, 27);
    const vm = () => VH / G.zoom / PX_M;
    step(5);
    const v0 = vm();
    mouse.r = true; step(40);
    check(`ПКМ — видно в ${CAM.adsOut} раза больше`, Math.abs(vm() / v0 - CAM.adsOut) < 0.02, [v0, vm()]);
    const s = worldToScreen(p.x, p.y);
    check('боец по-прежнему внизу посередине', Math.abs(s.x - VW / 2) < 1 && Math.abs(s.y - VH * (1 - CAM.bottom)) < 1, [s.x, s.y]);
    mouse.r = false; step(40);
    check('отпустил — обратно', Math.abs(vm() - v0) < 0.05, vm());
    OPTS.cam = 'std'; mouse.r = true; step(40);
    check('обычная камера — масштаб с прицелом не меняется', Math.abs(vm() - v0) < 0.05, vm());
    mouse.r = false; step(20);
  });

  run('видимость (K / Shift+K)', () => {
    OPTS.sight = 70;
    press('KeyK');
    check('K — на 5 м меньше', sightM() === 65, sightM());
    keys.ShiftLeft = true; press('KeyK'); keys.ShiftLeft = false;
    check('Shift+K — на 5 м больше', sightM() === 70, sightM());
    keys.ShiftLeft = true; press('KeyK'); keys.ShiftLeft = false;
    check('с 70 вверх — снова 10', sightM() === 10, sightM());
    press('KeyK');
    check('с 10 вниз — снова 70 (наибольшая)', sightM() === 70, sightM());
    const seen = [];
    for (let i = 0; i < 13; i++) { press('KeyK'); seen.push(sightM()); }
    check('шаг 5 м: 65 … 10', seen.join() === '65,60,55,50,45,40,35,30,25,20,15,10,70', seen.join());
    // на открытом месте: противник в 30 м лицом к игроку
    let spot = null;
    for (let ty = 3; ty < 52 && !spot; ty++) for (let tx = 2; tx < 40 && !spot; tx++) {
      const a = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }, b = { x: a.x + M(30), y: a.y };
      if (walkable(tx, ty) && walkable(tx + 30, ty) && sightLine(a, b) && ambientAt(a.x, a.y) > 0.9 && ambientAt(b.x, b.y) > 0.9) spot = [tx, ty];
    }
    check('нашлось открытое место', !!spot, spot);
    const e = G.enemies[0];
    at(p, spot[0], spot[1]); p.a = 0; p.crouch = false;
    e.dead = false; e.down = false; e.hp = 100; at(e, spot[0] + 30, spot[1]); e.a = Math.PI; e.st = 2; e.crouch = false;
    OPTS.sight = 70;
    check('70 м: игрок видит противника в 30 м', playerSees(p, e));
    check('70 м: противник видит игрока', !!perceive(e));
    OPTS.sight = 25;
    check('25 м: игрок не видит', !playerSees(p, e));
    check('25 м: противник тоже не видит', !perceive(e));
    const role = G.role; G.role = 'guest'; G.netSight = 40;
    check('у гостя — видимость хоста из снимка', sightM() === 40, sightM());
    G.role = role;
    OPTS.sight = 70; G.enemies.forEach(dummy);
  });

  run('брызги дождя при повороте камеры стоят на земле', () => {
    const t0 = G.time, rot0 = G.camRot, z0 = G.zoom;
    const grab = (rot) => {
      G.camRot = rot; CAMM = camMatrix();
      const pts = [], el = ctx.ellipse;
      ctx.ellipse = function (x, y, ...a) { pts.push(screenToWorld(x, y)); return el.call(this, x, y, ...a); };
      try { drawRain(1, CAMM); } finally { ctx.ellipse = el; }
      return pts;
    };
    G.time = 12.34;
    const A = grab(0.4), B = grab(0.75);
    const mid = B.filter((q) => { const s = worldToScreen(q.x, q.y, CAMM); return Math.hypot(s.x - VW / 2, s.y - VH / 2) < VH * 0.3; });
    const off = mid.map((q) => Math.min(...A.map((a) => Math.hypot(a.x - q.x, a.y - q.y))));
    check('брызги есть', A.length > 20 && mid.length > 3, [A.length, mid.length]);
    check('после поворота — те же точки мира', off.every((d) => d < 0.5), Math.max(...off).toFixed(3));
    G.time = t0; G.camRot = rot0; G.zoom = z0;
  });

  return T_.checks;
})();
