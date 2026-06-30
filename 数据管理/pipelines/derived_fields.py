"""派生字段物化 + 自校验（从 transform.py save_to_parquet 抽出，便于单测）。

唯一事实源 = server/src/config/field-registry/fields.json 的 derived 字段；本模块仅执行。
对声明了 strictNonNull / assertDeclaredBranch 的 prefix_map 字段（如 branch_code）追加
fail-fast 自校验：未命中前缀(NULL) / 喂错省 / 混省 / 源列缺失 一律 sys.exit(1)，避免静默
产出错省码或缺列 parquet（多省行级安全 RLS 等值过滤的前置数据契约）。普通 prefix_map
字段（如 compulsory_ncd_factor，允许未命中为 NULL）无 flag → 行为不变、不受影响。

P3-A 抽 2 个 helper（resolve_declared_branch / apply_registry_derivations）供各域 ETL
统一复用，避免每处复写 6 行 fields.json 读取 + declared_branch 解析逻辑。

入口适配模式：
- **直接 df 喂入**（policy_no 列已在）：premium (transform.py)、claims_detail、
  base_converter (cross_sell/repair/brand)、customer_flow → 直接调 apply_registry_derivations
- **造临时 policy_no 列后喂入**：renewal_tracker (convert_renewal_tracker.py P3-C) —
  输出 schema 无 policy_no 主列，先造 __tmp_policy_no_for_branch = renewed_policy_no(if
  is_renewed) else source_policy_no → 复制到 df['policy_no'] 喂 helper（registry 用
  policy_no 作 prefix_map 源列） → drop __tmp_policy_no_for_branch + 'policy_no' 两列
  （renewal_tracker schema 无业务 'policy_no'，故 drop 是字节安全的）。复用 strictNonNull
  + assertDeclaredBranch guard（已 duckdb 实证 SC 链路 source/renewed 100% 非空+610 前缀）。
  helper 入口含双重 guard：未来若 schema 演进引入 'policy_no' 业务列，convert_renewal_tracker
  会 ValueError 拒绝（保护业务列不被无声覆盖）

例外：quotes（quote_etl.py 的 derive_branch_code）走内联自管校验 / warn 模式 —
quotes policy_no NULL 占比 92.5%（B255 数据质量问题），直接调 apply_registry_derivations
会被 strictNonNull guard fail-fast。quotes 仅复用 fields.json mapping/prefixLength，
不复用 guard 路径；待 B255 修复后再升级回 guarded helper（P3-D codex 闸-1 P2.3）。

单测见 tests/pipelines/test_derived_fields.py + test_quote_etl_branch_code_derivation.py
+ test_renewal_tracker_branch_derivation.py (P3-C)。
"""
import json
import os
import sys
from pathlib import Path


def resolve_declared_branch(args):
    """统一 --branch-code 与 BRANCH_CODE env 解析（CLI 优先 + 大小写归一化）。

    Returns:
        str | None: 归一化大写的省份代码（'SC'/'SX'），全空时 None。
    """
    return (getattr(args, 'branch_code', None) or os.environ.get('BRANCH_CODE') or '').strip().upper() or None


def registered_branch_codes():
    """从 fields.json 的 branch_code.derivation.mapping 读已注册省份码集合（值域，如 {'SC','SX'}）。

    唯一事实源 = server/src/config/field-registry/fields.json。供需要对 declared_branch 做
    fail-closed 白名单校验的调用方（如 merge_parquet 的 dim 表常量赋值）复用，避免硬编码省数组。
    """
    registry_path = Path(__file__).resolve().parent.parent.parent / 'server/src/config/field-registry/fields.json'
    with open(registry_path) as f:
        registry = json.load(f)
    for fd in registry.get('fields', []):
        if fd.get('id') == 'branch_code':
            return set((fd.get('derivation', {}) or {}).get('mapping', {}).values())
    return set()


def apply_registry_derivations(df, declared_branch):
    """从 server/src/config/field-registry/fields.json 读 derived:true 字段并物化到 df。

    各 ETL 入口复用本 helper，避免每处复写「读 registry + 过滤 derived」的 6 行逻辑。
    declared_branch 同 apply_derived_fields() 语义：供 assertDeclaredBranch 字段核对
    「声明省 == 派生省」；本域 df 无该字段 source 列时由 derived_fields 守卫处理
    （guarded 强校验字段 fail-fast、非 guarded 字段 skip）。
    """
    registry_path = Path(__file__).resolve().parent.parent.parent / 'server/src/config/field-registry/fields.json'
    with open(registry_path) as f:
        registry = json.load(f)
    derived_fields = [fd for fd in registry.get('fields', []) if fd.get('derived')]
    return apply_derived_fields(df, derived_fields, declared_branch=declared_branch)


