'use strict';

/**
 * 飞行棋规则引擎（与网络层解耦，方便单测）
 *
 * 位置编码（每个玩家 4 架飞机）：
 *   -1        机库（未起飞）
 *   0..50     主航道（环形 52 格中的 51 格，起点为 0）
 *   51..55    归航跑道
 *   56        终点
 */

const COLORS = ['yellow', 'blue', 'red', 'green'];
const COLOR_NAMES = { red: '红队', yellow: '黄队', blue: '蓝队', green: '绿队' };
const COLOR_HEX = { red: '#ef4444', yellow: '#f59e0b', blue: '#3b82f6', green: '#22c55e' };

// 复刻 netmanfisher/chinese-ludo 的 600×600 棋盘路线（MIT）
const RING = [
    [300.8, 42.5], [266.4, 44.5], [232.7, 44.5], [196.2, 57.1], [180.8, 93.5],
    [180.8, 127.1], [196.2, 163.6], [165.4, 194.3], [128.9, 178.9], [94.5, 178.9],
    [57.6, 194.3], [45.0, 231.2], [45.0, 265.6], [45.0, 299.6], [45.0, 334.0],
    [45.0, 368.0], [57.6, 405.3], [94.5, 420.6], [128.9, 420.6], [165.4, 405.3],
    [196.2, 436.0], [180.8, 472.5], [180.8, 506.1], [196.2, 542.1], [232.7, 555.1],
    [266.4, 555.1], [300.0, 555.1], [333.6, 555.1], [367.3, 555.1], [403.4, 542.5],
    [418.8, 506.1], [418.8, 472.1], [426.5, 439.3], [434.2, 405.3], [471.1, 420.6],
    [505.5, 420.6], [542.4, 405.3], [554.6, 368.0], [555.0, 334.0], [555.0, 299.6],
    [555.0, 265.6], [554.6, 231.2], [542.4, 194.3], [505.5, 178.9], [471.1, 178.9],
    [434.2, 194.3], [403.8, 163.6], [418.8, 127.1], [418.8, 93.5], [403.4, 57.1],
    [367.3, 44.5], [333.6, 44.5],
  ];

  // 每队 5 格归航跑道（主航道入口之后的 5 格，指向中心）
  const HOME = [
    [[300.0, 93.5], [300.0, 127.9], [300.0, 161.9], [300.0, 196.0], [300.0, 230.0]],
    [[93.6, 299.6], [127.7, 299.6], [161.8, 299.6], [195.8, 299.6], [230.3, 299.6]],
    [[300.0, 505.7], [300.0, 471.7], [300.0, 437.7], [300.0, 403.2], [300.0, 369.2]],
    [[505.9, 299.6], [471.9, 299.6], [437.8, 299.6], [403.8, 299.6], [369.7, 299.6]],
  ];

  // 四角机库里的 4 个停机位
  const BASE_SLOTS = [
    [[46.2, 45.3], [46.2, 99.2], [97.7, 44.9], [97.7, 98.8]],
    [[45.4, 501.6], [45.4, 553.0], [98.9, 501.6], [99.3, 553.0]],
    [[501.9, 500.8], [501.9, 554.3], [553.8, 500.4], [553.8, 554.3]],
    [[501.1, 46.2], [501.1, 98.0], [554.6, 46.6], [555.0, 98.0]],
  ];

  // 中心终点（四色三角区域）
  const GOAL_CENTER = [[300.4, 279.4], [279.7, 300.0], [300.4, 320.6], [321.1, 300.0]];

  // 特殊天气格（按环形下标）
const TYPHOON_CELLS = [6, 19, 32, 45];
const LIGHTNING_CELLS = [10, 23, 36, 49];

// 各队飞行捷径触发格（环形下标，+12）
const FLY_TRIGGERS = [20, 33, 46, 7];
// 环形格颜色：0 绿、1 黄、2 蓝、3 红，映射到座位
const CELL_SEAT = [3, 0, 1, 2];
// 每队进入主航道的第一格（环形下标）与起飞等待点
const PATH_START = [3, 16, 29, 42];
const TAKEOFF = [
  [170, 15],
  [17, 429],
  [430, 582],
  [582, 168],
];

