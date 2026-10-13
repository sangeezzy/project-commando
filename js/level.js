'use strict';
// ---------- Тестовая карта «Полигон» 72×54 м: набор укрытий, старт на южном краю, противники вне поля зрения ----------

const LEVEL_W = 72, LEVEL_H = 54;
const PLAYER_START = { x: 43.5, y: 51.5 };        // южный край: до ближайшего противника ~14 м, никого не видно

// Строитель с масштабом S: стены, здания, площадки и свет растягиваются, а предметы (машины, контейнеры, ящики, укрытия)
// сохраняют настоящий размер — меняется только их место. Толщина стен — одна клетка, как была.
function scaledBuilder(b, S) {
  if (S === 1) return b;
  const c = (v) => Math.round(v * S);
  const keep = (x0, y0, x1, y1) => [c(x0), c(y0), c(x0) + (x1 - x0), c(y0) + (y1 - y0)];
  return {
    fill: (x0, y0, x1, y1, fm) => b.fill(c(x0), c(y0), c(x1), c(y1), fm),
    wall: (x0, y0, x1, y1, wm) => b.wall(c(x0), c(y0), c(x1), c(y1), wm),
    box: (x0, y0, x1, y1, wm, fm, doors = []) => b.box(c(x0), c(y0), c(x1), c(y1), wm, fm, doors.map(([x, y]) => [c(x), c(y)])),
    low: (x0, y0, x1, y1, wm) => b.low(...keep(x0, y0, x1, y1), wm),
    prop: (kind, x0, y0, x1, y1, props) => b.prop(kind, ...keep(x0, y0, x1, y1), props),
    door: (x, y, type, props) => b.door(c(x), c(y), type, props),
    key: (id, x, y, name) => b.key(id, c(x), c(y), name),
    dark: (x0, y0, x1, y1, v) => b.dark(c(x0), c(y0), c(x1), c(y1), v),
    ent: (kind, x, y, props) => b.ent(kind, x * S, y * S, props),
    enemy: (x, y, props) => b.enemy(c(x), c(y), props),
  };
}

