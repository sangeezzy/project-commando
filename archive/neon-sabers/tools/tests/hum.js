// Гул меча: голос создаётся для джедая и удаляется при выходе в меню.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  try {
    initAudio();
    check('AudioContext создан', !!AC, AC && AC.state);
    G.role = 'solo'; G.myIdx = 0; G.players = [makePlayer(0, 'jedi')]; startLevel(0);
    const step = (n) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; update(1 / 60); updateHums(); } };
    step(10);
    check('у джедая один голос гула', hums.size === 1, hums.size);
    saberKeyPressed = true; step(30);
    check('погашенный меч: клинок убран, голос остаётся (тихий)', me().saberLen === 0 && hums.size === 1, { len: me().saberLen, voices: hums.size });
    startSwing(me()); step(5);
    leaveToMenu(''); updateHums();
    check('в меню голоса удалены', hums.size === 0, hums.size);
  } catch (err) { check('без исключений', false, String(err) + ' ' + err.stack); }
  return checks;
})();
