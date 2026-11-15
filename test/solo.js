'use strict';

/**
 * 单人 vs 3 个电脑的端到端测试：真人只操作自己的回合，电脑由服务端托管
 * 用法：BASE=http://localhost:3100 node test/solo.js
 */

const { io } = require('socket.io-client');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://localhost:3000';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 240000;
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
  console.log(`[solo] 房间 ${code}`);

  let state = created.state;
  board.on('game:state', (s) => {
    state = s;
  });

  const human = await connect();
  const joined = await emitAck(human, 'player:join', {
    code,
    name: '单人玩家',
    playerId: `solo-${code}`,
  });
  assert.ok(joined.ok, `真人加入失败：${joined.error}`);
  const humanSeat = joined.seat;

  const added = await emitAck(board, 'board:addBots', {});
  assert.ok(added.ok, `加电脑失败：${added.error}`);
  assert.equal(added.added, 3, '应加入 3 个电脑');

  const rules = await emitAck(board, 'board:setRules', {
    weather: true,
    stackMove: true,
    takeoffFive: true,
    endMode: 'rank',
    botLevel: 'hard',
  });
  assert.ok(rules.ok, `设置规则失败：${rules.error}`);

  await sleep(150);
  assert.equal(state.players.length, 4);
  assert.equal(state.players.filter((p) => p.isBot).length, 3);
  assert.equal(state.rules.weather, true);
  assert.equal(state.rules.stackMove, true);
  assert.equal(state.rules.takeoffFive, true);
  assert.equal(state.rules.endMode, 'rank');
  assert.equal(state.rules.botLevel, 'hard');

  const started = await emitAck(board, 'board:start', {});
  assert.ok(started.ok, `开始游戏失败：${started.error}`);

  const t0 = Date.now();
  let lastSeq = -1;
  let actions = 0;
  let result = null;
  let acted = false;

  while (Date.now() - t0 < TIMEOUT_MS) {
    if (state && state.seq !== lastSeq) {
      lastSeq = state.seq;
      if (state.phase === 'finished') {
        result = state;
        break;
      }
      const player = state.players[state.turn];
      if (state.turn === humanSeat && player && !player.isBot) {
        if (state.awaitingMove) {
          const opt = state.options[Math.floor(Math.random() * state.options.length)];
          const res = await emitAck(human, 'player:move', { plane: opt.plane });
          actions += 1;
          if (res.error) console.log('[solo] 走子被拒绝：', res.error);
          acted = true;
        } else if (state.dice == null) {
          const res = await emitAck(human, 'player:roll');
          actions += 1;
          if (res.error) console.log('[solo] 掷骰被拒绝：', res.error);
          acted = true;
        }
      }
    }
    await sleep(60);
  }

  assert.ok(result, `对局未在 ${TIMEOUT_MS}ms 内结束（真人动作 ${actions} 次）`);
  const winner = result.players.find((p) => p.seat === result.winner);
  assert.ok(winner, '没有赢家');
  assert.ok(result.planes[result.winner].every((t) => t === 55), '赢家飞机未全部抵达');
  assert.ok(
    result.log.some((l) => /电脑 \d+ 掷出/.test(l.text)),
    '电脑没有掷骰记录'
  );
  assert.ok(acted, '真人没有执行任何动作');
  assert.equal(result.finishOrder.length, 4, '排位模式应产生 4 个名次');
  assert.deepEqual([...new Set(result.finishOrder)].sort(), [0, 1, 2, 3]);

  console.log(
    `[solo] 结束：${winner.name}（${winner.color}）获胜 · ${(
      (Date.now() - t0) / 1000
    ).toFixed(1)}s · 真人动作 ${actions} 次`
  );
  human.close();
  board.close();
  process.exit(0);
})().catch((err) => {
  console.error('[solo] 失败：', err.message);
  process.exit(1);
});
