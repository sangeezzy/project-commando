// Противник в поле зрения, но за краем экрана — маленькая красная стрелка у края в его сторону (offscreenContacts / drawOffscreen);
// за стеной, за спиной, на экране — стрелки нет.
window.__result = (() => {
  const { check, run } = T_;

  run('стрелки к противникам за краем экрана', () => {
    startMap('race', 0, [{ slot: 0, human: true, name: 'Т' }], false);       // большое открытое поле
    const p = me();
    G.enemies = [];
    p.x = p.px = 100 * TILE; p.y = p.py = 60 * TILE; p.a = -Math.PI / 2;     // смотрит на север
    G.viewT = G.view = 12; applyZoom(); G.cam.x = p.x; G.cam.y = p.y; G.weather = null;
    G.expo = { gain: 1 };
    const e = makeEnemy(0, 0, 0, null); G.enemies.push(e);
    const put = (dx, dy) => { e.x = e.px = p.x + M(dx); e.y = e.py = p.y + M(dy); e.offT = 0; };
    const arrows = () => { render(1 / 60); return offscreenContacts(p); };
    put(0, -22);                                   // впереди, 22 м — за верхним краем (по вертикали видно 12 м)
    let a = arrows();
    check('впереди за краем экрана — стрелка', a.length === 1, a.length);
    if (a[0]) check('у верхнего края, направлена вверх, с расстоянием', a[0].y < 40 && Math.abs(a[0].x - VW / 2) < 5 && Math.abs(a[0].a + Math.PI / 2) < 0.05 && Math.round(a[0].d) === 22,
      [Math.round(a[0].x), Math.round(a[0].y), a[0].a.toFixed(2), Math.round(a[0].d)]);
    put(-14, -18);                                 // влево-вперёд
    a = arrows();
    check('влево-вперёд — стрелка на краю экрана в его сторону', a.length === 1 && a[0].x < VW / 2 && a[0].y < VH / 2 && (a[0].y <= OFFSCREEN.pad + 1 || a[0].x <= OFFSCREEN.pad + 1), a[0] && [Math.round(a[0].x), Math.round(a[0].y)]);
    put(0, 22);                                    // за спиной — вне поля зрения
    check('за спиной — нет', arrows().length === 0);
    put(0, -3);                                    // на экране — видно и так
    check('на экране — стрелки нет', arrows().length === 0);
    // за стеной: стена поперёк линии взгляда
    put(0, -22);
    const ty = Math.floor(p.y / TILE) - 10, tx = Math.floor(p.x / TILE);
    for (let x = tx - 3; x <= tx + 3; x++) { map.grid[ty * map.w + x] = T.WALL; map.wm[ty * map.w + x] = WM.CONCRETE; }
    map.ver++;
    check('за стеной — нет', arrows().length === 0);
    for (let x = tx - 3; x <= tx + 3; x++) map.grid[ty * map.w + x] = T.FLOOR;
    map.ver++;
    e.dead = true;
    check('убит — нет', arrows().length === 0);
    e.dead = false;
    let err = null; try { drawOffscreen(p); drawHUD(); } catch (x) { err = String(x); }
    check('рисуется без ошибок', !err, err);
  });
  return T_.checks;
})();
