# VPS 数据同步与重载

> 当前真源是 `scripts/sync-vps.mjs`。本文只记录操作者流程，不保存私钥、公钥或账号口令。

## 生产目标

- SSH 别名：`chexian-vps-deploy`
- 应用目录：`/var/www/chexian`
- 数据目录：`/var/www/chexian/server/data`
- 重载入口：`sudo /usr/local/bin/deploy-chexian-api reload`
- 健康检查：VPS 本机 `http://localhost:3000/health`

连接信息如有变更，以 `scripts/sync-vps.mjs --help` 和操作者本机 SSH 配置为准；不要把密钥材料写入仓库。

## 标准发布流程

先验证本地数据，再预演同步计划：

```bash
bun scripts/verify-data-release.mjs --domain <domain_id>
node scripts/sync-vps.mjs --domain <domain_id> --dry-run
```

检查 dry-run 中的本地源、远端目标、`critical`/`atomic` 属性和 reload 计划。确认后仅同步数据：

```bash
node scripts/sync-vps.mjs --domain <domain_id> --no-restart
```

核对远端文件，再重载和检查健康状态：

```bash
ssh chexian-vps-deploy \
  'find /var/www/chexian/server/data -type f -name "*.parquet" -printf "%p %s\n" | sort'

ssh chexian-vps-deploy \
  'sudo /usr/local/bin/deploy-chexian-api reload'

ssh chexian-vps-deploy \
  'curl -fsS http://localhost:3000/health'
```

`/health` 为绿只证明主服务存活。发布完成还必须用真实权限用户请求目标 API，核对行数、核心合计、ETag 和日志。

## 销售队伍业绩域

该域本地与远端目录分别为：

```text
数据管理/warehouse/fact/sales_team_performance/
/var/www/chexian/server/data/fact/sales_team_performance/
```

ETL 与发布命令：

```bash
python3 数据管理/pipelines/sales_team_etl.py \
  -i '/absolute/path/标保核对表（新版）.xlsx' \
  --verify-workbook

bun scripts/verify-data-release.mjs --domain sales_team_performance
node scripts/sync-vps.mjs --domain sales_team_performance --dry-run
node scripts/sync-vps.mjs --domain sales_team_performance --no-restart
```

`sales_team_performance` 在同步计划中是 `critical + atomic + requiredLocal`：本地目录缺失会在 rsync、远端清理和 reload 前阻断，禁止静默跳过。

重载后，以管理员身份请求 `/api/query/sales-team-performance`，至少核对：

- `total.sales_team_row_count = 194191`
- `total.standard_premium = 150327494.46`
- 首次响应含 ETag，条件请求返回 304
- 日志无 `no file found`、视图不存在或加载超时

## 回滚和故障处理

- 同步前失败：保持远端不变，修复本地 ETL 或路径后重新 dry-run。
- 原子同步失败：不要 reload；检查 rsync 输出和远端临时目录。
- reload 后接口数字不符：停止宣告发布成功，恢复上一批已验证数据后再次 reload。
- `Permission denied`：检查操作者 SSH/受限 sudo 授权，不要临时放宽登录或把服务绑定到公网地址。
- `Connection refused`：先核查 SSH 别名、VPS 状态与安全组；不要改动无关代理服务。
