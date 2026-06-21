// ============================================================
// 通用基金经理数据解析脚本 v1.5
// 适用于晨星 /fund-manager/<id> 页面 innerText（浏览器导出）
// ============================================================
//
// 用法（CLI）：
//   node research/managers/scripts/parse-manager.js <innertext-json> <managerId> [nameHint]
//   例：node research/managers/scripts/parse-manager.js research/managers/raw-snapshots/morningstar-175675-20260619.json 175675 刘元海
//
// 输入文件格式：
//   单一 JSON 字符串（mcp chrome-devtools evaluate_script 默认输出格式）
//   也兼容：纯 innerText 字符串
//
// 输出：
//   data/manager/manager-<id>-<name>.json
//   符合 ./manager-schema.json（同目录，v1.5 已补字段枚举）
//
// 模块导出：
//   const { extractManager } = require('./parse-manager.js');
//   extractManager(innerText, managerId, nameHint) => JSON 对象
//
// ============================================================

const fs = require("fs");
const path = require("path");

// ============================================================
// 已知标签集合（v1.5 — 含刘元海、武阳、郑希三个页面所有发现）
// ============================================================

const KNOWN_EXPERIENCE = new Set([
  "任职稳定",
  "自购超百万份",
  "十年老将",
  "机构持有极低",
  "机构持有较高",
  "机构持有中",
  "主动管理超百亿",
  "近期规模相对稳定",
  "近一年规模稳定增长",
  "近一年规模快速增长",
  "近一年规模相对稳定",
  "近三年规模稳定增长",
  "近三年规模快速增长",
  "近三年规模相对稳定",
  "近五年规模稳定增长",
  "近五年规模快速增长",
  "近五年规模相对稳定",
  "多只FOF持有",
  "一拖多",
  "减持自身产品",
  "自购自身产品",
  "内部持有较高",
  "内部持有低",
]);

const KNOWN_STYLE = new Set([
  "持股P/B高",
  "持股P/B低",
  "持股P/E高",
  "持股P/E低",
  "持股ROE高",
  "持股ROE低",
  "持股高分红",
  "大盘价值",
  "大盘平衡",
  "大盘成长",
  "中盘价值",
  "中盘平衡",
  "中盘成长",
  "小盘价值",
  "小盘平衡",
  "小盘成长",
  "换手率较高",
  "换手率较低",
  "换手率高",
  "高权益仓位",
  "低权益仓位",
  "行业集中",
  "行业分散",
  "行业较集中",
  "行业较分散",
  "个股集中",
  "个股分散",
  "持仓集中度高",
  "持仓集中度低",
  "权益仓位稳定",
  "权益仓位波动",
  "股票风格漂移",
  "股票风格稳定",
  "股票风格集中",
]);

const KNOWN_SECTOR = new Set([
  "科技",
  "医药",
  "消费",
  "金融",
  "新能源",
  "工业",
  "材料",
  "公用事业",
  "地产",
  "可选消费",
  "必选消费",
  "通信",
  "传媒",
  "半导体",
  "医疗保健",
  "信息技术",
]);

const PERFORMANCE_POSITIVE = [
  "收益高",
  "超额",
  "胜率高",
  "捕获比大于1",
  "胜出",
  "稳定",
  "弹性强",
];
const PERFORMANCE_NEGATIVE = [
  "回撤控制能力弱",
  "回撤控制能力较弱",
  "波动高",
  "波动较高",
  "回撤大",
  "胜率低",
];
// 中性标签（v1.5 新增）：不参与 positive/negative 判断
const PERFORMANCE_NEUTRAL = ["胜率中", "胜率较高", "胜率一般"];

// ============================================================
// 主解析函数（纯函数，无 DOM/window 依赖）
// ============================================================

