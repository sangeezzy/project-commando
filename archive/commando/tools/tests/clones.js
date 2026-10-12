// Клоны: встреча с капитаном, приказ по рации, штурм окраин.
window.__result = (() => {
  const { check, tick, run } = T_;
  run('клоны', () => {
    T_.freeze(); T_.unride();
    const p = me();
    const camp = markerPos('cloneCamp');
    for (const q of G.players) { const s = freeSpotNear(camp.x + 40, camp.y + 20 * q.idx); q.x = q.rx = s.x; q.y = q.ry = s.y; q.dash = 9999; }
    check('до встречи с капитаном приказ недоступен', !canOrderClones(p));
    tick(10);
    check('отряд пришёл в лагерь — капитан на связи', G.m.met && canOrderClones(p));
    const before = G.enemies.filter((e) => e.zone === 'out' && !e.dead).length;
    handleAction(p, { k: 'cmd' });
    const clones = G.allies.filter((a) => a.t === 'clone' && !a.tech);
    check('приказ отдан: 6 клонов идут на штурм', G.m.ordered && clones.length === 6 && clones.every((a) => a.mode === 'assault'));
    check('центр узнаёт о штурме', G.m.centerAlert);
    const x0 = clones.reduce((s, a) => s + a.x, 0) / clones.length;
    tick(60 * 40);
    const alive = clones.filter((a) => !a.dead);
    const x1 = alive.reduce((s, a) => s + a.x, 0) / Math.max(1, alive.length);
    const after = G.enemies.filter((e) => e.zone === 'out' && !e.dead).length;
    check('клоны продвинулись к окраинам', x1 - x0 > 15 * TILE || alive.length === 0, { x0: Math.round(x0 / TILE), x1: Math.round(x1 / TILE), alive: alive.length });
    check('клоны уничтожают врагов', after < before - 3, { before, after });
    check('тех. клоны остались на посту', G.allies.filter((a) => a.tech).every((a) => a.mode === 'post'));
  });
  return T_.checks;
})();
