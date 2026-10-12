// База и цикл миссий: закрытые площадки, удержание, зачистка → отсчёт → возврат, сохранение, H после гибели.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  try {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    G.progress = loadProgress();
    G.role = 'solo'; G.myIdx = 0; G.players = [makePlayer(0, 'smuggler')]; startLevel(0);
    const p = me();
    const step = (sec) => { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateAuthority(1 / 60); } };
    const pad = (lv) => map.pads.find((q) => q.lv === lv);

    check('игра начинается на базе с тремя площадками', G.lv === 0 && map.hub && map.pads.length === 3, map.pads.map((q) => q.lv));
    check('открыта только миссия 1', missionUnlocked(1) && !missionUnlocked(2) && !missionUnlocked(3));
    Object.assign(p, { x: pad(2).x, y: pad(2).y }); step(2);
    check('закрытая площадка не запускает', G.lv === 0, G.lv);
    Object.assign(p, { x: pad(1).x, y: pad(1).y }); step(0.6);
    check('0.6 с на площадке — ещё на базе', G.lv === 0, G.pad && G.pad.t);
    step(0.7);
    check('1.2 с — вылет на миссию 1', G.lv === 1 && G.enemies.length > 0, G.lv);

    for (const e of G.enemies) damageEnemy(e, 9, 0);
    const score = G.score;
    step(0.1);
    check('зачистка — выход открыт, отсчёт ~8 с', G.exitOpen && G.returnT > 7.5, G.returnT);
    step(7);
    check('через 7 с ещё на миссии', G.lv === 1, G.lv);
    step(1.1);
    check('через 8 с — на базе, миссия засчитана', G.lv === 0 && G.progress[1].done && G.progress[1].best === score, G.progress[1]);
    check('миссия 2 открылась', missionUnlocked(2));
    check('прогресс сохранён в localStorage', loadProgress()[1].done, loadProgress()[1]);

    Object.assign(p, { x: pad(2).x, y: pad(2).y }); step(1.3);
    killPlayer(p); step(0.2);
    check('гибель — экран поражения', G.state === 'over', G.state);
    requestHub();
    check('H — на базу без зачёта', G.lv === 0 && !G.progress[2].done, { lv: G.lv, m2: G.progress[2] });
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  } catch (err) { check('без исключений', false, String(err) + ' ' + err.stack); }
  return checks;
})();
