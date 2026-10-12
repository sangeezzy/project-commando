// Фонарь и темнота: враг замечает героя с включённым фонарём издалека, без фонаря — только вблизи.
// Туман: в темноте видно в конусе фонаря и совсем рядом. Рация в пещерах не работает.
window.__result = (() => {
  const { check, tick, run } = T_;
  // две тёмные клетки на расстоянии d1..d2 с прямой видимостью
  const pair = (d1, d2) => {
    for (let y = 21; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (tileAt(x, y) !== T.FLOOR || !map.dark[y * map.w + x]) continue;
      const ax = x * TILE + 16, ay = y * TILE + 16;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, d = (d1 + d2) / 2;
        const bx = ax + Math.cos(a) * d, by = ay + Math.sin(a) * d;
        if (solidAt(bx, by) || !darkAt(bx, by) || !los(ax, ay, bx, by)) continue;
        return { ax, ay, bx, by };
      }
    }
    return null;
  };
  run('фонарь', () => {
    T_.freeze();
    const p = me();
    const pr = pair(185, 195);
    check('нашлось место для теста', !!pr);
    const setup = (lamp) => {
      const e = G.enemies[0];
      T_.only(e);
      e.x = pr.bx; e.y = pr.by; e.st = 0; e.goal = null; e.patrol = null; e.alertT = 0;
      e.a = Math.atan2(pr.by - pr.ay, pr.bx - pr.ax);      // стоит спиной к герою
      e.look = e.a; e.lookT = 99;
      p.x = p.rx = pr.ax; p.y = p.ry = pr.ay; p.mv = MV.IDLE; p.lamp = lamp;
      p.a = Math.atan2(pr.by - pr.ay, pr.bx - pr.ax);
      for (const q of G.players) if (q !== p) { q.x = q.rx = 5 * TILE; q.y = q.ry = 5 * TILE; q.down = true; }
      return e;
    };
    let e = setup(true); tick(20);
    check('фонарь включён — враг замечает свет спиной (190 px)', e.st === 2, e.st);
    G.m = freshFlags(); startStage(1, 1, 'start'); T_.freeze();
    e = setup(false); tick(20);
    check('фонарь выключен — в темноте на 190 px не замечает', e.st === 0, e.st);

    // туман: видно в конусе, не видно за спиной, видно вплотную
    const vs = [{ x: pr.ax, y: pr.ay, a: Math.atan2(pr.by - pr.ay, pr.bx - pr.ax), lamp: true }];
    check('враг в конусе фонаря виден', visibility(pr.bx, pr.by, vs) > 0.5, visibility(pr.bx, pr.by, vs));
    vs[0].a += Math.PI;
    check('за спиной в темноте не виден', visibility(pr.bx, pr.by, vs) === 0, visibility(pr.bx, pr.by, vs));
    vs[0].lamp = false; vs[0].a -= Math.PI;
    check('без фонаря на 190 px не виден', visibility(pr.bx, pr.by, vs) === 0);
    check('без фонаря вплотную (30 px) виден', visibility(pr.ax + 30, pr.ay, vs) > 0.5 || solidAt(pr.ax + 30, pr.ay));
    check('вспышка выстрела врага видна в темноте', visibility(pr.bx, pr.by, vs, true) === 1);

    const sp = map.ents.find((q) => q.kind === 'spawn');
    const rv = G.objs.find((o) => o.k === 'rv');
    check('в пещере связи нет', !radioAt(sp.px, sp.py));
    check('в долине связь есть', radioAt(rv.x, rv.y));
  });
  return T_.checks;
})();
