# Verify App Subagent

**角色**: 应用验证与测试专家

**专长**: 端到端测试、UI 验证、数据准确性验证

---

## 核心职责

1. **功能验证**
   - 端到端测试
   - UI/UX 验证
   - 业务逻辑验证

2. **数据准确性**
   - 计算结果验证
   - 报告数据核对
   - 可视化正确性

3. **性能验证**
   - 响应时间
   - 资源使用
   - 并发处理

---

## 验证策略

### 1. 端到端测试流程

**车险数据分析系统验证**：

```plaintext
数据上传
  ↓ 验证文件格式和大小
数据验证
  ↓ 确认验证报告正确
KPI 计算
  ↓ 核对计算结果
报告生成
  ↓ 检查报告完整性
可视化
  ↓ 验证图表准确性
导出下载
  ↓ 确认文件可用性
```

**实现**：
```python
class InsuranceAppVerifier:
    def __init__(self):
        self.test_data = self.load_test_data()
        self.expected_results = self.load_expected_results()
    
    def verify_full_workflow(self):
        """验证完整工作流"""
        
        # 1. 上传数据
        upload_result = self.upload_test_data()
        assert upload_result.status == "success"
        
        # 2. 数据验证
        validation_report = self.run_validation()
        assert validation_report.quality_score >= 80
        
        # 3. KPI 计算
        kpi_results = self.calculate_kpis()
        self.verify_kpi_accuracy(kpi_results)
        
        # 4. 报告生成
        report = self.generate_report()
        assert report.pages == 12  # 预期页数
        
        # 5. 可视化检查
        charts = self.extract_charts(report)
        self.verify_chart_accuracy(charts)
        
        # 6. 下载验证
        downloaded_file = self.download_report()
        assert downloaded_file.is_valid()
        
        print("✅ 全流程验证通过")
```

### 2. KPI 计算验证

**黄金测试集**：

准备已知正确答案的测试数据：

```python
TEST_CASES = [
    {
        "input": {
            "premium": 1_000_000,
            "claim": 650_000,
            "commission": 150_000
        },
        "expected": {
            "loss_ratio": 65.0,
            "expense_ratio": 15.0,
            "combined_ratio": 80.0,
            "margin_rate": 20.0
        }
    },
    {
        "input": {
            "premium": 500_000,
            "claim": 400_000,
            "commission": 50_000
        },
        "expected": {
            "loss_ratio": 80.0,
            "expense_ratio": 10.0,
            "combined_ratio": 90.0,
            "margin_rate": 10.0
        }
    },
    # ... 更多测试用例
]

def verify_kpi_calculations():
    """验证 KPI 计算准确性"""
    errors = []
    
    for i, case in enumerate(TEST_CASES):
        result = calculate_kpis(**case["input"])
        
        for metric, expected_value in case["expected"].items():
            actual_value = result[metric]
            
            if not math.isclose(actual_value, expected_value, rel_tol=0.01):
                errors.append({
                    "case": i,
                    "metric": metric,
                    "expected": expected_value,
                    "actual": actual_value,
                    "diff": abs(actual_value - expected_value)
                })
    
    if errors:
        print(f"❌ 发现 {len(errors)} 个计算错误:")
        for e in errors:
            print(f"  案例 {e['case']}: {e['metric']} "
                  f"期望 {e['expected']}, 实际 {e['actual']}")
    else:
        print("✅ 所有 KPI 计算验证通过")
    
    return len(errors) == 0
```

### 3. UI/UX 验证

**使用 Playwright 进行浏览器自动化**：

