# 车险数据分析平台（chexian-api）

## 项目简介
车险数据分析平台 - 一个面向车险经营场景的前后端分离分析平台。

## 技术栈
- 前端: React + TypeScript + Vite + Tailwind CSS
- 后端: Express + TypeScript + DuckDB
- 测试: Vitest + Playwright

## 项目结构
- `src/` - 前端源码
- `server/` - 后端源码
- `deploy/` - 部署脚本和配置
- `tests/` - 测试文件

## 安装和运行
1. 安装依赖

```bash
npm install
cd server && npm install && cd ..
```

2. 启动开发环境（前后端）

```bash
npm run dev
```

3. 构建生产版本

```bash
npm run build
```

4. 运行测试

```bash
npm run test
```

## 主要 API 端点
- `GET /api/kpi` - KPI 汇总指标
- `GET /api/trend` - 趋势分析
- `GET /api/renewal` - 续保分析
- `POST /api/query` - 通用查询入口（按模块查询）
- `GET /api/filters` - 筛选器选项

## 说明
- 前端默认运行于 `http://localhost:5173`
- 后端默认运行于 `http://localhost:3000`
- 生产部署与数据同步脚本位于 `deploy/`
