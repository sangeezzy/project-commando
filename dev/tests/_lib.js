// Общие помощники для юнит-тестов (грузятся в страницу игры перед тестом).
// Функции без this: их можно деструктурировать — const { check, tick } = T_.
window.T_ = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  return {
    checks,
    check,
    // полный кадр (ввод игрока + мир), n кадров по 1/60 с
    step(n) { for (let i = 0; i < n; i++) { G.time += 1 / 60; update(1 / 60); } },
    // только мир: оружие, ИИ, пули
    tick(n) { for (let i = 0; i < n; i++) { G.time += 1 / 60; updateWorld(1 / 60); } },
    // поставить в центр клетки
    at(o, tx, ty) { o.x = o.px = (tx + 0.5) * TILE; o.y = o.py = (ty + 0.5) * TILE; o.speed = 0; },
    only(...keep) { G.enemies = G.enemies.filter((e) => keep.includes(e)); },
    // враг-манекен: не думает, не стреляет
    dummy(e) { e.hp = 1e9; e.st = 0; e.notice = 0; e._dummy = true; },
    run(label, fn) {
      try { fn(); } catch (e) { check(label + ': без исключений', false, String(e) + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')); }
    },
  };
})();
