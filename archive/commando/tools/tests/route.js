// Обход: артефакт, местные (информация или наёмники), сканер тоннелей, люк, карта патрулей.
window.__result = (() => {
  const { check, tick, run } = T_;
  const reset = () => { G.m = freshFlags(); G.m.met = true; startStage(1, 2, 'start'); T_.freeze(); T_.unride(); return me(); };
  const near = (p, o, dy = 30) => { const s = freeSpotNear(o.x, o.y + dy); p.x = p.rx = s.x; p.y = p.ry = s.y; };
  run('артефакт и местный в очках', () => {
    const p = reset();
    const item = G.objs.find((o) => o.k === 'item');
    p.dash = 1e9;          // неуязвим: враги окраин остаются на месте (иначе окраины «зачищены»)
    near(p, item, 0);
    p.useId = item.id;
    tick(70);
    check('артефакт подобран (держать E 1 с)', G.m.art === p.idx, G.m.art);
    const g = G.objs.find((o) => o.k === 'npc' && o.role === 'glasses');
    giveArtifact(g, p);
    check('местный в очках рассказал про станцию', G.m.info && G.m.art === -2);
    check('станция отмечена на карте', objectives(p).markers.some((m) => m.label === 'СТАНЦИЯ'));
    const m2 = G.objs.find((o) => o.k === 'npc' && o.role === 'merc');
    giveArtifact(m2, p);
    check('второй раз отдать нечего', !G.m.bribed);
  });
  run('наёмники', () => {
    const p = reset();
    G.m.art = p.idx;
    const before = G.enemies.filter((e) => e.zone === 'out' && !e.dead).length;
    const cenBefore = G.enemies.filter((e) => e.zone === 'cen').length;
    giveArtifact(G.objs.find((o) => o.k === 'npc' && o.role === 'merc'), p);
    const leaving = G.enemies.filter((e) => e.leave).length;
    check('наёмники наняты: 3 бойца в центре', G.m.bribed && G.allies.filter((a) => a.t === 'merc').length === 3);
    check('около половины врагов окраин уходит в центр', Math.abs(leaving - before / 2) <= 1.5, { before, leaving });
    check('центр предупреждён', G.m.centerAlert);
    T_.away(p);
    p.x = p.rx = 30 * TILE; p.y = p.ry = 100 * TILE; p.dash = 9999;
    tick(60 * 45);
    const outLeft = G.enemies.filter((e) => e.zone === 'out' && !e.dead).length;
    const cenNow = G.enemies.filter((e) => e.zone === 'cen').length;
    check('ушедшие пропали с окраин и появились в центре', outLeft <= before - leaving + 1 && cenNow > cenBefore, { outLeft, cenBefore, cenNow });
  });
  run('сканер, тоннель, люк', () => {
    const p = reset();
    const gate = objByName('tunnelIn'), hatch = objByName('hatch');
    const camp = markerPos('techCamp');
    // клетка тоннеля прямо под люком
    const reach = () => bfsFrom(camp.x, camp.y).f[tileIndex(hatch.x, hatch.y + TILE)] < 1e9;
    check('без сканера в тоннели не попасть', !gate.open && !reach());
    completeScan(G.objs.find((o) => o.k === 'crate'), p);
    check('сканер настроен — вход в тоннели открыт', G.m.scanned && gate.open);
    const s = freeSpotNear(hatch.x, hatch.y + 40); p.x = p.rx = s.x; p.y = p.ry = s.y;
    check('стоим в тоннеле: связи нет, приказ клонам недоступен', !radioAt(p.x, p.y) && !canOrderClones(p));
    // как в игре: у люка появляется подсказка, удерживаем E
    T_.unfreeze(); G.players.forEach((q) => { if (q !== p) { q.bot = false; q.net = true; } });
    const near = findInteract(p);
    check('у люка из тоннеля есть подсказка «открыть люк»', near && near.o === hatch, near && near.info.label);
    keys.KeyE = true;
    for (let i = 0; i < 110; i++) { G.time += 1 / 60; update(1 / 60); }
    keys.KeyE = false;
    check('люк открыт (держать E)', hatch.open && G.m.hatchOpen);
    const s2 = freeSpotNear(hatch.x, hatch.y - 40);
    check('с другой стороны люка тоже есть подсказка', (hatch.open = false, setTiles(hatch.tiles, T.GATE), p.x = s2.x, p.y = s2.y, findInteract(p) && findInteract(p).o === hatch));
    openGate(hatch, true);
    check('из лагеря техников можно пройти в тоннель', reach());
  });
  run('карта патрулей', () => {
    const p = reset();
    const t = G.objs.find((o) => o.k === 'table');
    T_.only();            // охрана лагеря не мешает
    near(p, t, 0);
    p.useId = t.id;
    tick(110);
    check('карта патрулей изучена', G.m.patrolMap && t.done);
  });
  return T_.checks;
})();
