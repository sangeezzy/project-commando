// Полигон: карта, старт на краю карты, противники вне поля зрения, у всех M4A1, набор укрытий.
window.__result = (() => {
  const { check, run } = T_;
  run('полигон', () => {
    const p = me();
    check('карта 72×54 м', map.w === 72 && map.h === 54, [map.w, map.h]);
    check('старт на краю карты', Math.min(p.x / TILE, p.y / TILE, map.w - p.x / TILE, map.h - p.y / TILE) < 4, [p.x / TILE, p.y / TILE]);
    const near = Math.min(...G.enemies.map((e) => Math.hypot(e.x - p.x, e.y - p.y) / PX_M));
    check('рядом со стартом противников нет (ближе 12 м)', near > 12, near.toFixed(1));
    check('8 противников', G.enemies.length === 8, G.enemies.length);
    const seen = G.enemies.filter((e) => los(p.x, p.y, e.x, e.y)).map((e) => [Math.floor(e.x / TILE), Math.floor(e.y / TILE)]);
    check('ни одного противника не видно с места игрока (даже за спиной)', !seen.length, seen);
    check('у всех M4A1', [...G.players, ...G.enemies].every((o) => o.gun.t === 'm4a1'));
    const mats = new Set();
    for (let i = 0; i < map.w * map.h; i++) if (map.grid[i] !== T.FLOOR) mats.add(MAT[map.wm[i]].name);
    check('укрытия всех типов на карте', mats.size >= 10, [...mats]);
    check('противники стоят не в стенах', G.enemies.every((e) => !circleStuck(e, PR)));
    const f = bfsFrom(p.x, p.y, 1e9, true);   // сквозь незапертые двери
    check('до каждого противника можно дойти (через незапертые двери)', G.enemies.every((e) => f.f[tileIndex(e.x, e.y)] < 1e9));
    // постоять 10 секунд: никто не замечает
    const far = new Map();
    for (let i = 0; i < 60; i++) {
      T_.step(10);
      for (const e of G.enemies) far.set(e, Math.max(far.get(e) || 0, Math.hypot(e.x - e.home.x, e.y - e.home.y) / TILE));
    }
    check('за 10 с на месте никто не заметил', G.enemies.every((e) => e.st < 2) && !p.dead, G.enemies.map((e) => e.st));
    const pat = G.enemies.filter((e) => e.patrol);
    check('патрульные ходят', pat.length === 3 && pat.every((e) => far.get(e) > 1.5), pat.map((e) => far.get(e).toFixed(1)));
    render(1 / 60);
    check('кадр рисуется', true);
  });
  return T_.checks;
})();