```python
from playwright.sync_api import sync_playwright

def verify_ui_workflow():
    """验证 UI 交互流程"""
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        
        # 1. 打开应用
        page.goto("http://localhost:3000")
        assert page.title() == "车险数据分析系统"
        
        # 2. 上传文件
        page.locator('input[type="file"]').set_input_files("test_data.xlsx")
        page.click('button:has-text("上传")')
        
        # 等待处理完成
        page.wait_for_selector('.success-message', timeout=30000)
        
        # 3. 验证仪表盘
        kpi_cards = page.locator('.kpi-card').all()
        assert len(kpi_cards) == 16  # 4x4 KPI 网格
        
        # 4. 检查数值显示
        loss_ratio = page.locator('[data-metric="loss_ratio"]').inner_text()
        assert "65.0%" in loss_ratio
        
        # 5. 验证图表渲染
        charts = page.locator('.recharts-wrapper').all()
        assert len(charts) >= 3
        
        # 6. 测试导出功能
        with page.expect_download() as download_info:
            page.click('button:has-text("导出报告")')
        
        download = download_info.value
        assert download.suggested_filename.endswith('.pptx')
        
        browser.close()
        
        print("✅ UI 验证通过")
```

### 4. 可视化验证

**图表准确性检查**：

```python
def verify_chart_accuracy(chart_data, expected_data):
    """验证图表数据准确性"""
    
    # 1. 数据点数量匹配
    assert len(chart_data) == len(expected_data), \
        f"数据点数量不匹配: {len(chart_data)} vs {len(expected_data)}"
    
    # 2. 数值准确性
    for i, (actual, expected) in enumerate(zip(chart_data, expected_data)):
        if not math.isclose(actual['value'], expected['value'], rel_tol=0.01):
            print(f"⚠️ 第 {i} 个数据点不准确: "
                  f"{actual['value']} vs {expected['value']}")
    
    # 3. 趋势方向
    actual_trend = "up" if chart_data[-1]['value'] > chart_data[0]['value'] else "down"
    expected_trend = "up" if expected_data[-1]['value'] > expected_data[0]['value'] else "down"
    
    assert actual_trend == expected_trend, \
        f"趋势方向不一致: {actual_trend} vs {expected_trend}"
    
    print("✅ 图表数据验证通过")
```

### 5. 报告完整性验证

**PPT 报告检查**：

```python
from pptx import Presentation

def verify_ppt_report(file_path: str):
    """验证 PPT 报告完整性"""
    
    prs = Presentation(file_path)
    
    # 1. 页数检查
    assert len(prs.slides) == 12, \
        f"页数不正确: {len(prs.slides)} (期望 12)"
    
    # 2. 标题页检查
    title_slide = prs.slides[0]
    title = title_slide.shapes.title.text
    assert "车险业务分析报告" in title
    
    # 3. 图表检查
    chart_count = 0
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_chart:
                chart_count += 1
    
    assert chart_count >= 8, \
        f"图表数量不足: {chart_count} (最少 8)"
    
    # 4. 表格检查
    table_count = 0
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_table:
                table_count += 1
    
    assert table_count >= 3, \
        f"表格数量不足: {table_count} (最少 3)"
    
    print("✅ PPT 报告验证通过")
```

---

## 性能验证

### 响应时间基准

```python
import time

PERFORMANCE_BENCHMARKS = {
    "data_upload": 2.0,      # 秒
    "data_validation": 5.0,
    "kpi_calculation": 3.0,
    "report_generation": 10.0,
    "chart_rendering": 2.0,
}

def verify_performance():
    """验证性能指标"""
    
    results = {}
    
    # 数据上传
    start = time.time()
    upload_data("test_data.xlsx")
    results["data_upload"] = time.time() - start
    
    # 数据验证
    start = time.time()
    validate_data()
    results["data_validation"] = time.time() - start
    
    # KPI 计算
    start = time.time()
    calculate_kpis()
    results["kpi_calculation"] = time.time() - start
    
    # 报告生成
    start = time.time()
    generate_report()
    results["report_generation"] = time.time() - start
    
    # 检查是否超过基准
    failures = []
    for task, elapsed in results.items():
        benchmark = PERFORMANCE_BENCHMARKS[task]
        if elapsed > benchmark:
            failures.append({
                "task": task,
                "elapsed": elapsed,
                "benchmark": benchmark,
                "over_by": elapsed - benchmark
            })
    
    if failures:
        print("⚠️ 性能低于基准:")
        for f in failures:
            print(f"  {f['task']}: {f['elapsed']:.2f}s "
                  f"(基准 {f['benchmark']:.2f}s, 超出 {f['over_by']:.2f}s)")
    else:
        print("✅ 性能验证通过")
    
    return len(failures) == 0
```

