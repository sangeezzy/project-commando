// Шум: враг без прямой видимости слышит (или нет) героя в разных режимах движения.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  try {
    G.role = 'solo'; G.myIdx = 0; G.players = [makePlayer(0, 'jedi')];
    const p = me();
    // клетка на расстоянии dmin..dmax «по пути» от врага, без прямой видимости
    const findSpot = (e, dmin, dmax) => {
      const f = bfsFrom(e.x, e.y).f;
      for (let i = 0; i < f.length; i++) {
        if (f[i] < dmin || f[i] > dmax) continue;
        const x = (i % map.w) * TILE + 16, y = Math.floor(i / map.w) * TILE + 16;
        if (!los(e.x, e.y, x, y) && Math.hypot(x - e.x, y - e.y) > 90) return { x, y, d: f[i] };
      }
      return null;
    };
    // возвращает максимальное состояние врага за 1.5 с (0 спокоен, 1 насторожен, 2 тревога)
    const run = (mv, dmin, dmax) => {
      startLevel(1);
      let e = null, spot = null;
      for (const cand of G.enemies) { spot = findSpot(cand, dmin, dmax); if (spot) { e = cand; break; } }
      if (!spot) return -1;
      for (const o of G.enemies) if (o !== e) o.dead = true;
      p.x = p.rx = spot.x; p.y = p.ry = spot.y; p.mv = mv; p.stepT = 0;
      let maxSt = 0;
      for (let i = 0; i < 90; i++) { updateAuthority(1 / 60); maxSt = Math.max(maxSt, e.st); }
      return maxSt;
    };
    let st = run(MV.SLOW, 3, 4);   check('крадётся в 3-4 клетках — не слышно', st === 0, st);
    st = run(MV.WALK, 3, 4);       check('шаги в 3-4 клетках — слышно', st >= 1, st);
    st = run(MV.WALK, 7, 9);       check('шаги в 7-9 клетках — не слышно', st === 0, st);
    st = run(MV.SPRINT, 7, 9);     check('бег в 7-9 клетках — слышно', st >= 1, st);

    startLevel(1);
    const e = G.enemies[0];
    for (const o of G.enemies) if (o !== e) o.dead = true;
    const sp = findSpot(e, 6, 9);
    makeNoise(sp.x, sp.y, NOISE.blaster, true);
    check('выстрел бластера — тревога и цель поиска', e.st === 2 && !!e.goal, { st: e.st, goal: !!e.goal });
  } catch (err) { check('без исключений', false, String(err) + ' ' + err.stack); }
  return checks;
})();
