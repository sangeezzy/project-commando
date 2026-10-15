'use strict';
// ---------- Меню и лобби (DOM) ----------

const menuEl = document.getElementById('menu');
const mainMenuEl = document.getElementById('mainMenu');
const lobbyEl = document.getElementById('lobby');
const statusEl = document.getElementById('status');
const lobbyStatusEl = document.getElementById('lobbyStatus');
const slotsEl = document.getElementById('slots');
const nameEl = document.getElementById('name');
const botsChk = document.getElementById('botsChk');
const lobbyBotsChk = document.getElementById('lobbyBots');

function setStatus(t) { statusEl.textContent = t; }
function hideMenu() { menuEl.classList.add('hidden'); canvas.classList.add('playing'); setStatus(''); }
function showMenu() {
  menuEl.classList.remove('hidden'); canvas.classList.remove('playing');
  mainMenuEl.classList.remove('hidden'); lobbyEl.classList.add('hidden'); lanScreenEl.classList.add('hidden');
  Lan.gen++;                                            // поиск серверов — прекратить
}

function enterLobby() {
  G.state = 'lobby';
  menuEl.classList.remove('hidden'); canvas.classList.remove('playing');
  mainMenuEl.classList.add('hidden'); lobbyEl.classList.remove('hidden'); lanScreenEl.classList.add('hidden');
  Lan.gen++;
  setStatus('');
  renderLobby();
}

function renderLobby() {
  const isHost = G.role !== 'guest';
  const nHum = Lobby.slots.filter((s) => s.human).length;
  // адрес для друзей — крупно, первой строкой (его диктуют): без http:// — так вводят в «Войти»; в браузере — с http://
  const addrs = Net.addrs && Net.addrs.length ? Net.addrs : servedByServer() ? [location.host] : [];
  const addrEl = document.getElementById('lobbyAddr');
  addrEl.classList.toggle('hidden', G.role !== 'host' || !addrs.length);
  addrEl.innerHTML = '';
  if (G.role === 'host' && addrs.length) {
    const line = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; addrEl.appendChild(d); };
    line('small', addrs.length > 1 ? 'АДРЕС ДЛЯ ДРУЗЕЙ (у каждой сети свой — тот, где они):' : 'АДРЕС ДЛЯ ДРУЗЕЙ:');
    line('big', addrs.join('   ·   '));
    line('small', 'в приложении — так и ввести в «Войти»; в браузере — http://' + addrs[0]);
  }
  document.getElementById('lobbyCode').textContent = G.role === 'solo' ? 'ИГРА ОДНОМУ'
    : `ПРЯМОЕ ПОДКЛЮЧЕНИЕ · ИГРОКОВ: ${nHum} из ${Lobby.slots.length}` + (G.role === 'host' && appServer() ? ' · ХОСТ НА ТЕЛЕФОНЕ: НЕ СВОРАЧИВАЙТЕ ИГРУ' : '');
  slotsEl.innerHTML = '';
  for (const s of Lobby.slots) {
    const el = document.createElement('div');
    el.className = 'slot' + (s.human ? '' : ' empty') + (s.slot === G.mySlot ? ' mine' : '');
    el.style.setProperty('--c', SLOT_COLORS[s.slot]);
    const who = s.human ? s.name + (s.slot === G.mySlot ? ' (вы)' : '') : Lobby.bots ? 'союзный бот' : 'пусто';
    const ms = s.human && s.slot !== 0 && G.role !== 'solo' ? pingOf(s.slot) : null;
    const st = s.human ? (s.ready ? 'готов ✓' : 'не готов') + (ms != null ? ` · ${ms} мс` : '') : '';
    el.innerHTML = `<span class="dot"></span><span class="who"></span><span class="st"></span>`;
    el.querySelector('.who').textContent = who;
    el.querySelector('.st').textContent = st;
    el.querySelector('.st').classList.toggle('ok', !!s.ready);
    slotsEl.appendChild(el);
  }
  const mine = Lobby.slots[G.mySlot];
  const btnReady = document.getElementById('btnReady');
  btnReady.classList.toggle('on', !!(mine && mine.ready));
  btnReady.textContent = mine && mine.ready ? 'ГОТОВ ✓' : 'ГОТОВ';
  const btnStart = document.getElementById('btnStart');
  btnStart.classList.toggle('hidden', !isHost);
  btnStart.disabled = !lobbyReady();
  lobbyBotsChk.checked = Lobby.bots;
  voiceChk.checked = !!Voice.stream;
  voiceChk.disabled = G.role === 'solo';
  lobbyBotsChk.disabled = !isHost;
  const waiting = Lobby.slots.filter((s) => s.human && !s.ready).map((s) => s.name);
  lobbyStatusEl.textContent = !mine || !mine.ready ? 'Нажмите «Готов»'
    : waiting.length ? `Ждём готовности: ${waiting.join(', ')}`
    : isHost ? 'Все готовы — можно начинать' : 'Все готовы — ждём, когда хост начнёт';
}

