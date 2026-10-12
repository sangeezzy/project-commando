// Урон и попадания: броня B2 спереди держит, со спины пробивается; у B1 отлетает рука; хитмаркеры.
window.__result = (() => {
  const { check, run } = T_;
  run('броня', () => {
    T_.freeze();
    const p = me();
    const evs = [];
    const orig = playFx;
    playFx = (ev, remote) => { evs.push(ev); orig(ev, remote); };
    const k = G.enemies.find((e) => e.t === 'K');
    k.a = 0; k.hp = 8;
    damageEnemy(k, 2, p.idx, k.x + 100, k.y);
    check('B2 спереди: урон вдвое меньше', Math.abs(k.hp - 7) < 1e-6, k.hp);
    check('хитмаркер «броня» стрелку', evs.some((e) => e[0] === 'hm' && e[1] === p.idx && e[2] === 2));
    damageEnemy(k, 2, p.idx, k.x - 100, k.y);
    check('B2 со спины: урон в полтора раза больше', Math.abs(k.hp - 4) < 1e-6, k.hp);
    const d = G.enemies.find((e) => e.t === 'D' && !e.dead);
    evs.length = 0;
    damageEnemy(d, 1, p.idx, d.x + 50, d.y);
    check('B1 после попадания теряет руку (деталь отлетает)', evs.some((e) => e[0] === 'limb'));
    check('видно попадание (осколки)', evs.some((e) => e[0] === 'hit'));
    damageEnemy(d, 1, p.idx, d.x + 50, d.y);
    check('убит — хитмаркер «убил»', d.dead && evs.some((e) => e[0] === 'hm' && e[2] === 1));
    playFx = orig;
  });
  return T_.checks;
})();