function extractManager(t, managerId, nameHint = null) {
  if (typeof t !== "string") {
    throw new Error(`extractManager: t must be string, got ${typeof t}`);
  }
  const lines = t.split("\n");

  // ---------- helpers ----------
  const get = (re) => {
    const m = t.match(re);
    return m ? m[1].trim() : null;
  };
  const grabSection = (start, len) => {
    const idx = t.indexOf(start);
    return idx >= 0 ? t.slice(idx, idx + len) : null;
  };
  const findValueAfter = (label) => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === label && i + 1 < lines.length) {
        return lines[i + 1].trim();
      }
    }
    return null;
  };

  // ---------- 1. 基本信息 ----------
  const aumStr = findValueAfter("管理规模");
  const aumMatch = aumStr ? aumStr.match(/([\d.]+)/) : null;

  // 修复 #3: managementType/assetType 分别收集
  const assetTypes = [];
  const managementTypes = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "管理类型" && i + 1 < lines.length) {
      const next = lines[i + 1] && lines[i + 1].trim();
      if (next && next !== "管理规模") managementTypes.push(next);
    }
    if (lines[i] === "资产类型") {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const v = lines[j].trim();
        if (["投资经验", "持仓风格", "业绩特征"].includes(v)) break;
        if (v) assetTypes.push(v);
      }
      break;
    }
  }

  // ---------- 2. 标签分类（投资经验 / 持仓风格 / 行业偏好 / 业绩特征） ----------
  const experience = [];
  const styleLabels = [];
  const sectorPref = [];
  const performanceRaw = [];
  const SECTION_HEADERS = new Set([
    "投资经验",
    "持仓风格",
    "业绩特征",
    "风险回报",
  ]);
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const v = lines[i].trim();
    // 修复 #2: 段头本身（"投资经验"/"持仓风格"/"业绩特征"）不参与分类
    if (SECTION_HEADERS.has(v)) {
      if (v === "投资经验") section = "experience";
      else if (v === "持仓风格") section = "style";
      else if (v === "业绩特征") section = "perf";
      else if (v === "风险回报") break;
      continue; // 跳过段头本身
    }
    if (!v) continue;

    if (section === "experience" && KNOWN_EXPERIENCE.has(v)) {
      experience.push(v);
    } else if (section === "style") {
      if (KNOWN_STYLE.has(v)) styleLabels.push(v);
      else if (KNOWN_SECTOR.has(v)) sectorPref.push(v);
      // 兜底：未识别但可能在未来页面出现的术语，存入 styleLabels 备查
      // 这里暂不收集未知项，避免污染
    } else if (section === "perf" && v) {
      const isPositive = PERFORMANCE_POSITIVE.some((k) => v.includes(k));
      const isNegative = PERFORMANCE_NEGATIVE.some((k) => v.includes(k));
      const isNeutral = PERFORMANCE_NEUTRAL.some((k) => v.includes(k));
      let timeframe = null;
      if (v.includes("近一年")) timeframe = "近一年";
      else if (v.includes("近三年")) timeframe = "近三年";
      else if (v.includes("近五年")) timeframe = "近五年";
      else if (v.includes("近十年")) timeframe = "近十年";
      else if (v.includes("中长期")) timeframe = "中长期";
      else if (v.includes("长期")) timeframe = "长期";
      else if (v.includes("月度")) timeframe = "月度";
      // 修复 #8: 中性标签极性 = null（既非正也非负）
      let polarity = null;
      if (isPositive && !isNegative) polarity = true;
      else if (isNegative && !isPositive) polarity = false;
      else if (isNeutral) polarity = null;

      performanceRaw.push({
        label: v,
        positive: polarity === true,
        negative: polarity === false,
        neutral: polarity === null,
        polarity,
        timeframe,
      });
    }
  }

  // ---------- 3. 风险回报（当前显示的"近1年"或已切换的时间维度） ----------
  let riskReturnCurrent = null;
  const rrSection = grabSection("风险回报", 1500);
  if (rrSection) {
    // 经理年化回报：第一个 +数字% 格式
    const mgrReturnMatch = rrSection.match(/\+\s*([\d.]+)%/);
    // 修复 #6: 用整段周期块捕获 benchRet / mgrVol / benchVol
    // 格式：近X年年化回报 → 沪深300同期 → benchRet% → mgrVol% → 近X年年化波动 → 沪深300同期 → benchVol%
    const periodBlock = rrSection.match(
      /近\d+年年化回报\s+沪深300同期\s+([\d.\-]+)%\s+([\d.\-]+)%\s+近\d+年年化波动\s+沪深300同期\s+([\d.\-]+)%/,
    );
    // 修复 #7: 排名锚定相邻 label
    const returnRankMatch = rrSection.match(/前(\d+)%\s+收益能力/);
    const riskRankMatch = rrSection.match(/前(\d+)%\s+抗风险能力/);

    let period = null;
    if (rrSection.includes("近1年年化回报")) period = "1Y";
    else if (rrSection.includes("近3年年化回报")) period = "3Y";
    else if (rrSection.includes("近5年年化回报")) period = "5Y";
    else if (rrSection.includes("近10年年化回报")) period = "10Y";

    if (period && mgrReturnMatch) {
      const mgrRet = parseFloat(mgrReturnMatch[1]);
      const benchRet = periodBlock ? parseFloat(periodBlock[1]) : null;
      riskReturnCurrent = {
        period,
        managerReturn: mgrRet,
        benchmarkReturn: benchRet,
        excessReturn: benchRet !== null ? mgrRet - benchRet : null, // 新增：超额回报
        managerVol: periodBlock ? parseFloat(periodBlock[2]) : null,
        benchmarkVol: periodBlock ? parseFloat(periodBlock[3]) : null,
        returnRank: returnRankMatch ? `前${returnRankMatch[1]}%` : null,
        riskRank: riskRankMatch ? `前${riskRankMatch[1]}%` : null,
      };
    }
  }

  // ---------- 4. 历年年度回报 ----------
  let annualReturns = null;
  // 修复 #4: tab 分隔。先抓总回报% 段落，再 tab-split
  const arSection = grabSection("总回报%", 1500);
  if (arSection) {
    // 解析 N 列数字（年度 + 今年以来 + 任职以来，列数由经理任职年数决定）
    // 经理行：经理名 \t 数 \t 数 ... \t 数
    // 基准行：沪深300 \t 数 \t 数 ... \t 数
    // 头部：  总回报% \t 2022 \t 2023 \t ... \t 今年以来 \t 任职以来
    // iter-008: 截到段尾"管理规模变动"之前，避免混入下方"管理产品列表"段（"名称"行会误判）
    const arSectionTrimmed =
      arSection.split("管理规模变动")[0] ||
      arSection.split("管理产品列表")[0] ||
      arSection;
    const arLines = arSectionTrimmed
      .split("\n")
      .filter((l) => l.includes("\t"));
    let mgrYears = null;
    let benchYears = null;
    let headerCols = null;
    for (const l of arLines) {
      const cols = l
        .split("\t")
        .map((s) => s.trim())
        .filter((s) => s);
      // iter-008 增强：isMgr 必须是数字行（避免"名称"/"基金代码"等表头误判）
      const numCount = cols
        .slice(1)
        .filter((c) => !isNaN(parseFloat(c))).length;
      const isNumericRow =
        numCount >= Math.max(2, Math.floor((cols.length - 1) * 0.7));
      const isMgr =
        cols.length >= 3 &&
        /[一-龥]/.test(cols[0]) &&
        cols[0] !== "沪深300" &&
        cols[0] !== "总回报%" &&
        isNumericRow;
      const isBench = cols.length >= 3 && cols[0] === "沪深300";
      const isHeader = cols[0] === "总回报%";
      // 修复 #1 + iter-008: cols[0] 是经理名/基准名/段头，要跳过；从头部动态推断列数
      if (isHeader) {
        headerCols = cols.slice(1); // ['2022','2023',...,'今年以来','任职以来']
      } else if (isMgr) {
        mgrYears = cols.slice(1).map(parseFloat);
      } else if (isBench) {
        benchYears = cols.slice(1).map(parseFloat);
      }
    }
    if (
      mgrYears &&
      benchYears &&
      headerCols &&
      mgrYears.length === headerCols.length &&
      mgrYears.length >= 3
    ) {
      // 修复 iter-008: 不再硬编码 12 列，按头部列数动态生成 yearLabels
      const yearLabels = headerCols.map((h) =>
        /今年/.test(h)
          ? "ytd"
          : /任职/.test(h)
            ? "sinceInception"
            : parseInt(h, 10),
      );
      annualReturns = {
        benchmark: "沪深300",
        dataAsOf:
          t.match(/\*数据截止日期:\s*(\d{4}年\d{2}月\d{2}日)/)?.[1] || null,
        unit: "%",
        returns: [],
      };
      for (let i = 0; i < yearLabels.length; i++) {
        const item = {
          year: yearLabels[i],
          manager: mgrYears[i],
          benchmark: benchYears[i],
          excess: mgrYears[i] - benchYears[i],
        };
        if (yearLabels[i] === "ytd") annualReturns.ytd = item;
        else if (yearLabels[i] === "sinceInception")
          annualReturns.sinceInception = item;
        else annualReturns.returns.push(item);
      }
    }
  }

  // ---------- 5. 行业配置（持仓占比%） ----------
  let industryAllocation = null;
  const industryMatch = t.match(
    /持仓占比%\s+([\s\S]+?)(?=股票风格箱|前十大持仓)/,
  );
  if (industryMatch) {
    const indLines = industryMatch[1]
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    const items = [];
    // 每 4 行一个行业：lvl1 lvl2 lvl3 pct
    for (let i = 0; i + 3 < indLines.length; i += 4) {
      const lvl1 = indLines[i];
      const lvl2 = indLines[i + 1];
      const lvl3 = indLines[i + 2];
      const pct = parseFloat(indLines[i + 3]);
      if (!isNaN(pct) && lvl1 && lvl2 && lvl3) {
        items.push({ level1: lvl1, level2: lvl2, level3: lvl3, pct });
      }
    }
    if (items.length > 0) {
      const top = items[0];
      industryAllocation = {
        asOf: t.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null,
        current: items,
        topSector: top.level1,
        topSectorPct: top.pct,
      };
    }
  }

  // ---------- 6. 股票风格箱 ----------
  let styleBox = null;
  const sbMatch = t.match(
    /股票风格箱\s+(20\d{2}-\d{2}-\d{2})\s+价值\s+平衡\s+成长\s+大盘\s+([\d\s]+)中盘\s+([\d\s]+)小盘\s+([\d\s]+)/,
  );
  if (sbMatch) {
    const bigNums = sbMatch[2].trim().split(/\s+/).map(Number);
    const midNums = sbMatch[3].trim().split(/\s+/).map(Number);
    const smallNums = sbMatch[4].trim().split(/\s+/).map(Number);
    styleBox = {
      asOf: sbMatch[1],
      cells: {
        大盘价值: bigNums[0],
        大盘平衡: bigNums[1],
        大盘成长: bigNums[2],
        中盘价值: midNums[0],
        中盘平衡: midNums[1],
        中盘成长: midNums[2],
        小盘价值: smallNums[0],
        小盘平衡: smallNums[1],
        小盘成长: smallNums[2],
      },
    };
    const total = { value: 0, balance: 0, growth: 0 };
    for (const [k, v] of Object.entries(styleBox.cells)) {
      if (typeof v !== "number") continue;
      if (k.includes("价值")) total.value += v;
      else if (k.includes("平衡")) total.balance += v;
      else if (k.includes("成长")) total.growth += v;
    }
    const styleMax = Object.entries(total).sort((a, b) => b[1] - a[1])[0][0];
    const sizeMap = { 大盘: 0, 中盘: 0, 小盘: 0 };
    for (const [k, v] of Object.entries(styleBox.cells)) {
      if (typeof v !== "number") continue;
      if (k.startsWith("大盘")) sizeMap["大盘"] += v;
      else if (k.startsWith("中盘")) sizeMap["中盘"] += v;
      else if (k.startsWith("小盘")) sizeMap["小盘"] += v;
    }
    const sizeMax = Object.entries(sizeMap).sort((a, b) => b[1] - a[1])[0][0];
    styleBox.sizeBias = sizeMax;
    styleBox.styleBias =
      styleMax === "growth" ? "成长" : styleMax === "value" ? "价值" : "平衡";
  }

  // ---------- 7. 管理产品列表 ----------
  let funds = [];
  const fundsSection = grabSection("管理产品列表", 5000);
  if (fundsSection) {
    // 修复 #5: 扁平化 tab 分隔（兼容字段单行 + 字段分行两种格式）
    const tokens = fundsSection
      .split("\n")
      .flatMap((l) => l.split("\t"))
      .map((s) => s.trim())
      .filter((s) => s);
    for (let i = 0; i < tokens.length; i++) {
      const codeMatch = tokens[i].match(/^(\d{6})$/);
      if (codeMatch) {
        const code = codeMatch[1];
        // 倒推：前 1-4 个 token 找名称（跳过"代表产品"标记和数字编号）
        let name = null;
        let isRep = false;
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const v = tokens[j];
          if (v === "代表产品") {
            isRep = true;
            continue;
          }
          if (
            v.length > 4 &&
            !/^\d+$/.test(v) &&
            ![
              "现管基金",
              "历史任职",
              "名称",
              "基金代码",
              "基金规模(亿元)",
              "晨星分类",
              "任职日期",
              "在任时长",
              "任职回报",
              "同期同类回报",
            ].includes(v)
          ) {
            name = v;
            break;
          }
        }
        const scale =
          tokens[i + 1] && tokens[i + 1] !== "-" ? tokens[i + 1] : null;
        const category = tokens[i + 2] || null;
        const apptDate = tokens[i + 3] || null;
        const tenureDays = tokens[i + 4] || null;
        const tenureRet = parseFloat((tokens[i + 5] || "").replace("%", ""));
        const benchRet = parseFloat((tokens[i + 6] || "").replace("%", ""));

        let catL1 = null;
        if (category && category.includes(" - "))
          catL1 = category.split(" - ")[0];

        funds.push({
          name,
          code,
          scale,
          scaleNumeric: scale ? parseFloat(scale) : null,
          morningstarCategory: category,
          categoryLevel1: catL1,
          appointmentDate: apptDate,
          tenureDays,
          tenureReturn: !isNaN(tenureRet) ? tenureRet : null,
          benchmarkReturn: !isNaN(benchRet) ? benchRet : null,
          excessReturn:
            !isNaN(tenureRet) && !isNaN(benchRet) ? tenureRet - benchRet : null,
          isRepresentative: isRep,
        });
      }
    }
    // iter-011 修订：若所有基金都无"代表产品"标记，自动把规模最大的标为隐式代表
    if (funds.length > 0 && !funds.some((f) => f.isRepresentative)) {
      const maxScale = funds.reduce(
        (max, f) => ((f.scaleNumeric || 0) > (max.scaleNumeric || 0) ? f : max),
        funds[0],
      );
      maxScale.isRepresentative = true;
    }
  }

  // ---------- 8. 前十大持仓（季度视图） ----------
  let topHoldingsQuarterly = null;
  const holdingsMatch = t.match(
    /合并前十大持仓\s+季度\s+半年度\s+(20\d{2}-\d{2}-\d{2})\s+证券名称\s+代码\s+组合权重%\s+首次买入\s+市值\(亿元\)\s+持股份额变动%\s+晨星股票行业\s+([\s\S]+?)(?=重仓股持有期)/,
  );
  if (holdingsMatch) {
    const asOf = holdingsMatch[1];
    // 修复 #1: 按 7 字段一组解析（兼容 innerText 每行 1 字段格式）
    const hLines = holdingsMatch[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    const items = [];
    for (let i = 0; i + 6 < hLines.length; i += 7) {
      const code = hLines[i + 1];
      const w = parseFloat(hLines[i + 2]);
      // 修复: code 检查只用长度 + 字母数字混合（不再调 parseFloat，它会忽略 ".SHE" 后缀）
      // 兼容 002475.SHE / 688498.SHA / TSM US / LITE US / GLW US 等
      const codeLooksValid = code && code.length >= 4 && /[A-Z0-9]/.test(code);
      if (codeLooksValid && !isNaN(w)) {
        items.push({
          rank: items.length + 1,
          name: hLines[i],
          code,
          weight: w,
          firstBuy: hLines[i + 3],
          mktValue: parseFloat(hLines[i + 4]),
          shareChange:
            hLines[i + 5] !== "—" && hLines[i + 5] !== undefined
              ? parseFloat(hLines[i + 5])
              : null,
          sector: hLines[i + 6],
        });
      }
    }
    if (items.length > 0) topHoldingsQuarterly = { asOf, holdings: items };
  }

  // ---------- 9. 重仓股持有期（季度视图） ----------
  let holdingPeriodsQuarterly = null;
  const periodsMatch = t.match(
    /重仓股持有期\s+季度\s+半年度\s+(20\d{2}-\d{2}-\d{2})\s+证券名称\s+持有季度\s+市值\(亿元\)\s+当前重仓序列\s+晨星股票行业\s+([\s\S]+?)(?=©\d{4}|添加自选|管理规模变动)/,
  );
  if (periodsMatch) {
    const asOf = periodsMatch[1];
    // 修复 #2: 按 5 字段一组解析
    const pLines = periodsMatch[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    const items = [];
    for (let i = 0; i + 4 < pLines.length; i += 5) {
      const q = parseInt(pLines[i + 1]);
      if (!isNaN(q)) {
        items.push({
          name: pLines[i],
          quarters: q,
          mktValue:
            pLines[i + 2] !== "—" && pLines[i + 2] !== undefined
              ? parseFloat(pLines[i + 2])
              : null,
          currentRank:
            pLines[i + 3] !== "—" && pLines[i + 3] !== undefined
              ? pLines[i + 3]
              : null,
          sector: pLines[i + 4],
        });
      }
    }
    if (items.length > 0) holdingPeriodsQuarterly = { asOf, items };
  }

  // ---------- 10. 经理姓名（取最长的姓名候选） ----------
  const candidateName =
    nameHint ||
    (function () {
      // 优先：第一个"返回"按钮之后的非空单行
      for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const v = lines[i].trim();
        if (/^[一-龥]{2,4}$/.test(v)) return v;
      }
      return null;
    })();

  // ---------- 11. 公司 ----------
  const company = (function () {
    // 兼容 A 股常见"有限公司" + QDII/合资公司"有限责任公司"（如建信基金管理有限责任公司）
    const companyRe = /基金管理(有限公司|股份有限公司|有限责任公司)$/;
    // 优先：紧跟"关注"按钮后的下一行（如果是公司名）
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "关注" && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next && companyRe.test(next)) return next;
      }
    }
    // 备选：找"基金管理..."结尾的单行
    for (const l of lines) {
      const v = l.trim();
      if (companyRe.test(v) && v.length < 30) return v;
    }
    return null;
  })();

  // ---------- 12. 教育（取首段 bio 文本中的学历字段，兼容多种命名） ----------
  const education = (function () {
    // 注意顺序：先匹配长串（"博士研究生"/"工商管理硕士"），再单独"博士"/"硕士"
    const eduRegex =
      /(博士研究生|硕士研究生|博士研究生学历|硕士研究生学历|管理学博士|经济学博士|工学博士|理学博士|金融学博士|会计学博士|管理学硕士|经济学硕士|工学硕士|理学硕士|金融学硕士|会计学硕士|法学硕士|文学硕士|工商管理硕士|MBA|EMBA|[一-龥]+学(?:与[一-龥]+学)?硕士|[一-龥]+学(?:与[一-龥]+学)?博士|博士|硕士|本科[科学历]?)/;
    for (const l of lines) {
      const trimmed = l.trim();
      if (trimmed.length < 50) {
        const m = trimmed.match(eduRegex);
        if (m) return m[1];
      }
    }
    // 兜底：在整段文本中找第一个学历字段
    const m = t.match(eduRegex);
    return m ? m[1] : null;
  })();

  const bio = (function () {
    let best = null;
    for (const l of lines) {
      if (
        l.length > 20 &&
        /(曾任|历任|曾担任|曾出任|曾就职|曾供职|现任|加盟|加入|入职)/.test(l)
      ) {
        if (!best || l.length > best.length) best = l.trim();
      }
    }
    return best;
  })();

  // ---------- 14. basic 装配 ----------
  const basic = {
    name: candidateName,
    company,
    education,
    bio,
    investmentYears: (function () {
      const v = findValueAfter("投资年限");
      return v ? parseFloat(v) : null;
    })(),
    aum: aumStr,
    aumNumeric: aumMatch ? parseFloat(aumMatch[1]) : null,
    fundCountCurrent: (function () {
      const v = findValueAfter("管理基金");
      return v ? parseInt(v) : null;
    })(),
    fundCountTotal: funds.length || null,
    assetType: [...new Set(assetTypes)],
    managementType: [...new Set(managementTypes)],
    annualReturnEquity: (function () {
      const v = findValueAfter("权益型年化收益");
      return v ? parseFloat(v.replace("%", "")) : null;
    })(),
  };

  // ---------- 15. 组合输出 ----------
  return {
    _meta: {
      managerId: String(managerId),
      name: candidateName,
      scrapedAt: new Date().toISOString(),
      source: `https://www.morningstar.cn/#/fund-manager/${managerId}`,
      pageLength: t.length,
      pageComplete: t.length > 1000,
      extractionVersion: "v1.5-universal",
    },
    basic,
    labels: {
      experience,
      holdingStyle: styleLabels,
      // iter-011 修订：从"持仓风格"段（sectorPref）OR "行业配置"段（industryAllocation）合并
      // 年轻经理的"持仓风格"段可能无行业词（只有"高权益仓位"等），需从 industryAllocation 补
      sectorPreference: (() => {
        const set = new Set(sectorPref);
        if (industryAllocation?.current) {
          for (const it of industryAllocation.current) {
            if (it.level1) set.add(it.level1);
          }
        }
        return Array.from(set);
      })(),
      performance: performanceRaw,
    },
    riskReturn: {
      dataAsOf: get(/(\d{4}-\d{2}-\d{2})/),
      current: riskReturnCurrent,
    },
    annualReturns,
    industryAllocation,
    styleBox,
    funds,
    topHoldings: {
      quarterly: topHoldingsQuarterly,
      semiAnnual: null,
    },
    holdingPeriods: {
      quarterly: holdingPeriodsQuarterly,
      semiAnnual: null,
    },
  };
}