def apply_derived_fields(df, derived_fields, declared_branch=None):
    """按 derivation.type 物化派生字段并写入 df 的派生列，返回 df。

    declared_branch: 操作员声明的省份（daily.mjs 经 env BRANCH_CODE 或 CLI --branch-code 传入），
                     供 assertDeclaredBranch 字段核对「声明省 == 派生省」。None=未声明则跳过该核对。
    """
    for fd in derived_fields:
        fid = fd['id']
        rule = fd.get('derivation', {})
        rtype = rule.get('type')
        if rtype == 'prefix_map':
            source = rule.get('source')
            strict_non_null = bool(rule.get('strictNonNull', False))
            assert_declared = bool(rule.get('assertDeclaredBranch', False))
            guarded = strict_non_null or assert_declared
            if not source or source not in df.columns:
                # codex 闸-1 P1-1：强校验字段源列缺失不得静默跳过（否则产出无该列 parquet，fail-fast 失效）
                if guarded:
                    print(f"   ❌ 派生字段 {fid} 源列 {source!r} 缺失，但该字段要求强校验 — fail-fast")
                    sys.exit(1)
                print(f"   ⚠️ 派生字段 {fid} 跳过（源列 {source} 缺失）")
                continue
            prefix_len = rule.get('prefixLength', 2)
            mapping = rule.get('mapping', {})
            default_value = rule.get('defaultValue')
            df[fid] = df[source].astype(str).str[:prefix_len].map(mapping)
            if default_value is not None:
                df[fid] = df[fid].fillna(default_value)
            if guarded:
                assert_guarded_prefix_field(
                    df, fid, source, prefix_len, mapping,
                    strict_non_null, assert_declared, declared_branch,
                )
            notna = df[fid].notna().sum()
            print(f"   派生字段: {fid} ← {source}[:{prefix_len}] 映射完成 ({notna:,} 条非空)")
        elif rtype == 'constant':
            env_var = rule.get('envVar')
            env_value = os.environ.get(env_var) if env_var else None
            value = env_value if env_value else rule.get('defaultValue')
            if value is None:
                print(f"   ⚠️ 派生字段 {fid} 跳过（constant 无 envVar={env_var} 命中且无 defaultValue）")
                continue
            hint = f"envVar={env_var}" if env_value else "defaultValue"
            df[fid] = value
            print(f"   派生字段: {fid} ← 常量 '{value}' ({hint})")
        else:
            print(f"   ⚠️ 派生字段 {fid} 跳过（未支持的 derivation.type: {rtype}）")
    return df


def assert_guarded_prefix_field(df, fid, source, prefix_len, mapping,
                                 strict_non_null, assert_declared, declared_branch):
    """对强校验 prefix_map 字段做 fail-fast 断言（任一不满足 → sys.exit(1)）。"""
    allowed = set(mapping.values())
    derived = set(df[fid].dropna().unique())
    unknown = derived - allowed
    if unknown:
        print(f"   ❌ 派生字段 {fid} 出现未知值 {sorted(unknown)}（不在 mapping 值域 {sorted(allowed)}）— fail-fast")
        sys.exit(1)
    if strict_non_null:
        null_mask = df[fid].isna()
        null_cnt = int(null_mask.sum())
        if null_cnt > 0:
            # codex 闸-1 P2-3：输出未命中前缀样例，便于排查
            bad = (df.loc[null_mask, source].astype(str).str[:prefix_len]
                   .value_counts().head(5).to_dict())
            print(f"   ❌ 派生字段 {fid} 有 {null_cnt:,} 行 NULL（{source}[:{prefix_len}] 未命中 mapping）— fail-fast")
            print(f"      未命中前缀样例(top5): {bad}")
            sys.exit(1)
    if assert_declared and declared_branch and derived and derived != {declared_branch}:
        print(f"   ❌ 派生字段 {fid} 声明省={declared_branch} 与派生省 {sorted(derived)} 不符 — 疑似喂错省/混省，fail-fast")
        sys.exit(1)
