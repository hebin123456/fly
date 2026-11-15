#!/usr/bin/env bash
# 构建并推送镜像到 GHCR（也支持任意 registry，通过 IMAGE 指定）
# 用法：
#   ./deploy.sh
#   IMAGE=ghcr.io/hebin123456/fly-chess:1.0.0 ./deploy.sh
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/hebin123456/fly-chess:${TAG:-latest}}"
REGISTRY="${REGISTRY:-${IMAGE%%/*}}"

echo "==> 构建镜像 ${IMAGE}"
if [[ -n "${NODE_IMAGE:-}" ]]; then
  docker build --build-arg "NODE_IMAGE=${NODE_IMAGE}" -t "${IMAGE}" .
else
  docker build -t "${IMAGE}" .
fi

echo "==> 登录 ${REGISTRY}（用户名 hebin123456，密码用 GitHub Token）"
docker login "${REGISTRY}" -u "${REGISTRY_USER:-hebin123456}"

echo "==> 推送 ${IMAGE}"
docker push "${IMAGE}"

echo ""
echo "完成：${IMAGE}"
echo "运行：docker run -d --name fly-chess -p 3000:3000 -p 3443:3443 ${IMAGE}"
