/* 棋盘坐标与展示文案（按 public/assets/board-classic.jpg 实测像素换算成 600×600） */
(function () {
  'use strict';

  const SEAT_COLORS = ['#f59e0b', '#3b82f6', '#ef4444', '#22c55e'];
  const SEAT_LIGHT = ['#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0'];
  const SEAT_NAMES = ['黄队', '蓝队', '红队', '绿队'];
  const TEAM_NAMES = ['黄红队', '蓝绿队'];
  const COORD_MAX = 600;

  // 52 格主航道，顺时针；黄队从索引 0 的起飞格出发，各队起点间隔 13 格
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

  // 特殊天气格（环形下标）
  const TYPHOON_CELLS = [6, 19, 32, 45];
  const LIGHTNING_CELLS = [10, 23, 36, 49];

  // 每队进入主航道的第一格（环形下标）与起飞等待点
  const PATH_START = [3, 16, 29, 42];
  const TAKEOFF = [
    [170, 15],
    [17, 429],
    [430, 582],
    [582, 168],
  ];

  const GOAL_T = 56;
  const TRACK_LAST = 50;
  const FLY_TRIGGERS = [20, 33, 46, 7];

  function ringIndexOf(seat, t) {
    return (PATH_START[seat] + t - 1) % 52;
  }

  function isFlyCell(ringIdx) {
    return FLY_TRIGGERS.includes(ringIdx);
  }

  /** 返回棋子中心点 [行, 列]（600×600 坐标系） */
  function planeCoord(seat, plane, t) {
    if (t === -1) return BASE_SLOTS[seat][plane];
    if (t === 0) return TAKEOFF[seat];
    if (t <= TRACK_LAST) return RING[ringIndexOf(seat, t)];
    if (t < GOAL_T) return HOME[seat][t - 51];
    return GOAL_CENTER[seat];
  }

  function posLabel(t) {
    if (t === -1) return '停机坪';
    if (t === 0) return '起点等待';
    if (t <= TRACK_LAST) return `航道 ${t}`;
    if (t < GOAL_T) return `归航 ${t - 50}`;
    return '已抵达';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  window.FlyChess = {
    SEAT_COLORS,
    SEAT_LIGHT,
    SEAT_NAMES,
    TEAM_NAMES,
    COORD_MAX,
    RING,
    HOME,
    BASE_SLOTS,
    GOAL_CENTER,
    TYPHOON_CELLS,
    LIGHTNING_CELLS,
    GOAL_T,
    TRACK_LAST,
    FLY_TRIGGERS,
    PATH_START,
    TAKEOFF,
    ringIndexOf,
    isFlyCell,
    planeCoord,
    posLabel,
    escapeHtml,
  };
})();