function toggleReady() {
  const s = Lobby.slots[G.mySlot];
  if (!s) return;
  if (G.role === 'guest') { send({ t: 'ready', v: !s.ready }); return; }
  s.ready = !s.ready;
  lobbyChanged();
}

document.getElementById('btnReady').addEventListener('click', () => { initAudio(); toggleReady(); });
document.getElementById('btnStart').addEventListener('click', () => { initAudio(); startGameFromLobby(); });
document.getElementById('btnLeave').addEventListener('click', () => leaveToMenu(''));
lobbyBotsChk.addEventListener('change', () => {
  if (G.role === 'guest') return;
  Lobby.bots = lobbyBotsChk.checked;
  botsChk.checked = Lobby.bots;
  saveBots();
  lobbyChanged();
});

// Позывной и галочка ботов сохраняются между запусками
try {
  nameEl.value = localStorage.getItem('pcr-name') || '';
  botsChk.checked = localStorage.getItem('pcr-bots') !== '0';
} catch (e) { /* ignore */ }
function saveBots() { try { localStorage.setItem('pcr-bots', botsChk.checked ? '1' : '0'); } catch (e) { /* ignore */ } }
botsChk.addEventListener('change', saveBots);
// мест в отряде (2–8): одиночка и хост выбирают в главном меню, запоминается
const slotsSel = document.getElementById('slotsN');
try { Lobby.size = clamp(+localStorage.getItem('pcr-slots') || 4, SQUAD_MIN, SQUAD_MAX); } catch (e) { /* ignore */ }
slotsSel.value = String(Lobby.size);
slotsSel.addEventListener('change', () => { Lobby.size = clamp(+slotsSel.value || 4, SQUAD_MIN, SQUAD_MAX); try { localStorage.setItem('pcr-slots', String(Lobby.size)); } catch (e) { /* ignore */ } });

function readName() {
  const n = nameEl.value.trim().slice(0, 16) || 'Боец';
  G.myName = n;
  try { localStorage.setItem('pcr-name', n); } catch (e) { /* ignore */ }
}

function startSolo() {
  readName();
  cleanupNet();
  G.role = 'solo'; G.mySlot = 0;
  Lobby.slots = emptySlots();
  Object.assign(Lobby.slots[0], { human: true, name: G.myName });
  Lobby.bots = botsChk.checked;
  enterLobby();
}