// opts: scale — увеличенный вариант (×scale), enemies — расставить противников полигона (false — пустая карта), name
function buildRange(opts = {}) {
  const S = opts.scale || 1;
  const W = Math.round(LEVEL_W * S), H = Math.round(LEVEL_H * S);
  const b0 = new MapBuilder(W, H, 2026);
  const b = scaledBuilder(b0, S);
  b0.fill(1, 1, W - 2, H - 2, FM.ASPHALT);
  b.fill(44, 1, LEVEL_W - 2, 20, FM.GRAVEL);       // контейнерный двор
  b.fill(1, 33, 21, LEVEL_H - 2, FM.DIRT);         // пустырь у бункера
  b.fill(28, 20, 44, 34, FM.CONCRETE);             // бетонная площадка в центре

  // разметка дороги
  for (let x = 2; x < LEVEL_W - 2; x += 3) if (x < 27 || x > 45) b.ent('stripe', x, 27.42, { w: 1.6, h: 0.16 });

  // --- рядом с игроком: бетонные блоки, ящики, бочки ---
  b.low(31, 23, 34, 23, WM.JERSEY);
  b.low(38, 31, 41, 31, WM.JERSEY);
  b.low(30, 28, 30, 30, WM.JERSEY);
  b.low(42, 24, 42, 26, WM.JERSEY);
  b.low(33, 30, 34, 30, WM.CRATE);
  b.low(39, 23, 39, 23, WM.BARREL);

  // --- середина поля ---
  b.low(24, 20, 27, 20, WM.JERSEY);
  b.low(45, 33, 48, 33, WM.JERSEY);
  b.low(22, 30, 22, 33, WM.JERSEY);
  b.low(50, 22, 50, 25, WM.JERSEY);
  b.low(44, 18, 46, 18, WM.SANDBAG); b.low(44, 19, 44, 19, WM.SANDBAG); b.low(46, 19, 46, 19, WM.SANDBAG);
  b.low(26, 35, 27, 35, WM.CRATE); b.low(26, 36, 26, 36, WM.CRATE);
  b.low(47, 27, 47, 28, WM.CRATE);
  b.low(40, 19, 41, 19, WM.BARREL); b.low(23, 26, 23, 26, WM.BARREL);
  b.prop('car', 22, 15, 25, 16, { color: '#6c7580' });
  b.prop('car', 40, 36, 43, 37, { color: '#7a3b32' });

  // --- северо-запад: кирпичное здание с перегородкой ---
  b.box(6, 6, 20, 16, WM.BRICK, FM.INDOOR, [[13, 16], [20, 11], [9, 6]]);
  b.wall(13, 7, 13, 10, WM.BRICK);
  b.low(8, 8, 9, 8, WM.CRATE);
  b.door(13, 16, 'wood');                              // деревянная, не заперта
  b.door(20, 11, 'wood', { key: 'red' });              // деревянная, заперта — ключ или выбить
  b.door(9, 6, 'metal', { key: 'blue' });              // металлическая, заперта — ключ или выбить (трудно)

  // --- север: фанерный забор (пуля прошивает, но не видно) ---
  b.wall(26, 13, 32, 13, WM.PLYWOOD);
  b.wall(35, 13, 40, 13, WM.PLYWOOD);

  // --- северо-восток: контейнерный двор ---
  b.prop('container', 46, 5, 51, 6, { color: '#3f5f7a' });
  b.prop('container', 46, 9, 51, 10, { color: '#7a3f32' });
  b.prop('container', 55, 4, 56, 9, { color: '#5f6a3a' });
  b.prop('container', 59, 12, 64, 13, { color: '#8a6a2a' });
  b.prop('container', 54, 16, 59, 17, { color: '#3f5f7a' });
  b.low(61, 6, 62, 6, WM.CRATE);

  // --- запад: руины кирпичной стены ---
  b.wall(10, 24, 10, 31, WM.BRICK);
  b.wall(8, 24, 9, 24, WM.BRICK);

  // --- восток: контейнер поперёк дороги ---
  b.prop('container', 60, 24, 61, 29, { color: '#6a6f74' });
  b.low(65, 22, 65, 23, WM.BARREL);

  // --- юго-запад: бетонный бункер с мешками ---
  b.wall(8, 36, 18, 36, WM.CONCRETE);
  b.wall(18, 37, 18, 41, WM.CONCRETE);
  b.low(9, 44, 14, 44, WM.SANDBAG);
  b.low(8, 40, 8, 43, WM.SANDBAG);

  // --- юг: бетонный сарай ---
  b.box(29, 40, 39, 46, WM.CONCRETE, FM.INDOOR, [[34, 40], [39, 44]]);
  b.low(35, 43, 36, 43, WM.CRATE);
  b.door(34, 40, 'wood', { open: true });              // деревянная, открыта с самого начала
  b.door(39, 44, 'armored', { key: 'yellow' });        // бронированная, заперта — только ключом

  // --- юго-восток: гараж, штабель ящиков ---
  b.box(52, 42, 66, 50, WM.BRICK, FM.INDOOR, [[52, 46], [56, 42], [66, 47]]);
  b.wall(59, 43, 59, 45, WM.BRICK);
  b.door(52, 46, 'metal');                             // металлическая, не заперта
  b.door(56, 42, 'wood', { key: 'green' });            // деревянная, заперта
  b.door(66, 47, 'armored');                           // бронированная, не заперта
  b.wall(46, 44, 47, 46, WM.STACK);
  b.prop('car', 50, 36, 51, 39, { color: '#c9c3b5' });
  b.prop('car', 54, 36, 55, 39, { color: '#2f3a48' });

  // --- ключи: до каждого можно дойти, не проходя через его дверь ---
  b.key('red', 22, 18, 'Ключ от склада');               // у серой машины → дверь (20, 11)
  b.key('blue', 53, 8, 'Ключ от служебного входа');     // в контейнерном дворе → металлическая дверь (9, 6)
  b.key('green', 12, 42, 'Ключ от гаража');             // у бункера → дверь гаража (56, 42)
  b.key('yellow', 17, 8, 'Ключ от бронедвери');         // в дальней комнате кирпичного здания → сарай (39, 44)

  // --- освещение помещений (свет из дверей затекает внутрь сам) ---
  b.dark(7, 7, 12, 15, 0.25);        // кирпичное здание: комната с окнами
  b.dark(13, 7, 19, 15, 0.1);        // …дальняя комната
  b.dark(30, 41, 38, 45, 0.06);      // бетонный сарай — почти темно
  b.dark(53, 43, 58, 49, 0.12);      // гараж
  b.dark(59, 43, 65, 49, 0.03);      // …глухая часть гаража — кромешная тьма

  // --- противники: все вне прямой видимости игрока на старте ---
  // a — куда смотрит, patrol — точки обхода (клетки)
  if (opts.enemies !== false) addRangeEnemies(b);

  return finishMap(b0, { name: opts.name || 'ПОЛИГОН', start: { x: PLAYER_START.x * S, y: PLAYER_START.y * S } });
}

