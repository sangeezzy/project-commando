// Враги в темноте видят хуже: замечают героя только вблизи, если его не выдаёт свет.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  const c = (tx, ty) => [tx * TILE + 16, ty * TILE + 16];
  try {
    // миссия 1, левый нижний зал (тёмный): враг в (1,9) смотрит на героя
    const trial = (cls, ptile, opts = {}) => {
      G.role = 'solo'; G.myIdx = 0; G.players = [makePlayer(0, cls)]; startLevel(1);
      const p = me(), e = G.enemies[0];
      for (const o of G.enemies) if (o !== e) o.dead = true;
      [e.x, e.y] = c(...(opts.etile || [1, 9]));
      [p.x, p.y] = c(...ptile); p.rx = p.x; p.ry = p.y; p.mv = MV.IDLE;
      e.a = Math.atan2(p.y - e.y, p.x - e.x); e.look = e.a; e.st = 0;
      if (opts.saberOff) { p.saberOn = false; p.saberLen = 0; }
      if (opts.shot) p.flashT = MUZZLE_FLASH_T;
      for (let i = 0; i < 20; i++) { tickPlayerTimers(p, 1 / 60); updateEnemies(1 / 60); if (e.saw) return true; }
      return false;
    };
    check('тьма, 256px, контрабандист — не замечен', !trial('smuggler', [9, 9]));
    check('тьма, 96px, контрабандист — замечен', trial('smuggler', [4, 9]));
    check('тьма, 256px, меч горит — замечен', trial('jedi', [9, 9]));
    check('тьма, 256px, меч погашен — не замечен', !trial('jedi', [9, 9], { saberOff: true }));
    check('тьма, 256px, сразу после выстрела — замечен', trial('smuggler', [9, 9], { shot: true }));
    check('свет, ~290px, контрабандист — замечен', trial('smuggler', [10, 4], { etile: [1, 4] }));
  } catch (err) { check('без исключений', false, String(err) + ' ' + err.stack); }
  return checks;
})();
