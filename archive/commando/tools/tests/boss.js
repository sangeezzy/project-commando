// Босс супер-B2: спереди неуязвим, сзади получает урон; перегрев через 5 с стрельбы -> 10 с ближнего боя;
// после трёх перегревов теряет руку с оружием; выключается через 5 минут; победа -> база.
window.__result = (() => {
  const { check, tick, run } = T_;
  const setup = () => {
    G.m = freshFlags(); startStage(1, 2, 'boss');
    T_.freeze();
    const b = G.enemies.find((e) => e.t === 'X');
    const p = me();
    T_.away(p);
    G.allies = [];
    p.dash = 1e9;                                     // неуязвим (тест не про урон по герою)
    return { b, p };
  };
  run('броня босса', () => {
    const { b, p } = setup();
    b.a = 0;
    const hp = b.hp;
    check('спереди неуязвим', damageEnemy(b, 5, p.idx, b.x + 100, b.y) === 2 && b.hp === hp);
    damageEnemy(b, 5, p.idx, b.x - 100, b.y);
    check('со спины получает урон', b.hp === hp - 5, b.hp);
  });
  run('перегрев', () => {
    const { b, p } = setup();
    const s = freeSpotNear(b.x, b.y + 220);
    p.x = p.rx = s.x; p.y = p.ry = s.y;
    let t = 0, shots = 0;
    const orig = shootBolt;
    shootBolt = (o, ...rest) => { if (o === b) shots++; return orig(o, ...rest); };
    while (b.bst === 'gun' && t < 60 * 10) { tick(1); t++; }
    shootBolt = orig;
    check('после ~5 с непрерывной стрельбы оружие клинит', b.bst === 'jam' && b.over === 1, { bst: b.bst, t: (t / 60).toFixed(1), heat: b.heat });
    check('стрелял непрерывной очередью (> 40 выстрелов)', shots > 40, shots);
    tick(60 * (BOSS_JAM_TIME - 0.5));
    check('10 с — ближний бой', b.bst === 'jam');
    tick(60);
    check('остыл — снова стреляет', b.bst === 'gun');
    b.over = 2; b.heat = BOSS_HEAT_MAX - 0.01; b.spin = 1;
    tick(5);
    check('третий перегрев — рука с оружием взорвалась, только ближний бой', b.armless && b.bst === 'arm', { bst: b.bst });
    tick(60 * 15);
    check('без руки больше не стреляет', b.bst === 'arm');
  });
  run('выключение', () => {
    const { b } = setup();
    G.m.bossT = 0.5;
    tick(60);
    check('через 5 минут выключается целым', G.m.boss === 3 && !b.dead && b.off, { boss: G.m.boss });
    tick(60 * 15);
    check('отряд возвращается на базу', G.lv === 0 && map.hub);
    check('прогресс: миссия выполнена, робот захвачен целым', G.progress[1].done && /цел/.test(G.progress[1].best), G.progress[1]);
  });
  run('уничтожение', () => {
    const { b, p } = setup();
    b.a = 0;
    damageEnemy(b, 999, p.idx, b.x - 100, b.y);
    tick(5);
    check('здоровье кончилось — босс уничтожен', b.dead && G.m.boss === 2 && G.m.result === 'destroyed');
  });
  return T_.checks;
})();
