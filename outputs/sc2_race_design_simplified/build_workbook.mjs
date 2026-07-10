import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("outputs/sc2_race_design_simplified");
const outputPath = path.join(outputDir, "sc2_race_design_simplified.xlsx");

const sources = {
  patch: "https://news.blizzard.com/en-us/article/24259080/starcraft-ii-5-0-16-patch-notes",
  liquipedia:
    "https://liquipedia.net/starcraft2/Unit_Statistics_%28Legacy_of_the_Void%29",
  unitstatistics: "https://unitstatistics.com/starcraft2/",
};

const raceIdentity = [
  [
    "Terran",
    "工业、人类、可搬迁生产与防守阵地",
    "MULE/矿骡经济爆发、建筑可飞起重部署、反应堆/科技挂件改变产能",
    "高泛用火力、医疗运输、攻防节奏灵活，正面阵地和多线骚扰都强",
    "需要操作和站位，核心单位依赖技能/补给/科技支持",
    "中速成型，能龟能压，单位效率来自组合而非单体数值",
    "钢契军团：耐久建筑 + 专精兵营自动生产 + 中等价格火力",
  ],
  [
    "Protoss",
    "高科技、精英单位、护盾与折跃",
    "护盾可回复，折跃缩短前线补兵距离，单兵质量高",
    "单位昂贵但强，关键科技/技能决定战斗上限",
    "前期损失惩罚大，产能和科技节点被打断会明显失速",
    "慢热但爆发强，少量部队也有压迫感",
    "星辉圣庭：高成本精英 + 护盾回复 + 少量强正面",
  ],
  [
    "Zerg",
    "生物群落、幼虫经济、虫毯与数量优势",
    "幼虫把经济和军队产能绑定，菌毯提供地图控制和速度，单位低价量大",
    "扩张快、补兵快、包夹强，能用数量和机动性滚动优势",
    "单体脆，防守依赖侦查、铺场和及时转产",
    "快节奏、高波次，优势来自连续生产和地图覆盖",
    "巢潮集群：低价高速 + 自动周期多单位生成 + 更高单位上限",
  ],
];

const rawStats = [
  ["Terran", "Unit", "Marine", 50, 0, 1, 18, 45, 0, 6, 9.8, 5, 3.15, "5.0.16 未直接改动；仍是低价远程火力基准。", sources.liquipedia, sources.unitstatistics],
  ["Terran", "Unit", "Marauder", 100, 25, 2, 21, 125, 0, 10, 9.3, 6, 3.15, "5.0.16 未直接改动；体现重甲克制和中等耐久。", sources.liquipedia, sources.unitstatistics],
  ["Terran", "Unit", "Siege Tank", 150, 125, 3, 32, 175, 0, 40, 18.69, 13, 3.15, "5.0.16 虫族 Viper Abduct 可作用于架起坦克，阵地风险上升。", sources.patch, sources.liquipedia],
  ["Protoss", "Unit", "Zealot", 100, 0, 2, 27, 100, 50, 16, 18.6, 0.1, 3.15, "5.0.16 Warpgate 冷却从 20 到 22，补兵节奏放慢。", sources.patch, sources.liquipedia],
  ["Protoss", "Unit", "Stalker", 125, 50, 2, 27, 80, 80, 13, 9.7, 6, 4.13, "5.0.16 Warpgate 冷却从 23 到 22，基础机动单位补兵略快。", sources.patch, sources.liquipedia],
  ["Protoss", "Unit", "Immortal", 250, 100, 4, 39, 200, 100, 20, 17.5, 6, 3.15, "5.0.16 主要为 Barrier 音效/视觉修复；仍代表高质量反重甲。", sources.patch, sources.liquipedia],
  ["Zerg", "Unit", "Zergling", 25, 0, 0.5, 17, 35, 0, 5, 10, 0.1, 4.13, "5.0.16 资源和幼虫节奏调整间接影响低价单位波次。", sources.patch, sources.liquipedia],
  ["Zerg", "Unit", "Roach", 75, 25, 2, 19, 145, 0, 16, 11.2, 4, 3.15, "5.0.16 未直接改动；代表虫族低科技耐久单位。", sources.liquipedia, sources.unitstatistics],
  ["Zerg", "Unit", "Hydralisk", 100, 50, 2, 24, 90, 0, 12, 20.4, 5, 3.15, "5.0.16 虫族防守/科技环境变化会影响其登场窗口。", sources.patch, sources.liquipedia],
  ["Terran", "Key building", "Command Center", 400, 0, 0, 71, 1500, 0, 0, 0, 0, 0, "5.0.16 提供补给从 15 降到 13，开局补给压力上升。", sources.patch, sources.liquipedia],
  ["Protoss", "Key building", "Nexus", 400, 0, 0, 71, 1000, 1000, 0, 0, 0, 0, "5.0.16 提供补给从 15 降到 13；折跃和防守节奏同步调整。", sources.patch, sources.liquipedia],
  ["Zerg", "Key building", "Hatchery", 300, 0, 0, 71, 1500, 0, 0, 0, 0, 0, "5.0.16 费用从 275 到 300，补给从 6 到 4，幼虫周期从 10.7s 到 9.5s。", sources.patch, sources.liquipedia],
  ["Protoss", "Key building", "Shield Battery", 100, 0, 0, 29, 150, 150, 0, 0, 0, 0, "5.0.16 完成时初始能量为 75，前线防守更即时。", sources.patch, sources.liquipedia],
  ["Zerg", "Key building", "Spore Crawler", 75, 0, 0, 21, 400, 0, 20, 20, 7, 0, "5.0.16 对 Biological 加成从 +10 到 +15。", sources.patch, sources.liquipedia],
];

