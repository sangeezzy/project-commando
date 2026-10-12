// Дымовой тест: все этапы и контрольные точки запускаются, симуляция и отрисовка идут без исключений.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  const step = (n) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; update(1 / 60); } render(1 / 60); };
  const run = (label, fn) => { try { fn(); } catch (e) { check(label + ': без исключений', false, String(e) + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')); } };

  run('база', () => {
    check('старт на базе, 4 героя (1 человек + 3 бота)', map.hub && G.players.length === 4 && G.players.filter((p) => p.bot).length === 3,
      { hub: map.hub, n: G.players.length });
    check('персонажи не повторяются', new Set(G.players.map((p) => p.ch)).size === 4, G.players.map((p) => p.ch));
    step(120);
    // встать на площадку задания -> брифинг -> пещеры; во время брифинга мир стоит
    const pad = G.objs.find((o) => o.k === 'pad');
    const p = me();
    for (let i = 0; i < 60 * 2 && G.lv === 0; i++) { p.x = p.rx = pad.x; p.y = p.ry = pad.y; step(1); }
    check('площадка на базе запускает миссию с брифингом', G.lv === 1 && G.stage === 1 && !!G.brief);
    const e = G.enemies.find((q) => q.patrol);
    const ex = e && e.x;
    step(60);
    check('во время брифинга враги стоят', !e || e.x === ex);
    G.brief.t = 99; step(2);
    check('брифинг пропускается', !G.brief);
  });
  run('пещеры', () => {
    G.m = freshFlags(); startStage(1, 1, 'start'); step(300);
    const sq = G.players.map((p) => [CHARS[p.ch].squad, Math.round(p.x / TILE)]);
    check('отряды стартуют в разных пещерах', G.players.every((p) => (CHARS[p.ch].squad === 0) === (p.x < 55 * TILE)), sq);
    check('в пещере темно и нет связи', darkAt(G.players[0].x, G.players[0].y) && !radioAt(G.players[0].x, G.players[0].y));
  });
  run('пещеры: у костра', () => { G.m = freshFlags(); startStage(1, 1, 'rv'); step(200); });
  run('поселение', () => {
    G.m = freshFlags(); startStage(1, 2, 'start'); step(300);
    check('все стартуют на спидерах', G.players.every((p) => p.ride >= 0), G.players.map((p) => p.ride));
    check('камер 5 (2 постоянные + 3 случайные)', G.objs.filter((o) => o.k === 'camera').length === 5);
    check('клонов 8 (6 у лагеря + 2 техника)', G.allies.length === 8, G.allies.length);
  });
  run('центр', () => { G.m = freshFlags(); startStage(1, 2, 'center'); step(300); check('ворота центра открыты', objByName('innerGate').open); });
  run('босс', () => {
    G.m = freshFlags(); startStage(1, 2, 'boss'); step(300);
    check('босс на месте', G.enemies.some((e) => e.t === 'X'), G.enemies.map((e) => e.t));
  });
  return checks;
})();