const DEFAULT_RULES = {
  weather: true,
  stackMove: false,
  takeoffFive: false,
  teamMode: false,
  endMode: 'first', // first | rank
  botLevel: 'normal', // easy | normal | hard
};

const TEAM_NAMES = ['黄红队', '蓝绿队'];

const TRACK_LAST = 50;
const GOAL_T = 56;
const MAX_PLAYERS = 4;
const START_STEP = 13;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const randInt = (n) => Math.floor(Math.random() * n);
const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i += 1) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
  return s;
}

function sanitizeName(raw, fallback) {
  const name = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 12);
  return name || fallback;
}

/** 玩家 seat 的第 t 步（t≥1）落在环形航道的第几格 */
function ringIndexOf(seat, t) {
  return (PATH_START[seat] + t - 1) % RING.length;
}

/** 格子颜色 = 环形下标 % 4（0 绿、1 黄、2 蓝、3 红），映射到座位 */
function cellSeat(ringIdx) {
  return CELL_SEAT[ringIdx % 4];
}

/** 该格是否是某队的飞行捷径触发格 */
function isFlyCell(ringIdx) {
  return FLY_TRIGGERS.includes(ringIdx);
}

function isJumpCell(seat, ringIdx) {
  return cellSeat(ringIdx) === seat && !isFlyCell(ringIdx);
}

function createRoom(code) {
  return {
    code,
    createdAt: Date.now(),
    lastActive: Date.now(),
    players: [],
    planes: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
    phase: 'lobby', // lobby | playing | finished
    rules: { ...DEFAULT_RULES },
    finishOrder: [],
    turn: 0,
    dice: null,
    lastDice: null,
    options: [],
    awaitingMove: false,
    winner: null,
    winnerTeam: null,
    log: [],
    logSeq: 1,
    lastMove: null,
    seq: 0,
    round: 0,
    timers: [],
  };
}

function addPlayer(room, { id, name, isBot }) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const seat = room.players.length;
  const player = {
    id: id || randId(),
    name: sanitizeName(name, `${COLOR_NAMES[COLORS[seat]]}玩家`),
    color: COLORS[seat],
    seat,
    connected: true,
    isBot: Boolean(isBot),
    socketId: null,
    joinedAt: Date.now(),
  };
  room.players.push(player);
  room.lastActive = Date.now();
  return player;
}

function removePlayer(room, seat) {
  const p = room.players[seat];
  if (!p) return;
  room.players.splice(seat, 1);
  room.players.forEach((pl, i) => {
    pl.seat = i;
    pl.color = COLORS[i];
  });
  room.planes.push(room.planes.splice(seat, 1)[0]);
  for (let s = 0; s < room.planes.length; s += 1) {
    if (s >= room.players.length) room.planes[s] = [-1, -1, -1, -1];
  }
  room.turn = 0;
}

function clearTimers(room) {
  room.timers.forEach((t) => clearTimeout(t));
  room.timers = [];
}

function later(room, fn, ms) {
  const id = setTimeout(() => {
    room.timers = room.timers.filter((t) => t !== id);
    try {
      fn();
    } catch (err) {
      console.error('[timer]', err);
    }
  }, ms);
  room.timers.push(id);
  return id;
}

function pushLog(room, text, meta) {
  room.log.push({
    id: room.logSeq++,
    t: Date.now(),
    text,
    ...(meta || {}),
  });
  if (room.log.length > 80) room.log.splice(0, room.log.length - 80);
}

/**
 * 计算一次移动的结果。
 * @returns {{to:number, bonuses:Array<{type:'fly'|'jump', from:number, to:number}>}|null}
 */