const simplifiedRows = [
  ["钢契军团", "Race", "steel", "工业阵地", "", "", "", "", "", "", "", "", "", "建筑耐久 +18%，兵营自动生产时间 -10%。"],
  ["钢契军团", "Unit", "steel_vanguard", "铁卫", "前排", 36, 3, 1, 80, 0, 12, 1, 1, "中价前排，继承 Terran 稳定正面火力手感。"],
  ["钢契军团", "Unit", "steel_gunner", "铳兵", "远程", 44, 3.4, 1, 54, 0, 9, 2, 1.05, "低耐久远程输出，保留机枪兵式 DPS 密度但改为原创单位。"],
  ["钢契军团", "Unit", "steel_sapper", "破阵工", "攻城", 72, 5.2, 1, 95, 0, 20, 1, 0.85, "慢速拆建筑单位，对应阵地推进而非复制坦克。"],
  ["星辉圣庭", "Race", "astral", "精英护盾", "", "", "", "", "", "", "", "", "", "单位带护盾并自动回复；单位上限 -8。"],
  ["星辉圣庭", "Unit", "astral_guard", "星卫", "精英前排", 58, 4.4, 1, 38, 50, 16, 1, 1, "高有效生命但昂贵，保留 Protoss 护盾体验。"],
  ["星辉圣庭", "Unit", "astral_lancer", "辉矛", "远程穿刺", 68, 5, 1, 34, 42, 18, 2.2, 0.95, "少量远程强点杀，强化高质量小队感。"],
  ["星辉圣庭", "Unit", "astral_beacon", "棱核", "重型核心", 95, 6.3, 1, 58, 82, 28, 1.5, 0.8, "慢速高价值单位，避免照搬 Immortal 但保留重型威慑。"],
  ["巢潮集群", "Race", "swarm", "群体扩张", "", "", "", "", "", "", "", "", "", "基础突击单位每个自动生产周期生成 2 个；单位上限 +12。"],
  ["巢潮集群", "Unit", "swarm_runner", "巢奔", "突击群", 45, 3.2, 2, 32, 0, 7, 1, 1.35, "用数量和速度模拟虫族波次，而非照搬 Zergling。"],
  ["巢潮集群", "Unit", "swarm_spitter", "酸刺", "低价远程", 34, 2.6, 1, 42, 0, 9, 2, 1.1, "补足低价远程压制，服务手机端自动行军。"],
  ["巢潮集群", "Unit", "swarm_brute", "壳兽", "肉盾拆城", 68, 4.7, 1, 105, 0, 16, 1, 0.85, "让群体种族也有慢速承伤和拆建筑选择。"],
];

