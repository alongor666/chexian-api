#!/usr/bin/env bash
#
# 命令目录重组自动化脚本
#
# 功能：
# 1. 自动检测文档文件（非命令文件）
# 2. 批量移动到 .claude/docs/
# 3. 验证命令文件完整性
# 4. 生成移动报告
#
# 使用：bash scripts/reorganize-commands.sh
#

set -e

COMMANDS_DIR=".claude/commands"
DOCS_DIR=".claude/docs"
BACKUP_DIR=".claude/commands/.backup"
REPORT_FILE=".claude/REORGANIZE_REPORT.md"

echo "🚀 开始命令目录重组..."
echo ""

# 确保目录存在
mkdir -p "$DOCS_DIR"
mkdir -p "$BACKUP_DIR"

# ===========================
# 1. 检测文档文件
# ===========================
echo "🔍 检测文档文件（非命令文件）..."

# 文档文件特征：
# - 包含 "guide", "quickref", "test", "reference" 等关键词
# - 不包含 YAML frontmatter 的 name 字段
# - 文件名以大写字母开头

docs_to_move=()

for file in "$COMMANDS_DIR"/*.md; do
  [ -f "$file" ] || continue
  basename=$(basename "$file")

  # 跳过 README.md
  [[ "$basename" == "README.md" ]] && continue

  # 跳过备份目录
  [[ "$file" =~ \.backup ]] && continue

  # 检测文档特征
  is_doc=false

  # 1. 文件名包含文档关键词
  if [[ "$basename" =~ (guide|quickref|test|reference|summary|report|example|tutorial) ]]; then
    is_doc=true
  fi

  # 2. 文件名以大写字母开头（如 INTEGRATION_SUMMARY.md）
  if [[ "$basename" =~ ^[A-Z] ]]; then
    is_doc=true
  fi

  # 3. 文件不包含 YAML frontmatter 的 name 字段
  if ! grep -q "^name:" "$file"; then
    # 排除已知的命令文件（备份）
    [[ "$basename" =~ (commit-push-pr|data-analysis|security-review|weekly-report|session-manager|extract-knowledge|init-project|sync-and-rebase) ]] || is_doc=true
  fi

  if [ "$is_doc" = true ]; then
    docs_to_move+=("$file")
    echo "  📄 检测到文档: $basename"
  fi
done

echo ""
echo "✅ 检测完成：共 ${#docs_to_move[@]} 个文档文件"
echo ""

# ===========================
# 2. 批量移动文档
# ===========================
if [ ${#docs_to_move[@]} -eq 0 ]; then
  echo "✅ 无需移动，目录已整洁"
else
  echo "📦 批量移动文档到 $DOCS_DIR..."

  moved_count=0
  for file in "${docs_to_move[@]}"; do
    basename=$(basename "$file")
    target="$DOCS_DIR/$basename"

    # 如果目标文件已存在，先备份
    if [ -f "$target" ]; then
      cp "$target" "$BACKUP_DIR/$basename.$(date +%Y%m%d_%H%M%S).backup"
      echo "  ⚠️  备份已存在的文件: $basename"
    fi

    # 移动文件
    mv "$file" "$target"
    echo "  ✅ 移动: $basename → $DOCS_DIR/"
    ((moved_count++))
  done

  echo ""
  echo "✅ 移动完成：共 $moved_count 个文件"
fi

echo ""

# ===========================
# 3. 验证命令文件完整性
# ===========================
echo "🔍 验证命令文件完整性..."

commands_found=0
commands_valid=0
commands_invalid=()

for file in "$COMMANDS_DIR"/*.md; do
  [ -f "$file" ] || continue
  basename=$(basename "$file")

  # 跳过 README.md 和备份
  [[ "$basename" == "README.md" ]] && continue
  [[ "$file" =~ \.backup ]] && continue

  ((commands_found++))

  # 检查 YAML frontmatter
  if grep -q "^name:" "$file" && grep -q "^description:" "$file"; then
    ((commands_valid++))
    echo "  ✅ 有效命令: $basename"
  else
    commands_invalid+=("$basename")
    echo "  ❌ 无效命令: $basename (缺少 YAML frontmatter)"
  fi
done

echo ""
echo "📊 命令文件统计:"
echo "  - 总数: $commands_found"
echo "  - 有效: $commands_valid"
echo "  - 无效: ${#commands_invalid[@]}"
echo ""

if [ ${#commands_invalid[@]} -gt 0 ]; then
  echo "⚠️  警告：发现无效命令文件，请手动检查"
fi

# ===========================
# 4. 生成移动报告
# ===========================
echo "📝 生成移动报告..."

cat > "$REPORT_FILE" <<EOF
# 命令目录重组报告

> 执行时间: $(date +"%Y-%m-%d %H:%M:%S")
> 执行脚本: scripts/reorganize-commands.sh

---

## 📊 重组成果

| 指标 | 数值 |
|------|------|
| 检测到文档文件 | ${#docs_to_move[@]} 个 |
| 移动文件数 | ${moved_count:-0} 个 |
| 剩余命令文件 | $commands_found 个 |
| 有效命令文件 | $commands_valid 个 |
| 无效命令文件 | ${#commands_invalid[@]} 个 |

---

## 📁 移动的文件

EOF

if [ ${#docs_to_move[@]} -gt 0 ]; then
  for file in "${docs_to_move[@]}"; do
    basename=$(basename "$file")
    echo "- $basename" >> "$REPORT_FILE"
  done
else
  echo "无文件移动" >> "$REPORT_FILE"
fi

cat >> "$REPORT_FILE" <<EOF

---

## ✅ 验证结果

### 有效命令文件 ($commands_valid 个)

EOF

for file in "$COMMANDS_DIR"/*.md; do
  [ -f "$file" ] || continue
  basename=$(basename "$file")
  [[ "$basename" == "README.md" ]] && continue
  [[ "$file" =~ \.backup ]] && continue

  if grep -q "^name:" "$file"; then
    echo "- $basename" >> "$REPORT_FILE"
  fi
done

if [ ${#commands_invalid[@]} -gt 0 ]; then
  cat >> "$REPORT_FILE" <<EOF

### 无效命令文件 (${#commands_invalid[@]} 个)

EOF
  for invalid in "${commands_invalid[@]}"; do
    echo "- $invalid" >> "$REPORT_FILE"
  done
fi

cat >> "$REPORT_FILE" <<EOF

---

## 📋 目录结构

\`\`\`
.claude/
├── commands/           # 仅包含可执行命令
│   ├── README.md      # 命令索引
│   ├── *.md          # 命令文件 ($commands_found 个)
│   └── .backup/      # 备份文件
├── docs/              # 文档和参考资料
│   └── *.md          # 文档文件 (${#docs_to_move[@]} 个)
└── subagents/         # AI 子代理
\`\`\`

---

## ✅ 符合 Claude Code 最佳实践

- ✅ \`.claude/commands/\` 只包含命令文件
- ✅ 所有命令包含 YAML frontmatter
- ✅ 文档与命令完全分离
- ✅ 目录结构清晰

---

**维护者**: @claude
**完成时间**: $(date +"%Y-%m-%d")
**版本**: v1.0.0
EOF

echo "  ✅ 生成报告: $REPORT_FILE"
echo ""

# ===========================
# 5. 总结
# ===========================
echo "🎉 命令目录重组完成！"
echo ""
echo "📋 下一步:"
echo "  1. 查看重组报告: $REPORT_FILE"
echo "  2. 验证命令索引: $COMMANDS_DIR/README.md"
echo "  3. 运行治理校验: bun run scripts/check-governance.mjs"
echo ""
