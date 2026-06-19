# 基金经理数据提取指南（v1.6 · 2026-06-19 · augmented innerText）

> **目标**：用统一 schema 提取 `https://www.morningstar.cn/#/fund-manager/<id>` 页面，输出可对比、可校验的 JSON。

---

## 🚦 数据传输 4 段流水线（必读 · 用户核心要求）

> **iter-006 确立**：所有经理数据采集必须严格走以下 4 段流水线。任何跳过中间环节的做法（直接在浏览器返回完整 JSON、用 take_snapshot 抓 a11y 等）都视为不规范流程，需在 `process/iter-*.md` 说明原因。

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. NAVIGATE   chrome-devtools → navigate_page 打开目标 URL      │
│               （SPA hash 路由需用 location.reload 强刷）         │
│ 2. PERSIST    evaluate_script + filePath 把 innerText 落到本地   │
│               （落盘到 data/raw/<name>-innertext.json）          │
│ 3. PARSE      本地 Node 脚本：node data/parse-manager.js ...     │
│               （落盘到 data/raw/morningstar/manager-<id>-<n>.json）│
│ 4. VALIDATE   人工阅读 + node data/validate-manager.js            │
│               （硬校验 + 数据快照交叉对照）                       │
└──────────────────────────────────────────────────────────────────┘
```

### 第 1 段：NAVIGATE

```js
// 标准模式（多页 SPA 切换安全）
mcp__chrome-devtools__navigate_page({ url: 'https://www.morningstar.cn/#/fund-manager/<id>' })
// → 然后用 evaluate_script 校验 location.hash，确认切换成功

// SPA hash 路由陷阱（iter-006 发现）：
// 当 hash 已存在，navigate_page 不会触发视图刷新，必须强制 reload
mcp__chrome-devtools__evaluate_script(() => { location.hash = '#/fund-manager/<id>'; location.reload(); })
```

### 第 2 段：PERSIST（落盘 augmented innerText · iter-007 修订）

> ⚠️ **iter-007 重要修订**：直接抓 `document.body.innerText` 会丢失 CSS 截断的 bio 段（如 `-webkit-line-clamp: 2`），导致不同时刻抓出的 innerText 不一致。**改用 augmented 方案**：innerText + DOM 查询补全 bio 节点。

```js
// ⚠️ 旧方案（不要用 — bio 不稳定）
mcp__chrome-devtools__evaluate_script(
  () => document.body.innerText,
  { filePath: 'C:\\Lee\\Projects\\funds-research\\data\\raw\\<name>-innertext.json' }
)

// ✅ 新方案（augmented — 包含 CSS 截断的 bio）
mcp__chrome-devtools__evaluate_script(() => {
  const t = document.body.innerText;
  const bioNode = document.querySelector('.detail-info-desc-text');  // bio 节点（CSS 截断）
  const lines = t.split('\n');
  let companyIdx = lines.findIndex(l => l.includes('基金管理'));
  if (companyIdx === -1) companyIdx = 1;  // fallback
  // 拼接：innerText + 完整 bio（从 DOM 节点读，不受 CSS 影响）
  return [
    ...lines.slice(0, companyIdx + 1),
    bioNode ? bioNode.textContent.trim() : '',
    ...lines.slice(companyIdx + 1)
  ].join('\n');
}, { filePath: 'C:\\Lee\\Projects\\funds-research\\data\\raw\\<name>-innertext.json' })
```

**iter-007 发现的根本问题**：
- 郑希 innerText 在两次抓取中分别得到 3245 / 3187 字符
- 差异 58 字符（4 行）—— 正好是 bio 段（L4 OLD 是 bio，NEW 直接跳到"管理基金"）
- 根本原因：bio 节点 `offsetHeight = 58px`（CSS `-webkit-line-clamp: 2` 截断到 2 行）
- innerText 只返回**可见**文本，CSS 隐藏的内容被丢弃
- 不同时刻抓取受 SPA 渲染进度、滚动位置、CSS 应用时序影响，**结果不稳定**

**augmented 方案**：
- innerText 提供主结构（受 SPA 渲染影响小）
- DOM 查询（`querySelector` + `textContent`）获取 bio 全文（不受 CSS 影响）
- 拼接后落盘 = 稳定 + 完整

**为什么必须落盘**：
- augmented innerText 长度通常 3000-5000 字符，shell 传输会破坏换行符
- take_snapshot 抓 a11y 树常超过 50k 字符，触发 token 上限
- 落盘后可在 Node 端多次重跑解析（迭代修复 bug 时不用重抓页面）
- 落盘后便于 git diff 追踪页面变化

### 第 3 段：PARSE（落盘 JSON）

```bash
# 单个经理
node data/parse-manager.js data/raw/<name>-innertext.json <managerId> <nameHint>

