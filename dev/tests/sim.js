// Симуляция баланса (не входит в обычный прогон): «игрок» неуязвим, сидит в центре за блоком и не стреляет,
// выстрел поднимает противников, 3 союзных бота против n противников. Варианты поведения ботов — CFG (A — старое, D — текущее).
// Запуск: python dev/sim.py D:8 A:8 D:3   (вариант:число противников, по 12 раундов на каждый, параллельно)
// Доп. параметры (sim.py: вариант:число:параметры, например D:4:arm=III,kit=rand,runs=24): arm — броня ботов (IIIA, III, III+, IV),
// earm — броня противников, kit=rand — у всех случайные стволы и пистолеты (как на картах), runs — раундов,
// recoil=0 — без отдачи у ИИ, recoil=bots — только у союзных ботов (RECOIL.bots / RECOIL.enemies; по умолчанию — у всех),
// bstart=1 — боты стартуют рядом с «игроком» в центре.
window.__result = (() => {
  const qs = new URLSearchParams(location.search), cfgName = qs.get('cfg') || 'C', nEnemies = +(qs.get('n') || 8);
  if (qs.get('recoil') === '0') { RECOIL.bots = false; RECOIL.enemies = false; }
  if (qs.get('recoil') === 'bots') RECOIL.enemies = false;
  const CFG = {
    A: { guard: { huntNear: 1e9, reviveRisk: 1e9, tether: 1e9, coverR: 1e9, retreatCover: false }, share: 0, intelOff: true },
    B: { guard: { huntNear: M(10), reviveRisk: 6, tether: 1e9, coverR: 1e9, retreatCover: false }, share: M(25) },
    C: { guard: { huntNear: M(10), reviveRisk: 6, tether: M(12), coverR: M(8), retreatCover: true }, share: M(25) },
    D: { guard: { huntNear: 1e9, reviveRisk: 6, tether: M(12), coverR: M(8), retreatCover: true }, share: M(25) },
    E: { guard: { huntNear: M(10), reviveRisk: 1e9, tether: M(12), coverR: M(8), retreatCover: true }, share: M(25) },
    G: { guard: { huntNear: M(18), reviveRisk: 6, tether: M(12), coverR: M(8), retreatCover: true }, share: M(25) },
    H: { guard: { huntNear: M(18), reviveRisk: 1e9, tether: M(12), coverR: M(8), retreatCover: true }, share: M(25) },
    F: { guard: { huntNear: 1e9, reviveRisk: 1e9, tether: 1e9, coverR: 1e9, retreatCover: false }, share: M(25) },
  }[cfgName];
  Object.assign(ENEMY.guard, CFG.guard); ENEMY.intel.share = CFG.share;
  if (CFG.intelOff) window.updateIntel = () => { G.intel = { p: new Map(), e: new Map() }; };
  const arm = qs.get('arm') || null, earm = qs.get('earm') || null, randKit = qs.get('kit') === 'rand';
  const runs = +(qs.get('runs') || 12); let k = 0, d = 0, w = 0, downs = 0, hpLeft = 0; const per = [];
  const rnd = makeRng(777);
  for (let r = 0; r < runs; r++) {
    G.role = 'solo';
    startRange([{ slot: 0, human: true, name: 'Тест' }], true);
    G.enemies = shuffle(G.enemies.slice()).slice(0, nEnemies);
    const p = me(); p.hp = 1e12; T_.at(p, 32, 24); p.crouch = true; p.gun.chamber = 1; fireRound(p, 0);
    const bots = G.players.filter((q) => q.ai);
    for (const b of bots) { if (randKit) randomKit(b, rnd); giveArmor(b, arm); }
    // bstart=1 — боты сразу рядом с «игроком» в центре (иначе — у старта на южном краю: идут к нему через карту)
    if (qs.get('bstart') === '1') bots.forEach((b, i) => { const s = freeSpotNear((32 + [-2, 2, 0][i % 3]) * TILE, (24 + [1, 1, 2][i % 3]) * TILE); b.x = b.px = s.x; b.y = b.py = s.y; });
    for (const e of G.enemies) { if (randKit) randomKit(e, rnd); giveArmor(e, earm); }
    const wasDown = new Set();
    for (let i = 0; i < 120 * 60; i++) {
      G.time += 1 / 60; p.hp = 1e12; p.dead = false; p.down = false; p.crouch = true;
      updateWorld(1 / 60);
      for (const b of bots) if (b.down) wasDown.add(b);
      if (G.enemies.every((e) => e.dead) || bots.every((b) => b.dead)) break;
    }
    const kills = G.enemies.filter((e) => e.dead).length, dead = bots.filter((b) => b.dead).length;
    k += kills; d += dead; if (kills === G.enemies.length) w++; per.push(kills + '/' + dead);
    downs += wasDown.size; hpLeft += bots.filter((b) => !b.dead).reduce((s, b) => s + (b.down ? 0 : b.hp), 0);
  }
  return [{ name: cfgName, ok: true, got: { arm, earm, kit: randKit ? 'rand' : 'm4a1', runs, kills: +(k / runs).toFixed(2), botsDead: +(d / runs).toFixed(2),
    botsDowned: +(downs / runs).toFixed(2), hpLeft: +(hpLeft / runs).toFixed(0), wins: w, per } }];
})();
