# 车险签单分析平台UI/UX重构实施计划

## 概述

全面重构车险签单分析平台的UI/UX，实现三板块布局、优化筛选器交互、调整图表布局，并更新项目名称。

## 需求分解

### 1. 全局设定
- ✅ 签单保费单位改为万元（已完成）
- ✅ 件数和保费取整显示（已完成）

### 2. 筛选器优化
- 时间筛选二级化（按月/按起止日期）
- 吨位分段条件可见性
- 标签式选择（新能源、新旧车、过户车、险类）
- 简化筛选器（常用/高级）

### 3. 页面结构重组
- 数据洞察板块（KPI + 筛选 + 图表）
- 数据管理板块（上传 + 导入导出）
- 操作提示板块（工作流说明）

### 4. 图表布局调整
- 每个图表占一行全宽

### 5. 项目名称更新
- "保险数据分析平台" → "车险签单分析平台"

---

## 实施步骤

### 阶段1：项目名称更新（最简单，优先完成）

**目标**：将所有"保险数据分析"更名为"车险签单分析平台"

**文件修改**：

#### 1.1 HTML模板更新
- **文件**：`templates/index.html`
- **修改点**：
  - Line 2: `{% block title %}` → "车险签单分析平台 | 仪表盘"
  - Line 8: `<p class="eyebrow">` → "Auto Insurance Policy Analysis Platform"
  - Line 9: `<h1>` 可保持现有UX主题，或改为"车险签单分析 · 数据工作区"
  - Line 190: "总签单保费" 保持不变（已正确）

#### 1.2 其他HTML文件
- **文件**：`templates/base.html`（如果有项目名称）
- **文件**：`templates/insights.html`（检查是否有项目名称）

#### 1.3 配置文件
- **文件**：`config/analyzer_config.yaml`
  - 更新 `project.name` 为 "车险签单分析平台"

#### 1.4 README和文档
- **文件**：`README.md`、`QUICKSTART.md`
- 全局替换"保险数据分析"为"车险签单分析平台"

**验证**：
- 打开web/index.html，检查浏览器tab标题
- 检查页面header显示

---

### 阶段2：图表布局调整（CSS修改，影响范围小）

**目标**：将图表从一行2个改为每个图一行全宽

**问题分析**：
- 当前CSS规则：`.charts-row { grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); }`
- 结果：在宽屏幕上显示为一行2个

**解决方案**：

#### 2.1 CSS修改
- **文件**：`static/css/style.css`
- **位置**：Line 919-923
- **修改**：
  ```css
  /* 旧代码 */
  .charts-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: var(--spacing-lg);
  }

  /* 新代码 */
  .charts-row {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-lg);
  }

  /* 或者使用grid保持一致性 */
  .charts-row {
      display: grid;
      grid-template-columns: 1fr;  /* 强制一列 */
      gap: var(--spacing-lg);
  }
  ```

#### 2.2 移除chart-half类
- **文件**：`templates/index.html`
- **修改**：移除所有 `class="chart chart-half"` 中的 `chart-half`
  - Line 243: `<div id="chartOrganization" class="chart"></div>`
  - Line 251: `<div id="chartSalesPerson" class="chart"></div>`
  - Line 261: `<div id="chartCustomerType" class="chart"></div>`
  - Line 269: `<div id="chartInsuranceType" class="chart"></div>`
  - Line 279: `<div id="chartChannel" class="chart"></div>`
  - Line 287: `<div id="chartPremiumDistribution" class="chart"></div>`

#### 2.3 ChartManager调整（可选）
- **文件**：`static/js/chartManager.js`
- **检查**：ECharts初始化时的宽度/高度设置
- **可能需要调整**：图表的宽高比，以适应全宽显示

**验证**：
- 上传数据后，检查所有图表是否为一行一个
- 调整浏览器窗口大小，验证响应式布局

---

### 阶段3：页面结构重组为三板块

**目标**：将现有内容重组为数据洞察、数据管理、操作提示三个板块

**当前结构分析**：
```
- topbar（页眉）
- experience-section（体验卡片 x3）
- kpi-band（KPI卡片 x4）
- main-area
  - workspace-grid（上传区 + 操作提示）
  - analysis-section（筛选 + 指标卡 + 图表）
```

**目标结构**：
```
- topbar（页眉）
- tab-navigation（三板块tab导航）
  - 数据洞察（默认）
  - 数据管理
  - 操作提示

- content-area
  - 数据洞察板块
    - KPI卡片（4个指标卡）
    - 筛选器
    - 图表区（7个图表，每个一行）

  - 数据管理板块（初始隐藏）
    - 文件上传区
    - 数据导入/导出功能

  - 操作提示板块（初始隐藏）
    - 工作流时间线
    - 快速帮助
```

