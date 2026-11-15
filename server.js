'use strict';

const path = require('path');
const os = require('os');
const http = require('http');
const tls = require('tls');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const G = require('./src/game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  pingInterval: 10000,
});

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const ENABLE_HTTPS = String(process.env.ENABLE_HTTPS || '1') !== '0';

// 对局节奏（毫秒），自动化测试时可调小
const TURN_DELAY_MS = Math.max(0, Number(process.env.TURN_DELAY_MS ?? 1250));
const MOVE_DELAY_MS = Math.max(0, Number(process.env.MOVE_DELAY_MS ?? 800));
const OFFLINE_DELAY_MS = Math.max(0, Number(process.env.OFFLINE_DELAY_MS ?? 4000));

const rooms = new Map();

/* ------------------------------------------------------------------ */
/* 静态资源 & 小工具                                                    */
/* ------------------------------------------------------------------ */

app.disable('x-powered-by');
app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
  })
);

app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));

app.get('/api/net', (req, res) => {
  const ips = [];
  Object.values(os.networkInterfaces())
    .flat()
    .forEach((ni) => {
      if (ni && ni.family === 'IPv4' && !ni.internal && !ips.includes(ni.address)) ips.push(ni.address);
    });
  res.json({
    ips,
    httpPort: PORT,
    httpsPort: ENABLE_HTTPS ? HTTPS_PORT : 0,
    publicUrl: process.env.PUBLIC_URL || '',
    httpsEnabled: ENABLE_HTTPS,
  });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 600);
  if (!text) return res.status(400).json({ error: '缺少 text 参数' });
  const size = Math.max(160, Math.min(800, Number(req.query.size) || 360));
  try {
    const buf = await QRCode.toBuffer(text, {
      type: 'png',
      margin: 1,
      width: size,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1220', light: '#ffffff' },
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    return res.send(buf);
  } catch (err) {
    console.error('[qr]', err);
    return res.status(500).json({ error: '二维码生成失败' });
  }
});

/* ------------------------------------------------------------------ */
/* 房间与对局流程                                                      */
/* ------------------------------------------------------------------ */

function newRoomCode() {
  let code = G.makeCode();
  let guard = 0;
  while (rooms.has(code) && guard < 200) {
    code = G.makeCode();
    guard += 1;
  }
  return code;
}

function broadcast(room) {
  room.seq += 1;
  room.lastActive = Date.now();
  io.to(room.code).emit('game:state', G.publicState(room));
}

function roomOf(socket) {
  const data = socket.data || {};
  if (!data.code) return null;
  return rooms.get(data.code) || null;
}

function playerOf(room, socket) {
  const data = socket.data || {};
  return room.players.find((p) => p.id === data.playerId) || null;
}

/** 轮到一个离线玩家时自动托管：能走就走一步，否则跳过 */
function watchTurn(room) {
  if (room.phase !== 'playing') return;
  const seat = room.turn;
  const player = room.players[seat];
  if (!player || player.connected) return;
  G.later(
    room,
    () => {
      if (room.phase !== 'playing' || room.turn !== seat) return;
      if (player.connected) return;
      if (room.awaitingMove) {
        const option = room.options[0];
        if (option) {
          G.pushLog(room, `${player.name} 离线，自动走子`, { type: 'pass' });
          doMove(room, seat, option.plane, option);
        }
        return;
      }
      if (room.dice != null) return; // 已掷骰，正在自动移动
      G.pushLog(room, `${player.name} 不在线，自动跳过`, { type: 'pass' });
      endTurn(room, false);
    },
    OFFLINE_DELAY_MS
  );
}

function endTurn(room, extra) {
  G.later(
    room,
    () => {
      if (room.phase !== 'playing') return;
      if (extra) {
        G.pushLog(room, '掷出 6 点，再掷一次', { type: 'extra' });
      } else {
        room.turn = (room.turn + 1) % Math.max(1, room.players.length);
      }
      G.beginTurn(room);
      broadcast(room);
      watchTurn(room);
    },
    TURN_DELAY_MS
  );
}

function doMove(room, seat, plane, option) {
  if (room.phase !== 'playing') return;
  const result = G.applyMove(room, seat, plane, option);
  room.options = [];
  room.awaitingMove = false;
  broadcast(room);
  if (result.winner != null) {
    G.clearTimers(room);
    return;
  }
  endTurn(room, result.dice === 6);
}

function handleRoll(room, player) {
  if (room.phase !== 'playing') return { error: '本局还没开始' };
  if (room.awaitingMove) return { error: '请先选择要移动的飞机' };
  if (room.dice != null) return { error: '骰子还在转呢' };
  if (room.players[room.turn]?.seat !== player.seat) return { error: '还没轮到你' };

  const dice = G.rollDice();
  room.dice = dice;
  room.lastDice = dice;
  G.pushLog(room, `${player.name} 掷出 ${dice} 点`, { type: 'dice', seat: player.seat, dice });

  const options = G.legalMoves(room, player.seat, dice);
  room.options = options;

  if (options.length === 0) {
    G.pushLog(room, `${player.name} 没有可以移动的飞机`, { type: 'pass', seat: player.seat });
    broadcast(room);
    endTurn(room, false);
    return { ok: true, dice };
  }

  if (options.length === 1) {
    broadcast(room);
    const only = options[0];
    G.later(
      room,
      () => {
        if (room.phase !== 'playing' || room.turn !== player.seat) return;
        doMove(room, player.seat, only.plane, only);
      },
      room.dice === 6 ? MOVE_DELAY_MS + 120 : MOVE_DELAY_MS
    );
    return { ok: true, dice };
  }

  room.awaitingMove = true;
  broadcast(room);
  return { ok: true, dice };
}

function handleMove(room, player, plane) {
  if (room.phase !== 'playing') return { error: '本局还没开始' };
  if (!room.awaitingMove) return { error: '现在还不能移动' };
  if (room.players[room.turn]?.seat !== player.seat) return { error: '还没轮到你' };
  const option = room.options.find((o) => o.plane === plane);
  if (!option) return { error: '这架飞机不能这样走' };
  doMove(room, player.seat, plane, option);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Socket 事件                                                         */
/* ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  /* 大屏：创建或接管房间 */
  socket.on('board:attach', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const wanted = String((payload && payload.code) || '').toUpperCase().trim();
    let room = wanted ? rooms.get(wanted) : null;

    if (!room) {
      const code = /^[A-Z0-9]{4}$/.test(wanted) && !rooms.has(wanted) ? wanted : newRoomCode();
      room = G.createRoom(code);
      rooms.set(code, room);
      G.pushLog(room, '棋盘已就绪，等待玩家扫码加入', { type: 'system' });
    }

    socket.join(room.code);
    socket.data = { role: 'board', code: room.code };
    room.boardSocketId = socket.id;
    room.lastActive = Date.now();
    reply({ ok: true, state: G.publicState(room) });
    broadcast(room);
  });

  /* 大屏：开始 / 再来一局 */
  socket.on('board:start', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = roomOf(socket);
    if (!room) return reply({ error: '房间不存在' });
    if (room.phase === 'playing') return reply({ error: '游戏已在进行中' });
    if (room.players.length < 2) return reply({ error: '至少需要 2 名玩家' });

    G.startGame(room);
    broadcast(room);
    watchTurn(room);
    return reply({ ok: true });
  });

  /* 手机：扫码加入 / 断线重连 */
  socket.on('player:join', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const p = payload || {};
    const code = String(p.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return reply({ error: '房间不存在，请核对大屏上的房间号' });

    let player = p.playerId ? room.players.find((x) => x.id === p.playerId) : null;

    if (player) {
      player.connected = true;
      player.socketId = socket.id;
      if (p.name) player.name = G.sanitizeName(p.name, player.name);
      G.pushLog(room, `${player.name} 重新连接`, { type: 'join', seat: player.seat });
    } else {
      if (room.phase !== 'lobby') {
        return reply({
          error: room.phase === 'finished' ? '本局已结束，等下一局再扫码吧' : '本局已经开始了，等下一局再扫码吧',
        });
      }
      if (room.players.length >= G.MAX_PLAYERS) return reply({ error: '房间已满（最多 4 人）' });
      player = G.addPlayer(room, { id: p.playerId, name: p.name });
      if (!player) return reply({ error: '加入失败，请重试' });
      G.pushLog(room, `${player.name} 加入房间（${G.COLOR_NAMES[player.color]}）`, {
        type: 'join',
        seat: player.seat,
      });
    }

    player.socketId = socket.id;
    socket.join(room.code);
    socket.data = { role: 'player', code: room.code, playerId: player.id };
    room.lastActive = Date.now();

    reply({
      ok: true,
      playerId: player.id,
      seat: player.seat,
      name: player.name,
      color: player.color,
      state: G.publicState(room),
    });
    broadcast(room);
    return undefined;
  });

  /* 手机：掷骰子 */
  socket.on('player:roll', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = roomOf(socket);
    if (!room) return reply({ error: '房间不存在' });
    const player = playerOf(room, socket);
    if (!player) return reply({ error: '你还没有加入房间' });
    const result = handleRoll(room, player);
    return reply(result);
  });

  /* 手机：选择飞机 */
  socket.on('player:move', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = roomOf(socket);
    if (!room) return reply({ error: '房间不存在' });
    const player = playerOf(room, socket);
    if (!player) return reply({ error: '你还没有加入房间' });
    const plane = Number(payload && payload.plane);
    if (!Number.isInteger(plane) || plane < 0 || plane > 3) return reply({ error: '飞机编号不对' });
    const result = handleMove(room, player, plane);
    return reply(result);
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket);
    if (!room) return;
    const data = socket.data || {};

    if (data.role === 'board') {
      if (room.boardSocketId === socket.id) room.boardSocketId = null;
      return;
    }

    const player = room.players.find((p) => p.id === data.playerId);
    if (!player) return;
    if (player.socketId && player.socketId !== socket.id) return; // 已被新连接接管
    player.connected = false;

    if (room.phase === 'lobby') {
      G.removePlayer(room, player.seat);
      G.pushLog(room, `${player.name} 离开了房间`, { type: 'leave' });
    } else {
      G.pushLog(room, `${player.name} 掉线了`, { type: 'leave', seat: player.seat });
    }
    broadcast(room);
    if (room.phase === 'playing' && room.turn === player.seat) watchTurn(room);
  });
});

