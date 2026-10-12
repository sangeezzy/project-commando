// Прицел врагов: упреждение по движущемуся герою и темп стрельбы тяжёлого штурмовика.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  try {
    // пустая комната 30x20, враг слева, герой в 300px правее ходит вверх-вниз
    const room = ['#'.repeat(30)];
    for (let y = 0; y < 18; y++) room.push('#' + '.'.repeat(28) + '#');
    room.push('#'.repeat(30));
    const mk = (ch) => {
      const m = room.slice();
      m[9] = '#...' + ch + '.'.repeat(24) + '#';
      m[2] = '#P' + '.'.repeat(26) + 'E#';
      return m;
    };
    const realLead = leadAngle, realFire = enemyFire;
    const trial = (ch, useLead, speed, secs) => {
      LEVELS.push({ name: 'TEST', color: '#fff', map: mk(ch) });
      G.role = 'solo'; G.myIdx = 0; G.players = [makePlayer(0, 'smuggler')];
      startLevel(LEVELS.length - 1);
      LEVELS.pop();
      leadAngle = useLead ? realLead : (e, p) => Math.atan2(p.y - e.y, p.x - e.x);
      let hits = 0, shots = 0, dir = 1, t = 0;
      enemyFire = (a, b) => { shots++; realFire(a, b); };
      const p = me(), e = G.enemies[0];
      e.st = 2; e.react = 1;
      const x0 = e.x + 300;
      p.x = x0; p.y = 9 * TILE + 16;
      for (let i = 0; i < secs * 60; i++) {
        t += 1 / 60;
        if (t > 1.6) { t = 0; dir = -dir; }
        p.x = x0; p.y = clamp(p.y + dir * speed / 60, 2 * TILE + 16, 17 * TILE);
        updateAuthority(1 / 60);
        if (p.dead) { hits++; p.dead = false; G.state = 'play'; }
      }
      leadAngle = realLead; enemyFire = realFire;
      return { shots, hits, rate: shots ? +(hits / shots).toFixed(2) : 0 };
    };
    const noLead = trial('T', false, 180, 30);
    const lead = trial('T', true, 180, 30);
    const still = trial('T', true, 0, 10);
    const heavy = trial('H', true, 180, 30);
    check('упреждение заметно точнее прямого прицела', lead.rate > Math.max(0.3, noLead.rate * 3), { noLead, lead });
    check('по стоящему герою — почти всегда попадает', still.rate >= 0.9, still);
    check('тяжёлый: не меньше 3 выстрелов в секунду', heavy.shots >= 90, heavy);
  } catch (err) { check('без исключений', false, String(err) + ' ' + err.stack); }
  return checks;
})();