function addRangeEnemies(b) {
  b.enemy(17, 13, { a: Math.PI });
  b.enemy(48, 7, { a: Math.PI, patrol: [[47, 7], [52, 7]] });
  b.enemy(29, 9, { a: Math.PI / 2, patrol: [[27, 9], [31, 10]] });
  b.enemy(12, 39, { a: 0 });
  b.enemy(57, 46, { a: -Math.PI / 2 });
  b.enemy(31, 44, { a: -Math.PI / 2 });
  b.enemy(6, 27, { a: 0, patrol: [[6, 25], [6, 30]] });
  b.enemy(64, 27, { a: Math.PI });
}

// ---------- Хаб: отсюда — на карты ----------
// Помещение 30×22 м; на севере — проходы на карты (встать и постоять 2 с — хост), перед ними — оружейный стол
const HUB_W = 30, HUB_H = 22;
const HUB_EXITS = [
  { map: 'big', name: 'КАРТА 1: ПОЛИГОН ×1,5', desc: 'увеличенный полигон без противников — пристрелка', x0: 5, y0: 1, x1: 9, y1: 2 },
  { map: 'clear', name: 'КАРТА 2: ЗАЧИСТКА', desc: '8–12 противников, старт с края карты, уничтожить всех', x0: 20, y0: 1, x1: 24, y1: 2 },
];
const HUB_TABLE = { x0: 12, y0: 9, x1: 17, y1: 10 };
function buildHub() {
  const b = new MapBuilder(HUB_W, HUB_H, 7);
  b.box(0, 0, HUB_W - 1, HUB_H - 1, WM.CONCRETE, FM.CONCRETE);
  b.fill(1, 1, HUB_W - 2, HUB_H - 2, FM.CONCRETE);
  // проходы на север: в стене — проёмы, за ними — «коридор» в никуда (зона перехода)
  for (const e of HUB_EXITS) b.fill(e.x0, 0, e.x1, 0, FM.ASPHALT);
  for (const e of HUB_EXITS) for (let x = e.x0; x <= e.x1; x++) b.set(x, 0, T.FLOOR, FM.ASPHALT);
  b.prop('table', HUB_TABLE.x0, HUB_TABLE.y0, HUB_TABLE.x1, HUB_TABLE.y1, {});
  b.low(2, 16, 3, 16, WM.CRATE); b.low(2, 17, 2, 17, WM.CRATE);
  b.low(26, 15, 27, 15, WM.SANDBAG); b.low(25, 18, 27, 18, WM.JERSEY);
  b.low(9, 6, 10, 6, WM.BARREL);
  return finishMap(b, { name: 'ХАБ', start: { x: 15, y: 17 } });
}

// Карта по идентификатору: hub — хаб, big — увеличенный пустой полигон, clear — полигон (противники — из missionSetup),
// range — классический полигон (тесты, автотест)
function buildMap(id) {
  if (id === 'hub') return buildHub();
  if (id === 'big') return buildRange({ scale: 1.5, enemies: false, name: 'ПОЛИГОН ×1,5' });
  if (id === 'clear') return buildRange({ enemies: false, name: 'ЗАЧИСТКА' });
  return buildRange();
}