const currentMapRows = [
  ["RaceId", "src/game/types.ts", "新增 steel / astral / swarm 三个原创种族标识。"],
  ["RaceDefinition", "src/game/types.ts + src/game/config.ts", "保存显示名、机制说明、颜色、单位列表、建筑/生产时间/单位上限修正。"],
  ["PlayerState.raceId", "src/game/types.ts", "每个玩家持有当前种族；重开时由 GameSimulation.selectedRaces 保留。"],
  ["setRace command", "src/game/simulation.ts", "仅在 started=false 时允许更换，开局后返回失败。"],
  ["buildBarracks command", "src/game/simulation.ts + src/ui/GameUI.ts", "建造时选择当前种族单位并绑定专精兵营；普通 build 只保留金矿和防御塔。"],
  ["BuildingState.autoUnitType/production", "src/game/types.ts + src/game/simulation.ts", "兵营保存自动生产兵种、当前周期等级、进度、扣费状态和暂停原因。"],
  ["UnitDefinition.raceId/icon/spawnCount", "src/game/types.ts", "UI 过滤种族单位，Phaser 绘制小图标，巢潮支持一次自动生成多单位。"],
  ["UnitLevel range/shield", "src/game/types.ts + simulation.ts", "支持远程攻击、护盾吸收、护盾回复、建筑伤害倍率。"],
  ["GameUI race picker", "src/ui/GameUI.ts + src/styles.css", "开局页选择玩家种族，HUD 显示双方种族。"],
  ["BattleScene unit visuals", "src/phaser/BattleScene.ts", "使用几何轮廓、种族色和单位图标，不使用星际 2 资产。"],
  ["Tests", "tests/simulation.test.ts + e2e/game.spec.ts", "覆盖种族选择、自动生产、暂停原因、护盾、群体生成、射程、AI 和竖屏 UI。"],
];

const tuningRows = [
  ["Metric", "Target", "Current v1 default", "How to read", "Next tuning action"],
  ["First mine timing", "15s 内可完成", "起始 120 金币，金矿 60", "保证玩家第一步不等待", "若新手仍不建矿，提高高亮/默认提示"],
  ["First barracks timing", "35s 内可完成", "专精兵营 80，基础收入 2/s", "经济投入后进入自动出兵", "若节奏慢，调低兵营至 70 或提高矿收入"],
  ["Steel feel", "稳、抗打、推进慢", "建筑 HP +18%，生产时间 -10%", "容错比另外两族高且产能更稳定", "若拖局，降低塔或建筑倍率"],
  ["Astral feel", "少量高价值单位", "上限 -8，单位护盾回复", "损失惩罚高但续航强", "若太强，降低护盾回复而非生命"],
  ["Swarm feel", "连续波次和扩张", "单位上限 +12，巢奔 x2", "压迫来自数量", "若拥堵，降低 spawnCount 或提高碰撞分散"],
  ["Win condition", "主城被摧毁", "沿用当前 Demo", "保持手机端规则简单", "后续可加入据点占比胜利"],
];

function addSheet(workbook, name) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  return sheet;
}

function styleTitle(range) {
  range.format = {
    fill: "#17254D",
    font: { bold: true, color: "#FFFFFF", size: 16 },
  };
}

function styleHeader(range, fill = "#2F5D7C") {
  range.format = {
    fill,
    font: { bold: true, color: "#FFFFFF" },
    borders: { preset: "outside", style: "thin", color: "#D9E2EF" },
  };
}

function styleBody(range) {
  range.format = {
    borders: {
      insideHorizontal: { style: "thin", color: "#E5E7EB" },
      top: { style: "thin", color: "#CBD5E1" },
      bottom: { style: "thin", color: "#CBD5E1" },
    },
    wrapText: true,
  };
}

function writeTable(sheet, startCell, headers, rows, tableName) {
  const rowCount = rows.length + 1;
  const colCount = headers.length;
  const start = sheet.getRange(startCell);
  const range = start.resize(rowCount, colCount);
  range.values = [headers, ...rows];
  styleHeader(start.resize(1, colCount));
  styleBody(start.offset(1, 0).resize(rows.length, colCount));
  const table = sheet.tables.add(range, true, tableName);
  table.showFilterButton = true;
  table.style = "TableStyleMedium2";
  return range;
}

const workbook = Workbook.create();

