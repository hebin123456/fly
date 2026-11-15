# 飞行棋 · 大屏棋盘 + 手机手柄

平板/电视当棋盘，4 台手机扫码入座，**摇一摇手机（陀螺仪）掷骰子**，支持实时同步、掉线托管与再来一局。

- 大屏：`/` 展示 15×15 棋盘、二维码、玩家与对局动态
- 手机：`/play?room=XXXX` 加入房间、摇一摇/点骰子、选择飞机
- 技术栈：Node 20 + Express + Socket.IO + qrcode，纯原生前端，无外部 CDN
- Docker 镜像内置 HTTP(3000) 与 HTTPS(3443，自签证书) 双栈
- 已发布镜像：`ghcr.io/hebin123456/fly-chess:latest`

## 快速开始

```bash
# 若镜像是 private，先登录一次
# docker login ghcr.io -u hebin123456

docker run -d --name fly-chess --restart unless-stopped \
  -p 3000:3000 -p 3443:3443 \
  ghcr.io/hebin123456/fly-chess:latest
```

或使用 compose：

```bash
docker compose pull && docker compose up -d    # 使用已发布镜像
docker compose up -d --build                   # 或从源码重新构建
```

1. 平板和手机连同一个 Wi-Fi。
2. 平板浏览器打开 `http://<电脑局域网IP>:3000`（用局域网 IP 打开，二维码会自动带上这个地址）。
3. 手机扫大屏上的二维码，输入昵称入座；至少 2 人后，大屏点「开始游戏」。
4. 轮到你时摇一摇手机（或点骰子）掷出点数，再点选要移动的飞机。

## 手机陀螺仪与 HTTPS

浏览器只在**安全上下文（HTTPS）**下开放运动传感器：

- 大屏改用 `https://<局域网IP>:3443` 打开，证书提示选「继续访问」，再让手机扫码（手机也需接受一次自签证书）。
- 想用可信证书：在容器前挂 Caddy/Nginx 做 HTTPS 反代，并设置 `ENABLE_HTTPS=0`。
- 不开陀螺仪也能完整游玩：直接点骰子掷出点数。

iOS 首次点击「开启陀螺仪」时，系统会询问「运动与方向」权限，允许即可。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 端口 |
| `HTTPS_PORT` | `3443` | HTTPS 端口（自签证书） |
| `ENABLE_HTTPS` | `1` | `0` 关闭 HTTPS，仅 HTTP |
| `PUBLIC_URL` | 空 | 对外访问地址，如 `https://fly.example.com`；大屏用 localhost 打开时必须设置，否则二维码可能指向容器内网 IP |

## 镜像构建与推送（GHCR）

已发布地址：`ghcr.io/hebin123456/fly-chess`，标签 `latest` 与 `1.0.0`。

```bash
# 登录（密码使用带 write:packages 权限的 GitHub Token）
docker login ghcr.io -u hebin123456

# 构建并推送
docker build -t ghcr.io/hebin123456/fly-chess:latest .
docker push ghcr.io/hebin123456/fly-chess:latest

# 国内拉不到 Docker Hub 基础镜像时
docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine \
  -t ghcr.io/hebin123456/fly-chess:latest .

# 或使用脚本（默认推到 GHCR）
./deploy.sh
NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine ./deploy.sh
```

GHCR 新包默认是 private：自己用 `docker login ghcr.io` 即可拉取；要让别人免登录拉取，需在
[Package settings](https://github.com/users/hebin123456/packages/container/package/fly-chess/settings)
的 Danger Zone 里把 visibility 改成 Public。

## 本地开发与测试

```bash
npm install
npm start                 # http://localhost:3000 与 https://localhost:3443

npm test                  # 规则单测
PLAYERS=4 node test/simulate.js   # 4 名机器人自动打完一整局（需先启动服务）
BASE=https://localhost:3443 PLAYERS=2 node test/simulate.js   # 验证 HTTPS/WSS
```

自动化对局默认按真实节奏（每步约 1 秒），可先加速启动服务再跑：

```bash
TURN_DELAY_MS=80 MOVE_DELAY_MS=60 npm start
PLAYERS=4 node test/simulate.js
```

## 规则

- 每队 4 架飞机；掷出 6 可让一架飞机起飞，并可再掷一次。
- 落在自己颜色的格子上，跳 4 格；落在自己颜色的飞机格上，飞 12 格。
- 落到对手飞机所在格，对手飞机被撞回停机坪；自己的飞机可以叠放。
- 需要精确点数进入终点，点数超出则不能移动；四架飞机全部抵达终点即获胜。

## 常见问题

- **二维码地址不对**：大屏请用局域网 IP 访问；或设置 `PUBLIC_URL`。
- **手机连不上**：确认同一 Wi-Fi、电脑防火墙放通 3000/3443，且路由器未开启 AP 隔离。
- **摇一摇没反应**：确认大屏和手机都走 HTTPS，并在手机上允许运动传感器；或直接点骰子。
- **HTTPS 证书警告**：自签证书属于正常现象，选择继续访问即可；公网使用建议配可信证书。
