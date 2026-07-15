-- ============================================================================
-- 销售队伍业绩域 · 标保规则层（口径唯一事实源）
-- ============================================================================
-- 迁移自《标保核对表（新版）.xlsx》标保宽表 R 列口径（修复后标保）。
-- 2026-07-14 全量对账：194,191 行与 Excel 宽表逐行零差异，
-- 总额 = 150,327,494.46，见 sales_portrait 仓库 ADR-006。
--
-- 规则血缘（原 Excel 中为三套分行公式 + 手工修补，此处统一显式化）：
--   1. 险种系数
--      a. 信用保证险：恒 0.65（原 Excel 为硬编码单元格值）
--      b. 车险：按车险折标因子分类映射（原标保!L 车险行公式，
--         VLOOKUP 重复保单号取首条）；未匹配 → 1。2026-07-14 全量中未匹配
--         15 行涉及 14 个保单：14 行负保费冲销、1 行正保费；此处按工作簿值 1 显式兜底。
--         非空但未登记的分类不兜底，保留 NULL 供 ETL fail-fast，防新增枚举静默按 1 计算。
--      c. 其他非车险：按承保确认时间三段 × 险种简称映射（原标保!L2 公式，
--         阈值 2026-04-01 / 2026-05-07）
--   2. 一司一策系数：按一司一策分类（大同1.05→1.05，吕梁0.95→0.95，
--      其他/未匹配→1），来源 ADR-001
--   3. 最终系数：大同机构车险自 2025-05-15 起封顶 1.05（宽表 Q 列口径）
--   4. 标保 = 实收保费 × 最终系数
--
-- 占位符：{fact} = 标保底表 parquet；{dim} = 车险折标因子 parquet
-- ============================================================================

WITH coeff_first AS (
  -- VLOOKUP 语义：重复保单号取首条。源表共 4,505 个重复保单号（4,613 个额外行），
  -- 其中 251 个重复保单号的系数取值不一致；工作簿同样取首条，已按迁移口径接受。
  SELECT 保单号,
         arg_min(车险折标因子, src_row) AS 折标分类,
         arg_min(一司一策系数, src_row) AS 一司一策分类
  FROM '{dim}' GROUP BY 保单号
),
rules AS (
  SELECT f.*, cf.折标分类, cf.一司一策分类,
    CASE
      WHEN f.险种大类 = '信用保证险' THEN 0.65
      WHEN f.险种大类 = '车险' THEN
        CASE WHEN cf.折标分类 IS NULL THEN 1 ELSE
          CASE cf.折标分类
            WHEN '目标业务1.3' THEN 1.3 WHEN '目标业务1.2' THEN 1.2 WHEN '目标业务1.1' THEN 1.1
            WHEN '目标业务1.5' THEN 1.5 WHEN '目标业务1.05' THEN 1.05 WHEN '目标业务1' THEN 1
            WHEN '普通业务1' THEN 1 WHEN '普通业务1新' THEN 1 WHEN '普通业务0.95' THEN 0.95
            WHEN '管控业务0.5' THEN 0.5 WHEN '清亏业务0.3' THEN 0.3 WHEN '清亏业务0.1' THEN 0.1
            WHEN '清亏业务0' THEN 0 WHEN '清亏业务0.2' THEN 0.2
          END
        END
      ELSE
        CASE
          WHEN f.承保确认时间 IS NULL OR f.承保确认时间 < DATE '2026-04-01' THEN
            CASE WHEN substr(f.险种名称,1,4) IN ('0460','1372') THEN 1.5
                 WHEN substr(f.险种名称,1,2) = '12' THEN 1.5
                 WHEN substr(f.险种名称,1,4) = '0461' THEN 1.3
                 WHEN substr(f.险种名称,1,4) IN ('0621','0429','0431') THEN 1.2
                 ELSE 1 END
          WHEN f.承保确认时间 < DATE '2026-05-07' THEN
            CASE WHEN substr(f.险种名称,1,4) IN ('0460','1372') THEN 1.5
                 WHEN substr(f.险种名称,1,2) = '12' THEN 1.5
                 WHEN substr(f.险种名称,1,4) = '0461' THEN 1.2
                 ELSE 1 END
          ELSE
            CASE WHEN substr(f.险种名称,1,4) IN ('0460','1250') THEN 2
                 WHEN substr(f.险种名称,1,4) IN ('0429','0431','0612','0663','0664','0461') THEN 1.5
                 WHEN substr(f.险种名称,1,4) IN ('0602','0447','0603','0606','0662','0401') THEN 1.2
                 WHEN substr(f.险种名称,1,4) IN ('0621','1257') THEN 1.1
                 WHEN substr(f.险种名称,1,4) = '0209' THEN 0.5
                 ELSE 1 END
        END
    END AS 险种系数,
    CASE cf.一司一策分类 WHEN '大同1.05' THEN 1.05 WHEN '吕梁0.95' THEN 0.95 ELSE 1 END AS 一司一策系数
  FROM '{fact}' f LEFT JOIN coeff_first cf USING (保单号)
)
SELECT *,
  CASE WHEN 险种大类 = '车险' AND 承保确认时间 >= DATE '2025-05-15' AND 机构 LIKE '%大同%'
       THEN least(险种系数 * 一司一策系数, 1.05)
       ELSE 险种系数 * 一司一策系数 END AS 最终系数,
  实收保费 * CASE WHEN 险种大类 = '车险' AND 承保确认时间 >= DATE '2025-05-15' AND 机构 LIKE '%大同%'
       THEN least(险种系数 * 一司一策系数, 1.05)
       ELSE 险种系数 * 一司一策系数 END AS 标保
FROM rules
