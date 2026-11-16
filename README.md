# 飞行棋 · 大屏棋盘 + 手机手柄

平板/电视当棋盘，1-4 人扫码入座，**也可以单人挑战 3 个电脑**，摇一摇手机（陀螺仪）掷骰子，支持实时同步、掉线托管与再来一局。

- 大屏：`/` 展示经典飞行棋棋盘（复用开源棋盘图，52 格跑道、四角机库、中央归航）、二维码、玩家与对局动态，支持一键加满电脑和逐个移除玩家（含真人）
- 手机：`/play?room=XXXX` 扫一扫/输入房间号加入、摇一摇/点骰子、选择飞机
- 人机：大屏点「加满电脑」自动补齐电脑，一个人也能开局
- 组队：2v2 黄+红 vs 蓝+绿，队友之间不互撞，两人四机全部抵达后队伍获胜
- 规则：开局前可开关特殊天气格、叠子一起走、5 点起飞，以及选择第一名/排满名次与电脑难度
- 技术栈：Node 20 + Express + Socket.IO + qrcode，纯原生前端，无外部 CDN；扫码使用 jsQR（Apache-2.0）
- Docker 镜像内置 HTTP(3000) 与 HTTPS(3443，自签证书) 双栈
- 已发布镜像：`ghcr.io/hebin123456/fly-chess:latest`

## 快速开始

```bash
docker run -d --name fly-chess --restart unless-stopped \
  -p 3443:3443 \
  ghcr.io/hebin123456/fly-chess:latest
```

或使用 compose：

```bash
docker compose up -d    # 自动拉取已发布镜像，仅暴露 HTTPS 3443
```