/* 清理长时间无人的房间 */
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    const hasBoard = Boolean(room.boardSocketId);
    const hasOnline = room.players.some((p) => p.connected);
    if (!hasBoard && !hasOnline && now - room.lastActive > 60 * 60 * 1000) {
      G.clearTimers(room);
      rooms.delete(code);
    }
  });
}, 10 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */

function localAddresses() {
  const list = [];
  Object.values(os.networkInterfaces())
    .flat()
    .forEach((ni) => {
      if (ni && ni.family === 'IPv4' && !ni.internal && !list.includes(ni.address)) list.push(ni.address);
    });
  return list;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[fly-chess] HTTP  http://localhost:${PORT}`);
  localAddresses().forEach((ip) => console.log(`[fly-chess] 局域网 http://${ip}:${PORT}`));
});

if (ENABLE_HTTPS) {
  try {
    const selfsigned = require('selfsigned');
    const altNames = [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
    ];
    localAddresses().forEach((ip) => altNames.push({ type: 7, ip }));
    const pems = selfsigned.generate([{ name: 'commonName', value: 'fly-chess.local' }], {
      days: 3650,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }],
    });

    // TLS 解密后把连接交给同一个 HTTP server，HTTP / HTTPS 共享 Express 与 Socket.IO
    const tlsServer = tls.createServer({ key: pems.private, cert: pems.cert }, (tlsSocket) => {
      server.emit('connection', tlsSocket);
    });
    tlsServer.on('tlsClientError', () => {});
    tlsServer.on('error', (err) => console.error('[fly-chess] HTTPS 错误：', err.message));
    tlsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`[fly-chess] HTTPS https://localhost:${HTTPS_PORT} （自签证书，手机端需选择继续访问）`);
      localAddresses().forEach((ip) =>
        console.log(`[fly-chess] 局域网 https://${ip}:${HTTPS_PORT}`)
      );
    });
  } catch (err) {
    console.error('[fly-chess] HTTPS 启动失败：', err.message);
  }
}

function shutdown() {
  rooms.forEach((room) => G.clearTimers(room));
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
