#!/bin/bash
# ============================================================
# VPS 一键启用 HTML 报告托管
# ============================================================
# 用途：在 VPS 上启用 chexian-api 的 /reports/* 路由
#   1. 配置 nginx 反代 /reports/ → 后端 :3000
#   2. 在 .env 加 PUBLIC_BASE_URL（用于 push_html.py 拼链接）
#   3. nginx reload + PM2 reload
#
# 前置条件：
#   - 已 ssh deployer@162.14.113.44
#   - 已通过 git push 触发 CI 部署，server/dist 含新的 /reports/ 路由
#
# 使用方法：
#   scp deploy/vps-enable-reports.sh deployer@162.14.113.44:/tmp/
#   ssh deployer@162.14.113.44 'sudo bash /tmp/vps-enable-reports.sh'
# ============================================================

set -euo pipefail

NGINX_CONF="/etc/nginx/sites-available/chexian"
ENV_FILE="/var/www/chexian/server/.env"
PUBLIC_BASE_URL="https://chexian.cretvalu.com"

echo "===> 1/4 检查前置条件"
[ -f "$NGINX_CONF" ] || { echo "❌ nginx 配置文件不存在: $NGINX_CONF"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "❌ .env 不存在: $ENV_FILE"; exit 1; }
echo "✓ nginx + .env 文件就位"

echo ""
echo "===> 2/4 修改 nginx：注入 location /reports/"
if grep -q "location /reports/" "$NGINX_CONF"; then
  echo "⚠ /reports/ 已配置，跳过 nginx 修改"
else
  # 在 location /health 块后插入 /reports/ 块
  cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d_%H%M%S)"

  # 用 awk 在 location /health { ... } 块结束的 } 后插入新块
  awk '
    /location \/health/ { in_health=1 }
    { print }
    in_health && /^    }/ {
      print ""
      print "    # ========== HTML 报告反代（chexian-api authMiddleware 鉴权） =========="
      print "    location /reports/ {"
      print "        proxy_pass http://chexian_api;"
      print "        proxy_http_version 1.1;"
      print "        proxy_set_header Host $host;"
      print "        proxy_set_header X-Real-IP $remote_addr;"
      print "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
      print "        proxy_set_header X-Forwarded-Proto $scheme;"
      print "        proxy_pass_header Cache-Control;"
      print "    }"
      in_health=0
    }
  ' "${NGINX_CONF}.bak."* > "$NGINX_CONF"

  # nginx 语法测试
  if ! nginx -t 2>&1; then
    echo "❌ nginx 配置语法错误，回滚..."
    cp "${NGINX_CONF}.bak."* "$NGINX_CONF"
    nginx -t
    exit 1
  fi
  echo "✓ nginx 配置注入成功 + 语法校验通过"
fi

echo ""
echo "===> 3/4 修改 .env：注入 PUBLIC_BASE_URL"
if grep -q "^PUBLIC_BASE_URL=" "$ENV_FILE"; then
  current=$(grep "^PUBLIC_BASE_URL=" "$ENV_FILE" | cut -d= -f2)
  if [ "$current" = "$PUBLIC_BASE_URL" ]; then
    echo "⚠ PUBLIC_BASE_URL 已为 $PUBLIC_BASE_URL，跳过"
  else
    sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$PUBLIC_BASE_URL|" "$ENV_FILE"
    echo "✓ PUBLIC_BASE_URL 已更新：$current → $PUBLIC_BASE_URL"
  fi
else
  echo "" >> "$ENV_FILE"
  echo "# HTML 报告链接的公网 base URL（push_html.py 用）" >> "$ENV_FILE"
  echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL" >> "$ENV_FILE"
  echo "✓ PUBLIC_BASE_URL 已追加到 .env"
fi

echo ""
echo "===> 4/4 reload nginx + PM2"
systemctl reload nginx
echo "✓ nginx reloaded"

# PM2 reload（chexian-api 启动时会自动 mkdir reports/ 目录）
/usr/local/bin/deploy-chexian-api reload
echo "✓ PM2 reloaded"

echo ""
echo "===> 验证"
sleep 3
echo "--- /health ---"
curl -sf https://chexian.cretvalu.com/health | head -c 300 && echo ""

echo "--- /reports/<不存在文件>（应 401，因未登录）---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://chexian.cretvalu.com/reports/nonexistent.html"

echo ""
echo "✅ VPS HTML 报告托管已启用"
echo "   下一步：本地 node scripts/sync-vps.mjs 同步 HTML 文件"
echo "         本地 python3 push_html.py --base-url $PUBLIC_BASE_URL"
