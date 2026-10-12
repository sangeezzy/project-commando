// Низкие укрытия: сквозь них видно, но выстрел издалека они держат; стоя вплотную, можно стрелять поверх.
window.__result = (() => {
  const { check, tick, run, at } = T_;
  run('укрытия', () => {
    T_.freeze();
    const p = me();
    dismount(p);
    check('баррикада — низкое укрытие', tileAt(51, 44) === T.LOW);
    const e = G.enemies.find((q) => q.t === 'D');
    T_.only(e);
    const reset = () => { at(e, 53, 44); e.hp = e.maxHp = 50; e.dead = false; e.stun = 99; G.bullets = []; };
    reset();
    at(p, 44, 44); p.a = 0;
    check('сквозь баррикаду видно', los(p.x, p.y, e.x, e.y));
    for (let i = 0; i < 5; i++) { playerFire(p); tick(8); }
    tick(40);
    check('выстрел издалека остановлен баррикадой', e.hp === 50, e.hp);
    reset();
    at(p, 50, 44); p.a = 0;
    for (let i = 0; i < 5; i++) { playerFire(p); tick(8); }
    tick(20);
    check('вплотную к укрытию стрельба поверх него проходит', e.hp < 50, e.hp);
    // выстрел врага по герою за баррикадой
    reset(); e.stun = 0;
    at(p, 50, 44); at(e, 58, 44); p.hp = 4; p.dash = 0;
    G.bullets = [];
    for (let i = 0; i < 5; i++) { shootBolt(e, Math.PI, 0, 500, 'e'); tick(10); }
    tick(40);
    check('герой за укрытием защищён от дальних выстрелов', p.hp === 4, p.hp);
  });
  run('узкие проходы', () => {
    // крупный босс (радиус 26) не протискивается в дверь шириной в клетку, герой — проходит
    const door = { x: 92 * TILE + 16, y: 47 * TILE };
    const big = { x: door.x, y: door.y }, small = { x: door.x, y: door.y };
    for (let i = 0; i < 200; i++) { moveCircle(big, 0, -3, ETYPES.X.r); moveCircle(small, 0, -3, PR); }
    check('крупный круг не проходит в узкую дверь', big.y > 45 * TILE, Math.round(big.y / TILE));
    check('герой в дверь проходит', small.y < 44 * TILE, Math.round(small.y / TILE));
  });
  return T_.checks;
})();