从源码构建镜像请参考 [镜像构建与推送（GHCR）](#镜像构建与推送ghcr)。

1. 平板和手机连同一个 Wi-Fi。
2. 平板浏览器打开 `https://<电脑局域网IP>:3443`（首次提示自签证书风险，选择继续访问；二维码会自动带上这个地址）。
3. 手机扫大屏上的二维码（也可以直接点手机加入页的「扫一扫大屏二维码」调用相机），输入昵称入座。
4. 想单人玩，大屏点「加满电脑」，再点「开始游戏」；多人则等人齐后直接开始。
5. 轮到你时摇一摇手机（或点骰子）掷出点数，再点选要移动的飞机。

## 手机陀螺仪与 HTTPS

浏览器只在**安全上下文（HTTPS）**下开放运动传感器，所以默认只用 HTTPS：

- 大屏用 `https://<局域网IP>:3443` 打开，证书提示选「继续访问」（手机也需接受一次自签证书），手机即可摇一摇。
- 想用可信证书：在容器前挂 Caddy/Nginx 做 HTTPS 反代，并设置 `ENABLE_HTTPS=0`。
- 不开陀螺仪也能完整游玩：直接点骰子掷出点数。

iOS 首次点击「开启陀螺仪」时，系统会询问「运动与方向」权限，允许即可。

### 使用域名和可信证书

已有 Nginx/Caddy 等 HTTPS 反代时，容器只需跑 HTTP，把域名反代到宿主机的 `10005` 即可：

```yaml
ports:
  - "10005:3000"
environment:
  ENABLE_HTTPS: "0"
  PUBLIC_URL: "https://fly.hebin.me"
```

反代需要支持 WebSocket 升级（`/socket.io`）。Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:10005;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Caddy 只需一行：`reverse_proxy 127.0.0.1:10005`（自带 WebSocket 和自动 HTTPS）。

### Cloudflare Tunnel

用 Cloudflare Tunnel 时同样让容器跑 HTTP：

- `ENABLE_HTTPS: "0"`，`PUBLIC_URL: "https://fly.hebin.me"`
- Tunnel 的 ingress 指向 `http://192.168.188.102:10005`（或 cloudflared 同机时用 `http://localhost:10005`）
- Cloudflare 侧自动提供 HTTPS 与 WebSocket，无需额外配置；如果开了 Cloudflare Access，记得放行玩家访问

cloudflared 配置示例：

```yaml
ingress:
  - hostname: fly.hebin.me
    service: http://192.168.188.102:10005
  - service: http_status:404
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 端口 |
| `HTTPS_PORT` | `3443` | HTTPS 端口（自签证书） |
| `ENABLE_HTTPS` | `1` | `0` 关闭 HTTPS，仅 HTTP |
| `PUBLIC_URL` | 空 | 对外访问地址，如 `https://fly.example.com`；大屏用 localhost 打开时必须设置，否则二维码可能指向容器内网 IP |
| `BOT_DELAY_MS` | `900` | 电脑每一步的思考时间（毫秒） |

## 镜像构建与推送（GHCR）

已发布地址：`ghcr.io/hebin123456/fly-chess`，标签 `latest` 与 `1.5.5`，已设为 **public**，可直接匿名拉取：

```bash
docker pull ghcr.io/hebin123456/fly-chess:latest
```

```bash
# 重新构建并推送（密码使用带 write:packages 权限的 GitHub Token）
docker login ghcr.io -u hebin123456

docker build -t ghcr.io/hebin123456/fly-chess:latest .
docker push ghcr.io/hebin123456/fly-chess:latest

# 国内拉不到 Docker Hub 基础镜像时
docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine \
  -t ghcr.io/hebin123456/fly-chess:latest .

# 或使用脚本（默认推到 GHCR）
./deploy.sh
NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine ./deploy.sh
```

如果之后重新创建包，GHCR 默认仍是 private，需要在
[Package settings](https://github.com/users/hebin123456/packages/container/package/fly-chess/settings)
的 Danger Zone 里把 visibility 改成 Public。

## 本地开发与测试

```bash
npm install
npm start                 # http://localhost:3000 与 https://localhost:3443

npm test                  # 规则单测
PLAYERS=4 node test/simulate.js   # 4 名机器人自动打完一整局（需先启动服务）
npm run solo              # 1 真人 + 3 电脑自动对局
BASE=https://localhost:3443 PLAYERS=2 node test/simulate.js   # 验证 HTTPS/WSS
```

自动化对局默认按真实节奏（每步约 1 秒），可先加速启动服务再跑：

```bash
TURN_DELAY_MS=80 MOVE_DELAY_MS=60 npm start
PLAYERS=4 node test/simulate.js
```

## 玩法设置（大屏开局前）

右侧「玩法设置」卡片可实时开关，开局后锁定：

- **特殊天气格**：棋盘上的「台」格会把飞机随机吹到其他航道，「雷」格会把飞机劈回停机坪。
- **叠子一起走**：开启后，同一格的己方飞机一起移动（手机选棋会标注「N 架一起」）。
- **5 点也能起飞**：开启后掷出 5 或 6 都可以让飞机起飞；额外回合仍只在 6 点时触发。
- **结束方式**：`第一名` 有人四机到终点即结束；`排 1-4 名` 会继续比到所有名次确定，并跳过已完赛玩家。
- **电脑难度**：简单随机走；普通优先撞子/终点；困难还会避开对手 1-6 步内的落点与雷电格。

## 规则

- 每队 4 架飞机；掷出 6 可让一架飞机飞到「起点」等待，下一次掷骰才进入航道；掷出 6 可再掷一次。
- 落在自己颜色的格子上，跳 4 格；落在自己颜色的飞机格上，飞 12 格。
- 落到对手飞机所在格，对手飞机被撞回停机坪；自己的飞机可以叠放。
- 需要精确点数进入终点，点数超出则不能移动；四架飞机全部抵达终点即获胜。
- **2v2 组队**：黄+红 对阵 蓝+绿，队友之间不能互相撞子；同一队两名玩家的四架飞机都抵达终点后，队伍获胜。

## 素材与许可

- 棋盘图片与 52 格坐标复用自 [netmanfisher/chinese-ludo](https://github.com/netmanfisher/chinese-ludo)，MIT License，授权文件见 `public/assets/LICENSE-chinese-ludo.md`。
- 手机扫码使用 jsQR，Apache-2.0。

## 常见问题

- **二维码地址不对**：大屏请用局域网 IP 访问；或设置 `PUBLIC_URL`。
- **手机连不上**：确认同一 Wi-Fi、电脑防火墙放通 3000/3443，且路由器未开启 AP 隔离。
- **摇一摇没反应**：确认大屏和手机都走 HTTPS，并在手机上允许运动传感器；或直接点骰子。
- **HTTPS 证书警告**：自签证书属于正常现象，选择继续访问即可；公网使用建议配可信证书。
