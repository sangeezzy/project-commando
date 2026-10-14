// Симуляция баланса (не входит в обычный прогон): «игрок» неуязвим, сидит в центре за блоком и не стреляет,
// выстрел поднимает противников, 3 союзных бота против n противников. Варианты поведения ботов — CFG (A — старое, D — текущее).
// Запуск: python dev/sim.py D:8 A:8 D:3   (вариант:число противников, по 12 раундов на каждый, параллельно)
window.__result = (() => {
  const qs = new URLSearchParams(location.search), cfgName = qs.get('cfg') || 'C', nEnemies = +(qs.get('n') || 8);
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
  const runs = 12; let k = 0, d = 0, w = 0; const per = [];
  for (let r = 0; r < runs; r++) {
    G.role = 'solo';
    startRange([{ slot: 0, human: true, name: 'Тест' }], true);
    G.enemies = shuffle(G.enemies.slice()).slice(0, nEnemies);
    const p = me(); p.hp = 1e12; T_.at(p, 32, 24); p.crouch = true; p.gun.chamber = 1; fireRound(p, 0);
    const bots = G.players.filter((q) => q.ai);
    for (let i = 0; i < 120 * 60; i++) {
      G.time += 1 / 60; p.hp = 1e12; p.dead = false; p.down = false; p.crouch = true;
      updateWorld(1 / 60);
      if (G.enemies.every((e) => e.dead) || bots.every((b) => b.dead)) break;
    }
    const kills = G.enemies.filter((e) => e.dead).length, dead = bots.filter((b) => b.dead).length;
    k += kills; d += dead; if (kills === G.enemies.length) w++; per.push(kills + '/' + dead);
  }
  return [{ name: cfgName, ok: true, got: { kills: +(k / runs).toFixed(2), botsDead: +(d / runs).toFixed(2), wins: w, per } }];
})();
