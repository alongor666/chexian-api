#!/usr/bin/env python3
"""续保报告『判断红线』lint —— 把用户否决过的判断型错误固化成确定性回归闸。

三个技能里 ①取数有 refine_verify（对 Parquet）、③渲染有 driver（对版面），唯独 ②refine 的
『判断定调』无机器真值。本 lint 是把『用户的人眼否决』沉淀成可复跑的禁词/必含闸：防回归（已
犯过的型错不复犯），配合对话分析持续往 judgment_redlines.json 加规则，构成自迭代回路。

单一事实源 = 同目录 judgment_redlines.json（正反例库）。
用法：python3 lint_renewal_judgment.py <报告.md | PPT.html>   退出码 0=全过 / 1=有违反 / 2=用法错。
"""
import sys
import re
import json
import pathlib

HERE = pathlib.Path(__file__).parent


def strip_tags(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s)


# 标点/括号/引号/空白归一：禁词是精确子串匹配，对『不在「报价覆盖」』这类引号变体脆弱
# （PR #539 review 实测：bad_example 自身写法都能绕过）。匹配前对文本与禁词同做归一，
# 一次性堵住"插引号/加空白"整类绕过。注意：插入词变体（缺口『主要』在成交端）属语义级，
# 子串黑名单本质防不了，靠自迭代积累正反例 + 一次过率北极星指标兜底。
_NORM_RE = re.compile(r'[「」『』“”‘’（）()【】〔〕《》〈〉［］\[\]｛｝{}\s]')


def normalize(s: str) -> str:
    return _NORM_RE.sub('', s)


def lint(path: str) -> int:
    rules = json.loads((HERE / 'judgment_redlines.json').read_text(encoding='utf-8'))
    text = normalize(strip_tags(pathlib.Path(path).read_text(encoding='utf-8')))
    violations = []
    for r in rules.get('rules', []):
        hits = [w for w in r['forbid'] if normalize(w) in text]
        if hits:
            violations.append((r['id'], r['name'], '命中禁词 ' + ' / '.join(hits), r.get('good_example', '')))
    for m in rules.get('must_contain', []):
        if not any(normalize(w) in text for w in m['any_of']):
            violations.append((m['id'], m['name'], '缺必含（' + ' / '.join(m['any_of']) + ' 至少一个）', m.get('rationale', '')))
    n_rules = len(rules.get('rules', [])) + len(rules.get('must_contain', []))
    if violations:
        print(f'✗ 判断红线 {len(violations)} 违反 · {pathlib.Path(path).name}', file=sys.stderr)
        for vid, name, what, fix in violations:
            print(f'  [{vid}] {name}：{what}', file=sys.stderr)
            if fix:
                print(f'        → 应改为：{fix}', file=sys.stderr)
        return 1
    print(f'✓ 判断红线 0 违反（{n_rules} 条规则）· {pathlib.Path(path).name}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python3 lint_renewal_judgment.py <报告.md|PPT.html>', file=sys.stderr)
        sys.exit(2)
    sys.exit(lint(sys.argv[1]))