function resolveMove(seat, t, dice, rules) {
  if (t === -1) {
    const canTakeoff = dice === 6 || Boolean(rules && rules.takeoffFive && dice === 5);
    if (!canTakeoff) return null;
    return { to: 0, bonuses: [] };
  }
  if (t >= GOAL_T) return null;
  let to = t + dice;
  if (to > GOAL_T) return null;

  const bonuses = [];
  if (to <= TRACK_LAST) {
    const ring = ringIndexOf(seat, to);
    if (ring === FLY_TRIGGERS[seat]) {
      if (to + 12 <= TRACK_LAST) {
        bonuses.push({ type: 'fly', from: to, to: to + 12 });
        to += 12;
      }
    } else if (cellSeat(ring) === seat) {
      if (to + 4 <= TRACK_LAST) {
        bonuses.push({ type: 'jump', from: to, to: to + 4 });
        to += 4;
      }
    }
  }
  return { to, bonuses };
}

function legalMoves(room, seat, dice) {
  const moves = [];
  room.planes[seat].forEach((t, plane) => {
    const res = resolveMove(seat, t, dice, room.rules);
    if (!res) return;
    const group =
      room.rules && room.rules.stackMove && t >= 0
        ? room.planes[seat].filter((pt) => pt === t).length
        : 1;
    moves.push({ plane, from: t, to: res.to, bonuses: res.bonuses, group });
  });
  return moves;
}

function weatherAt(ringIdx) {
  if (TYPHOON_CELLS.includes(ringIdx)) return 'typhoon';
  if (LIGHTNING_CELLS.includes(ringIdx)) return 'lightning';
  return '';
}

/** 把 seat 在位置 t 的落点上的对手全部撞回停机坪 */
function captureAt(room, seat, t, captures) {
  if (t < 1 || t > TRACK_LAST) return;
  const ring = ringIndexOf(seat, t);
  for (let q = 0; q < room.players.length; q += 1) {
    if (q === seat) continue;
    if (room.rules.teamMode && q % 2 === seat % 2) continue;
    room.planes[q].forEach((pt, j) => {
      if (pt >= 1 && pt <= TRACK_LAST && ringIndexOf(q, pt) === ring) {
        room.planes[q][j] = -1;
        captures.push({ seat: q, plane: j });
      }
    });
  }
}

/**
 * 执行移动，返回本回合的结构化结果（含被撞回的飞机）。
 * groupPlanes 用于“叠子一起走”：把同格的己方飞机一起移动。
 */
