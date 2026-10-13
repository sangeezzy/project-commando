// Противники у угла, а игрок всё время смотрит на них (жалоба: подходят к углу, стоят, обходят здание, у другого угла
// то же — и так без конца). Игрок бессмертен, стоит у южной стены сарая (box 29..39 × 40..46) и всегда поворачивается
// к ближайшему противнику (как с выключенным туманом войны — видит, где они). Противники должны рано или поздно вступить в бой.
window.__result = (() => {
  const { check, tick, at, only, run } = T_;
  function scenario(name, n, reps = 3) {
    for (let rep = 0; rep < reps; rep++) run(`${name} #${rep + 1}`, () => {
      startRange();
      const p = me();
      const es = G.enemies.slice(0, n);
      only(...es);
      p.god = true;
      at(p, 33, 47); p.a = Math.PI;
      es.forEach((e, i) => { at(e, 26 - i, 37); e.a = Math.PI / 2; });          // к северо-западу: к игроку — из-за юго-западного угла
      for (const e of es) { alertEnemy(e, p.x, p.y, true); e.lastX = p.x; e.lastY = p.y; e.lastSeen = G.time - 3; e.target = p; }
      let shots = 0, flanks = 0, firstShot = -1, lateShots = 0;
      const fl = new Set();
      const ammo = () => es.reduce((s, e) => s + e.gun.mag + e.gun.chamber + e.gun.pouch.reduce((a, b) => a + b, 0), 0);
      let am = ammo();
      for (let i = 0; i < 60 * 45; i++) {
        // «внимательный игрок»: смотрит на ближайшего противника (знает, где он)
        const near = es.filter((e) => !e.dead).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (near) p.a = Math.atan2(near.y - p.y, near.x - p.x);
        tick(1);
        const now = ammo();
        if (now < am) { shots += am - now; if (firstShot < 0) firstShot = i / 60; if (i > 60 * 25) lateShots += am - now; }
        am = now;
        for (const e of es) if (e.flank && !fl.has(e.flank)) { fl.add(e.flank); flanks++; }
      }
      const info = { shots, lateShots, firstShot: firstShot < 0 ? '—' : firstShot.toFixed(1) + ' с', flanks };
      check(`${name} #${rep + 1}: противники вступают в бой (за 35 с, с учётом «держит угол»), а не ходят по кругу (было: никогда)`, shots > 0 && firstShot >= 0 && firstShot < 35, info);
      // бессмертный игрок не умирает — противники и после боя меняют позицию; круг — это когда боя больше нет
      check(`${name} #${rep + 1}: и дальше ведут бой (стреляют после 25-й секунды), обходят не чаще раза в ~7 с`, lateShots > 0 && flanks <= 6 * n, info);
      p.god = false;
    });
  }
  scenario('двое у угла', 2);
  scenario('один у угла', 1);
  return T_.checks;
})();