const readme = addSheet(workbook, "00_Readme");
readme.getRange("A1:H1").merge();
readme.getRange("A1").values = [["星际 2 三族参考与原创简化方案"]];
styleTitle(readme.getRange("A1:H1"));
readme.getRange("A3:H10").values = [
  ["范围", "Legacy of the Void 多人对战三族设计参考；不包含战役、合作任务或编辑器单位。", "", "", "", "", "", ""],
  ["补丁基准", "截至 2026-06-28，采用 Blizzard StarCraft II 5.0.16 Patch Notes。", "", "", "", "", "", ""],
  ["非照搬原则", "游戏内仅使用原创种族名、原创单位名、几何视觉和重新缩放后的数值体验。", "", "", "", "", "", ""],
  ["交付内容", "种族定位、代表性原始数值、归一化指标、原创三族方案、当前代码映射和调参记录。", "", "", "", "", "", ""],
  ["主要来源", sources.patch, "", "", "", "", "", ""],
  ["单位数值来源", sources.liquipedia, "", "", "", "", "", ""],
  ["交叉参考", sources.unitstatistics, "", "", "", "", "", ""],
  ["注意", "表中星际 2 名称只用于设计研究；实现中不使用其 IP 名称、美术或剧情表达。", "", "", "", "", "", ""],
];
readme.getRange("A3:A10").format = { fill: "#E0F2FE", font: { bold: true, color: "#0F172A" } };
readme.getRange("B3:H10").merge(true);
readme.getRange("A3:H10").format = { wrapText: true, borders: { preset: "inside", style: "thin", color: "#D9E2EF" } };
readme.getRange("A:A").format.columnWidth = 18;
readme.getRange("B:H").format.columnWidth = 18;
readme.freezePanes.freezeRows(1);

const identity = addSheet(workbook, "01_Race_Identity");
identity.getRange("A1:G1").values = [["Race", "Fantasy", "Economy/Production", "Army Strength", "Weakness", "Numeric Feel", "Simplified Mapping"]];
identity.getRange("A2:G4").values = raceIdentity;
styleHeader(identity.getRange("A1:G1"), "#315C75");
styleBody(identity.getRange("A2:G4"));
identity.getRange("A:G").format.columnWidth = 22;
identity.getRange("B:G").format.columnWidth = 34;
identity.freezePanes.freezeRows(1);

const raw = addSheet(workbook, "02_SC2_Raw_Stats");
writeTable(
raw,
  "A1",
  ["Race", "Category", "Name", "Minerals", "Gas", "Supply", "Build Time", "HP", "Shields", "Damage", "DPS", "Range", "Speed", "5.0.16 Note", "Primary Source URL", "Cross-check URL"],
  rawStats,
  "RawStatsTable",
);
raw.getRange(`D2:M${rawStats.length + 1}`).format.numberFormat = "#,##0.00";
raw.getRange("D:M").format.columnWidth = 12;
raw.getRange("N:P").format.columnWidth = 42;
raw.freezePanes.freezeRows(1);

