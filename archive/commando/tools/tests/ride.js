// Спидеры: у костра все садятся (боты сами), отряд едет на этап 2; водитель рулит, сойти — E.
window.__result = (() => {
  const { check, step, run } = T_;
  run('спидеры', () => {
    const p = me();
    T_.only();
    step(30);
    check('у костра все в сборе — контрольная точка', G.m.rvAll && G.cp === 'rv', { rv: G.m.rvAll, cp: G.cp });
    const s0 = G.speeders[0];
    p.x = p.rx = s0.x + 20; p.y = p.ry = s0.y;
    toggleRide(p);
    check('сел за руль', p.ride === s0.id && s0.seats[0] === p.idx, s0.seats);
    let t = 0;
    while (G.stage === 1 && t < 60 * 30) { step(1); t++; }
    check('боты сами сели, отряд уехал на этап 2', G.stage === 2, { stage: G.stage, rides: G.players.map((q) => q.ride), t: (t / 60).toFixed(1) });
    check('на этапе 2 все на спидерах, я за рулём', G.players.every((q) => q.ride >= 0) && G.speeders.some((s) => s.seats[0] === p.idx));
    const s = G.speeders.find((q) => q.id === p.ride);
    const x0 = s.x;
    for (let i = 0; i < 60; i++) { driveSpeeder(s, 1, 0, 1 / 60); syncRiders(); }
    check('спидер едет (за 1 с > 150 px)', s.x - x0 > 150, Math.round(s.x - x0));
    check('седок движется вместе со спидером', Math.hypot(p.x - s.x, p.y - s.y) < 20);
    dismount(p);
    check('сошёл: не на спидере и не в стене', p.ride === -1 && !solidAt(p.x, p.y) && !s.seats.includes(p.idx));
  });
  return T_.checks;
})();
