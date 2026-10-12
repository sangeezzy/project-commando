// Общие помощники для юнит-тестов (грузятся в страницу игры перед тестом).
// Функции без this: их можно деструктурировать — const { check, tick } = T_.
window.T_ = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  return {
    checks,
    check,
    // прогнать симуляцию n кадров по 1/60 с (как в игре: свой герой, боты, мир)
    step(n) { for (let i = 0; i < n; i++) { G.time += 1 / 60; update(1 / 60); } },
    // только мир хоста, без управления героем и ботами
    tick(n) { for (let i = 0; i < n; i++) { G.time += 1 / 60; updateAuthority(1 / 60); } },
    at(o, tx, ty) { o.x = o.rx = tx * TILE + 16; o.y = o.ry = ty * TILE + 16; },
    // оставить только нужных врагов
    only(...keep) { G.enemies = G.enemies.filter((e) => keep.includes(e)); },
    // боты замирают: ими управляет тест
    freeze() { for (const p of G.players) { if (p._bot === undefined) p._bot = p.bot; p.bot = false; p.net = p.idx !== G.myIdx; } },
    unfreeze() { for (const p of G.players) { if (p._bot !== undefined) p.bot = p._bot; delete p._bot; p.net = false; } },
    // все сходят со спидеров
    unride() { for (const p of G.players) if (p.ride >= 0) dismount(p); },
    // убрать остальных героев подальше (павшими, чтобы не мешали)
    away(...keep) {
      for (const q of G.players) if (!keep.includes(q)) { q.x = q.rx = 3 * TILE; q.y = q.ry = 3 * TILE; q.down = true; if (q.ride >= 0) dismount(q); }
    },
    run(label, fn) {
      try { fn(); } catch (e) { check(label + ': без исключений', false, String(e) + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')); }
    },
  };
})();