#### 3.1 HTML重组
- **文件**：`templates/index.html`

**步骤**：
1. 添加tab导航（在topbar后）
2. 将experience-section移除或移到操作提示板块
3. 重组main-area为三个tab-panel
4. 将kpi-band移到数据洞察板块顶部
5. 将上传区移到数据管理板块
6. 将操作提示时间线移到操作提示板块

**伪代码**：
```html
<header class="topbar">...</header>

<!-- 新增：Tab导航 -->
<nav class="tab-navigation">
  <button class="tab-btn active" data-tab="insights">📊 数据洞察</button>
  <button class="tab-btn" data-tab="management">📁 数据管理</button>
  <button class="tab-btn" data-tab="help">💡 操作提示</button>
</nav>

<main class="content-area">
  <!-- 数据洞察板块（默认显示） -->
  <section id="tab-insights" class="tab-panel active">
    <div class="kpi-band">...</div>  <!-- 4个KPI卡片 -->
    <div class="filters-section">...</div>  <!-- 筛选器 -->
    <div class="charts-section">...</div>  <!-- 图表 -->
  </section>

  <!-- 数据管理板块（初始隐藏） -->
  <section id="tab-management" class="tab-panel" style="display:none;">
    <div class="upload-section">...</div>  <!-- 上传区 -->
    <div class="data-actions">
      <!-- 利用现有功能 -->
      <button id="exportDataBtn">📥 导出筛选数据</button>
      <button id="exportChartsBtn">📊 导出图表</button>
      <!-- 其他已有的数据操作功能 -->
    </div>
  </section>

  <!-- 操作提示板块（初始隐藏） -->
  <section id="tab-help" class="tab-panel" style="display:none;">
    <div class="timeline">...</div>  <!-- 工作流时间线 Step 1-4 -->
  </section>
</main>
```

#### 3.2 CSS样式添加
- **文件**：`static/css/style.css`

**新增样式**：
```css
/* Tab导航 */
.tab-navigation {
    display: flex;
    gap: var(--spacing-sm);
    padding: var(--spacing-md) var(--spacing-xl);
    background: var(--background);
    border-bottom: 1px solid var(--light-gray);
}

.tab-btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 1rem;
    font-weight: 500;
    color: var(--medium-gray);
    cursor: pointer;
    transition: all 0.2s ease;
}

.tab-btn:hover {
    color: var(--primary-blue);
}

.tab-btn.active {
    color: var(--primary-blue);
    border-bottom-color: var(--primary-blue);
}

/* Tab面板 */
.content-area {
    padding: var(--spacing-xl);
}

.tab-panel {
    display: none;
}

.tab-panel.active {
    display: block;
}
```

#### 3.3 JavaScript tab切换逻辑
- **文件**：`static/js/app.js`（或新建`static/js/tabs.js`）

**新增代码**：
```javascript
// Tab切换逻辑
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // 移除所有active状态
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            // 添加active状态
            btn.classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');
        });
    });
}

// 在DOMContentLoaded时调用
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    // ... 其他初始化
});
```

**验证**：
- 点击tab切换，检查内容显示/隐藏
- 检查active状态样式

---

### 阶段4：筛选器优化

**目标**：
1. 时间筛选二级化
2. 吨位分段条件可见
3. 标签式选择
4. 简化筛选器

#### 4.1 时间筛选二级化

**设计**：
```
时间筛选
├── [按月] [按起止日期]  ← 单选tab
│
├── 按月模式
│   └── <select multiple> 年月列表
│
└── 按起止日期模式
    ├── <input type="date"> 起始日期（年月日，YYYY-MM-DD）
    └── <input type="date"> 结束日期（年月日，YYYY-MM-DD）
```

**用户确认**：日期精度为年月日（YYYY-MM-DD），使用`<input type="date">`

**HTML结构**：
```html
<div class="filter-item" id="filter-time">
  <label>时间</label>

  <!-- 二级tab -->
  <div class="filter-tabs">
    <button class="filter-tab active" data-mode="monthly">按月</button>
    <button class="filter-tab" data-mode="daterange">按起止日期</button>
  </div>

  <!-- 按月模式 -->
  <div class="filter-mode" id="mode-monthly">
    <select id="filter-年月" multiple size="6">
      <!-- 动态生成年月选项 -->
    </select>
  </div>

  <!-- 按起止日期模式 -->
  <div class="filter-mode" id="mode-daterange" style="display:none;">
    <input type="date" id="filter-date-start" />
    <input type="date" id="filter-date-end" />
  </div>
</div>
```

