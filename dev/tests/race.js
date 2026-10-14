// Автодром и боты за рулём: карта (трассы, покрытие, 8 машин, без противников), проход в хабе; вождение ботов выключено по умолчанию
// (VEH.botDrive), при включении — круги по трассам (держатся асфальта, скорость), поездка к точке, на автодроме — сами берут машины.
window.__result = (() => {
  const { check, run, tick, at } = T_;
  const solo = [{ slot: 0, human: true, name: 'Тест' }];
  const flTrack = (t) => t.pts.map((p) => map.fl[Math.floor(p.y / TILE) * map.w + Math.floor(p.x / TILE)]);

  run('автодром', () => {
    startMap('race', 0, solo, false);
    check('карта 200 × 130 м, без противников', map.w === 200 && map.h === 130 && G.enemies.length === 0);
    check('10 машин, все пять моделей — по две', map.cars.length === 10 && VEH_IDS.every((id) => map.cars.filter((c) => c.model === id).length === 2),
      map.cars.map((c) => c.model));
    check('трассы: прямая, простая, сложная, смешанная', map.tracks.map((t) => t.id).join() === 'straight,oval,snake,mixed');
    for (const id of ['straight', 'oval', 'snake']) {
      const fl = flTrack(map.tracks.find((t) => t.id === id));
      check(`«${id}»: по оси — асфальт`, fl.every((f) => f === FM.ASPHALT), fl.filter((f) => f !== FM.ASPHALT).length);
    }
    const mx = flTrack(map.tracks.find((t) => t.id === 'mixed'));
    const share = (f) => mx.filter((q) => q === f).length / mx.length;
    check('смешанная: асфальт, гравий и грунт (каждого ≥ 20%)', share(FM.ASPHALT) > 0.2 && share(FM.GRAVEL) > 0.2 && share(FM.DIRT) > 0.2,
      [share(FM.ASPHALT).toFixed(2), share(FM.GRAVEL).toFixed(2), share(FM.DIRT).toFixed(2)]);
    check('машины — на трассах, носом по ходу', map.cars.every((c) => map.fl[Math.floor(c.y / TILE) * map.w + Math.floor(c.x / TILE)] !== FM.DIRT));
    // хаб: пятый проход — на юг
    startMap('hub', 0, solo, false);
    const ex = HUB_EXITS.find((e) => e.map === 'race');
    check('в хабе — проход «Автодром» (в южной стене проём)', !!ex && tileAt(ex.x0 + 1, HUB_H - 1) === T.FLOOR);
    at(me(), ex.x0 + 2, ex.y0);
    tick(60 * HUB_HOLD + 10);
    check('хост 2 с в проходе — на автодроме', G.mapId === 'race', G.mapId);
  });

  run('вождение ботов выключено по умолчанию', () => {
    check('VEH.botDrive = false', VEH.botDrive === false);
    startMap('race', 0, solo, true);
    tick(60 * 8);
    check('на автодроме боты за руль не садятся', map.cars.every((c) => !c.seats[0]));
    const bot = G.players.find((q) => q.ai);
    check('botDrive без включения — отказ', botDrive(bot, map.cars[0], { pts: map.tracks[1].pts, loop: true }) === false);
  });

  // Бот за рулём машины c по трассе tr: сколько кругов за sec, доля времени на трассе (не грунт там, где трасса — асфальт), макс. скорость
  const lapTest = (trId, carIdx, sec) => {
    startMap('race', 0, solo, true);
    const bot = G.players.find((q) => q.ai), c = map.cars[carIdx], tr = map.tracks.find((t) => t.id === trId);
    G.players.filter((q) => q.ai && q !== bot).forEach((q) => { q.x = q.px = 3 * TILE; q.y = q.py = 3 * TILE; });
    me().x = me().px = 5 * TILE; me().y = me().py = 125 * TILE;          // ведущий — в стороне
    at(bot, Math.floor(c.x / TILE) - 3, Math.floor(c.y / TILE));
    botDrive(bot, c, { pts: tr.pts, loop: true });
    let on = 0, all = 0, vmax = 0, tLap = -1;
    for (let i = 0; i < 60 * sec; i++) {
      tick(1);
      if (bot.veh === c) {
        all++;
        const f = map.fl[Math.floor(c.y / TILE) * map.w + Math.floor(c.x / TILE)];
        if (trId === 'mixed' || f !== FM.DIRT) on++;
        vmax = Math.max(vmax, carSpeed(c) / PX_M * 3.6);
      }
      if (bot.drive && bot.drive.laps >= 1 && tLap < 0) { tLap = i / 60; break; }
    }
    return { laps: bot.drive ? bot.drive.laps : 0, on: all ? on / all : 0, vmax: Math.round(vmax), tLap: tLap.toFixed(1), seated: bot.veh === c && bot.seat === 0 };
  };

  run('боты за рулём: круги по трассам', () => {
    VEH.botDrive = true;
    const ov = lapTest('oval', 2, 90);
    check('простая трасса: бот сел за руль и прошёл круг, держится асфальта (≥ 90%)', ov.seated && ov.laps >= 1 && ov.on >= 0.9, ov);
    check('простая трасса: на прямых разгоняется (> 50 км/ч)', ov.vmax > 50, ov.vmax);
    const sn = lapTest('snake', 4, 150);
    check('сложная трасса: круг, держится асфальта (≥ 85%)', sn.laps >= 1 && sn.on >= 0.85, sn);
    const mxd = lapTest('mixed', 6, 150);
    check('смешанное покрытие: круг пройден', mxd.laps >= 1, mxd);
    VEH.botDrive = false;
  });

  run('бот: доехать до точки', () => {
    VEH.botDrive = true;
    startMap('race', 0, solo, true);
    const bot = G.players.find((q) => q.ai), c = map.cars[0];
    at(bot, Math.floor(c.x / TILE), Math.floor(c.y / TILE) + 3);
    const tx = 120 * TILE, ty = 8 * TILE;
    botDriveTo(bot, c, tx, ty);
    let done = false;
    for (let i = 0; i < 60 * 40 && !done; i++) { tick(1); if (bot.drive && bot.drive.done) done = true; }
    const d = Math.hypot(c.x - tx, c.y - ty) / PX_M;
    check('доехал до точки в 100 м и встал (≤ 8 м)', done && d < 8 && carSpeed(c) < M(0.5), [done, d.toFixed(1)]);
    VEH.botDrive = false;
  });

  run('автодром: боты сами берут машины (при VEH.botDrive)', () => {
    VEH.botDrive = true;
    startMap('race', 0, solo, true);
    tick(60 * 25);
    const drivers = map.cars.filter((c) => c.seats[0] && personById(c.seats[0]).ai).length;
    check('три бота — за рулём трёх машин, едут', drivers === 3 && map.cars.some((c) => carSpeed(c) > M(5)), drivers);
    VEH.botDrive = false;
  });
  return T_.checks;
})();
