-- 「续保报价归因」粗口径（renewal_tracker.is_quoted）假阳性复核 — 可复现查询
-- BACKLOG 550186 / PR #1137。评审整改版（2026-07-18）：日期取值严格对齐生产引擎
-- 数据管理/integrations/wecom_smartsheet/sync_ledger_update_fields.py fetch_source_rows：
--   签单日 = 保单域 MIN(CAST(policy_date AS DATE))，止期 = MIN(CAST(insurance_end_date AS DATE))，
--   按（保单号 + COALESCE(车架号,'')）复合键分组；标准口径命中要求 sign_date IS NOT NULL，
--   止期为 NULL 时不设上界——与生产 JOIN 条件逐项一致，不使用底册推导日期代理。
--
-- 用法（worktree 无数据时用主仓绝对路径；此处以主仓相对路径书写）：
--   山西：duckdb -c ".read 复核查询.sql"（先把下方三个路径宏替换为 SX 版）
--   四川：同上替换为 SC 版
--   省份隔离红线：WHERE branch_code 必带；SC 保单 glob 用列表形式排除 SX_ 前缀文件。
--
-- 路径宏（山西 SX）：
--   POLICY  = '数据管理/warehouse/validation/SX/*.parquet'          （union_by_name=true）
--   TRACKER = '数据管理/warehouse/validation/SX/renewal_tracker/latest.parquet'
--   QUOTES  = '数据管理/warehouse/validation/SX/quotes_conversion/latest.parquet'
--   BRANCH  = 'SX'
-- 路径宏（四川 SC · 2026-07 实测已切子目录布局，801409 cutover）：
--   POLICY  = '数据管理/warehouse/fact/policy/current/SC/*.parquet'
--   TRACKER = '数据管理/warehouse/fact/renewal_tracker/latest.parquet'
--   QUOTES  = '数据管理/warehouse/fact/quotes_conversion/latest.parquet'
--   BRANCH  = 'SC'
--
-- 实测结果（2026-07-18，与 PR #1137 评审复算逐位一致）：
--   山西：复合键粒度 假阳性 7,175/37,995 = 18.88%；VIN 去重粒度 7,157/37,976 = 18.85%
--   四川：复合键粒度 假阳性   936/71,928 =  1.30%；VIN 去重粒度   903/71,895 =  1.26%

WITH pol AS (
  -- 生产口径日期：保单域真实签单日/止期，按 保单号+车架号 复合键分组（对齐 fetch_source_rows ledger CTE）
  SELECT policy_no,
         COALESCE(vehicle_frame_no, '') AS vehicle_frame_no,
         MIN(CAST(policy_date AS DATE)) AS sign_date,
         MIN(CAST(insurance_end_date AS DATE)) AS end_date
  FROM read_parquet(POLICY, union_by_name=true)
  WHERE branch_code = BRANCH
  GROUP BY policy_no, COALESCE(vehicle_frame_no, '')
),
rt AS (
  SELECT source_policy_no, COALESCE(vehicle_frame_no, '') AS vehicle_frame_no, is_quoted
  FROM read_parquet(TRACKER)
  WHERE branch_code = BRANCH
),
q AS (
  -- 对齐生产 q CTE：仅商业险、车架号非空；不设报价窗口起点过滤（生产亦无）
  SELECT vehicle_frame_no, CAST(quote_time AS DATE) AS qd
  FROM read_parquet(QUOTES)
  WHERE branch_code = BRANCH AND insurance_type = '商业保险'
    AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
),
j AS (
  SELECT rt.source_policy_no, rt.vehicle_frame_no, rt.is_quoted,
         -- 标准口径命中：对齐生产 JOIN 条件（sign_date 非空；签单日+30 < 报价 ≤ 止期+30，止期空则无上界）
         MAX(CASE WHEN pol.sign_date IS NOT NULL
                   AND q.qd > pol.sign_date + INTERVAL 30 DAY
                   AND (pol.end_date IS NULL OR q.qd <= pol.end_date + INTERVAL 30 DAY)
                  THEN 1 ELSE 0 END) AS has_a
  FROM rt
  LEFT JOIN pol ON pol.policy_no = rt.source_policy_no
               AND pol.vehicle_frame_no = rt.vehicle_frame_no
  LEFT JOIN q ON q.vehicle_frame_no = NULLIF(rt.vehicle_frame_no, '')
  GROUP BY 1, 2, 3
)
-- 输出一：台账复合键粒度（source_policy_no + 车架号 行级）
SELECT '复合键粒度' AS 粒度,
       COUNT(*) AS 应续行数,
       SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS 粗口径已报价,
       SUM(CASE WHEN is_quoted AND has_a = 0 THEN 1 ELSE 0 END) AS 假阳性,
       ROUND(100.0 * SUM(CASE WHEN is_quoted AND has_a = 0 THEN 1 ELSE 0 END)
             / NULLIF(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END), 0), 2) AS 假阳率pct
FROM j
UNION ALL
-- 输出二：API/指标注册表车架号去重粒度（renewal_quoted_count = COUNT(DISTINCT vehicle_frame_no)）
SELECT 'VIN去重粒度',
       COUNT(DISTINCT vehicle_frame_no),
       COUNT(DISTINCT CASE WHEN is_quoted THEN vehicle_frame_no END),
       COUNT(DISTINCT CASE WHEN is_quoted THEN vehicle_frame_no END)
         - COUNT(DISTINCT CASE WHEN is_quoted AND has_a = 1 THEN vehicle_frame_no END),
       ROUND(100.0 * (COUNT(DISTINCT CASE WHEN is_quoted THEN vehicle_frame_no END)
         - COUNT(DISTINCT CASE WHEN is_quoted AND has_a = 1 THEN vehicle_frame_no END))
             / NULLIF(COUNT(DISTINCT CASE WHEN is_quoted THEN vehicle_frame_no END), 0), 2)
FROM j;