**FilterManager修改**：
- **文件**：`static/js/filterManager.js`
- **修改点**：
  1. 在dimensions数组中将"年月"改为"时间"
  2. 在buildFilterUI()中为时间字段添加特殊处理
  3. 添加时间模式切换逻辑
  4. 修改filterData()中的时间过滤逻辑

**伪代码**：
```javascript
// filterManager.js

buildFilterUI() {
    this.dimensions.forEach(dim => {
        if (dim.key === '时间') {
            // 构建二级时间筛选UI
            this.buildTimeFilter();
        } else {
            // 原有逻辑
        }
    });
}

buildTimeFilter() {
    const filterItem = document.createElement('div');
    filterItem.className = 'filter-item';
    filterItem.innerHTML = `
        <label>时间</label>
        <div class="filter-tabs">
            <button class="filter-tab active" data-mode="monthly">按月</button>
            <button class="filter-tab" data-mode="daterange">按起止日期</button>
        </div>
        <div class="filter-mode" id="mode-monthly">
            <select id="filter-年月" multiple size="6"></select>
        </div>
        <div class="filter-mode" id="mode-daterange" style="display:none;">
            <input type="date" id="filter-date-start" />
            <input type="date" id="filter-date-end" />
        </div>
    `;

    // 添加tab切换事件
    filterItem.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => this.switchTimeMode(tab.dataset.mode));
    });

    // 动态生成年月选项
    this.populateMonthOptions();
}

switchTimeMode(mode) {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-mode="${mode}"]`).classList.add('active');

    document.getElementById('mode-monthly').style.display = mode === 'monthly' ? 'block' : 'none';
    document.getElementById('mode-daterange').style.display = mode === 'daterange' ? 'block' : 'none';
}
```

#### 4.2 吨位分段条件可见

**设计**：仅在客户类别选择"非营业货车"、"挂车"、"特种车"、"营业货车"后显示吨位分段

**FilterManager修改**：
```javascript
// filterManager.js

attachEventListeners() {
    // 监听客户类别变化
    const customerTypeSelect = document.getElementById('filter-客户类别');
    customerTypeSelect?.addEventListener('change', () => {
        this.updateTonnageVisibility();
    });
}

updateTonnageVisibility() {
    const customerTypeSelect = document.getElementById('filter-客户类别');
    const selectedTypes = Array.from(customerTypeSelect.selectedOptions).map(opt => opt.value);

    const showTonnage = selectedTypes.some(type =>
        ['非营业货车', '挂车', '特种车', '营业货车'].includes(type)
    );

    const tonnageFilter = document.querySelector('[data-dimension="吨位分段"]');
    if (tonnageFilter) {
        tonnageFilter.style.display = showTonnage ? 'block' : 'none';

        // 如果隐藏，清空选择
        if (!showTonnage) {
            const tonnageSelect = document.getElementById('filter-吨位分段');
            tonnageSelect.selectedIndex = -1;
            delete this.draftFilters['吨位分段'];
        }
    }
}
```

**HTML修改**：
- 为filter-item添加data-dimension属性以便JS查询
```html
<div class="filter-item" data-dimension="吨位分段" style="display:none;">
  <label>吨位分段</label>
  <select id="filter-吨位分段" multiple size="6"></select>
</div>
```

#### 4.3 标签式选择

**设计**：将"是否新能源"、"是否新旧车"、"是否过户车"、"险类"改为标签按钮组

**用户确认**：险类默认全选，用户可单选取消

**HTML结构**：
```html
<div class="filter-item">
  <label>是否新能源</label>
  <div class="tag-group" data-dimension="是否新能源">
    <button class="tag-btn active" data-value="是">是</button>
    <button class="tag-btn active" data-value="否">否</button>
  </div>
</div>

<!-- 险类默认全选 -->
<div class="filter-item">
  <label>险类</label>
  <div class="tag-group" data-dimension="险类">
    <!-- 所有选项默认active，用户可点击取消 -->
    <button class="tag-btn active" data-value="交强险">交强险</button>
    <button class="tag-btn active" data-value="商业险">商业险</button>
  </div>
</div>
```

**CSS样式**：
```css
.tag-group {
    display: flex;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
}

.tag-btn {
    padding: var(--spacing-xs) var(--spacing-md);
    border: 1px solid var(--medium-gray);
    border-radius: var(--radius-sm);
    background: var(--white);
    color: var(--dark-gray);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
}

.tag-btn:hover {
    border-color: var(--primary-blue);
    color: var(--primary-blue);
}

