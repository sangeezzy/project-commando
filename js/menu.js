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
  mainMenuEl.classList.remove('hidden'); lobbyEl.classList.add('hidden');
}

function enterLobby() {
  G.state = 'lobby';
  menuEl.classList.remove('hidden'); canvas.classList.remove('playing');
  mainMenuEl.classList.add('hidden'); lobbyEl.classList.remove('hidden');
  setStatus('');
  renderLobby();
}

function renderLobby() {
  const isHost = G.role !== 'guest';
  const nHum = Lobby.slots.filter((s) => s.human).length;
  document.getElementById('lobbyCode').textContent = G.role === 'solo' ? 'ИГРА ОДНОМУ'
    : `ПРЯМОЕ ПОДКЛЮЧЕНИЕ · ДРУЗЬЯМ: ${(Net.addrs || []).map((a) => 'http://' + a).join('  или  ') || location.host} · ИГРОКОВ: ${nHum} из 4`;
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
document.getElementById('btnJoinLocal').addEventListener('click', () => { initAudio(); readName(); joinLocal(addrEl.value); });
addrEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { initAudio(); readName(); joinLocal(addrEl.value); } });
// игру открыли по адресу хоста (не localhost) — скорее всего, чтобы войти к нему: подставить адрес
if (servedByServer() && !/^(localhost|127\.0\.0\.1)(:|$)/.test(location.host)) addrEl.value = location.host;
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
