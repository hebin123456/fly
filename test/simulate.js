'use strict';

/**
 * 端到端自动对局：通过 Socket.IO 模拟大屏 + 多名手机玩家
 * 用法：BASE=http://localhost:3000 PLAYERS=4 node test/simulate.js
 */

const { io } = require('socket.io-client');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://localhost:3000';
const COUNT = Math.max(2, Math.min(4, Number(process.env.PLAYERS) || 4));
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 120000;
const IS_HTTPS = BASE.startsWith('https:');

function connect() {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, {
      transports: ['websocket'],
      reconnection: false,
      ...(IS_HTTPS ? { rejectUnauthorized: false } : {}),
    });
    sock.once('connect', () => resolve(sock));
    sock.once('connect_error', (err) => reject(new Error(`连接失败：${err.message}`)));
  });
}

function emitAck(sock, event, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'ack 超时' }), 5000);
    sock.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const board = await connect();
  const created = await emitAck(board, 'board:attach', {});
  assert.ok(created.ok, '大屏创建房间失败');
  const code = created.state.code;
  console.log(`[sim] 房间 ${code} · 加入 ${COUNT} 名玩家 · ${BASE}`);

  const players = [];
  for (let i = 0; i < COUNT; i += 1) {
    const sock = await connect();
    const res = await emitAck(sock, 'player:join', {
      code,
      name: `模拟玩家${i + 1}`,
      playerId: `sim-${code}-${i}`,
    });
    assert.ok(res.ok, `玩家 ${i + 1} 加入失败：${res.error}`);
    players.push(sock);
  }

  let state = created.state;
  board.on('game:state', (s) => {
    state = s;
  });
  await sleep(150);
  assert.equal(state.players.length, COUNT);

  // 未开始时不能掷骰
  const early = await emitAck(players[0], 'player:roll');
  assert.ok(early.error, '未开始竟然可以掷骰');

  const started = await emitAck(board, 'board:start', {});
  assert.ok(started.ok, `开始游戏失败：${started.error}`);
  await sleep(120);

  // 非当前回合玩家不能掷骰 / 当前回合未掷骰不能走子
  const nonTurn = state.turn === 0 ? 1 : 0;
  const wrongTurn = await emitAck(players[nonTurn], 'player:roll');
  assert.ok(wrongTurn.error, '非当前回合玩家竟然可以掷骰');
  const earlyMove = await emitAck(players[state.turn], 'player:move', { plane: 0 });
  assert.ok(earlyMove.error, '未掷骰竟然可以走子');

  const startedAt = Date.now();
  let lastSeq = -1;
  let actions = 0;
  let result = null;

  async function waitForSeq(prev, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (state.seq !== prev) return true;
      await sleep(40);
    }
    return false;
  }

  while (Date.now() - startedAt < TIMEOUT_MS) {
    if (state && state.seq !== lastSeq) {
      lastSeq = state.seq;
      if (state.phase === 'finished') {
        result = state;
        break;
      }
      const seat = state.turn;
      const sock = players[seat];
      if (sock) {
        if (state.awaitingMove) {
          const option = state.options[Math.floor(Math.random() * state.options.length)];
          const before = state.seq;
          const res = await emitAck(sock, 'player:move', { plane: option.plane });
          actions += 1;
          if (res.error) console.log(`[sim] 走子被拒绝：${res.error}（seq ${before}）`);
          await waitForSeq(before);
        } else if (state.dice == null) {
          const before = state.seq;
          const res = await emitAck(sock, 'player:roll');
          actions += 1;
          if (res.error) console.log(`[sim] 掷骰被拒绝：${res.error}（seq ${before}）`);
          await waitForSeq(before);
        }
      }
    }
    await sleep(60);
  }

  assert.ok(result, `对局未在 ${TIMEOUT_MS}ms 内结束（动作 ${actions} 次，seq ${state && state.seq}）`);
  const winner = result.players.find((p) => p.seat === result.winner);
  assert.ok(winner, '对局结束但没有赢家');
  assert.ok(result.planes[result.winner].every((t) => t === 55), '赢家飞机没有全部到达终点');
  assert.equal(result.players.length, COUNT, '玩家数量发生变化');

  console.log(
    `[sim] 结束：${winner.name}（${winner.color}）获胜 · ${((Date.now() - startedAt) / 1000).toFixed(
      1
    )}s · 动作 ${actions} 次 · seq ${result.seq}`
  );
  console.log(`[sim] 动态：${result.log.slice(-5).map((l) => l.text).join(' | ')}`);

  players.forEach((p) => p.close());
  board.close();
  process.exit(0);
})().catch((err) => {
  console.error('[sim] 失败：', err.message);
  process.exit(1);
});
