/* 棋盘坐标与展示文案（复刻 netmanfisher/chinese-ludo 的 600×600 棋盘坐标，MIT） */
(function () {
  'use strict';

  const SEAT_COLORS = ['#f59e0b', '#3b82f6', '#ef4444', '#22c55e'];
  const SEAT_LIGHT = ['#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0'];
  const SEAT_NAMES = ['黄队', '蓝队', '红队', '绿队'];
  const COORD_MAX = 600;

  // 52 格主航道，顺时针；黄队从索引 0 起飞
  const RING = [
    [212, 91], [198, 122], [198, 151], [212, 183], [184, 209],
    [150, 195], [120, 196], [86, 209], [74, 241], [74, 270],
    [75, 300], [75, 330], [74, 358], [86, 390], [119, 404],
    [150, 404], [184, 390], [212, 416], [198, 448], [198, 477],
    [212, 508], [244, 519], [276, 518], [307, 520], [336, 519],
    [366, 519], [399, 508], [413, 477], [413, 447], [400, 416],
    [428, 391], [461, 405], [491, 404], [526, 390], [536, 358],
    [537, 328], [537, 299], [537, 270], [536, 239], [526, 210],
    [491, 195], [460, 196], [427, 210], [398, 182], [413, 151],
    [413, 122], [399, 90], [366, 81], [335, 79], [305, 80],
    [275, 80], [245, 82],
  ];

  // 每队 5 格归航跑道（主航道入口之后的 5 格）
  const HOME = [
    [[305, 123], [305, 152], [305, 181], [305, 211], [305, 240]],
    [[118, 300], [150, 300], [181, 300], [211, 300], [242, 300]],
    [[305, 477], [305, 448], [305, 418], [306, 389], [306, 359]],
    [[492, 300], [461, 299], [430, 300], [399, 299], [369, 299]],
  ];

  // 四角机库里的 4 个停机位
  const BASE_SLOTS = [
    [[45, 44], [45, 100], [98, 45], [96, 98]],
    [[44, 500], [45, 553], [98, 500], [99, 555]],
    [[501, 501], [503, 555], [554, 501], [554, 554]],
    [[501, 45], [501, 97], [554, 44], [554, 98]],
  ];

  // 中心终点
  const GOAL_CENTER = [[306, 274], [278, 300], [306, 325], [333, 300]];

  // 特殊天气格（环形下标）
  const TYPHOON_CELLS = [6, 19, 32, 45];
  const LIGHTNING_CELLS = [10, 23, 36, 49];

  const GOAL_T = 55;
  const TRACK_LAST = 49;
  const FLY_TRIGGERS = [17, 30, 43, 4];

  function ringIndexOf(seat, t) {
    return (seat * 13 + t) % 52;
  }

  function isFlyCell(ringIdx) {
    return FLY_TRIGGERS.includes(ringIdx);
  }

  /** 返回棋子中心点 [行, 列]（600×600 坐标系） */
  function planeCoord(seat, plane, t) {
    if (t === -1) return BASE_SLOTS[seat][plane];
    if (t <= TRACK_LAST) return RING[ringIndexOf(seat, t)];
    if (t < GOAL_T) return HOME[seat][t - 50];
    return GOAL_CENTER[seat];
  }

  function posLabel(t) {
    if (t === -1) return '停机坪';
    if (t <= TRACK_LAST) return `航道 ${t + 1}`;
    if (t < GOAL_T) return `归航 ${t - 49}`;
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
    ringIndexOf,
    isFlyCell,
    planeCoord,
    posLabel,
    escapeHtml,
  };
})();
