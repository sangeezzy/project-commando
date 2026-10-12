// Завалы: перекрывают путь из пещеры; разбирают только вдвоём, нажимая E в зелёной зоне.
window.__result = (() => {
  const { check, tick, step, run } = T_;
  run('завал', () => {
    T_.freeze();
    T_.only();
    const exit = markerPos('exit0');
    const sp = map.ents.find((q) => q.kind === 'spawn' && q.squad === 0);
    const reach = () => bfsFrom(exit.x, exit.y).f[tileIndex(sp.px, sp.py)] < 1e9;
    check('выход из пещеры закрыт завалами', !reach());
    const o = objByName('w1');
    const [a, b] = G.players.filter((q) => CHARS[q.ch].squad === 0);
    const place = (q, dx) => { const s = freeSpotNear(o.x + dx, o.y + 95); q.x = q.rx = s.x; q.y = q.ry = s.y; };
    place(a, -20); place(b, 20);
    debrisPress(o, a, 0);
    debrisPress(o, a, 0.7);
    check('в одиночку не разобрать', o.prog === 0 && o.eng.length === 1, { prog: o.prog, eng: o.eng });
    debrisPress(o, b, 0);
    debrisPress(o, a, 0.7); debrisPress(o, b, 0.72);
    check('оба нажали в зелёной зоне — завал сдвинулся', o.prog === 1, o.prog);
    debrisPress(o, a, 0.3); debrisPress(o, b, 0.7);
    check('промах одного — не считается', o.prog === 1, o.prog);
    debrisPress(o, a, 0.7);
    check('второй догнал в том же заходе — засчитано', o.prog === 2, o.prog);
    for (let i = 0; i < 2; i++) { debrisPress(o, a, 0.7); debrisPress(o, b, 0.7); }
    check('4 удачных захода — завал разобран', o.done && tileAt(o.tiles[0][0], o.tiles[0][1]) === T.FLOOR, o.prog);
    const o2 = objByName('w2');
    o2.done = true; setTiles(o2.tiles, T.FLOOR);
    check('после завалов путь к выходу свободен', reach());

    // бот-напарник сам берётся за завал и жмёт вовремя
    G.m = freshFlags(); startStage(1, 1, 'start');
    T_.unfreeze();
    T_.only();
    const o3 = objByName('w1');
    const h = me();
    const bot = G.players.find((q) => q !== h && CHARS[q.ch].squad === CHARS[h.ch].squad);
    const s1 = freeSpotNear(o3.x, o3.y + 95); h.x = h.rx = s1.x; h.y = h.ry = s1.y;
    const s2 = freeSpotNear(o3.x + 30, o3.y + 100); bot.x = bot.rx = s2.x; bot.y = bot.ry = s2.y;
    debrisPress(o3, h, 0);
    for (let i = 0; i < 60 * 25 && !o3.done; i++) {
      step(1);
      const ph = debrisPhase(o3);
      if (o3.eng.length >= 2 && ph > 0.66 && ph < 0.76 && !o3.hits.includes(h.idx)) debrisPress(o3, h, ph);
    }
    check('с ботом-напарником завал разобран', o3.done, { prog: o3.prog, eng: o3.eng });
  });
  return T_.checks;
})();