const normalized = addSheet(workbook, "03_Normalized_Metrics");
normalized.getRange("A1:I1").values = [["Race", "Unit", "Total Cost", "Effective HP", "Base DPS", "DPS per 100 Cost", "Range", "Speed", "Mobility Index"]];
styleHeader(normalized.getRange("A1:I1"), "#365C83");
const metricRows = rawStats.filter((row) => row[1] === "Unit");
normalized.getRange(`A2:B${metricRows.length + 1}`).values = metricRows.map((row) => [row[0], row[2]]);
const formulas = metricRows.map((_, index) => {
  const rawRow = index + 2;
  const metricRow = index + 2;
  return [
    `='02_SC2_Raw_Stats'!D${rawRow}+('02_SC2_Raw_Stats'!E${rawRow}*1.5)`,
    `='02_SC2_Raw_Stats'!H${rawRow}+'02_SC2_Raw_Stats'!I${rawRow}`,
    `='02_SC2_Raw_Stats'!K${rawRow}`,
    `=E${metricRow}/C${metricRow}*100`,
    `='02_SC2_Raw_Stats'!L${rawRow}`,
    `='02_SC2_Raw_Stats'!M${rawRow}`,
    `=H${metricRow}/3.15`,
  ];
});
normalized.getRange(`C2:I${metricRows.length + 1}`).formulas = formulas;
styleBody(normalized.getRange(`A2:I${metricRows.length + 1}`));
normalized.getRange(`C2:I${metricRows.length + 1}`).format.numberFormat = "0.00";
normalized.getRange("K1:O1").values = [["Race", "Avg Cost", "Avg Effective HP", "Avg DPS", "Avg Speed"]];
styleHeader(normalized.getRange("K1:O1"), "#0F766E");
normalized.getRange("K2:K4").values = [["Terran"], ["Protoss"], ["Zerg"]];
normalized.getRange("L2:O4").formulas = [
  ["=AVERAGE(C2:C4)", "=AVERAGE(D2:D4)", "=AVERAGE(E2:E4)", "=AVERAGE(H2:H4)"],
  ["=AVERAGE(C5:C7)", "=AVERAGE(D5:D7)", "=AVERAGE(E5:E7)", "=AVERAGE(H5:H7)"],
  ["=AVERAGE(C8:C10)", "=AVERAGE(D8:D10)", "=AVERAGE(E8:E10)", "=AVERAGE(H8:H10)"],
];
styleBody(normalized.getRange("K2:O4"));
normalized.getRange("L2:O4").format.numberFormat = "0.00";
const chart = normalized.charts.add("bar", normalized.getRange("K1:O4"));
chart.title = "三族代表单位平均数值对比";
chart.hasLegend = true;
chart.setPosition("K7", "S24");
normalized.getRange("A:O").format.columnWidth = 15;
normalized.freezePanes.freezeRows(1);

const simplified = addSheet(workbook, "04_Simplified_Races");
writeTable(
  simplified,
  "A1",
  ["Race", "Kind", "ID", "Label", "Role", "Cost", "Train Time", "Spawn Count", "HP L1", "Shield L1", "Damage L1", "Range L1", "Speed L1", "Design Note"],
  simplifiedRows,
  "SimplifiedRaceTable",
);
simplified.getRange(`F2:M${simplifiedRows.length + 1}`).format.numberFormat = "0.00";
simplified.getRange("A:A").format.columnWidth = 14;
simplified.getRange("B:B").format.columnWidth = 10;
simplified.getRange("C:C").format.columnWidth = 18;
simplified.getRange("D:E").format.columnWidth = 14;
simplified.getRange("F:M").format.columnWidth = 11;
simplified.getRange("N:N").format.columnWidth = 44;
simplified.freezePanes.freezeRows(1);

const map = addSheet(workbook, "05_Current_Game_Map");
writeTable(
  map,
  "A1",
  ["Interface / Surface", "Location", "Implementation"],
  currentMapRows,
  "CurrentGameMapTable",
);
map.getRange("A:A").format.columnWidth = 34;
map.getRange("B:B").format.columnWidth = 38;
map.getRange("C:C").format.columnWidth = 58;
map.freezePanes.freezeRows(1);

const tuning = addSheet(workbook, "06_Tuning_Log");
tuning.getRange("A1:E1").values = [tuningRows[0]];
tuning.getRange(`A2:E${tuningRows.length}`).values = tuningRows.slice(1);
styleHeader(tuning.getRange("A1:E1"), "#7C3AED");
styleBody(tuning.getRange(`A2:E${tuningRows.length}`));
tuning.getRange("A:E").format.columnWidth = 28;
tuning.getRange("B:E").format.columnWidth = 34;
tuning.freezePanes.freezeRows(1);

for (const sheetName of [
  "00_Readme",
  "01_Race_Identity",
  "02_SC2_Raw_Stats",
  "03_Normalized_Metrics",
  "04_Simplified_Races",
  "05_Current_Game_Map",
  "06_Tuning_Log",
]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(
    path.join(outputDir, `${sheetName}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const normalizedCheck = await workbook.inspect({
  kind: "table",
  range: "03_Normalized_Metrics!A1:O10",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 15,
  maxChars: 6000,
});
console.log(normalizedCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
try {
  await xlsx.save(outputPath);
  console.log(outputPath);
} catch (error) {
  if (error?.code !== "EBUSY") {
    throw error;
  }
  const fallbackPath = path.join(outputDir, "sc2_race_design_simplified_autoproduction.xlsx");
  await xlsx.save(fallbackPath);
  console.warn(`Target workbook is locked; saved updated copy to ${fallbackPath}`);
}
