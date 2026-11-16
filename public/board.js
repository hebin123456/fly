'use strict';

/* global io, FlyChess */

const { SEAT_COLORS, SEAT_NAMES, planeCoord, escapeHtml, COORD_MAX } = FlyChess;

const RING = FlyChess.RING;
const GOAL_T = FlyChess.GOAL_T;

const PLANE_PATH =
  'M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z';

const LS_ROOM = 'flychess:board-room';
const socket = io();

let state = null;
let roomCode = '';
let netCfg = null;
let joinUrl = '';
let qrReadyFor = '';
let logLastId = 0;
let startPending = false;

const tokens = new Map();
let goalBadges = [];

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const planesEl = $('planes');

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

function emitAck(event, payload, timeout = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ error: '请求超时，请检查网络' });
    }, timeout);
    socket.emit(event, payload, (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function setConn(online) {
  $('connDot').className = `conn-dot ${online ? 'online' : 'offline'}`;
  $('connText').textContent = online ? '已连接' : '连接已断开';
}

/* ------------------------------------------------------------------ */
/* 棋盘绘制                                                           */
/* ------------------------------------------------------------------ */

function setupBoardDecor() {
  const decor = $('decor');
  const weatherCells = [
    ...FlyChess.TYPHOON_CELLS.map((idx) => [idx, '台']),
    ...FlyChess.LIGHTNING_CELLS.map((idx) => [idx, '雷']),
  ];
  weatherCells.forEach(([idx, glyph]) => {
    const [r, c] = RING[idx];
    const el = document.createElement('div');
    el.className = 'weather-badge';
    el.textContent = glyph;
    el.style.left = `${(c / COORD_MAX) * 100}%`;
    el.style.top = `${(r / COORD_MAX) * 100}%`;
    decor.appendChild(el);
  });

  goalBadges = FlyChess.GOAL_CENTER.map(([r, c], seat) => {
    const el = document.createElement('div');
    el.className = 'goal-badge';
    el.style.setProperty('--c', SEAT_COLORS[seat]);
    el.style.left = `${(c / COORD_MAX) * 100}%`;
    el.style.top = `${(r / COORD_MAX) * 100}%`;
    const count = document.createElement('span');
    count.textContent = '0';
    el.appendChild(count);
    decor.appendChild(el);
    return { el, count };
  });
}

/* ------------------------------------------------------------------ */
/* 棋子                                                               */
/* ------------------------------------------------------------------ */

function createToken(seat) {
  const el = document.createElement('div');
  el.className = 'token';
  el.style.setProperty('--c', SEAT_COLORS[seat]);
  const rot = [90, 180, 270, 0][seat];
  el.style.setProperty('--rot', `${rot}deg`);
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PLANE_PATH}"></path></svg>`;
  return el;
}

function renderTokens() {
  if (!state) return;

  const items = [];
  state.players.forEach((p) => {
    (state.planes[p.seat] || []).forEach((t, plane) => {
      if (t === GOAL_T) return; // 终点用计数徽标展示
      const [r, c] = planeCoord(p.seat, plane, t);
      items.push({ seat: p.seat, plane, t, r, c });
    });
  });

  const groups = new Map();
  items.forEach((it) => {
    const key = `${it.r.toFixed(2)}:${it.c.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  });

  const seen = new Set();
  groups.forEach((list) => {
    const n = list.length;
    list.forEach((it, i) => {
      let r = it.r;
      let c = it.c;
      let scale = 1;
      if (n > 1) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        r += Math.sin(angle) * 4;
        c += Math.cos(angle) * 4;
        scale = 0.8;
      }

      const key = `${it.seat}-${it.plane}`;
      seen.add(key);
      let el = tokens.get(key);
      if (!el) {
        el = createToken(it.seat);
        tokens.set(key, el);
        planesEl.appendChild(el);
      }
      el.style.left = `${(c / COORD_MAX) * 100}%`;
      el.style.top = `${(r / COORD_MAX) * 100}%`;
      el.style.setProperty('--s', scale.toFixed(3));
      const active = state.phase === 'playing' && it.seat === state.turn;
      el.classList.toggle('active', active);
      el.style.zIndex = String(6 + (n > 1 ? 1 : 0));
    });
  });

  tokens.forEach((el, key) => {
    if (!seen.has(key)) {
      el.remove();
      tokens.delete(key);
    }
  });

  renderGoalCounts();
}

function renderGoalCounts() {
  if (!state) return;
  goalBadges.forEach((badge, seat) => {
    const p = state.players.find((x) => x.seat === seat);
    const count = p ? (state.planes[seat] || []).filter((t) => t === GOAL_T).length : 0;
    badge.el.classList.toggle('show', count > 0);
    badge.count.textContent = String(count);
  });
}

/* ------------------------------------------------------------------ */
/* 侧栏渲染                                                           */
/* ------------------------------------------------------------------ */

function renderPlayers() {
  const wrap = $('players');
  const rows = [];
  for (let seat = 0; seat < 4; seat += 1) {
    const p = state.players.find((x) => x.seat === seat);
    if (!p) {
      rows.push(`
        <div class="player-row empty" style="--c:#64748b">
          <span class="pdot"></span>
          <div class="pinfo"><b>空位</b><small>等待扫码加入</small></div>
          <span class="pstate">${SEAT_NAMES[seat]}</span>
        </div>`);
      continue;
    }
    const arrived = (state.planes[p.seat] || []).filter((t) => t === GOAL_T).length;
    const active = state.phase === 'playing' && state.turn === seat;
    const rank = (state.finishOrder || []).indexOf(seat) + 1;
    rows.push(`
      <div class="player-row ${active ? 'active' : ''} ${rank === 1 ? 'champion' : ''}" style="--c:${SEAT_COLORS[seat]}">
        <span class="pdot"></span>
        <div class="pinfo">
          <b>${escapeHtml(p.name)}</b>
          <small>${SEAT_NAMES[seat]} · ${rank ? `第 ${rank} 名` : `已抵达 ${arrived} / 4`}</small>
        </div>
        <span class="pstate ${rank || p.connected || p.isBot ? '' : 'off'}">${
          rank
            ? '完赛'
            : active
              ? p.isBot
                ? '思考中'
                : '行动中'
              : p.isBot
                ? '电脑'
                : p.connected
                  ? '在线'
                  : '离线'
        }</span>
      </div>`);
  }
  wrap.innerHTML = rows.join('');
  $('playerCount').textContent = `${state.players.length} / 4`;
}

function renderTurn() {
  const banner = $('turnBanner');
  const dot = $('turnDot');
  const text = $('turnText');

  if (state.phase === 'lobby') {
    banner.classList.remove('active');
    dot.style.setProperty('--c', '#8b9bb8');
    text.textContent = `等待玩家加入 · ${state.players.length} / 4`;
    return;
  }
  if (state.phase === 'finished') {
    const w = state.players.find((p) => p.seat === state.winner);
    banner.classList.add('active');
    dot.style.setProperty('--c', w ? SEAT_COLORS[w.seat] : '#fbbf24');
    text.textContent = `${w ? w.name : SEAT_NAMES[state.winner] || ''} 获得胜利`;
    return;
  }
  const p = state.players.find((x) => x.seat === state.turn);
  const name = p ? p.name : SEAT_NAMES[state.turn] || '';
  banner.classList.add('active');
  dot.style.setProperty('--c', SEAT_COLORS[state.turn] || '#8b9bb8');
  if (state.awaitingMove) text.textContent = `${name} 正在选择飞机`;
  else if (state.dice != null) text.textContent = `${name} 掷出了 ${state.dice} 点`;
  else text.textContent = `轮到 ${name} 掷骰子`;
}

function renderDice() {
  const face = state.dice != null ? state.dice : state.lastDice;
  $('diceBig').dataset.face = face ? String(face) : '0';

  const p = state.players.find((x) => x.seat === state.turn);
  if (state.phase === 'lobby') {
    $('diceLabel').textContent = '等待开局';
    $('diceSub').textContent = '扫码后由大屏开始游戏';
    return;
  }
  if (state.phase === 'finished') {
    const w = state.players.find((x) => x.seat === state.winner);
    $('diceLabel').textContent = '本局结束';
    $('diceSub').textContent = w ? `${w.name} 拿下胜利` : '四机全部抵达终点';
    return;
  }
  $('diceLabel').textContent = p ? `${p.name} 的回合` : '进行中';
  const bot = Boolean(p && p.isBot);
  if (state.awaitingMove) {
    $('diceSub').textContent = `掷出 ${state.lastDice || state.dice} 点，${
      bot ? '电脑正在选飞机' : '请在手机上选飞机'
    }`;
  } else if (state.dice != null) {
    $('diceSub').textContent = state.dice === 6 ? '掷出 6 点，可以再掷一次' : '等待飞机移动';
  } else {
    $('diceSub').textContent = bot ? '电脑正在掷骰子…' : '等待手机摇一摇掷骰子';
  }
}

function renderLog(force) {
  const logEl = $('log');
  const items = state.log || [];
  if (!items.length) {
    if (force) logEl.innerHTML = '';
    return;
  }
  const last = items[items.length - 1];
  if (!force && last.id < logLastId) force = true;
  if (!force && items[0].id > logLastId + 1 && logLastId !== 0) force = true;
  if (!force && last.id === logLastId) return;

  if (force) {
    logEl.innerHTML = '';
    logLastId = 0;
  }
  const fresh = items.filter((it) => it.id > logLastId);
  fresh.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'log-item';
    row.dataset.type = it.type || 'info';
    row.innerHTML = `<i></i><span>${escapeHtml(it.text)}</span>`;
    logEl.appendChild(row);
  });
  if (fresh.length) {
    logLastId = fresh[fresh.length - 1].id;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function renderControls() {
  const startBtn = $('startBtn');
  const addBotBtn = $('addBotBtn');
  const hint = $('startHint');
  const phaseTag = $('phaseTag');
  const playing = state.phase === 'playing';

  phaseTag.textContent =
    state.phase === 'lobby' ? '等待中' : state.phase === 'playing' ? '进行中' : '已结束';

  $('joinCard').classList.toggle('compact', playing || state.phase === 'finished');
  $('joinCompactCode').textContent = state.code;
  $('joinTitle').textContent = playing || state.phase === 'finished' ? '房间信息' : '手机扫码加入';
  $('rulesCard').classList.toggle('hidden', state.phase !== 'lobby');

  if (state.phase === 'lobby') {
    const bots = state.players.filter((p) => p.isBot).length;
    const hasHuman = state.players.some((p) => !p.isBot);
    const botLimit = hasHuman ? 4 : 3;

    addBotBtn.classList.remove('hidden');
    addBotBtn.disabled = state.players.length >= botLimit;
    startBtn.classList.remove('hidden');

    startBtn.disabled = state.players.length < 2 || !hasHuman || startPending;
    startBtn.textContent = startPending ? '正在开始…' : '开始游戏';

    if (!hasHuman) {
      hint.textContent =
        bots > 0 ? '电脑已就位，手机扫码加入后即可开始' : '手机扫码加入，或点「加满电脑」单人开局';
    } else if (state.players.length < 2) {
      hint.textContent = '再拉一位朋友，或点「加满电脑」单人开局';
    } else if (bots > 0) {
      hint.textContent = `人机对战 · ${bots} 个电脑，点击开始`;
    } else {
      hint.textContent = '人齐了，点击开始（最多 4 人）';
    }
  } else {
    addBotBtn.classList.add('hidden');
    startBtn.classList.add('hidden');
    hint.textContent = playing ? '手机端摇一摇即可掷骰子' : '大屏可直接再来一局';
  }
}

function renderWinner() {
  const overlay = $('winnerOverlay');
  if (state.phase !== 'finished' || state.winner == null) {
    overlay.classList.add('hidden');
    return;
  }
  const w = state.players.find((p) => p.seat === state.winner);
  const name = w ? w.name : SEAT_NAMES[state.winner];
  const rankMode = state.rules && state.rules.endMode === 'rank';
  const order = state.finishOrder || [];

  overlay.classList.remove('hidden');
  $('winnerName').textContent = rankMode ? `冠军 · ${name}` : `${name} 获胜`;
  $('winnerSub').textContent = rankMode ? '比赛结束 · 最终排名' : '四架飞机全部抵达终点';
  $('winnerName').style.setProperty('--win', SEAT_COLORS[state.winner] || '#fbbf24');
  $('winnerName').style.color = SEAT_COLORS[state.winner] || '#fbbf24';

  const ranksEl = $('winnerRanks');
  if (rankMode && order.length) {
    ranksEl.classList.remove('hidden');
    ranksEl.innerHTML = order
      .map((seat, i) => {
        const p = state.players.find((x) => x.seat === seat);
        const color = SEAT_COLORS[seat] || '#8b9bb8';
        return `<div class="winner-rank-row ${i === 0 ? 'first' : ''}">
          <b>${i + 1}</b>
          <span class="pdot" style="--c:${color}"></span>
          <span class="name">${escapeHtml(p ? p.name : SEAT_NAMES[seat])}</span>
          <span class="pstate">${SEAT_NAMES[seat]}</span>
        </div>`;
      })
      .join('');
  } else {
    ranksEl.classList.add('hidden');
    ranksEl.innerHTML = '';
  }
}

function render(forceLog) {
  if (!state) return;
  $('roomCode').textContent = state.code;
  $('board').classList.toggle('weather-off', !(state.rules && state.rules.weather));
  renderRules();
  renderPlayers();
  renderTurn();
  renderDice();
  renderControls();
  renderLog(Boolean(forceLog));
  renderTokens();
  renderWinner();
}

function renderRules() {
  const r = state.rules || {};
  $('ruleWeather').checked = Boolean(r.weather);
  $('ruleStack').checked = Boolean(r.stackMove);
  $('ruleFive').checked = Boolean(r.takeoffFive);

  const endMode = r.endMode === 'rank' ? 'rank' : 'first';
  const botLevel = ['easy', 'normal', 'hard'].includes(r.botLevel) ? r.botLevel : 'normal';
  $('segEndMode')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.value === endMode));
  $('segBotLevel')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.value === botLevel));
}

/* ------------------------------------------------------------------ */
/* 二维码                                                             */
/* ------------------------------------------------------------------ */

async function loadNet() {
  if (netCfg) return netCfg;
  try {
    const res = await fetch('/api/net');
    netCfg = await res.json();
  } catch {
    netCfg = { ips: [], httpPort: 3000, httpsPort: 3443, publicUrl: '', httpsEnabled: false };
  }
  return netCfg;
}

async function buildJoinUrl(code) {
  const cfg = await loadNet();
  const base = String(cfg.publicUrl || '').replace(/\/+$/, '');
  if (base) return `${base}/play?room=${code}`;

  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) return `${location.origin}/play?room=${code}`;

  const ip = (cfg.ips || [])[0];
  if (!ip) return `${location.origin}/play?room=${code}`;
  const isHttps = location.protocol === 'https:';
  const port = isHttps ? cfg.httpsPort || 3443 : cfg.httpPort || 3000;
  return `${isHttps ? 'https' : 'http'}://${ip}:${port}/play?room=${code}`;
}

async function refreshQr(force) {
  if (!roomCode) return;
  if (!force && qrReadyFor === roomCode) return;
  const url = await buildJoinUrl(roomCode);
  joinUrl = url;
  qrReadyFor = roomCode;

  $('joinUrl').textContent = url.replace(/^https?:\/\//, '');
  const img = $('qrImg');
  img.classList.remove('ready');
  img.onload = () => img.classList.add('ready');
  img.src = `/api/qr?text=${encodeURIComponent(url)}&size=440`;

  const cfg = await loadNet();
  const hint = $('sslHint');
  if (location.protocol === 'http:' && cfg.httpsEnabled && cfg.ips && cfg.ips[0]) {
    const httpsUrl = `https://${cfg.ips[0]}:${cfg.httpsPort || 3443}/`;
    hint.innerHTML = `手机摇一摇需要 HTTPS。可先用 <a href="${httpsUrl}">${httpsUrl}</a> 打开大屏（浏览器提示证书风险时选择继续访问）。`;
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}

/* ------------------------------------------------------------------ */
/* 状态同步                                                           */
/* ------------------------------------------------------------------ */

function applyState(next, reset) {
  const roomChanged = state && next && next.code !== state.code;
  state = next;
  roomCode = next.code;
  try {
    localStorage.setItem(LS_ROOM, roomCode);
  } catch {
    /* ignore */
  }
  if (reset || roomChanged) {
    tokens.forEach((el) => el.remove());
    tokens.clear();
    logLastId = 0;
    qrReadyFor = '';
  }
  render(reset || roomChanged);
  refreshQr(reset || roomChanged);
}

async function attach() {
  let saved = '';
  try {
    saved = localStorage.getItem(LS_ROOM) || '';
  } catch {
    /* ignore */
  }
  const fromUrl = String(new URLSearchParams(location.search).get('room') || '')
    .toUpperCase()
    .trim();
  const res = await emitAck('board:attach', { code: fromUrl || saved });
  if (res.ok && res.state) applyState(res.state, true);
  else toast(res.error || '连接棋盘失败');
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                           */
/* ------------------------------------------------------------------ */

socket.on('connect', () => {
  setConn(true);
  attach();
});
socket.on('disconnect', () => setConn(false));
socket.on('connect_error', () => setConn(false));
socket.on('game:state', (s) => {
  if (!s || !s.code) return;
  if (s.code !== roomCode) applyState(s, true);
  else {
    state = s;
    render(false);
  }
});

$('startBtn').addEventListener('click', async () => {
  if (!state || startPending) return;
  startPending = true;
  renderControls();
  const res = await emitAck('board:start', {});
  startPending = false;
  if (res.error) toast(res.error);
  render();
});

$('addBotBtn').addEventListener('click', async () => {
  if (!state || state.phase !== 'lobby') return;
  const res = await emitAck('board:addBots', {});
  if (res.error) toast(res.error);
});

async function saveRules() {
  const endBtn = $('segEndMode').querySelector('button.on');
  const botBtn = $('segBotLevel').querySelector('button.on');
  const res = await emitAck('board:setRules', {
    weather: $('ruleWeather').checked,
    stackMove: $('ruleStack').checked,
    takeoffFive: $('ruleFive').checked,
    endMode: endBtn ? endBtn.dataset.value : 'first',
    botLevel: botBtn ? botBtn.dataset.value : 'normal',
  });
  if (res.error) toast(res.error);
}
['ruleWeather', 'ruleStack', 'ruleFive'].forEach((id) => {
  $(id).addEventListener('change', saveRules);
});

function bindRuleSeg(id) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    $(id)
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('on', b === btn));
    saveRules();
  });
}
bindRuleSeg('segEndMode');
bindRuleSeg('segBotLevel');

$('againBtn').addEventListener('click', async () => {
  const res = await emitAck('board:start', {});
  if (res.error) toast(res.error);
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
    } catch {
      /* ignore */
    }
  }
});

(async function init() {
  setupBoardDecor();
  setConn(socket.connected);
  await loadNet();
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch {
    /* ignore */
  }
})();
