'use strict';

/* global io, FlyChess */

const {
  SEAT_COLORS,
  SEAT_LIGHT,
  SEAT_NAMES,
  planeCoord,
  escapeHtml,
} = FlyChess;

const RING = FlyChess.RING;
const HOME = FlyChess.HOME;
const BASE_SLOTS = FlyChess.BASE_SLOTS;
const GOAL_T = FlyChess.GOAL_T;
const GRID = 14;

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

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
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

function drawBoard() {
  const svg = $('boardSvg');
  svg.setAttribute('viewBox', '0 0 14 14');

  // 底板
  svg.appendChild(
    svgEl('rect', { x: 0, y: 0, width: 14, height: 14, rx: 0.5, fill: '#fbf7ec' })
  );

  // 四角机库（5×5）
  const baseOrigin = [[1, 1], [1, 8], [8, 8], [8, 1]];
  for (let seat = 0; seat < 4; seat += 1) {
    const [br, bc] = baseOrigin[seat];
    svg.appendChild(
      svgEl('rect', {
        x: bc + 0.1,
        y: br + 0.1,
        width: 4.8,
        height: 4.8,
        rx: 0.92,
        fill: SEAT_LIGHT[seat],
        'fill-opacity': 0.85,
        stroke: SEAT_COLORS[seat],
        'stroke-opacity': 0.42,
        'stroke-width': 0.06,
      })
    );
    svg.appendChild(
      svgEl('rect', {
        x: bc + 0.46,
        y: br + 0.46,
        width: 4.08,
        height: 4.08,
        rx: 0.66,
        fill: '#fffdf8',
        'fill-opacity': 0.88,
        stroke: SEAT_COLORS[seat],
        'stroke-opacity': 0.16,
        'stroke-width': 0.04,
      })
    );
    const watermark = svgEl('g', {
      transform: `translate(${bc + 2.5 - 0.66} ${br + 2.5 - 0.66}) scale(0.055)`,
      fill: SEAT_COLORS[seat],
      'fill-opacity': 0.13,
    });
    watermark.appendChild(svgEl('path', { d: PLANE_PATH }));
    svg.appendChild(watermark);
    BASE_SLOTS[seat].forEach(([r, c]) => {
      svg.appendChild(
        svgEl('circle', {
          cx: c,
          cy: r,
          r: 0.42,
          fill: '#fff',
          'fill-opacity': 0.9,
          stroke: SEAT_COLORS[seat],
          'stroke-opacity': 0.52,
          'stroke-width': 0.05,
          'stroke-dasharray': '0.1 0.08',
        })
      );
    });
  }

  // 归航跑道
  for (let seat = 0; seat < 4; seat += 1) {
    HOME[seat].forEach(([r, c]) => {
      svg.appendChild(
        svgEl('rect', {
          x: c + 0.07,
          y: r + 0.07,
          width: 0.86,
          height: 0.86,
          rx: 0.18,
          fill: SEAT_COLORS[seat],
          'fill-opacity': 0.95,
          stroke: '#ffffff',
          'stroke-opacity': 0.9,
          'stroke-width': 0.045,
        })
      );
    });
  }

  // 外圈 52 格主航道
  RING.forEach(([r, c], idx) => {
    const seat = idx % 4;
    const fly = idx % 13 === 5 || idx % 13 === 11;
    const isStart = idx % 13 === 0;
    svg.appendChild(
      svgEl('rect', {
        x: c + 0.06,
        y: r + 0.06,
        width: 0.88,
        height: 0.88,
        rx: 0.18,
        fill: SEAT_COLORS[seat],
        'fill-opacity': fly ? 1 : 0.86,
        stroke: '#ffffff',
        'stroke-opacity': 0.95,
        'stroke-width': 0.045,
      })
    );
    if (fly) {
      const g = svgEl('g', {
        transform: `translate(${c + 0.225} ${r + 0.245}) scale(0.022)`,
        fill: '#ffffff',
        'fill-opacity': 0.92,
      });
      g.appendChild(svgEl('path', { d: PLANE_PATH }));
      svg.appendChild(g);
    }
    if (isStart) {
      svg.appendChild(
        svgEl('circle', {
          cx: c + 0.5,
          cy: r + 0.5,
          r: 0.29,
          fill: 'none',
          stroke: '#ffffff',
          'stroke-opacity': 0.95,
          'stroke-width': 0.07,
        })
      );
    }
  });

  // 飞行捷径虚线（每队一条，飞 12 格）
  [11, 24, 37, 50].forEach((idx) => {
    const seat = idx % 4;
    const [r1, c1] = RING[idx];
    const [r2, c2] = RING[(idx + 12) % RING.length];
    const x1 = c1 + 0.5;
    const y1 = r1 + 0.5;
    const x2 = c2 + 0.5;
    const y2 = r2 + 0.5;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const cx = mx + (7 - mx) * 0.32;
    const cy = my + (7 - my) * 0.32;
    svg.appendChild(
      svgEl('path', {
        d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
        fill: 'none',
        stroke: SEAT_COLORS[seat],
        'stroke-opacity': 0.38,
        'stroke-width': 0.06,
        'stroke-dasharray': '0.15 0.13',
        'stroke-linecap': 'round',
      })
    );
  });

  // 中央终点（2×2 四色风车）
  svg.appendChild(
    svgEl('rect', { x: 6.04, y: 6.04, width: 1.92, height: 1.92, rx: 0.16, fill: '#0b1220' })
  );
  const center = [
    { pts: '6,6 8,6 7,7', seat: 0 },
    { pts: '6,6 6,8 7,7', seat: 1 },
    { pts: '6,8 8,8 7,7', seat: 2 },
    { pts: '8,6 8,8 7,7', seat: 3 },
  ];
  center.forEach(({ pts, seat }) => {
    svg.appendChild(
      svgEl('polygon', {
        points: pts,
        fill: SEAT_COLORS[seat],
        'fill-opacity': 0.95,
        stroke: '#0b1220',
        'stroke-width': 0.035,
      })
    );
  });

  // 终点计数徽标
  goalBadges = [[7, 6.46], [6.46, 7], [7, 7.54], [7.54, 7]].map(([r, c], seat) => {
    const g = svgEl('g', { opacity: 0, 'pointer-events': 'none' });
    g.appendChild(
      svgEl('circle', {
        cx: c,
        cy: r,
        r: 0.245,
        fill: SEAT_COLORS[seat],
        stroke: '#fffdf8',
        'stroke-width': 0.045,
      })
    );
    const text = svgEl('text', {
      x: c,
      y: r + 0.008,
      fill: '#fff',
      'font-size': 0.29,
      'font-weight': '700',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': 'system-ui, -apple-system, sans-serif',
    });
    text.textContent = '0';
    g.appendChild(text);
    svg.appendChild(g);
    return { g, text };
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
        r += Math.sin(angle) * 0.17;
        c += Math.cos(angle) * 0.17;
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
      el.style.left = `${(c / GRID) * 100}%`;
      el.style.top = `${(r / GRID) * 100}%`;
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
    badge.g.setAttribute('opacity', count > 0 ? '1' : '0');
    badge.text.textContent = String(count);
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
    rows.push(`
      <div class="player-row ${active ? 'active' : ''}" style="--c:${SEAT_COLORS[seat]}">
        <span class="pdot"></span>
        <div class="pinfo">
          <b>${escapeHtml(p.name)}</b>
          <small>${SEAT_NAMES[seat]} · 已抵达 ${arrived} / 4</small>
        </div>
        <span class="pstate ${p.connected ? '' : 'off'}">${active ? '行动中' : p.connected ? '在线' : '离线'}</span>
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
  if (state.awaitingMove) {
    $('diceSub').textContent = `掷出 ${state.lastDice || state.dice} 点，请在手机上选一架飞机`;
  } else if (state.dice != null) {
    $('diceSub').textContent = state.dice === 6 ? '掷出 6 点，可以再掷一次' : '等待飞机移动';
  } else {
    $('diceSub').textContent = '等待手机摇一摇掷骰子';
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
  const hint = $('startHint');
  const phaseTag = $('phaseTag');
  const playing = state.phase === 'playing';

  phaseTag.textContent =
    state.phase === 'lobby' ? '等待中' : state.phase === 'playing' ? '进行中' : '已结束';

  $('joinCard').classList.toggle('compact', playing || state.phase === 'finished');
  $('joinCompactCode').textContent = state.code;
  $('joinTitle').textContent = playing || state.phase === 'finished' ? '房间信息' : '手机扫码加入';

  if (state.phase === 'lobby') {
    startBtn.classList.remove('hidden');
    startBtn.disabled = state.players.length < 2 || startPending;
    startBtn.textContent = startPending ? '正在开始…' : '开始游戏';
    hint.textContent =
      state.players.length < 2 ? '至少需要 2 名玩家，扫码邀请朋友' : '人齐了，点击开始（最多 4 人）';
  } else {
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
  overlay.classList.remove('hidden');
  $('winnerName').textContent = `${name} 获胜`;
  $('winnerName').style.setProperty('--win', SEAT_COLORS[state.winner] || '#fbbf24');
  $('winnerName').style.color = SEAT_COLORS[state.winner] || '#fbbf24';
}

function render(forceLog) {
  if (!state) return;
  $('roomCode').textContent = state.code;
  renderPlayers();
  renderTurn();
  renderDice();
  renderControls();
  renderLog(Boolean(forceLog));
  renderTokens();
  renderWinner();
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
  drawBoard();
  setConn(socket.connected);
  await loadNet();
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch {
    /* ignore */
  }
})();