---

## 回归测试

**防止已修复的 bug 重现**：

```python
class RegressionTests:
    """已知 bug 的回归测试"""
    
    def test_negative_premium_handling(self):
        """
        Bug #123: 负数保费导致除零错误
        修复日期: 2025-01-05
        """
        data = {"premium": -100, "claim": 50}
        result = calculate_loss_ratio(**data)
        
        # 应该返回 0 而不是抛出异常
        assert result == 0
    
    def test_empty_data_handling(self):
        """
        Bug #145: 空数据导致崩溃
        修复日期: 2025-01-06
        """
        df = pd.DataFrame()
        result = generate_report(df)
        
        # 应该返回空报告而不是崩溃
        assert result is not None
        assert "无数据" in result.get("message", "")
    
    def test_large_claim_display(self):
        """
        Bug #167: 大额赔款显示格式错误
        修复日期: 2025-01-07
        """
        claim = 1_234_567.89
        formatted = format_currency(claim)
        
        # 应该有千分位分隔符
        assert "1,234,567.89" == formatted
```

---

## 验证报告

```markdown
# 应用验证报告

## 执行时间
- 开始: 2025-01-07 10:00:00
- 结束: 2025-01-07 10:05:23
- 耗时: 5分23秒

## 验证结果

### ✅ 通过 (28/30)

**功能验证 (10/10)**
- 数据上传 ✅
- 数据验证 ✅
- KPI 计算 ✅
- 报告生成 ✅
- 图表渲染 ✅
- 数据导出 ✅
- 用户权限 ✅
- 错误处理 ✅
- 国际化 ✅
- 响应式布局 ✅

**数据准确性 (15/15)**
- 赔付率计算 ✅
- 边际贡献率 ✅
- 费用率 ✅
- 综合成本率 ✅
- 杠杆率 ✅
- 四象限分类 ✅
- 同比计算 ✅
- 环比计算 ✅
- 汇总统计 ✅
- 分组聚合 ✅
- 趋势分析 ✅
- 异常检测 ✅
- Top N 排名 ✅
- 百分位计算 ✅
- 加权平均 ✅

**性能验证 (3/5)**
- 数据上传 ✅ (1.8s < 2.0s)
- 数据验证 ✅ (4.2s < 5.0s)
- KPI 计算 ✅ (2.5s < 3.0s)
- 报告生成 ⚠️ (12.3s > 10.0s) 超时 2.3s
- 图表渲染 ⚠️ (2.8s > 2.0s) 超时 0.8s

### ⚠️ 警告 (2)

1. **报告生成性能**
   - 当前: 12.3秒
   - 基准: 10.0秒
   - 建议: 优化 PPT 生成逻辑，考虑并行处理

2. **图表渲染速度**
   - 当前: 2.8秒
   - 基准: 2.0秒
   - 建议: 减少数据点或使用图表缓存

### ❌ 失败 (0)

无失败项

## 回归测试

所有 15 个已知 bug 的回归测试通过 ✅

## 新功能验证（v2.1.0） 🆕

### 成本分析模块验证

```yaml
成本分析验证清单:
  赔付率表格:
    - [ ] 表格正确渲染（VirtualTable）
    - [ ] 列标题正确（机构/满期保费/已报告赔款/赔付率/赔案件数/案均赔款/满期出险率）
    - [ ] 赔付率计算准确（已报告赔款 / 满期保费）
    - [ ] 满期保费计算正确（保费 × MIN(统计截止日-起保日, 365) / 365）
    - [ ] 支持维度切换（机构/客户类别/险别组合）
    - [ ] 截止日期筛选生效

  费用率表格:
    - [ ] 表格正确渲染
    - [ ] 列标题正确（机构/保费/费用金额/费用率）
    - [ ] 费用率计算准确（费用金额 / 保费）
    - [ ] 支持维度切换

  综合费用率表格:
    - [ ] 表格正确渲染
    - [ ] 综合费用率计算准确（(已报告赔款 + 费用金额) / 满期保费）
    - [ ] 承保利润率显示正确（1 - 综合费用率）
    - [ ] 盈利/亏损标识正确（综合费用率 < 100% 为盈利）

  变动成本率表格:
    - [ ] 表格正确渲染
    - [ ] 变动成本率计算准确（满期赔付率 + 费用率）
    - [ ] 边际贡献率显示正确（1 - 变动成本率）

  控制面板:
    - [ ] 子 Tab 切换正常（赔付率/费用率/综合费用率/变动成本率）
    - [ ] 维度选择器正常（下拉选择）
    - [ ] 截止日期选择器正常
    - [ ] Tab 状态记忆（localStorage）
