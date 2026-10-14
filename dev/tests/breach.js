// Боты выбивают двери в бою (противник за дверью), спокойные — открывают; труп в бою — без удивления и клича
window.__result = (() => {
  const { check, run, tick, dummy } = T_;
  const sq = [{ slot: 0, human: true, name: 'Тест' }];
  // дверь, перед и за которой есть пол; бот — с одной стороны, противник — с другой
  const scene = (pred) => {
    startRange(sq, true);
    const d = map.doors.find((q) => !q.open && pred(q) && [1.5, -3].every((k) => {
      const x = d0x(q, k), y = d0y(q, k); return walkable(Math.floor(x / TILE), Math.floor(y / TILE));
    }));
    const bot = G.players.find((q) => q.ai), p = me(), e = G.enemies[0];
    G.players.filter((q) => q.ai && q !== bot).forEach((q) => { q.dead = true; });
    G.enemies = [e]; dummy(e);
    G.players.forEach((q) => { q.god = true; });
    const put = (o, k) => { o.x = o.px = d0x(d, k); o.y = o.py = d0y(d, k); o.speed = 0; };
    put(bot, 1.5); put(p, 3); put(e, -3);
    bot.a = Math.atan2(d.cy - bot.y, d.cx - bot.x);
    return { d, bot, e };
  };
  const d0x = (d, k) => d.cx + (d.horiz ? 0 : k * TILE), d0y = (d, k) => d.cy + (d.horiz ? k * TILE : 0);
  // удары ногой — по событиям двери (распахнул, выбил, выдержала)
  const kicks = []; const em0 = emit;
  window.emit = (ev) => { if (ev[0] === 'door' && ['slam', 'break', 'thud'].includes(ev[3])) kicks.push(ev[3]); return em0(ev); };

  run('бот в бою — выбивает', () => {
    const { d, bot, e } = scene((q) => q.locked && q.type === 'wood');
    bot.st = 2; bot.lastX = e.x; bot.lastY = e.y; bot.lastSeen = G.time - 5; bot.goal = null; bot.searchT = 0;
    kicks.length = 0;
    for (let i = 0; i < 60 * 15 && !doorPassable(d); i++) { tick(1); bot.lastX = e.x; bot.lastY = e.y; }
    check('запертая деревянная, противник за ней — бот выбил ногой', doorPassable(d) && d.broken && kicks.includes('break'), [d.locked, d.broken, [...kicks], bot.st, bot.regroup, bot.dead, Math.round(Math.hypot(bot.x - d.cx, bot.y - d.cy)), d.type]);
  });

  run('без противника за дверью — открывает', () => {
    const { d, bot } = scene((q) => !q.locked);
    bot.st = 2; bot.lastX = d0x(d, -6); bot.lastY = d0y(d, -6); bot.lastSeen = G.time - 5; bot.goal = null; bot.searchT = 0;
    const far = { x: bot.lastX, y: bot.lastY };
    bot.lastX = d0x(d, 40); bot.lastY = d0y(d, 40);     // противник с этой же стороны, далеко — дверь ему не нужна
    kicks.length = 0;
    tick(60 * 3);
    check('бот в бою, противник не за дверью — дверь не выбивает', !kicks.length, [...kicks]);
    const { d: d2, bot: b2 } = scene((q) => !q.locked);
    b2.st = 0; b2.regroup = false;
    // спокойный бот идёт через дверь — открывает рукой
    kicks.length = 0;
    b2.st = 1; b2.lastX = d0x(d2, -3); b2.lastY = d0y(d2, -3); b2.investigate = true; b2.goal = null;
    tick(60 * 4);
    check('не в бою — не выбивает', !kicks.length, [...kicks]);
    void far;
  });

  run('труп в бою', () => {
    startRange(sq, false);
    const [a, b] = G.enemies;
    G.enemies = [a, b];
    me().x = me().px = M(2); me().y = me().py = M(2); me().god = true;
    b.dead = true; b.x = a.x + Math.cos(a.a) * M(3); b.y = a.y + Math.sin(a.a) * M(3);
    a.st = 2; a.lastX = a.x - M(10); a.lastY = a.y; a.lastSeen = G.time - 3; a.seeing = false;
    const lx = a.lastX, n0 = G.fxOut ? G.fxOut.length : 0;
    let barked = false; const em = window.emit;
    window.emit = (ev) => { if (ev[0] === 'bark' && /труп/i.test(ev[3])) barked = true; return em(ev); };
    checkBodies(a);
    window.emit = em;
    check('в бою: не кричит «тревога», цель не меняет; тело остаётся ненайденным для спокойных', !barked && a.lastX === lx && !b.bodyFound && a.bodies.has(b.id), [barked, a.lastX === lx, b.bodyFound]);
    a.st = 0; a.bodies.clear();
    window.emit = (ev) => { if (ev[0] === 'bark' && /труп/i.test(ev[3])) barked = true; return em(ev); };
    checkBodies(a);
    window.emit = em;
    check('спокойный — по-прежнему тревога и клич', barked && b.bodyFound && a.st === 2, [barked, b.bodyFound, a.st]);
    void n0;
  });
  window.emit = em0;
  return T_.checks;
})();