function applyMove(room, seat, plane, option, groupPlanes) {
  const planes = room.planes[seat];
  const group = Array.isArray(groupPlanes) && groupPlanes.length ? groupPlanes : [plane];
  const from = planes[plane];
  group.forEach((pi) => {
    planes[pi] = option.to;
  });

  const captures = [];
  if (option.to <= TRACK_LAST) captureAt(room, seat, option.to, captures);

  const player = room.players[seat];
  const name = player ? player.name : COLOR_NAMES[COLORS[seat]];
  const colorName = COLOR_NAMES[COLORS[seat]];

  if (from === -1) {
    pushLog(room, `${name} 的 ${plane + 1} 号机起飞`, { seat, type: 'takeoff' });
  } else if (group.length > 1) {
    pushLog(room, `${name} 的 ${group.length} 架飞机一起前进 ${option.to - from} 格`, {
      seat,
      type: 'move',
    });
  } else {
    pushLog(room, `${name} 的 ${plane + 1} 号机前进 ${option.to - from} 格`, { seat, type: 'move' });
  }
  option.bonuses.forEach((b) => {
    if (b.type === 'fly') pushLog(room, `${name} 命中飞机格，沿虚线飞 12 格`, { seat, type: 'fly' });
    if (b.type === 'jump') pushLog(room, `${name} 落到本色格，跳跃 4 格`, { seat, type: 'jump' });
  });

  // 特殊天气：台风随机吹走，雷电劈回停机坪
  let weather = '';
  if (room.rules && room.rules.weather && option.to >= 1 && option.to <= TRACK_LAST) {
    weather = weatherAt(ringIndexOf(seat, option.to));
    if (weather === 'lightning') {
      group.forEach((pi) => {
        planes[pi] = -1;
        pushLog(room, `${name} 的 ${pi + 1} 号机被雷电劈回停机坪`, { seat, type: 'weather' });
      });
    } else if (weather === 'typhoon') {
      group.forEach((pi) => {
        let nt = 1 + randInt(TRACK_LAST);
        if (nt === option.to) nt = (nt % TRACK_LAST) + 1;
        planes[pi] = nt;
        captureAt(room, seat, nt, captures);
        pushLog(room, `${name} 的 ${pi + 1} 号机被台风吹到航道 ${nt}`, {
          seat,
          type: 'weather',
        });
      });
    }
  }

  captures.forEach((c) => {
    const victim = room.players[c.seat];
    pushLog(room, `${name} 撞回了 ${victim ? victim.name : colorName} 的 1 架飞机`, {
      seat,
      type: 'capture',
    });
  });

  if (option.to === GOAL_T) {
    pushLog(room, `${name} 的 ${plane + 1} 号机抵达终点`, { seat, type: 'goal' });
  }

  let winner = null;
  const allDone = planes.every((t) => t === GOAL_T);
  let finishedPlayer = false;
  if (allDone && !room.finishOrder.includes(seat)) {
    room.finishOrder.push(seat);
    finishedPlayer = true;
    if (room.rules.endMode === 'rank' && !room.rules.teamMode) {
      pushLog(room, `${name} 第 ${room.finishOrder.length} 名完赛`, { seat, type: 'rank' });
    }
  }

  if (allDone) {
    if (room.rules.teamMode) {
      const team = seat % 2;
      const teamDone = [team, team + 2].every(
        (s) => room.planes[s] && room.planes[s].every((t) => t === GOAL_T)
      );
      if (teamDone) {
        room.phase = 'finished';
        room.winner = seat;
        room.winnerTeam = team;
        winner = seat;
        pushLog(room, `${TEAM_NAMES[team]} 两队飞机全部到达终点，获得胜利！`, {
          seat,
          type: 'win',
        });
      } else {
        pushLog(room, `${name} 四机到达终点，${TEAM_NAMES[team]} 等待队友完成`, {
          seat,
          type: 'goal',
        });
      }
    } else if (room.rules.endMode !== 'rank') {
      room.phase = 'finished';
      room.winner = seat;
      winner = seat;
      pushLog(room, `${name} 四机全部到达终点，获得胜利！`, { seat, type: 'win' });
    } else if (room.finishOrder.length >= room.players.length - 1) {
      room.players.forEach((p, i) => {
        if (room.finishOrder.includes(i)) return;
        room.finishOrder.push(i);
        pushLog(room, `${p.name} 第 ${room.finishOrder.length} 名`, { seat: i, type: 'rank' });
      });
      room.phase = 'finished';
      room.winner = room.finishOrder[0];
      winner = room.winner;
      const champ = room.players[room.winner];
      pushLog(room, `比赛结束，${champ ? champ.name : ''} 获得冠军！`, {
        seat: room.winner,
        type: 'win',
      });
    }
  }

  const result = {
    seat,
    plane,
    from,
    to: option.to,
    bonuses: option.bonuses,
    captures,
    weather,
    group,
    winner,
    finishedPlayer,
    dice: room.lastDice,
  };
  room.lastMove = result;
  return result;
}

function rollDice() {
  return 1 + randInt(6);
}

