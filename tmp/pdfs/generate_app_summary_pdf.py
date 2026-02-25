from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

OUT = "output/pdf/chexian-api-应用摘要-单页.pdf"

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

PAGE_W, PAGE_H = A4
MARGIN = 36
CONTENT_W = PAGE_W - 2 * MARGIN

c = canvas.Canvas(OUT, pagesize=A4)


def draw_wrapped(text, x, y, font="STSong-Light", size=10, leading=14):
    c.setFont(font, size)
    lines = []
    current = ""
    for ch in text:
        candidate = current + ch
        if pdfmetrics.stringWidth(candidate, font, size) <= CONTENT_W:
            current = candidate
        else:
            lines.append(current)
            current = ch
    if current:
        lines.append(current)

    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def section(title, y):
    c.setFont("STSong-Light", 12)
    c.drawString(MARGIN, y, title)
    return y - 16


y = PAGE_H - MARGIN

c.setFont("STSong-Light", 18)
c.drawString(MARGIN, y, "chexian-api 应用摘要")
y -= 24

c.setFont("STSong-Light", 9)
c.drawString(MARGIN, y, "证据来源: README.md, ARCHITECTURE.md, 开发文档/TECH_STACK.md, src/app/App.tsx, src/shared/api/client.ts, server/src/app.ts, server/src/routes/query.ts, server/src/services/duckdb.ts")
y -= 18

# 1) What it is
y = section("1) 它是什么", y)
text = "这是一个车险经营分析平台，采用纯 API 架构。前端 React 应用通过 REST API 访问后端 Express + DuckDB，对 Parquet 数据执行分析查询并展示可视化结果。"
y = draw_wrapped(text, MARGIN, y)
y -= 4

# 2) Who it's for
y = section("2) 面向谁", y)
text = "主要面向车险经营管理人员: 分公司管理员(全量视图)与三级机构用户(机构内视图)，角色与行级权限由 JWT 与权限中间件控制。"
y = draw_wrapped(text, MARGIN, y)
text = "更细粒度岗位画像(如精确职位说明): Not found in repo."
y = draw_wrapped(text, MARGIN, y)
y -= 4

# 3) Key features
y = section("3) 它做什么 (核心功能)", y)
features = [
    "- 登录与鉴权: 用户名密码登录，并支持企微 OAuth 回调入口。",
    "- 数据文件管理: 上传、加载、切换和下载 Parquet 数据文件。",
    "- 经营看板: KPI、趋势、机构与业务员维度分析。",
    "- 专题分析: 续保、成本、增长、货车、系数、营销战报、保费报表。",
    "- 查询能力: 预置查询 API + 自定义 SQL 查询端点。",
    "- 安全与治理: JWT 认证、权限过滤、限流、审计日志。",
]
for item in features:
    y = draw_wrapped(item, MARGIN, y)
y -= 4

# 4) Architecture
y = section("4) 如何工作 (紧凑架构)", y)
arch_lines = [
    "- 前端层: src/app/App.tsx 路由到 dashboard/premium-report/cost 等页面，src/shared/api/client.ts 统一请求 /api/*。",
    "- 接口层: server/src/app.ts 注册 auth/query/data/filters/ai 路由，/api 下应用限流与审计。",
    "- 业务层: server/src/routes/query.ts 解析筛选条件，调用 server/src/sql/*.ts 生成 SQL。",
    "- 数据层: server/src/services/duckdb.ts 使用 @duckdb/node-api 执行查询，加载最新 Parquet 并构建 PolicyFact 视图。",
    "- 权限流: authMiddleware + permissionMiddleware 注入行级过滤，管理员可见全量，机构用户仅见本机构。",
    "- 数据流: 浏览器组件 -> API Client -> /api/query|data|filters -> SQL 生成器 -> DuckDB -> JSON -> 前端渲染。",
]
for item in arch_lines:
    y = draw_wrapped(item, MARGIN, y)
y -= 4

# 5) Getting started
y = section("5) 如何运行 (最小步骤)", y)
steps = [
    "1. 安装依赖: 在仓库根目录执行 bun install，并在 server 目录执行 bun install。",
    "2. 准备后端环境: 配置 server/.env(至少 PORT/JWT_SECRET/CORS_ORIGIN)。",
    "3. 准备数据: 将 .parquet 文件放入 server/data/ (或使用数据同步脚本)。",
    "4. 启动前后端: bun run dev:full。访问 http://localhost:5173，健康检查 http://localhost:3000/health。",
]
for item in steps:
    y = draw_wrapped(item, MARGIN, y)

c.save()
print(OUT)