.tag-btn.active {
    background: var(--primary-blue);
    color: var(--white);
    border-color: var(--primary-blue);
}
```

**FilterManager修改**：
```javascript
buildFilterUI() {
    this.dimensions.forEach(dim => {
        if (['是否新能源', '是否新旧车', '是否过户车', '险类'].includes(dim.key)) {
            this.buildTagFilter(dim);
        } else {
            // 原有逻辑
        }
    });
}

buildTagFilter(dimension) {
    const uniqueValues = [...new Set(this.rawData.map(row => row[dimension.key]))].filter(Boolean);

    const filterItem = document.createElement('div');
    filterItem.className = 'filter-item';
    filterItem.innerHTML = `
        <label>${dimension.label}</label>
        <div class="tag-group" data-dimension="${dimension.key}">
            ${uniqueValues.map(val => `
                <button class="tag-btn" data-value="${val}">${val}</button>
            `).join('')}
            <button class="tag-btn active" data-value="全部">全部</button>
        </div>
    `;

    // 添加点击事件
    filterItem.querySelectorAll('.tag-btn').forEach(btn => {
        btn.addEventListener('click', () => this.toggleTag(dimension.key, btn));
    });

    this.filtersGrid.appendChild(filterItem);
}

toggleTag(dimension, btn) {
    const tagGroup = btn.parentElement;
    const value = btn.dataset.value;

    // 切换当前标签
    btn.classList.toggle('active');

    // 更新draftFilters
    const activeTags = Array.from(tagGroup.querySelectorAll('.tag-btn.active'))
        .map(b => b.dataset.value);

    const allValues = Array.from(tagGroup.querySelectorAll('.tag-btn'))
        .map(b => b.dataset.value);

    if (activeTags.length === 0) {
        // 如果没有选择，重置为全选
        tagGroup.querySelectorAll('.tag-btn').forEach(b => b.classList.add('active'));
        delete this.draftFilters[dimension];
    } else if (activeTags.length === allValues.length) {
        // 全选状态，不设置过滤条件
        delete this.draftFilters[dimension];
    } else {
        // 部分选择，设置过滤条件
        this.draftFilters[dimension] = activeTags;
    }

    this.syncFilterStatus();
}
```

#### 4.4 简化筛选器（常用/高级）

**设计**：
- 常用筛选器（默认显示）：时间、三级机构、客户类别、业务员
- 高级筛选器（折叠）：吨位分段、是否新能源、是否新旧车、是否过户车、险别、险类、终端来源

**HTML结构**：
```html
<div class="filters-section">
  <div class="filters-header">
    <h2>📋 数据筛选</h2>
    <button id="toggleAdvancedFilters" class="btn-link">
      <span id="advancedToggleText">显示高级筛选 ▼</span>
    </button>
  </div>

  <div class="filters-grid" id="commonFilters">
    <!-- 时间、三级机构、客户类别、业务员 -->
  </div>

  <div class="filters-grid advanced-filters" id="advancedFilters" style="display:none;">
    <!-- 其他筛选器 -->
  </div>
</div>
```

**CSS样式**：
```css
.advanced-filters {
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px dashed var(--light-gray);
}

.btn-link {
    background: none;
    border: none;
    color: var(--primary-blue);
    font-size: 0.875rem;
    cursor: pointer;
    text-decoration: underline;
}

.btn-link:hover {
    color: var(--secondary-blue);
}
```

**JavaScript逻辑**：
```javascript
// app.js 或 filterManager.js