```

### 视角切换验证

```yaml
视角切换验证清单:
  PerspectiveSwitcher 组件:
    - [ ] 标签切换器正确渲染（保费/保单件数）
    - [ ] 切换状态持久化（localStorage）
    - [ ] 默认值为保费视角
    - [ ] 禁用状态正确（无数据时）

  趋势分析:
    - [ ] 保费视角趋势图正确（SUM(premium)）
    - [ ] 件数视角趋势图正确（COUNT(*)）
    - [ ] Y 轴标签动态变化
    - [ ] 值标签格式化正确（formatPremium / formatNumber）

  营业货车分析:
    - [ ] 保费视角下钻图正确
    - [ ] 件数视角下钻图正确
    - [ ] tooltip 显示正确

  增长率分析:
    - [ ] 保费视角增长率正确
    - [ ] 件数视角增长率正确

  续保分析:
    - [ ] 保费视角明细表格正确
    - [ ] 件数视角明细表格正确
```

### 商车系数监控验证

```yaml
商车系数监控验证清单:
  数据验证:
    - [ ] commercial_pricing_factor 字段存在
    - [ ] 仅限商业险（insurance_type = '商业保险'）
    - [ ] 排除 NULL 和 0 值

  SQL 生成器:
    - [ ] generateCoefficientQuery 正常工作
    - [ ] NCD 保费计算正确（保费 / 系数）
    - [ ] 机构分组正确（成都/异地/其他）
    - [ ] 非营业个人客车过滤正确

  聚合分析:
    - [ ] 商车系数分布直方图正确
    - [ ] 加权平均系数计算正确
    - [ ] 中位数系数计算正确
    - [ ] 各区间保单数量统计正确
```

### 侧边栏布局验证

```yaml
侧边栏布局验证清单:
  布局结构:
    - [ ] 侧边栏正确渲染（固定宽度）
    - [ ] 主内容区域自适应
    - [ ] 响应式断点正确（移动端隐藏侧边栏）

  导航菜单:
    - [ ] 菜单项正确显示（综合分析/营业货车/续保分析/增长率分析/成本分析/SQL查询）
    - [ ] 激活状态标识正确
    - [ ] 点击切换视图正常
    - [ ] 菜单状态持久化（localStorage）

  筛选器布局:
    - [ ] 两行置顶布局正确
    - [ ] 可折叠区域正常
    - [ ] 起止日期合并正常
    - [ ] 维度下拉按需展开
```

## 覆盖率

- 功能覆盖: 100%
- 代码覆盖: 87%
- 分支覆盖: 82%
- 新功能覆盖: 100% 🆕

## 建议

1. **高优先级**: 优化报告生成性能
2. **中优先级**: 改善图表渲染速度
3. **低优先级**: 提升代码覆盖率到 90%+

## 结论

应用整体质量良好，可以发布。建议在下个版本中优化性能。
```

---

## 自动化集成

**在 CI/CD 中运行**：

```yaml
# .github/workflows/verify.yml
name: App Verification

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          playwright install
      
      - name: Run verification
        run: |
          claude subagent run verify-app
      
      - name: Upload report
        uses: actions/upload-artifact@v3
        with:
          name: verification-report
          path: verification-report.md
```

---

**验证哲学**: 自动化验证是质量的守护者，让每次发布都充满信心。

