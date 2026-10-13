// Двое противников у одного угла (жалоба: второй выталкивает первого из-за угла на открытое место).
// Угол — юго-восточный угол кирпичного здания (стена x = 20, y 6..16), как в npcpeek; опасность (игрок) — к северо-востоку,
// противники идут с юго-запада друг за другом (второй — на разном расстоянии позади). Игрок бессмертен, смотрит на угол.
window.__result = (() => {
  const { check, run, at, only } = T_;
  const D = { x: 22.5 * TILE, y: 10.5 * TILE };
  run('двое у одного угла', () => {
    let exposed = 0, peekFrames = 0, maxShift = 0, overlap = 0, maxStack = 0;
    const starts = [[15, 18], [14, 19], [13, 19], [16, 19], [12, 18], [15, 17]];
    for (const [bx, by] of starts) for (let rep = 0; rep < 2; rep++) {
      startRange();
      const p = me();
      const [A, B] = G.enemies;
      only(A, B);
      p.god = true; at(p, 22, 10);
      at(A, 17, 17); at(B, bx, by);
      for (const e of [A, B]) {
        e.st = 2; e.notice = 0; e.seeing = false; e.lastSeen = -99; e.lastX = D.x; e.lastY = D.y; e.target = p;
        e.patrol = null; e.goal = null; e.searchT = 0; e.caught = 0; e.commit = 0;
      }
      const anchor = new Map();          // где стоял, когда начал выглядывать (за углом сам не ходит)
      for (let i = 0; i < 60 * 12; i++) {
        p.a = Math.atan2(17.5 * TILE - p.y, 21 * TILE - p.x);      // смотрит на угол
        G.time += 1 / 60; updateAI(1 / 60); updateBullets(1 / 60);
        for (const e of [A, B]) {
          if (e.dead || !e.peek || e.peek.phase === 'shoot') { anchor.delete(e); continue; }
          if (!anchor.has(e)) anchor.set(e, { x: e.x, y: e.y });
          peekFrames++;
          const a = anchor.get(e);
          maxShift = Math.max(maxShift, Math.hypot(e.x - a.x, e.y - a.y));
          if (sightLine(p, { x: e.x, y: e.y })) exposed++;          // тело на виду — вытолкнули из-за угла
        }
        if (!A.dead && !B.dead && Math.hypot(A.x - B.x, A.y - B.y) < PR * 1.5) overlap++;
        for (const e of [A, B]) maxStack = Math.max(maxStack, e.stackT || 0);
      }
      p.god = false;
    }
    const info = { exposed, peekFrames, maxShift: (maxShift / PX_M).toFixed(2) + ' м', overlap, maxStack: maxStack.toFixed(1) + ' с' };
    check('у угла своих не выталкивают на виду (тело остаётся за углом)', peekFrames > 300 && exposed === 0, info);
    check('стоящего у угла не сдвигают (уступает идущий)', maxShift < M(0.15), info);
    check('не стоят друг в друге', overlap < 60, info);
    check('второй ждёт за первым недолго (потом обходит)', maxStack <= 5.1, info);
  });
  return T_.checks;
})();