// ============================================================
// CLI 入口
// ============================================================

function readInnerText(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const trimmed = raw.trim();

  // 格式 1：JSON 字符串（旧版 — 整文件就是一个被双引号包裹的字符串）
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  // 格式 2：JSON 对象（含 {url, title, text, ...}）— 新版 chrome-devtools evaluate_script 默认输出
  //         注意：只取首个非空字符是 { 时才解析；拿到对象后用 .text 字段（兜底用对象其他 string 字段）
  if (trimmed.length > 0 && trimmed[0] === "{") {
    try {
      const obj = JSON.parse(trimmed);
      if (typeof obj === "object" && obj !== null) {
        if (typeof obj.text === "string") return obj.text;
        // 兜底：取最长的 string 字段（通常是 innerText dump）
        const longest = Object.values(obj)
          .filter((v) => typeof v === "string")
          .sort((a, b) => b.length - a.length)[0];
        if (longest) return longest;
      }
    } catch {
      // fall through
    }
  }
  // 格式 3：JSON 数组（每行一个字符串）— 老版 chrome-devtools evaluate_script 输出
  //         例：[{"line": "..."}, {"line": "..."}] 或 ["line1", "line2", ...]
  //         用 \n 拼接成 innerText 形式
  if (trimmed.length > 0 && trimmed[0] === "[") {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        const joined = arr
          .map((it) => (typeof it === "string" ? it : it?.text || it?.line || ""))
          .filter((s) => typeof s === "string")
          .join("\n");
        if (joined.length > 100) return joined;
      }
    } catch {
      // fall through
    }
  }
  // 格式 4：纯文本（直接 dump 的 innerText）
  return raw;
}