# 批量（如有多个 innertext）
for f in data/raw/*-innertext.json; do
  name=$(node -e "const t=JSON.parse(require('fs').readFileSync('$f','utf-8')); console.log(t.split('\n').find(l => /^[一-龥]{2,4}$/.test(l.trim())))")
  id=$(basename "$f" | grep -oP '\d+' | head -1)  # 慎用：内嵌 ID 较稳
  node data/parse-manager.js "$f" "$id" "$name"
done
```

**CLI 防御（v1.5 新增）**：
- managerId 必须是 4-7 位数字（晨星内部 ID），否则 exit 1
- nameHint 不能是 "返回"（这是按钮），否则 exit 1
- 这两个防御避免了 v1.4 时代的幽灵 JSON（managerId=liuyuanhai 等）

### 第 4 段：VALIDATE（人工 + 脚本双重校验）

```bash
# 校验全部 JSON
node data/validate-manager.js

# 校验单个
node data/validate-manager.js data/raw/morningstar/manager-166288-zhengxi.json
```

**44 项硬校验 + 数据快照输出**，包括：
- 必填字段完整性（_meta / basic / labels / riskReturn / annualReturns / industryAllocation / styleBox / funds / topHoldings / holdingPeriods）
- 数据类型 + 单位 + 数值范围
- 内部一致性（excess = manager - benchmark，误差 < 0.01）
- 港股代码格式（5 位数字，兼容无后缀）

**人工对照**（不可省略）：
- 数据快照列打印在终端，肉眼核对"经理名/公司/规模/年限"
- 任意一项与公开印象不符 → 回查原始 innerText，回查页面

---

## 📂 文件清单

| 文件 | 用途 | 状态 |
|---|---|---|
| `data/manager-schema.json` | JSON Schema 定义（约束、字段、类型、枚举） | v1.5 |
| `data/parse-manager.js` | 通用本地解析脚本（v1.5） | **统一入口**（替换 v1.4 + parse-wuyang.js） |
| `data/validate-manager.js` | 数据校验脚本（v1.0 · iter-006 新增） | **独立 CLI**（不嵌在 parse 内） |
| `data/raw/<name>-innertext.json` | 浏览器导出 innerText（输入） | 保留 |
| `data/raw/morningstar/manager-<id>-<name>.json` | 解析后 JSON（输出） | 保留 |

---

## 🚀 使用流程

### 单个经理（如刘元海 175675）

```python
# Claude Code 伪代码（iter-006 推荐流程）
1. navigate_page → https://www.morningstar.cn/#/fund-manager/175675
2. evaluate_script → { location.hash, pageLen, firstNameLine }  # 校验切换
3. evaluate_script → document.body.innerText, filePath: data/raw/liuyuanhai-innertext.json
4. Bash: node data/parse-manager.js data/raw/liuyuanhai-innertext.json 175675 刘元海
5. Read: data/raw/morningstar/manager-175675-liuyuanhai.json（人工抽检 1-2 个字段）
6. Bash: node data/validate-manager.js data/raw/morningstar/manager-175675-liuyuanhai.json
7. 若通过 → 写 iter-XXX log → 同步 INDEX
```

### 批量提取（多个经理）

```bash
# 准备：把所有 innertext 放到 data/raw/
# 注意：CLI 必须传正确的 managerId（4-7 位数字）
for id_name in "166288 郑希" "180438 武阳" "175675 刘元海"; do
  id=$(echo $id_name | cut -d' ' -f1)
  name=$(echo $id_name | cut -d' ' -f2)
  innertext="data/raw/${name}-innertext.json"  # 注意：郑希对应 zhengxi-innertext.json
  node data/parse-manager.js "$innertext" "$id" "$name"
done
node data/validate-manager.js  # 一次性校验全部
```

---

## 🗂️ Schema 字段说明

### 顶层结构

```
{
  _meta:            抓取元信息（ID、时间、URL）
  basic:            基本信息（公司、学历、规模、年限）
  labels:           画像标签（4类）
  riskReturn:       风险回报（1/3/5/10年 — v1.5 仅默认 1Y，3Y/5Y/10Y 需点击切换）
  annualReturns:    历年年度回报（2016-2025）
  industryAllocation: 行业配置（最新+历史）
  styleBox:         股票风格箱
  funds:            管理产品列表
  topHoldings:      前十大持仓（季度+半年度）
  holdingPeriods:   重仓股持有期
}
```

### 标签分类规则（v1.5 扩展）

| 类别 | 触发关键词 | 备注 |
|---|---|---|
| `experience` | 任职稳定/自购超百万份/规模增长/机构持有/一拖多/多只FOF持有/减持自身产品/内部持有 | "投资经验"段；v1.5 含 24 个枚举 |
| `holdingStyle` | P/B/ROE/大盘/中盘/小盘/换手率/权益仓位/行业集中/股票风格 | "持仓风格"段；v1.5 含 33 个枚举 |
| `sectorPreference` | 科技/医药/消费/金融/工业/新能源 等 | "持仓风格"段中行业词 |
| `performance` | 收益/超额/胜率/捕获比/回撤/波动 | "业绩特征"段；v1.5 含中性极性（`胜率中`） |

### 业绩标签极性判断（v1.5 三态）

| 极性 | 触发关键词 |
|---|---|
| `positive=true` | 收益高 / 超额 / 胜率高 / 捕获比大于1 / 胜出 / 稳定 / 弹性强 |
| `negative=true` | 回撤控制能力弱 / 波动高 / 回撤大 / 胜率低 |
| `neutral=true` | 胜率中 / 胜率较高 / 胜率一般 |

---

## ⚠️ 当前 v1.5 状态

| 数据类别 | 状态 | 备注 |
|---|---|---|
| basic | ✅ 100% | name/company/education/bio/investmentYears/aum/fundCount/assetType/managementType/annualReturnEquity |
| labels | ✅ 100% | 4 类（经验/风格/行业/业绩） |
| riskReturn 1Y | ✅ 默认视图 | 含 excessReturn（v1.5 新增） |
| riskReturn 3Y/5Y/10Y | ⚠️ 需点击切换 | v2.0（auto mode 当前不可用 click 流程） |
| cumulativeReturn | ⚠️ 需点击 6 个标签 | v2.0 |
| annualReturns | ✅ 100% | 2016-2025 + YTD + 任职以来（v1.5 修复 1 位偏移） |
| industryAllocation | ✅ 100% | 5 个行业（一/二/三级） |
| styleBox | ✅ 100% | 9 cells + 推断 sizeBias/styleBias |
| funds | ✅ 100% | 9 个产品，含代表产品标记 |
| topHoldings.quarterly | ✅ 100% | 10 个持仓（v1.5 修复 US/港股代码过滤） |
| topHoldings.semiAnnual | ❌ 需点击"半年度"按钮 | v2.0 |
| holdingPeriods.quarterly | ✅ 100% | 10 个 |
| holdingPeriods.semiAnnual | ❌ 需点击"半年度"按钮 | v2.0 |
| 行业变化堆叠图 | ❌ 需 SVG path 解析 | v2.0 |
| 规模变动图 | ❌ 需 SVG path 解析 | v2.0 |

## 🐛 v1.0 → v1.5 修复记录

| 版本 | Bug | 现象 | 修复 |
|---|---|---|---|
| v1.0 → v1.4 | fundCodes 空 | `^\d{6}$` 太严 | split('\t') + findIndex |
| v1.0 → v1.4 | topHoldings 只 3 条 | 抓取行数 30 不足 | 增至 100 |
| v1.0 → v1.4 | TSM US 丢失 | 正则要求 `\.SHE\|\.SHA` | 宽松：(SHE\|SHA\|US\|HK)$ |
| v1.0 → v1.4 | annualReturns 错位 | split(/\s+/) 吃首空格 | 改 split('\t') |
| v1.4 | mgrVol=22.78（基准值） | label 后第 1 个是基准 | 用整段周期块正则 |
| v1.4 | riskRank="前0%" | [\s\S]*? non-greedy 抢先 | 锚定 "收益能力"/"抗风险能力" |
| v1.4 | bio/company null | 切换视图后 bio 从 innerText 消失 | 在首次加载（默认视图）抓 |
| v1.4 | education=整段 bio | 短正则匹配长文本 | 取行首短字段 |
| v1.4 | 行业配置污染风格箱 | 抓 30 行无边界 | 显式找"股票风格箱"作为截止 |
| **v1.5** | **annualReturns 错位 1 位** | **mgrYears[0]="刘元海" 被 parseFloat 当 NaN** | **slice(1, 13) 跳过经理名 token** |
| **v1.5** | **performance 多 1 项** | **段头"业绩特征"被自己 push** | **SECTION_HEADERS 加 continue** |
| **v1.5** | **education 抓不到** | **"管理学博士" 不在 v1.4 短前缀里** | **正则扩展 + bio 兜底** |
| **v1.5** | **holdings 仅 4 条** | **`parseFloat(code)` 误判** | **改用 /[A-Z0-9]/.test(code)** |
| **v1.5** | **缺 excessReturn 字段** | **v1.4 没算超额** | **新增 excessReturn = mgr - bench** |
| **v1.5** | **managementType/assetType 错位** | **"管理类型"行内容错塞 assetTypes** | **分两个数组分别收集** |
| **v1.5** | **CLI 幽灵 JSON** | **managerId/姓名错传产生 manager-xxx-返回.json** | **CLI 加数字校验 + 姓名校验** |
| **v1.5** | **新标签未覆盖** | **"股票风格集中/稳定"/"一拖多"/"多只FOF持有" 等被丢弃** | **KNOWN_EXPERIENCE 扩到 24 项** |
| **v1.5** | **中性标签丢失** | **"月度胜率中" 被强制 positive** | **新增 PERFORMANCE_NEUTRAL + polarity=null** |

---

## 🔍 已知陷阱

| 坑 | 表现 | 应对 |
|---|---|---|
| **SPA hash 路由不切换** | navigate_page 返回成功但页面还是上一个经理 | 用 `location.reload()` 强刷 |
| 经理姓名前面有"返回"按钮 | 简单正则可能匹配错 | 用 `findValueAfter('返回')` 找下一行 |
| 投资经验段包含多类标签 | 不分类会污染 | 用 `section` 状态机分类 |
| 业绩标签可能既正又负 | "中长期超额收益高"和"近三年回撤控制能力弱"并存 | 标签都独立记录 positive/negative/neutral |
| 持仓表可能含"—" | shareChange 解析失败 | 显式 `!== '—'` 检查 |
| 业绩标签已切到10年 | 字段从"近1年"变"近10年" | 用 `\d+年` 通配 |
| 搜索 "张坤" 找不到 | SPA 搜索组件无 URL 输出 | 通过 `/fund/<code>.html` → 经理名查找，或直接给 ID |
| **bio 段超长被截断** | "显示更多" 截断 + bio 含学历 | education 优先查独立段，否则 bio 兜底 |
| **港股代码无后缀** | "06869" 不匹配 \.HK$ | validate regex 加 `^\d{5}(\.HK)?$` |
| **US 标的代码无数字** | "TSM US" `/\d/.test()` 假阳性 | 改用 `/[A-Z0-9]/.test()` |

---

## ✅ 验证清单（升级 v1.5）

每条数据落盘前用 `validate-manager.js` 跑一次：

- [ ] **44 项硬校验全部通过**（详见 `node data/validate-manager.js` 输出）
- [ ] `basic.name` 与 `_meta.name` 一致
- [ ] `basic.company` 包含"基金管理"四字
- [ ] `basic.aumNumeric > 0`
- [ ] `riskReturn.current.managerReturn > -100%`（基金不可能跌 100%+）
- [ ] `riskReturn.current.excessReturn ≈ managerReturn - benchmarkReturn`（误差 < 0.5%）
- [ ] `annualReturns.returns >= 8`（10 年完整周期）
- [ ] `industryAllocation.current` 占比合计 ≤ 100.5%（容忍浮点）
- [ ] `styleBox.cells` 9 个数字齐全
- [ ] `funds >= 1` 且 `funds.hasRepresentative === true`
- [ ] `funds.codeFormat` 全部 6 位数字
- [ ] `topHoldings.quarterly >= 5`（前 10 大，缺失可能因停牌）
- [ ] `topHoldings.codeFormat` 兼容 SHE/SHA/US/HK/港股 5 位数
- [ ] `topHoldings.weightSum < 80`（前 10 大合计不超过 80%）
- [ ] `holdingPeriods.quarterly >= 3`（至少有 3 条历史）

---

## 📊 数据统计友好性

由于所有经理数据都在同一 schema 下，可以直接做：

```python
# 1. 全部经理 1Y 年化收益排名
all_managers = load_all('data/raw/morningstar/manager-*.json')
ranked = sorted(all_managers, key=lambda m: m.riskReturn.current.managerReturn, reverse=True)

# 2. 按公司分组
by_firm = group_by(all_managers, lambda m: m.basic.company)

# 3. 风险调整后指标对比
metrics = pd.DataFrame([{
  'name': m.basic.name,
  'company': m.basic.company,
  '1y_return': m.riskReturn.current.managerReturn,
  '1y_vol': m.riskReturn.current.managerVol,
  '1y_sharpe': (m.riskReturn.current.managerReturn - 3) / m.riskReturn.current.managerVol,
  'since_inception': m.annualReturns.sinceInception.manager
} for m in all_managers])

# 4. 持仓行业交叉
all_holdings = concat([(m.basic.name, h) for m in all_managers for h in m.topHoldings.quarterly.holdings])
top_stocks = all_holdings.groupby('name').agg({'weight': 'sum'}).sort_values('weight', ascending=False).head(20)
```

---

## 🔄 后续迭代

### v2.0（需要新增 click 能力）

- [ ] 4 个时间维度切换：循环点击"近3年/5年/10年"按钮
- [ ] 持仓半年度视图
- [ ] 业绩对比 6 标签
- [ ] SVG 堆叠图解析：行业变化 + 规模变动

### v1.6（小改进）

- [ ] riskReturn 4 维度批量（需 click 流程配合 v2.0 一起做）
- [ ] 自动从 innerText 推断经理姓名（v1.5 已支持行首匹配，但需过滤"返回"按钮）

### v2.5（重大升级）

- [ ] 批量模式：传入经理 ID 数组，自动 navigate + persist + parse + validate
- [ ] 跨经理对比自动生成 `output/rankings-topN.md`