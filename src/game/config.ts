import type { GameConfig, UnitType } from "./types";

export const UNIT_TYPES: readonly UnitType[] = ["warrior", "archer", "siege"];

export const DEFAULT_CONFIG: GameConfig = {
  board: {
    // 棋盘列数，越大横向格子越多。
    columns: 8,
    // 棋盘行数，越大纵向战场越长。
    rows: 12,
  },
  // 双方开局拥有的金币数量。
  startingGold: 120,
  // 双方不依赖金矿时的自然金币收入，单位是每秒金币。
  baseIncome: 2,
  // 每个玩家场上最多同时存在的单位数量。
  unitCap: 40,
  // 模拟固定步长，单位是秒；越小越精细，但计算次数越多。
  fixedStep: 0.1,
  // AI 每隔多少秒做一次建造、升级或训练决策。
  aiDecisionInterval: 2,
  // 是否启用红方 AI。
  aiEnabled: true,
  // null 时每局生成随机种子；指定整数可完整复现 AI 决策。
  aiSeed: null,
  buildings: {
    city: {
      // 建筑类型标识，主城用于判定胜负。
      kind: "city",
      // UI 中显示的建筑名称。
      label: "主城",
      // 建造价格；主城开局生成，所以价格为 0。
      buildCost: 0,
      levels: [
        {
          // 主城最大耐久。
          maxHp: 1000,
        },
      ],
    },
    mine: {
      // 建筑类型标识，金矿提供额外金币收入。
      kind: "mine",
      // UI 中显示的建筑名称。
      label: "金矿",
      // 建造一座金矿需要的金币。
      buildCost: 60,
      levels: [
        {
          // 1 级金矿最大耐久。
          maxHp: 180,
          // 1 级金矿每秒额外提供的金币。
          income: 2,
        },
        {
          // 从 1 级升级到 2 级需要的金币。
          upgradeCost: 80,
          // 2 级金矿最大耐久。
          maxHp: 260,
          // 2 级金矿每秒额外提供的金币。
          income: 4,
        },
        {
          // 从 2 级升级到 3 级需要的金币。
          upgradeCost: 150,
          // 3 级金矿最大耐久。
          maxHp: 360,
          // 3 级金矿每秒额外提供的金币。
          income: 8,
        },
      ],
    },
    barracks: {
      // 建筑类型标识，兵营用于训练单位。
      kind: "barracks",
      // UI 中显示的建筑名称。
      label: "兵营",
      // 建造一座兵营需要的金币。
      buildCost: 80,
      levels: [
        {
          // 1 级兵营最大耐久。
          maxHp: 240,
        },
        {
          // 从 1 级升级到 2 级需要的金币。
          upgradeCost: 150,
          // 2 级兵营最大耐久。
          maxHp: 340,
        },
        {
          // 从 2 级升级到 3 级需要的金币。
          upgradeCost: 300,
          // 3 级兵营最大耐久。
          maxHp: 480,
        },
      ],
    },
    tower: {
      // 建筑类型标识，防御塔会自动攻击附近敌军。
      kind: "tower",
      // UI 中显示的建筑名称。
      label: "防御塔",
      // 建造一座防御塔需要的金币。
      buildCost: 100,
      levels: [
        {
          // 1 级防御塔最大耐久。
          maxHp: 260,
          // 1 级防御塔每次攻击造成的伤害。
          damage: 25,
          // 1 级防御塔攻击范围，单位是六边格距离。
          range: 2.5,
          // 1 级防御塔攻击间隔，单位是秒。
          attackInterval: 1,
        },
        {
          // 从 1 级升级到 2 级需要的金币。
          upgradeCost: 120,
          // 2 级防御塔最大耐久。
          maxHp: 380,
          // 2 级防御塔每次攻击造成的伤害。
          damage: 50,
          // 2 级防御塔攻击范围，单位是六边格距离。
          range: 2.5,
          // 2 级防御塔攻击间隔，单位是秒。
          attackInterval: 1,
        },
        {
          // 从 2 级升级到 3 级需要的金币。
          upgradeCost: 200,
          // 3 级防御塔最大耐久。
          maxHp: 540,
          // 3 级防御塔每次攻击造成的伤害。
          damage: 75,
          // 3 级防御塔攻击范围，单位是六边格距离。
          range: 2.5,
          // 3 级防御塔攻击间隔，单位是秒。
          attackInterval: 1,
        },
      ],
    },
  },
  units: {
    warrior: {
      id: "warrior",
      label: "战士",
      icon: "盾",
      summary: "高血前排",
      accentColor: "#F4C95D",
      cost: 20,
      trainTime: 4,
      levels: [
        { maxHp: 125, damage: 8, range: 1, speed: 1.05, attackInterval: 0.95, structureDamageMultiplier: 0.6 },
        { maxHp: 190, damage: 12, range: 1, speed: 1.08, attackInterval: 0.9, structureDamageMultiplier: 0.6 },
        { maxHp: 280, damage: 18, range: 1, speed: 1.1, attackInterval: 0.85, structureDamageMultiplier: 0.65 },
      ],
    },
    archer: {
      id: "archer",
      label: "射手",
      icon: "弓",
      summary: "远程高攻",
      accentColor: "#7DD3A8",
      cost: 35,
      trainTime: 4,
      levels: [
        { maxHp: 42, damage: 18, range: 2, speed: 0.95, attackInterval: 1, structureDamageMultiplier: 0.3 },
        { maxHp: 64, damage: 27, range: 2, speed: 1, attackInterval: 0.95, structureDamageMultiplier: 0.3 },
        { maxHp: 96, damage: 40, range: 2, speed: 1.05, attackInterval: 0.9, structureDamageMultiplier: 0.3 },
      ],
    },
    siege: {
      id: "siege",
      label: "攻城兵",
      icon: "锤",
      summary: "建筑克星",
      accentColor: "#F28C5B",
      cost: 60,
      trainTime: 4,
      levels: [
        { maxHp: 80, damage: 6, range: 2, speed: 0.75, attackInterval: 1.25, structureDamageMultiplier: 5 },
        { maxHp: 120, damage: 9, range: 2, speed: 0.8, attackInterval: 1.2, structureDamageMultiplier: 5.2 },
        { maxHp: 180, damage: 13, range: 2, speed: 0.85, attackInterval: 1.15, structureDamageMultiplier: 5.4 },
      ],
    },
  },
};

// 创建一份游戏配置；测试或特殊模式可以通过 overrides 覆盖默认值。
export function createConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    board: { ...DEFAULT_CONFIG.board, ...overrides.board },
    buildings: overrides.buildings ?? DEFAULT_CONFIG.buildings,
    units: overrides.units ?? DEFAULT_CONFIG.units,
  };
}