function printStats(data) {
  console.log("\n=== 数据统计 ===");
  console.log(`_meta.name: ${data._meta.name}`);
  console.log(`_meta.pageLength: ${data._meta.pageLength}`);
  console.log(`basic.bio: ${data.basic.bio?.length || 0} 字符`);
  console.log(`basic.company: ${data.basic.company}`);
  console.log(`basic.education: ${data.basic.education}`);
  console.log(`basic.investmentYears: ${data.basic.investmentYears}`);
  console.log(`basic.aum: ${data.basic.aum}`);
  console.log(`basic.assetType: ${JSON.stringify(data.basic.assetType)}`);
  console.log(
    `basic.managementType: ${JSON.stringify(data.basic.managementType)}`,
  );
  console.log(`labels.experience: ${data.labels.experience.length} 项`);
  console.log(`labels.holdingStyle: ${data.labels.holdingStyle.length} 项`);
  console.log(
    `labels.sectorPreference: ${data.labels.sectorPreference.length} 项`,
  );
  console.log(
    `labels.performance: ${data.labels.performance.length} 项 (正${data.labels.performance.filter((p) => p.polarity === true).length}/负${data.labels.performance.filter((p) => p.polarity === false).length}/中${data.labels.performance.filter((p) => p.polarity === null).length})`,
  );
  console.log(`riskReturn.current.period: ${data.riskReturn.current?.period}`);
  console.log(
    `riskReturn.current.managerReturn: ${data.riskReturn.current?.managerReturn}%`,
  );
  console.log(
    `riskReturn.current.managerVol: ${data.riskReturn.current?.managerVol}%`,
  );
  console.log(
    `annualReturns.returns: ${data.annualReturns?.returns.length || 0} 年`,
  );
  console.log(
    `industryAllocation.current: ${data.industryAllocation?.current.length || 0} 行业`,
  );
  console.log(
    `styleBox: ${data.styleBox ? Object.values(data.styleBox.cells).filter((v) => typeof v === "number").length + " cells, sizeBias=" + data.styleBox.sizeBias + ", styleBias=" + data.styleBox.styleBias : "null"}`,
  );
  console.log(`funds: ${data.funds.length} 只`);
  console.log(
    `topHoldings.quarterly: ${data.topHoldings.quarterly?.holdings.length || 0} 持仓`,
  );
  console.log(
    `holdingPeriods.quarterly: ${data.holdingPeriods.quarterly?.items.length || 0} 持有期`,
  );
}