/** 电脑策略：按难度选择走法 */
function pickBotMove(room, seat, options) {
  if (!options || !options.length) return null;
  const level = (room.rules && room.rules.botLevel) || 'normal';
  if (level === 'easy') {
    return options[Math.floor(Math.random() * options.length)];
  }

  let best = null;
  let bestScore = -Infinity;

  options.forEach((opt) => {
    let score = opt.to;
    if (opt.to === GOAL_T) score += 600;
    if (opt.from === -1) score += 120;
    (opt.bonuses || []).forEach((bonus) => {
      if (bonus.type === 'fly') score += 90;
      if (bonus.type === 'jump') score += 50;
    });
    if (opt.to >= 1 && opt.to <= TRACK_LAST) {
      const ring = ringIndexOf(seat, opt.to);
      let enemies = 0;
      for (let q = 0; q < room.players.length; q += 1) {
        if (q === seat) continue;
        if (room.rules.teamMode && q % 2 === seat % 2) continue;
        (room.planes[q] || []).forEach((pt) => {
          if (pt >= 1 && pt <= TRACK_LAST && ringIndexOf(q, pt) === ring) enemies += 1;
        });
      }
      if (enemies > 0) score += 400 * enemies;

      if (level === 'hard') {
        // 避开对手 1-6 步可到达的落点
        let threats = 0;
        for (let q = 0; q < room.players.length; q += 1) {
          if (q === seat) continue;
          if (room.rules.teamMode && q % 2 === seat % 2) continue;
          (room.planes[q] || []).forEach((pt) => {
            if (pt < 1 || pt > TRACK_LAST) return;
            const step = (ring - ringIndexOf(q, pt) + RING.length) % RING.length;
            if (step >= 1 && step <= 6 && pt + step <= TRACK_LAST) threats += 1;
          });
        }
        if (threats > 0) score -= 35 * threats;

        if (room.rules.weather) {
          const zone = weatherAt(ring);
          if (zone === 'lightning') score -= 80;
          if (zone === 'typhoon') score -= 20;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  });

  return best;
}

/** 按座位顺序找下一个还没完赛的玩家 */
function nextSeat(room) {
  const n = room.players.length;
  if (!n) return 0;
  for (let i = 1; i <= n; i += 1) {
    const s = (room.turn + i) % n;
    if (!room.players[s]) continue;
    if (room.rules.endMode === 'rank' && room.finishOrder.includes(s)) continue;
    if (room.rules.teamMode && room.planes[s].every((t) => t === GOAL_T)) continue;
    return s;
  }
  return room.turn;
}

function startGame(room) {
  clearTimers(room);
  room.planes = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]];
  room.finishOrder = [];
  room.phase = 'playing';
  room.turn = 0;
  room.dice = null;
  room.lastDice = null;
  room.options = [];
  room.awaitingMove = false;
  room.winner = null;
  room.winnerTeam = null;
  room.lastMove = null;
  room.round += 1;
  pushLog(room, `第 ${room.round} 局开始，${room.players[0] ? room.players[0].name : '红队'} 先手`, {
    type: 'start',
  });
}

function beginTurn(room) {
  clearTimers(room);
  room.dice = null;
  room.options = [];
  room.awaitingMove = false;
  room.lastMove = null;
  room.lastActive = Date.now();
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    rules: { ...room.rules },
    finishOrder: [...room.finishOrder],
    turn: room.turn,
    dice: room.dice,
    lastDice: room.lastDice,
    options: room.awaitingMove ? room.options : [],
    awaitingMove: room.awaitingMove,
    winner: room.winner,
    winnerTeam: room.winnerTeam,
    round: room.round,
    seq: room.seq,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      seat: p.seat,
      connected: p.connected,
      isBot: Boolean(p.isBot),
    })),
    planes: room.planes.map((a) => a.slice()),
    log: room.log.slice(-40),
    lastMove: room.lastMove,
    serverNow: Date.now(),
  };
}

module.exports = {
  COLORS,
  COLOR_NAMES,
  COLOR_HEX,
  TEAM_NAMES,
  RING,
  HOME,
  BASE_SLOTS,
  GOAL_CENTER,
  GOAL_T,
  TRACK_LAST,
  PATH_START,
  TAKEOFF,
  MAX_PLAYERS,
  START_STEP,
  FLY_TRIGGERS,
  DEFAULT_RULES,
  TYPHOON_CELLS,
  LIGHTNING_CELLS,
  weatherAt,
  createRoom,
  addPlayer,
  removePlayer,
  sanitizeName,
  makeCode,
  randId,
  ringIndexOf,
  cellSeat,
  isFlyCell,
  isJumpCell,
  resolveMove,
  legalMoves,
  applyMove,
  pickBotMove,
  nextSeat,
  rollDice,
  startGame,
  beginTurn,
  clearTimers,
  later,
  pushLog,
  publicState,
};
