// Хаб и карты: оружейный стол, переход (хост стоит в проходе 2 с), увеличенный пустой полигон,
// «Зачистка» (старт у края, 8–12 противников вне видимости, патрули; тот же seed — та же расстановка), возврат в хаб
window.__result = (() => {
  const { check, run, at } = T_;
  const squad = [{ slot: 0, human: true, name: 'Тест' }];
  const step = (n) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; update(1 / 60); } };

  run('хаб', () => {
    startMap('hub', 0, squad, true);
    const p = me();
    check('хаб: без противников, отряд с ботами', G.mapId === 'hub' && G.enemies.length === 0 && G.players.length === 4, [G.mapId, G.enemies.length, G.players.length]);
    check('у стола — F открывает выбор оружия', (() => { at(p, HUB_TABLE.x0 + 2, HUB_TABLE.y1 + 2); pressed.KeyF = true; step(1); return loadoutOpen(); })());
    // выбор: АКМ + ружьё
    document.getElementById('lo1').value = 'akm'; document.getElementById('lo2').value = 'w1300';
    document.getElementById('loOk').click();
    check('взял АКМ + Winchester 1300 + Colt, окно закрыто', !loadoutOpen() && p.kit[0].t === 'akm' && p.kit[1].t === 'w1300' && p.kit[2].t === 'm1911',
      p.kit.map((k) => k && k.t));
    check('одинаковые не даёт', (() => { openLoadout(); document.getElementById('lo1').value = 'akm'; document.getElementById('lo2').value = 'akm';
      document.getElementById('loOk').click(); const still = loadoutOpen(); closeLoadout(); return still && p.kit[1].t === 'w1300'; })());
    // не у стола — выбор не применяется (защита хоста)
    at(p, 3, 19); applyKitAct(p, 'kit:m4a1,');
    check('не у стола — снаряжение не меняется', p.kit[0].t === 'akm');
    // переход: хост стоит в проходе 2 с
    const ex = HUB_EXITS.find((e) => e.map === 'big');
    at(p, Math.floor((ex.x0 + ex.x1) / 2), ex.y1);
    step(60);
    check('в проходе 1 с — ещё в хабе, счёт идёт', G.mapId === 'hub' && G.hubHold && G.hubHold.t > 0.9, G.hubHold);
    step(70);
    check('2 с в проходе — переход на карту', G.mapId === 'big', G.mapId);
    check('снаряжение со стола — на карте, с полным боекомплектом', me().kit[0].t === 'akm' && me().kit[1].t === 'w1300' && ammoTotal(me().kit[0]) === WEAPONS.akm.mag * WEAPONS.akm.mags,
      [me().kit.map((k) => k && k.t), ammoTotal(me().kit[0])]);
  });

  run('увеличенный полигон', () => {
    const big = map;
    check('×1,5: 108×81 клеток, без противников', big.w === 108 && big.h === 81 && G.enemies.length === 0, [big.w, big.h, G.enemies.length]);
    const cars = big.ents.filter((e) => e.kind === 'car');
    check('машины — настоящего размера (как на обычном)', cars.every((c) => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) === 8), cars.map((c) => [c.x1 - c.x0 + 1, c.y1 - c.y0 + 1]));
    check('старт — на проходимом месте', walkable(Math.floor(me().x / TILE), Math.floor(me().y / TILE)));
    pressed.Backspace = true; step(1);
    check('Backspace (хост) — обратно в хаб', G.mapId === 'hub', G.mapId);
  });

  run('«Зачистка»', () => {
    // по клеткам: после перезапуска проходит кадр — патрульные успевают сдвинуться на пиксель
    const snap = () => ({ n: G.enemies.length, e: G.enemies.map((e) => [Math.floor(e.x / TILE), Math.floor(e.y / TILE), !!e.patrol, e.kit.map((k) => k && k.t).join()]).join(';'),
      s: G.players.map((q) => [Math.floor(q.x / TILE), Math.floor(q.y / TILE)]).join(';'), bots: G.players.filter((q) => q.ai).map((q) => q.kit.map((k) => k && k.t).join()).join(';') });
    const bad = [];
    const counts = [], patrolShare = [];
    for (const seed of [11, 222, 3333, 44444, 555555, 6666666]) {
      startMap('clear', seed, squad, true);
      const team = G.players;
      const n = G.enemies.length;
      counts.push(n);
      patrolShare.push(G.enemies.filter((e) => e.patrol).length / n);
      const de = Math.min(...team.map((q) => Math.min(q.x / TILE, q.y / TILE, map.w - q.x / TILE, map.h - q.y / TILE)));
      if (n < 8 || n > 12) bad.push([seed, 'число', n]);
      if (de > 5.5) bad.push([seed, 'старт не у края', de.toFixed(1)]);
      if (team.some((q) => map.fl[tileIndex(q.x, q.y)] === FM.INDOOR)) bad.push([seed, 'старт в помещении']);
      for (const e of G.enemies) for (const q of team) {
        if (los(e.x, e.y, q.x, q.y)) bad.push([seed, 'видит отряд', Math.round(e.x / TILE), Math.round(e.y / TILE)]);
        if (Math.hypot(e.x - q.x, e.y - q.y) < M(15)) bad.push([seed, 'ближе 15 м']);
      }
      if (!G.enemies.every((e) => e.kit[2].t === 'm1911' && e.kit[0])) bad.push([seed, 'набор']);
    }
    check('8–12 противников', counts.every((n) => n >= 8 && n <= 12) && new Set(counts).size > 1, counts);
    check('старт у края, на улице; ни один противник не видит отряд (и наоборот), никто не ближе 15 м', !bad.length, bad.slice(0, 5));
    check('часть патрулирует (30–60%), остальные держат позиции', patrolShare.every((k) => k >= 0.2 && k <= 0.7), patrolShare.map((k) => k.toFixed(2)));
    // тот же seed — та же расстановка (и наборы ботов); перезапуск (Enter) — тот же
    startMap('clear', 777, squad, true); const a = snap();
    startMap('clear', 777, squad, true); const b = snap();
    check('тот же seed — та же расстановка, патрули и наборы', JSON.stringify(a) === JSON.stringify(b));
    G.enemies[0].hp = 1; G.enemies[0].dead = true;
    pressed.Enter = true; step(1);
    check('Enter — заново с той же расстановкой (убитые живы)', JSON.stringify(snap()) === JSON.stringify(a) && !G.enemies[0].dead);
    startMap('clear', 778, squad, true);
    check('другой seed — другая расстановка', JSON.stringify(snap()) !== JSON.stringify(a));
    check('все противники убиты — победа', (() => { G.enemies.forEach((e) => { e.dead = true; }); step(2); return G.state === 'win'; })(), G.state);
  });
  return T_.checks;
})();