function validate(data) {
  console.log("\n=== 校验 ===");
  const checks = [
    ["_meta.pageComplete", data._meta.pageComplete],
    ["_meta.name", !!data._meta.name],
    ["basic.name", !!data.basic.name],
    ["basic.company", !!data.basic.company],
    ["basic.aumNumeric > 0", (data.basic.aumNumeric || 0) > 0],
    ["basic.fundCountCurrent > 0", (data.basic.fundCountCurrent || 0) > 0],
    ["riskReturn.current", !!data.riskReturn.current],
    [
      "annualReturns.returns >= 5",
      (data.annualReturns?.returns.length || 0) >= 5,
    ],
    ["annualReturns.sinceInception", !!data.annualReturns?.sinceInception],
    [
      "industryAllocation.current >= 1",
      (data.industryAllocation?.current.length || 0) >= 1,
    ],
    [
      "styleBox 9 cells",
      data.styleBox &&
        Object.values(data.styleBox.cells).filter((v) => typeof v === "number")
          .length === 9,
    ],
    ["funds >= 1", data.funds.length >= 1],
    [
      "topHoldings.quarterly >= 5",
      (data.topHoldings.quarterly?.holdings.length || 0) >= 5,
    ],
    [
      "holdingPeriods.quarterly >= 3",
      (data.holdingPeriods.quarterly?.items.length || 0) >= 3,
    ],
  ];
  let pass = 0;
  for (const [k, v] of checks) {
    console.log(`${v ? "✓" : "✗"} ${k}`);
    if (v) pass++;
  }
  console.log(`\n总计：${pass}/${checks.length} 通过`);
  return pass === checks.length;
}