document.getElementById('btnSolo').addEventListener('click', () => { initAudio(); startSolo(); });
document.getElementById('btnHostLocal').addEventListener('click', () => { initAudio(); readName(); Lobby.bots = botsChk.checked; hostLocal(); });
const addrEl = document.getElementById('addr');
document.getElementById('btnJoinLocal').addEventListener('click', () => { initAudio(); readName(); rememberAddr(); joinLocal(addrEl.value); });
addrEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { initAudio(); readName(); rememberAddr(); joinLocal(addrEl.value); } });
// игру открыли по адресу хоста (не localhost) — скорее всего, чтобы войти к нему: подставить адрес; иначе — прошлый адрес
if (servedByServer() && !/^(localhost|127\.0\.0\.1)(:|$)/.test(location.host)) addrEl.value = location.host;
else { try { addrEl.value = localStorage.getItem('pcr-addr') || ''; } catch (e) { /* ignore */ } }
const rememberAddr = () => { try { if (addrEl.value.trim()) localStorage.setItem('pcr-addr', addrEl.value.trim()); } catch (e) { /* ignore */ } };
// приложение для телефона (dev/android: index.html?app=1) — комнату создать нельзя (нет сервера), только войти к хосту
const IS_APP = new URLSearchParams(location.search).has('app');
if (IS_APP) {
  document.documentElement.classList.add('app');
  document.getElementById('btnHostLocal').textContent = 'СОЗДАТЬ КОМНАТУ НА ЭТОМ ТЕЛЕФОНЕ';
}
// ---------- Список локальных серверов ----------
// Браузер сам не умеет широковещательный UDP, поэтому два пути:
//  1) свой сервер (страница открыта с него — «Играть.bat», или сервер приложения на телефоне) опрашивает все свои сети
//     по UDP (GET /lan или CommandoApp.lanScan) — так находятся и хосты в Radmin VPN / ZeroTier; заодно сообщает свои адреса;
//  2) перебор адресов своих подсетей /24 (192.168.x.*, 10.x.x.*, 172.16–31.x.*) на порту 8000 — без своего сервера и UDP.
// Каждый адрес проверяется запросом GET /info (есть ли комната, гости, что сообщил хост — sendRoomInfo в net.js).
const lanScreenEl = document.getElementById('lanScreen');
const lanListEl = document.getElementById('lanList'), lanStatusEl = document.getElementById('lanStatus');
const Lan = { gen: 0, rooms: new Map(), empty: new Set(), seen: new Set(), left: 0 };
const LAN_PROBE_MS = 1500, LAN_PAR = 96, LAN_PORT = 8000;
const LAN_MAP = { hub: 'хаб', range: 'полигон', ...Object.fromEntries(HUB_EXITS.map((e) => [e.map, e.name.replace(/^.*?:\s*/, '').toLowerCase()])) };
const lanPrivate = (ip) => /^(192\.168|10|172\.(1[6-9]|2\d|3[01]))\./.test(ip);

async function lanFetch(url, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, cache: 'no-store' }); return r.ok ? await r.json() : null; }
  catch (e) { return null; }
  finally { clearTimeout(t); }
}

// Свои адреса и ответы на UDP-опрос — от своего сервера или приложения; нет ни того, ни другого — пусто
async function lanAsk() {
  const app = window.CommandoApp && typeof CommandoApp.lanScan === 'function' ? CommandoApp : null;
  if (app) { try { return JSON.parse(app.lanScan()); } catch (e) { /* ignore */ } }
  if (servedByServer()) { const r = await lanFetch('/lan', 3000); if (r) return r; }
  return { addrs: [], found: [] };
}

function openLanList() {
  mainMenuEl.classList.add('hidden'); lanScreenEl.classList.remove('hidden');
  setStatus('');
  lanScan();
}

async function lanScan() {
  const gen = ++Lan.gen;
  Lan.rooms.clear(); Lan.empty.clear(); Lan.seen.clear(); Lan.left = 1;
  renderLan();
  const [ask, own] = await Promise.all([lanAsk(), servedByServer() ? lanFetch('/info', LAN_PROBE_MS) : null]);
  if (gen !== Lan.gen) return;
  if (own && own.commando && !own.room) Lan.seen.add(own.id);     // свой сервер без комнаты — не показывать
  // кого проверить: сначала ответившие по UDP, адрес этой страницы и прошлый адрес, потом подсети /24
  const first = [...(ask.found || [])];
  if (servedByServer() && !/^(localhost|127\.)/.test(location.hostname)) first.push(location.host);
  let last = '';
  try { last = (wsTarget(localStorage.getItem('pcr-addr') || '') || {}).host || ''; } catch (e) { /* ignore */ }
  if (last) first.push(last);
  const nets = new Set();
  for (const a of [...(ask.addrs || []), ...first.map((h) => h.split(':')[0])]) if (lanPrivate(a)) nets.add(a.split('.').slice(0, 3).join('.'));
  if (!nets.size) ['192.168.0', '192.168.1', '192.168.43', '192.168.137'].forEach((n) => nets.add(n));   // свои адреса неизвестны — частые домашние сети и точки доступа
  const queue = [...first];
  for (const n of [...nets].slice(0, 6)) for (let i = 1; i < 255; i++) queue.push(`${n}.${i}:${LAN_PORT}`);
  const hosts = [...new Set(queue)];
  Lan.left = hosts.length;
  renderLanStatus();
  let next = 0;
  const worker = async () => {
    while (next < hosts.length && gen === Lan.gen) {
      const h = hosts[next++];
      const r = await lanFetch(`http://${h}/info`, LAN_PROBE_MS);
      if (gen !== Lan.gen) return;
      Lan.left--;
      if (r && r.commando && !Lan.seen.has(r.id)) {
        Lan.seen.add(r.id);                     // один сервер под разными адресами — одна строка (первый ответивший адрес)
        if (r.room) Lan.rooms.set(r.id, { host: h, info: r.info || {}, guests: r.guests | 0 });
        else Lan.empty.add(h);
        renderLan();
      } else if (Lan.left % 16 === 0) renderLanStatus();
    }
  };
  await Promise.all(Array.from({ length: LAN_PAR }, worker));
  if (gen === Lan.gen) renderLan();
}