function initAdvancedFiltersToggle() {
    const toggleBtn = document.getElementById('toggleAdvancedFilters');
    const advancedFilters = document.getElementById('advancedFilters');
    const toggleText = document.getElementById('advancedToggleText');

    toggleBtn.addEventListener('click', () => {
        const isHidden = advancedFilters.style.display === 'none';

        advancedFilters.style.display = isHidden ? 'grid' : 'none';
        toggleText.textContent = isHidden ? '隐藏高级筛选 ▲' : '显示高级筛选 ▼';
    });
}
```

**FilterManager修改**：
在buildFilterUI()中，根据字段类型分配到不同容器：
```javascript
buildFilterUI() {
    const commonFilters = ['时间', '三级机构', '客户类别', '业务员'];
    const commonGrid = document.getElementById('commonFilters');
    const advancedGrid = document.getElementById('advancedFilters');

    this.dimensions.forEach(dim => {
        const filterItem = this.buildFilterItem(dim);

        if (commonFilters.includes(dim.key)) {
            commonGrid.appendChild(filterItem);
        } else {
            advancedGrid.appendChild(filterItem);
        }
    });
}
```

---

## 文件清单

### 必须修改的文件

1. **templates/index.html** - HTML结构重组、tab导航、筛选器UI
2. **static/css/style.css** - 图表布局、tab样式、标签按钮样式
3. **static/js/filterManager.js** - 时间二级筛选、条件可见、标签式选择、简化筛选器
4. **static/js/app.js** - tab切换逻辑、初始化
5. **config/analyzer_config.yaml** - 项目名称

### 可能需要修改的文件

6. **static/js/chartManager.js** - 图表宽高比调整（如需要）
7. **templates/base.html** - 项目名称（如有）
8. **README.md** - 项目名称
9. **QUICKSTART.md** - 项目名称

### 需要检查的现有功能（数据管理板块复用）

10. **static/js/app.js** - 检查现有导出功能（exportDataBtn）
11. **static/js/chartManager.js** - 检查图表导出功能（如有）
12. 其他已实现的数据操作功能

---

## 实施优先级

### P0（高优先级，先实施）
1. ✅ 阶段1：项目名称更新（15分钟）
2. ✅ 阶段2：图表布局调整（30分钟）

### P1（中优先级，核心功能）
3. 阶段3：页面结构重组为三板块（2小时）
4. 阶段4.1：时间筛选二级化（1.5小时）
5. 阶段4.2：吨位分段条件可见（30分钟）

### P2（低优先级，体验优化）
6. 阶段4.3：标签式选择（1.5小时）
7. 阶段4.4：简化筛选器（1小时）

**总预估时间**：约8-10小时

---

## 向后兼容性考虑

1. **数据格式**：CSV字段名保持不变（"年月"仍为列名，仅UI显示为"时间"）
2. **现有功能**：Draft→Applied模式保持不变
3. **图表配置**：ChartManager API保持不变，仅调整布局

---

## 测试清单

### 功能测试
- [ ] 项目名称在所有页面正确显示
- [ ] 图表一行一个全宽显示
- [ ] Tab切换正常（数据洞察/数据管理/操作提示）
- [ ] 时间筛选：按月模式正常
- [ ] 时间筛选：按起止日期模式正常
- [ ] 吨位分段条件可见性正确
- [ ] 标签式选择可以多选/取消
- [ ] 高级筛选器展开/折叠正常
- [ ] Draft→Applied模式正常工作
- [ ] 导出数据功能正常

### UI/UX测试
- [ ] 响应式布局（桌面/平板/手机）
- [ ] 筛选器状态反馈清晰
- [ ] 图表渲染性能良好
- [ ] 无样式冲突或错位
- [ ] 颜色符合McKinsey设计系统

### 兼容性测试
- [ ] Chrome浏览器
- [ ] Firefox浏览器
- [ ] Safari浏览器
- [ ] Edge浏览器

---

## 潜在风险与缓解

### 风险1：时间筛选逻辑复杂
- **缓解**：先实现按月模式，再扩展按起止日期模式
- **测试**：准备多种时间范围的测试数据

### 风险2：标签式选择与Draft→Applied模式集成
- **缓解**：复用现有syncFilterStatus()逻辑
- **测试**：验证草稿状态正确显示

### 风险3：三板块切换后数据状态丢失
- **缓解**：仅切换显示，不重置数据状态
- **测试**：切换tab后验证筛选器和图表状态

---

## 成功标准

1. ✅ 项目名称统一为"车险签单分析平台"
2. ✅ 所有图表一行一个全宽显示
3. ✅ 三板块布局清晰，切换流畅
4. ✅ 时间筛选支持按月和按起止日期
5. ✅ 吨位分段条件可见性正确
6. ✅ 标签式选择交互流畅
7. ✅ 高级筛选器折叠功能正常
8. ✅ Draft→Applied模式无影响
9. ✅ 所有测试清单通过

---

## 用户确认事项

1. ✅ **时间筛选日期精度**：年月日（YYYY-MM-DD），使用`<input type="date">`
2. ✅ **险类标签选择**：默认全选，用户可单选取消（不需要"全部"按钮）
3. ✅ **数据加工功能**：充分利用已有功能（导出数据、导出图表等），不重复造轮子
4. ✅ **操作提示板块**：仅显示工作流时间线（Step 1-4）

## 备注

- 保持现有McKinsey设计系统风格
- 保持Draft→Applied核心模式不变
- 所有改动向后兼容，不影响现有数据处理
- 优先完成P0和P1任务，P2任务可根据时间调整
- **数据管理板块**：复用现有导出功能，避免重复开发