function main() {
  const [, , inputPath, managerId, ...nameParts] = process.argv;
  if (!inputPath || !managerId) {
    console.error(
      "用法：node research/managers/scripts/parse-manager.js <innertext-json> <managerId> [nameHint]",
    );
    console.error(
      "例：  node research/managers/scripts/parse-manager.js research/managers/raw-snapshots/morningstar-175675-20260619.json 175675 刘元海",
    );
    process.exit(1);
  }
  // 防御：managerId 必须是纯数字
  if (!/^\d{4,7}$/.test(String(managerId))) {
    console.error(
      `✗ managerId 必须是 4-7 位数字（晨星内部 ID），收到：${managerId}`,
    );
    console.error("  提示：CLI 第二个参数是 ID，第三个是经理姓名");
    process.exit(1);
  }
  // 防御：nameHint 不能是 "返回"（这是按钮，不是姓名）
  const rawHint = nameParts.join(" ") || null;
  if (rawHint === "返回") {
    console.error(
      '✗ nameHint 是 "返回"，这是页面按钮不是姓名，请传正确的经理名',
    );
    process.exit(1);
  }
  const nameHint = rawHint;
  const t = readInnerText(inputPath);
  const data = extractManager(t, managerId, nameHint);

  // 输出文件名：manager-<id>-<name>.json
  // 姓名直接用中文（UTF-8 文件名 Windows / macOS / Linux 都支持）
  // 不再做拼音映射 — 既容易过期又跟实际文件名不一致
  const outDir = path.join(__dirname, "..", "..", "..", "data", "manager");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `manager-${managerId}-${data._meta.name}.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✓ Saved to ${outPath}`);

  printStats(data);
  const ok = validate(data);
  process.exit(ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  extractManager,
  KNOWN_EXPERIENCE,
  KNOWN_STYLE,
  KNOWN_SECTOR,
};