function renderLanStatus() {
  const n = Lan.rooms.size;
  const empty = Lan.empty.size ? ` · серверов без комнаты: ${Lan.empty.size}` : '';
  lanStatusEl.textContent = (Lan.left > 0 ? `Ищем… осталось проверить адресов: ${Lan.left}` : n ? `Найдено комнат: ${n}` : 'Комнат не найдено') + empty;
}

function renderLan() {
  renderLanStatus();
  lanListEl.innerHTML = '';
  if (!Lan.rooms.size) {
    const d = document.createElement('div');
    d.className = 'lan none';
    d.textContent = Lan.left > 0 ? 'поиск…' : 'никого — хост создал комнату? вы в одной сети?';
    lanListEl.appendChild(d);
    return;
  }
  for (const r of Lan.rooms.values()) {
    const I = r.info, el = document.createElement('div');
    el.className = 'lan';
    const humans = I.h || r.guests + 1, slots = I.s || 0, full = slots && humans >= slots;
    const where = I.m ? 'в игре: ' + (LAN_MAP[I.m] || I.m) : I.n ? 'в лобби' : '';
    const other = I.v && I.v !== GAME_VERSION;
    el.innerHTML = '<span class="who"><span class="name"></span><span class="what"></span></span><button>ВОЙТИ</button>';
    el.querySelector('.name').textContent = (I.n ? 'Хост: ' + I.n : 'Комната') + ' · игроков ' + humans + (slots ? ' из ' + slots : '');
    const what = el.querySelector('.what');
    what.textContent = [r.host, where, other ? 'другая версия игры — не войти' : '', full ? 'мест нет' : ''].filter(Boolean).join(' · ');
    what.classList.toggle('bad', !!(other || full));
    const btn = el.querySelector('button');
    btn.disabled = !!(other || full);
    btn.addEventListener('click', () => {
      initAudio(); readName();
      addrEl.value = r.host; rememberAddr();
      showMenu();
      joinLocal(r.host);
    });
    lanListEl.appendChild(el);
  }
}

document.getElementById('btnLan').addEventListener('click', () => { initAudio(); openLanList(); });
document.getElementById('btnLanRefresh').addEventListener('click', () => lanScan());
document.getElementById('btnLanBack').addEventListener('click', () => showMenu());

// Голосовой чат: включается в лобби
const voiceChk = document.getElementById('voiceChk'), voiceStatusEl = document.getElementById('voiceStatus');
voiceChk.addEventListener('change', async () => {
  if (voiceChk.checked) {
    voiceStatusEl.textContent = 'Запрашиваем микрофон…';
    const ok = await Voice.enable();
    voiceStatusEl.textContent = ok ? 'Микрофон включён. В бою: рядом слышно без рации, B — рация, M — микрофон вкл/выкл.' : Voice.error;
    if (!ok) voiceChk.checked = false;
  } else { Voice.disable(); voiceStatusEl.textContent = ''; }
});

// Esc в бою — выйти в меню
addEventListener('keydown', (e) => { if (e.code === 'Escape' && G.state !== 'menu' && G.state !== 'lobby') leaveToMenu(''); });
