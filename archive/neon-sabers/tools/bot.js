// Тестовый бот. Внедряется в страницу игры (tools/bot.html).
// Ищет ближайшего врага (на базе — площадку первой невыполненной миссии), идёт к нему по BFS,
// целится и атакует. В headless requestAnimationFrame почти не срабатывает,
// поэтому бот сам двигает симуляцию: update(1/60) каждые 16 мс.
window.__errors = [];
window.addEventListener('error', (e) => __errors.push(String(e.message) + ' @' + e.lineno));
window.__stats = { frames: 0, deaths: 0, levels: new Set() };

function botTick() {
  if (window.__botOff) return;
  if (G.role === 'none' || !map) return;
  __stats.frames++;
  __stats.levels.add(G.lv);
  const p = me();
  if (!p) return;
  if (G.state !== 'play') {
    if (G.overT > 0.7 && isAuth()) { __stats.deaths++; requestRestart(); }
    return;
  }
  let t = null, td = 1e9;
  for (const e of G.enemies) if (!e.dead) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < td) { td = d; t = e; } }
  if (!t && G.exitOpen) t = map.exit;
  if (map.hub) {
    const pads = map.pads.filter((pd) => missionUnlocked(pd.lv));
    t = pads.find((pd) => !G.progress[pd.lv].done) || pads[0];
  }
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) keys[k] = false;
  if (!t) return;

  // BFS от цели до бота
  const w = map.w, f = new Int32Array(w * map.h).fill(1e9), q = [];
  const ti = Math.floor(t.y / TILE) * w + Math.floor(t.x / TILE);
  f[ti] = 0; q.push(ti);
  while (q.length) {
    const i = q.shift(), x = i % w, y = (i / w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (solidTile(nx, ny)) continue;
      const j = ny * w + nx;
      if (f[j] > f[i] + 1) { f[j] = f[i] + 1; q.push(j); }
    }
  }
  const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
  let best = f[py * w + px], bx = px, by = py;
  for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
    if (!solidTile(nx, ny) && f[ny * w + nx] < best) { best = f[ny * w + nx]; bx = nx; by = ny; }
  }
  const seeT = los(p.x, p.y, t.x, t.y);
  let gx = bx * TILE + 16, gy = by * TILE + 16;
  if (seeT) { gx = t.x; gy = t.y; }
  const dx = gx - p.x, dy = gy - p.y;
  if (dx > 4) keys.KeyD = true;
  if (dx < -4) keys.KeyA = true;
  if (dy > 4) keys.KeyS = true;
  if (dy < -4) keys.KeyW = true;

  mouse.x = t.x - G.cam.x + VW / 2;
  mouse.y = t.y - G.cam.y + VH / 2;
  mouse.l = !map.hub && seeT && (p.cls === 'smuggler' ? td < 400 : td < 70);
  if (seeT && td < 160 && p.spCd <= 0 && Math.random() < 0.02) mouse.rPressed = true;
  if (Math.random() < 0.01) spacePressed = true;
}

setInterval(() => {
  botTick();
  if (G.role !== 'none' && map) { G.time += 1 / 60; update(1 / 60); }
}, 16);

function report() {
  return JSON.stringify({
    gtime: +G.time.toFixed(1), errors: __errors, role: G.role, lv: G.lv, state: G.state, score: G.score,
    frames: __stats.frames, deaths: __stats.deaths, levels: [...__stats.levels],
    enemiesLeft: G.enemies.filter((e) => !e.dead).length,
    players: G.players.map((p) => ({ idx: p.idx, cls: p.cls, dead: p.dead, x: Math.round(p.x), y: Math.round(p.y) })),
    net: { code: Net.code, connected: Net.connected }, hub: map ? map.hub : null,
    progress: G.progress.map((q) => (q.done ? 'V' : '-') + q.best).join(' '),
  });
}
