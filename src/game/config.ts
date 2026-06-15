import type { GameConfig } from "./types";

export const DEFAULT_CONFIG: GameConfig = {
  board: {
    columns: 11,
    rows: 18,
  },
  startingGold: 120,
  baseIncome: 4,
  unitCap: 40,
  queueCap: 5,
  fixedStep: 0.1,
  aiDecisionInterval: 1,
  aiEnabled: true,
  buildings: {
    city: {
      kind: "city",
      label: "主城",
      buildCost: 0,
      levels: [{ maxHp: 1000 }],
    },
    mine: {
      kind: "mine",
      label: "金矿",
      buildCost: 60,
      levels: [
        { maxHp: 180, income: 3 },
        { upgradeCost: 80, maxHp: 260, income: 6 },
        { upgradeCost: 150, maxHp: 360, income: 10 },
      ],
    },
    barracks: {
      kind: "barracks",
      label: "兵营",
      buildCost: 80,
      levels: [
        { maxHp: 240 },
        { upgradeCost: 120, maxHp: 340 },
        { upgradeCost: 220, maxHp: 480 },
      ],
    },
    tower: {
      kind: "tower",
      label: "防御塔",
      buildCost: 100,
      levels: [
        { maxHp: 260, damage: 14, range: 2.5, attackInterval: 1 },
        { upgradeCost: 120, maxHp: 380, damage: 24, range: 2.5, attackInterval: 1 },
        { upgradeCost: 200, maxHp: 540, damage: 38, range: 2.5, attackInterval: 1 },
      ],
    },
  },
  units: {
    infantry: {
      id: "infantry",
      label: "步兵",
      cost: 25,
      trainTime: 3,
      levels: [
        { maxHp: 100, damage: 12, speed: 1.25, attackInterval: 0.8 },
        { maxHp: 145, damage: 18, speed: 1.3, attackInterval: 0.75 },
        { maxHp: 210, damage: 28, speed: 1.35, attackInterval: 0.7 },
      ],
    },
  },
};

export function createConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    board: { ...DEFAULT_CONFIG.board, ...overrides.board },
    buildings: overrides.buildings ?? DEFAULT_CONFIG.buildings,
    units: overrides.units ?? DEFAULT_CONFIG.units,
  };
}

