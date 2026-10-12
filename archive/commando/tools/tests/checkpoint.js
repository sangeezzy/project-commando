// Контрольные точки: зачистка окраин -> КТ «центр»; гибель отряда -> перезапуск с КТ с сохранёнными решениями.
window.__result = (() => {
  const { check, tick, run } = T_;
  run('контрольная точка', () => {
    T_.freeze(); T_.unride();
    const p = me();
    G.m.met = true;
    orderClones(p, true);
    const clones = G.allies.filter((a) => a.t === 'clone' && !a.tech);
    damageAlly(clones[0], 99); damageAlly(clones[1], 99);
    check('погибшие клоны учтены', G.m.clonesLeft === 4, G.m.clonesLeft);
    for (const e of G.enemies) if (e.zone === 'out') e.dead = true;
    tick(2);
    check('окраины зачищены — ворота центра открыты, КТ «центр»', G.m.outCleared && objByName('innerGate').open && G.cp === 'center');
    check('штурм был — центр поднят по тревоге', G.enemies.filter((e) => e.zone === 'cen' && !e.dead).every((e) => e.st === 2));
    for (const q of G.players) downPlayer(q);
    tick(2);
    check('все ранены — отряд уничтожен', G.state === 'over');
    restartFromCheckpoint();
    check('перезапуск с КТ «центр»', G.state === 'play' && G.stage === 2 && G.cp === 'center' && objByName('innerGate').open);
    check('решения сохранены (клоны в штурме)', G.m.ordered && G.m.met);
    const alive = G.allies.filter((a) => a.t === 'clone' && !a.tech && !a.dead);
    check('живых клонов столько же (4), они рядом с отрядом', alive.length === 4 && alive.every((a) => Math.hypot(a.x - p.x, a.y - p.y) < 400), alive.length);
    check('на окраинах врагов нет, в центре есть', G.enemies.every((e) => e.zone === 'cen') && G.enemies.length > 5);
    check('все герои целы', G.players.every((q) => !q.down && q.hp === PLAYER_HP));
  });
  return T_.checks;
})();
