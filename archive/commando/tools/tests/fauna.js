// Фауна тоннелей: нападает стаей только при численном превосходстве и боится света фонаря.
window.__result = (() => {
  const { check, tick, run } = T_;
  const setup = (n) => {
    G.m = freshFlags(); G.m.met = true; startStage(1, 2, 'start');
    T_.freeze(); T_.unride();
    const worms = G.enemies.filter((e) => e.t === 'W' && Math.hypot(e.x - 125 * TILE, e.y - 92 * TILE) < 4 * TILE);
    T_.only(...worms);
    const team = G.players.slice(0, n);
    T_.away(...team);
    team.forEach((q, i) => {
      const s = freeSpotNear(121 * TILE + i * 10, 88 * TILE);
      q.x = q.rx = s.x; q.y = q.ry = s.y; q.lamp = false; q.hp = PLAYER_HP; q.hurtT = 0; q.a = Math.PI;   // смотрят в сторону от гнезда
    });
    return { worms, team };
  };
  run('стая против одного', () => {
    const { worms, team } = setup(1);
    check('в гнезде 3 червя', worms.length === 3, worms.length);
    tick(60 * 5);
    check('3 против 1 — нападают', team[0].hp < PLAYER_HP || team[0].down, team[0].hp);
  });
  run('стая против четверых', () => {
    const { team } = setup(4);
    tick(60 * 4);
    check('3 против 4 — не нападают, кружат в темноте', team.every((q) => q.hp === PLAYER_HP && !q.down), team.map((q) => q.hp));
  });
  run('свет', () => {
    const { worms, team } = setup(1);
    const p = team[0];
    const w = worms[0];
    T_.only(w);
    p.lamp = true; p.a = Math.atan2(w.y - p.y, w.x - p.x);
    const d0 = Math.hypot(w.x - p.x, w.y - p.y);
    tick(30);
    const d1 = Math.hypot(w.x - p.x, w.y - p.y);
    check('в луче фонаря червь пугается и уползает', w.fear > 0 && d1 > d0, { d0: Math.round(d0), d1: Math.round(d1), fear: w.fear });
  });
  return T_.checks;
})();
