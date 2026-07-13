import { UNIT_TYPES } from "./config";
import { hexDistance, hexKey, hexNeighbors } from "./hex";
import type {
  BattleState,
  BuildingKind,
  BuildingState,
  GameConfig,
  HexCoord,
  UnitLevel,
  UnitType,
} from "./types";

const AI_PLAYER = "red" as const;
const ENEMY_PLAYER = "blue" as const;
const SEARCH_DEPTH = 3;
const BEAM_WIDTH = 8;
const MAX_SEARCH_NODES = 256;
const PLANNING_HORIZON = 30;
const ECONOMY_HORIZON = 45;
const NEAR_OPTIMAL_RATIO = 0.95;
const PLAN_SWITCH_RATIO = 1.15;

export type AiGoal =
  | "idle"
  | "economy"
  | "defense"
  | "army"
  | "siege"
  | "upgrade";

export type AiPrimaryAction =
  | { type: "wait"; duration: number }
  | { type: "build"; kind: "mine" | "tower"; coord: HexCoord }
  | { type: "buildBarracks"; unitType: UnitType; coord: HexCoord }
  | { type: "upgrade"; buildingId: string };

export type AiAction =
  | AiPrimaryAction
  | {
      type: "setProductionPaused";
      buildingId: string;
      paused: boolean;
    };

export type AiInterruptionReason =
  | "none"
  | "commitment-active"
  | "commitment-expired"
  | "target-invalid"
  | "emergency"
  | "new-plan-superior";

export interface AiMemory {
  seed: number;
  rngState: number;
  committedGoal: AiGoal;
  committedAction: AiPrimaryAction | null;
  commitUntil: number;
  reserveGold: number;
  lastUtility: number;
}

export interface AiCandidateTrace {
  action: AiPrimaryAction;
  goal: AiGoal;
  score: number;
  cost: number;
  affordable: boolean;
  spatialScore: number;
}

export interface AiDecisionTrace {
  seed: number;
  nodeCount: number;
  candidates: readonly AiCandidateTrace[];
  chosen: AiPrimaryAction;
  goalAction: AiPrimaryAction;
  goal: AiGoal;
  reserveGold: number;
  interruptionReason: AiInterruptionReason;
  emergency: boolean;
}

export interface AiPlan {
  /** Complete execution queue. It already includes primaryAction exactly once. */
  actions: readonly AiAction[];
  primaryAction: AiPrimaryAction;
  /** Total target balance, not an additional amount to subtract. */
  reserveGold: number;
  productionPreferences: Readonly<Record<UnitType, number>>;
  utility: number;
  emergency: boolean;
  commitUntil: number;
  nextMemory: AiMemory;
  trace: AiDecisionTrace;
}

export interface UnitLevelMetrics {
  level: number;
  maxHp: number;
  unitDps: number;
  structureDps: number;
  range: number;
  speed: number;
  cost: number;
  trainTime: number;
  combatValue: number;
  durabilityPerGold: number;
  unitDpsPerGoldSecond: number;
  structureDpsPerGoldSecond: number;
}

export interface DerivedUnitMetrics extends UnitLevelMetrics {
  unitType: UnitType;
  levels: readonly UnitLevelMetrics[];
}

export type UnitMetricsMap = Record<UnitType, DerivedUnitMetrics>;

export interface UnitMatchup {
  attacker: UnitType;
  defender: UnitType;
  timeToKill: number;
  timeToDie: number;
  firstStrikeSeconds: number;
  exchangeEfficiency: number;
  expectedValueExchange: number;
}

export type UnitMatchupMatrix = Record<UnitType, Record<UnitType, UnitMatchup>>;

interface PlannerSnapshot {
  redGold: number;
  blueGold: number;
  redIncome: number;
  blueIncome: number;
  redCityHpRatio: number;
  blueCityHpRatio: number;
  redCity: BuildingState | null;
  blueCity: BuildingState | null;
  redPower: number;
  bluePower: number;
  redUnitPower: Record<UnitType, number>;
  blueUnitPower: Record<UnitType, number>;
  redUnitCounts: Record<UnitType, number>;
  blueUnitCounts: Record<UnitType, number>;
  redUnits: number;
  blueUnits: number;
  enemyThreat: number;
  predictedCityDamage: number;
  closestEnemyEta: number;
  offensiveThreat: number;
  predictedEnemyCityDamage: number;
  closestFriendlyEta: number;
  enemyStructurePressure: number;
  productionCapacity: Record<UnitType, number>;
  territoryRatio: number;
}

interface CandidateEffects {
  economy: number;
  military: number;
  defense: number;
  production: number;
  spatial: number;
  income: number;
}

interface Candidate {
  action: AiPrimaryAction;
  goal: AiGoal;
  cost: number;
  baseScore: number;
  spatialScore: number;
  effects: CandidateEffects;
}

interface SearchModel {
  gold: number;
  income: number;
  economy: number;
  military: number;
  defense: number;
  production: number;
  spatial: number;
  survival: number;
}

interface SearchNode {
  model: SearchModel;
  sequence: readonly Candidate[];
  used: ReadonlySet<string>;
  score: number;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function positive(value: number, fallback = 0.001): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function emptyUnitRecord(): Record<UnitType, number> {
  return { warrior: 0, archer: 0, siege: 0 };
}

function normalizeSeed(seed: number): number {
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
  return normalized === 0 ? 0x9e3779b9 : normalized;
}

function generateSeed(): number {
  if (typeof globalThis.crypto !== "undefined") {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return normalizeSeed(buffer[0]);
  }
  return normalizeSeed(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
}

function nextRandom(state: number): { state: number; value: number } {
  let next = normalizeSeed(state);
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { state: normalizeSeed(next), value: next / 0x100000000 };
}

export function createAiMemory(
  config: Readonly<GameConfig>,
  seedOverride?: number,
): AiMemory {
  const seed = normalizeSeed(seedOverride ?? config.aiSeed ?? generateSeed());
  return {
    seed,
    rngState: seed,
    committedGoal: "idle",
    committedAction: null,
    commitUntil: 0,
    reserveGold: 0,
    lastUtility: 0,
  };
}

function deriveLevelMetrics(
  level: UnitLevel,
  index: number,
  cost: number,
  trainTime: number,
): UnitLevelMetrics {
  const interval = positive(level.attackInterval);
  const safeCost = positive(cost);
  const safeTrainTime = positive(trainTime);
  const unitDps = Math.max(0, level.damage) / interval;
  const structureDps = unitDps * Math.max(0, level.structureDamageMultiplier);
  const maxHp = Math.max(0, level.maxHp);
  const range = Math.max(0, level.range);
  const speed = Math.max(0, level.speed);
  const combatValue =
    maxHp * 0.35 +
    unitDps * (8 + range * 1.5) +
    structureDps * 1.5 +
    speed * 10;
  return {
    level: index + 1,
    maxHp,
    unitDps,
    structureDps,
    range,
    speed,
    cost: Math.max(0, cost),
    trainTime: Math.max(0, trainTime),
    combatValue,
    durabilityPerGold: maxHp / safeCost,
    unitDpsPerGoldSecond: unitDps / (safeCost * safeTrainTime),
    structureDpsPerGoldSecond: structureDps / (safeCost * safeTrainTime),
  };
}

/** Derives fresh metrics on every call so runtime config changes take effect immediately. */
export function deriveUnitMetrics(config: Readonly<GameConfig>): UnitMetricsMap {
  const result = {} as UnitMetricsMap;
  for (const unitType of UNIT_TYPES) {
    const definition = config.units[unitType];
    const levels = definition.levels.map((level, index) =>
      deriveLevelMetrics(level, index, definition.cost, definition.trainTime),
    );
    const baseline =
      levels[0] ??
      deriveLevelMetrics(
        {
          maxHp: 0,
          damage: 0,
          range: 0,
          speed: 0,
          attackInterval: 1,
          structureDamageMultiplier: 0,
        },
        0,
        definition.cost,
        definition.trainTime,
      );
    result[unitType] = {
      ...baseline,
      unitType,
      levels,
    };
  }
  return result;
}

/** Builds a level-one duel matrix without any hard-coded unit counter rules. */
export function buildMatchupMatrix(
  config: Readonly<GameConfig>,
): UnitMatchupMatrix {
  const metrics = deriveUnitMetrics(config);
  const matrix = {} as UnitMatchupMatrix;
  for (const attackerType of UNIT_TYPES) {
    matrix[attackerType] = {} as Record<UnitType, UnitMatchup>;
    for (const defenderType of UNIT_TYPES) {
      const attacker = metrics[attackerType];
      const defender = metrics[defenderType];
      const attackerApproach =
        Math.max(0, defender.range - attacker.range) / positive(attacker.speed);
      const defenderApproach =
        Math.max(0, attacker.range - defender.range) / positive(defender.speed);
      const timeToKill = attackerApproach + defender.maxHp / positive(attacker.unitDps);
      const timeToDie = defenderApproach + attacker.maxHp / positive(defender.unitDps);
      const duelRatio = clamp(timeToDie / positive(timeToKill), 0.05, 20);
      const investmentRatio =
        (positive(defender.cost) * positive(defender.trainTime)) /
        (positive(attacker.cost) * positive(attacker.trainTime));
      const exchangeEfficiency = duelRatio * investmentRatio;
      const defenderLoss = defender.combatValue * clamp(duelRatio, 0, 1);
      const attackerLoss =
        attacker.combatValue * clamp(timeToKill / positive(timeToDie), 0, 1);
      matrix[attackerType][defenderType] = {
        attacker: attackerType,
        defender: defenderType,
        timeToKill,
        timeToDie,
        firstStrikeSeconds: defenderApproach - attackerApproach,
        exchangeEfficiency,
        expectedValueExchange: defenderLoss - attackerLoss,
      };
    }
  }
  return matrix;
}

function metricForLevel(
  metrics: UnitMetricsMap,
  unitType: UnitType,
  level: number,
): UnitLevelMetrics {
  const definition = metrics[unitType];
  return (
    definition.levels[Math.max(0, Math.min(definition.levels.length - 1, level - 1))] ??
    definition
  );
}

function buildingLevel(
  config: Readonly<GameConfig>,
  building: BuildingState,
) {
  const levels = config.buildings[building.kind].levels;
  return levels[Math.max(0, Math.min(levels.length - 1, building.level - 1))];
}

function incomeRate(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  owner: "red" | "blue",
): number {
  let income = config.baseIncome;
  for (const building of Object.values(state.buildings)) {
    if (building.owner === owner && building.kind === "mine") {
      income += buildingLevel(config, building).income ?? 0;
    }
  }
  return Math.max(0, income);
}

function findCity(
  state: Readonly<BattleState>,
  owner: "red" | "blue",
): BuildingState | null {
  return (
    Object.values(state.buildings).find(
      (building) => building.owner === owner && building.kind === "city",
    ) ?? null
  );
}

function cityHpRatio(
  city: BuildingState | null,
  config: Readonly<GameConfig>,
): number {
  if (!city) {
    return 0;
  }
  const maxHp = positive(buildingLevel(config, city).maxHp);
  return clamp(city.hp / maxHp);
}

function makeSnapshot(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
): PlannerSnapshot {
  const redCity = findCity(state, AI_PLAYER);
  const blueCity = findCity(state, ENEMY_PLAYER);
  const redUnitPower = emptyUnitRecord();
  const blueUnitPower = emptyUnitRecord();
  const redUnitCounts = emptyUnitRecord();
  const blueUnitCounts = emptyUnitRecord();
  let redPower = 0;
  let bluePower = 0;
  let redUnits = 0;
  let blueUnits = 0;
  let enemyThreat = 0;
  let predictedCityDamage = 0;
  let closestEnemyEta = Number.POSITIVE_INFINITY;
  let offensiveThreat = 0;
  let predictedEnemyCityDamage = 0;
  let closestFriendlyEta = Number.POSITIVE_INFINITY;

  for (const unit of Object.values(state.units)) {
    const unitMetric = metricForLevel(metrics, unit.unitType, unit.level);
    const hpRatio = clamp(unit.hp / positive(unitMetric.maxHp));
    const liveValue = unitMetric.combatValue * hpRatio;
    if (unit.owner === AI_PLAYER) {
      redUnits += 1;
      redUnitCounts[unit.unitType] += 1;
      redUnitPower[unit.unitType] += liveValue;
      redPower += liveValue;
      if (blueCity) {
        const distance = hexDistance(unit, blueCity);
        const eta =
          Math.max(0, distance - unitMetric.range) / positive(unitMetric.speed);
        closestFriendlyEta = Math.min(closestFriendlyEta, eta);
        offensiveThreat += liveValue / (1 + eta / 8);
        if (eta < 12) {
          predictedEnemyCityDamage +=
            unitMetric.structureDps * (12 - eta) * hpRatio;
        }
      }
      continue;
    }

    blueUnits += 1;
    blueUnitCounts[unit.unitType] += 1;
    blueUnitPower[unit.unitType] += liveValue;
    bluePower += liveValue;
    if (redCity) {
      const distance = hexDistance(unit, redCity);
      const eta =
        Math.max(0, distance - unitMetric.range) / positive(unitMetric.speed);
      closestEnemyEta = Math.min(closestEnemyEta, eta);
      enemyThreat += liveValue / (1 + eta / 8);
      if (eta < 12) {
        predictedCityDamage += unitMetric.structureDps * (12 - eta) * hpRatio;
      }
    }
  }

  let enemyStructurePressure = 0;
  let redTerritory = 0;
  let blueTerritory = 0;
  const productionCapacity = emptyUnitRecord();
  for (const cell of Object.values(state.cells)) {
    if (cell.owner === AI_PLAYER) {
      redTerritory += 1;
    } else if (cell.owner === ENEMY_PLAYER) {
      blueTerritory += 1;
    }
  }
  for (const building of Object.values(state.buildings)) {
    if (building.owner === ENEMY_PLAYER && building.kind !== "city") {
      const level = buildingLevel(config, building);
      const towerDps =
        building.kind === "tower"
          ? (level.damage ?? 0) / positive(level.attackInterval ?? 1)
          : 0;
      enemyStructurePressure += Math.max(0, building.hp) + towerDps * 10;
    }
    if (
      building.owner === AI_PLAYER &&
      building.kind === "barracks" &&
      building.autoUnitType
    ) {
      const duration = positive(config.units[building.autoUnitType].trainTime);
      productionCapacity[building.autoUnitType] += 1 / duration;
    }
  }

  return {
    redGold: Math.max(0, state.players.red.gold),
    blueGold: Math.max(0, state.players.blue.gold),
    redIncome: incomeRate(state, config, AI_PLAYER),
    blueIncome: incomeRate(state, config, ENEMY_PLAYER),
    redCityHpRatio: cityHpRatio(redCity, config),
    blueCityHpRatio: cityHpRatio(blueCity, config),
    redCity,
    blueCity,
    redPower,
    bluePower,
    redUnitPower,
    blueUnitPower,
    redUnitCounts,
    blueUnitCounts,
    redUnits,
    blueUnits,
    enemyThreat,
    predictedCityDamage,
    closestEnemyEta,
    offensiveThreat,
    predictedEnemyCityDamage,
    closestFriendlyEta,
    enemyStructurePressure,
    productionCapacity,
    territoryRatio:
      redTerritory + blueTerritory > 0
        ? redTerritory / (redTerritory + blueTerritory)
        : 0.5,
  };
}

function maxMetric(
  metrics: UnitMetricsMap,
  selector: (metric: DerivedUnitMetrics) => number,
): number {
  return Math.max(...UNIT_TYPES.map((unitType) => selector(metrics[unitType])), 0.001);
}

function productionPreferences(
  snapshot: PlannerSnapshot,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
  matrix: UnitMatchupMatrix,
): Record<UnitType, number> {
  const raw = emptyUnitRecord();
  const totalEnemyPower = positive(snapshot.bluePower, 1);
  const totalFriendlyPower = positive(snapshot.redPower, 1);
  const maxCombatEfficiency = maxMetric(
    metrics,
    (metric) =>
      metric.combatValue /
      (positive(metric.cost) * positive(metric.trainTime)),
  );
  const maxStructureEfficiency = maxMetric(
    metrics,
    (metric) => metric.structureDpsPerGoldSecond,
  );
  const maxDurability = maxMetric(metrics, (metric) => metric.durabilityPerGold);
  const enemyCityMaxHp = config.buildings.city.levels[0]?.maxHp ?? 1;
  const structureNeed = clamp(
    snapshot.enemyStructurePressure / positive(enemyCityMaxHp * 1.25),
  );
  const frontlineNeed = clamp(
    (snapshot.bluePower - snapshot.redPower * 0.65) /
      positive(snapshot.bluePower + snapshot.redPower) +
      0.5,
  );

  for (const candidateType of UNIT_TYPES) {
    const metric = metrics[candidateType];
    let counterScore = 0;
    if (snapshot.blueUnits > 0) {
      for (const enemyType of UNIT_TYPES) {
        const enemyWeight = snapshot.blueUnitPower[enemyType] / totalEnemyPower;
        counterScore +=
          enemyWeight *
          clamp(matrix[candidateType][enemyType].exchangeEfficiency / 3, 0, 2);
      }
    } else {
      counterScore = 0.5;
    }

    const combatEfficiency =
      metric.combatValue /
      (positive(metric.cost) * positive(metric.trainTime) * maxCombatEfficiency);
    const structureEfficiency =
      metric.structureDpsPerGoldSecond / maxStructureEfficiency;
    const durability = metric.durabilityPerGold / maxDurability;
    const currentShare = snapshot.redUnitPower[candidateType] / totalFriendlyPower;
    const deficitMultiplier = clamp(
      1.45 - currentShare * UNIT_TYPES.length,
      0.45,
      1.45,
    );
    raw[candidateType] =
      Math.max(
        0.001,
        counterScore * 0.45 +
          combatEfficiency * 0.15 +
          structureEfficiency * structureNeed * 0.25 +
          durability * frontlineNeed * 0.15,
      ) * deficitMultiplier;
  }

  const total = UNIT_TYPES.reduce((sum, unitType) => sum + raw[unitType], 0);
  for (const unitType of UNIT_TYPES) {
    raw[unitType] /= positive(total, UNIT_TYPES.length);
  }
  return raw;
}

function isBuildCellLegal(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  coord: HexCoord,
): boolean {
  const cell = state.cells[hexKey(coord)];
  if (!cell || cell.buildingId || cell.owner === ENEMY_PLAYER) {
    return false;
  }
  if (cell.owner === AI_PLAYER) {
    return true;
  }
  return hexNeighbors(
    coord,
    config.board.columns,
    config.board.rows,
  ).some((neighbor) => state.cells[hexKey(neighbor)]?.owner === AI_PLAYER);
}

function validBuildCells(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
): HexCoord[] {
  return Object.values(state.cells)
    .filter((cell) => isBuildCellLegal(state, config, cell))
    .map((cell) => ({ col: cell.col, row: cell.row }));
}

function boardSpan(config: Readonly<GameConfig>): number {
  return Math.max(1, config.board.columns + config.board.rows - 2);
}

function cellSafety(
  coord: HexCoord,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
): number {
  let minimumEta = Number.POSITIVE_INFINITY;
  for (const unit of Object.values(state.units)) {
    if (unit.owner !== ENEMY_PLAYER) {
      continue;
    }
    const metric = metricForLevel(metrics, unit.unitType, unit.level);
    const eta =
      Math.max(0, hexDistance(coord, unit) - metric.range) /
      positive(metric.speed);
    minimumEta = Math.min(minimumEta, eta);
  }
  let towerDanger = 0;
  for (const building of Object.values(state.buildings)) {
    if (building.owner !== ENEMY_PLAYER || building.kind !== "tower") {
      continue;
    }
    const range = buildingLevel(config, building).range ?? 0;
    if (hexDistance(coord, building) <= range) {
      towerDanger += 1;
    }
  }
  const etaSafety = Number.isFinite(minimumEta)
    ? clamp(minimumEta / Math.max(6, config.aiDecisionInterval * 4))
    : 1;
  return clamp(etaSafety / (1 + towerDanger * 2));
}

function dispersionScore(
  coord: HexCoord,
  buildings: readonly BuildingState[],
  kind: BuildingKind,
  span: number,
): number {
  const sameKind = buildings.filter(
    (building) => building.owner === AI_PLAYER && building.kind === kind,
  );
  if (sameKind.length === 0) {
    return 1;
  }
  return clamp(
    Math.min(...sameKind.map((building) => hexDistance(coord, building))) /
      Math.max(2, span * 0.35),
  );
}

function mineSpatialScore(
  coord: HexCoord,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
  snapshot: PlannerSnapshot,
): number {
  const span = boardSpan(config);
  const proximity = snapshot.redCity
    ? 1 - clamp(hexDistance(coord, snapshot.redCity) / span)
    : 0.5;
  return (
    cellSafety(coord, state, config, metrics) * 0.5 +
    proximity * 0.3 +
    dispersionScore(coord, Object.values(state.buildings), "mine", span) * 0.2
  );
}

function towerPathCoverage(
  coord: HexCoord,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
  snapshot: PlannerSnapshot,
): number {
  const range = config.buildings.tower.levels[0]?.range ?? 0;
  let covered = 0;
  let total = 0;
  if (snapshot.redCity) {
    for (const unit of Object.values(state.units)) {
      if (unit.owner !== ENEMY_PLAYER) {
        continue;
      }
      const metric = metricForLevel(metrics, unit.unitType, unit.level);
      const value = metric.combatValue * clamp(unit.hp / positive(metric.maxHp));
      const corridorDetour =
        hexDistance(unit, coord) +
        hexDistance(coord, snapshot.redCity) -
        hexDistance(unit, snapshot.redCity);
      const coverage = clamp(
        1 -
          Math.max(0, corridorDetour - range) /
            Math.max(1, range + config.board.columns * 0.25),
      );
      covered += value * coverage;
      total += value;
    }
  }
  if (total > 0) {
    return covered / total;
  }
  if (!snapshot.redCity || !snapshot.blueCity) {
    return 0.5;
  }
  const detour =
    hexDistance(snapshot.blueCity, coord) +
    hexDistance(coord, snapshot.redCity) -
    hexDistance(snapshot.blueCity, snapshot.redCity);
  return clamp(1 - detour / Math.max(1, range * 2 + 1));
}

function towerSpatialScore(
  coord: HexCoord,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
  snapshot: PlannerSnapshot,
): number {
  const range = config.buildings.tower.levels[0]?.range ?? 0;
  let protection = 0;
  let protectedValue = 0;
  for (const building of Object.values(state.buildings)) {
    if (building.owner !== AI_PLAYER) {
      continue;
    }
    const value =
      building.kind === "city"
        ? 3
        : building.kind === "mine" || building.kind === "barracks"
          ? 2
          : 1;
    protectedValue += value;
    if (hexDistance(coord, building) <= range + 1) {
      protection += value;
    }
  }
  const frontline = snapshot.blueCity
    ? 1 - clamp(hexDistance(coord, snapshot.blueCity) / boardSpan(config))
    : 0.5;
  return (
    towerPathCoverage(coord, state, config, metrics, snapshot) * 0.5 +
    (protection / positive(protectedValue, 1)) * 0.3 +
    frontline * 0.2
  );
}

function barracksSpatialScore(
  coord: HexCoord,
  unitType: UnitType,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
  snapshot: PlannerSnapshot,
): number {
  const unit = metrics[unitType];
  const travelTime = snapshot.blueCity
    ? Math.max(0, hexDistance(coord, snapshot.blueCity) - unit.range) /
      positive(unit.speed)
    : boardSpan(config) / positive(unit.speed);
  const maxTravel = boardSpan(config) / positive(unit.speed);
  const forward = 1 - clamp(travelTime / positive(maxTravel));
  return (
    forward * 0.5 +
    cellSafety(coord, state, config, metrics) * 0.3 +
    dispersionScore(
      coord,
      Object.values(state.buildings),
      "barracks",
      boardSpan(config),
    ) *
      0.2
  );
}

function zeroEffects(): CandidateEffects {
  return {
    economy: 0,
    military: 0,
    defense: 0,
    production: 0,
    spatial: 0,
    income: 0,
  };
}

function towerDps(level: {
  damage?: number;
  attackInterval?: number;
}): number {
  return Math.max(0, level.damage ?? 0) / positive(level.attackInterval ?? 1);
}

function makeBuildCandidate(
  action: AiPrimaryAction,
  goal: AiGoal,
  cost: number,
  spatialScore: number,
  effects: Partial<CandidateEffects>,
  baseScore: number,
): Candidate {
  return {
    action,
    goal,
    cost: Math.max(0, cost),
    spatialScore,
    baseScore,
    effects: { ...zeroEffects(), ...effects },
  };
}

function upgradeCandidate(
  building: BuildingState,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
  preferences: Readonly<Record<UnitType, number>>,
  emergency: boolean,
  economyNeed: number,
): Candidate | null {
  if (building.owner !== AI_PLAYER || building.kind === "city") {
    return null;
  }
  const definition = config.buildings[building.kind];
  if (building.level >= definition.levels.length) {
    return null;
  }
  const current = definition.levels[building.level - 1];
  const next = definition.levels[building.level];
  if (!current || !next) {
    return null;
  }
  const cost = Math.max(0, next.upgradeCost ?? 0);
  const hpGain = Math.max(0, next.maxHp - current.maxHp);
  let goal: AiGoal = "upgrade";
  let economy = 0;
  let military = 0;
  let defense = hpGain * 0.2;
  let production = 0;
  let income = 0;
  let marginal = hpGain * 0.05;

  if (building.kind === "mine") {
    goal = "economy";
    income = Math.max(0, (next.income ?? 0) - (current.income ?? 0));
    economy =
      income * ECONOMY_HORIZON * (0.2 + economyNeed * 0.8) + hpGain * 0.05;
    marginal += economy;
  } else if (building.kind === "tower") {
    goal = "defense";
    const dpsGain = Math.max(0, towerDps(next) - towerDps(current));
    const rangeGain = Math.max(0, (next.range ?? 0) - (current.range ?? 0));
    defense += dpsGain * 12 + rangeGain * 35;
    marginal += defense * (emergency ? 1.6 : 1);
  } else if (building.kind === "barracks" && building.autoUnitType) {
    const unitMetrics = metrics[building.autoUnitType];
    const oldMetric = metricForLevel(metrics, building.autoUnitType, building.level);
    const newMetric = metricForLevel(
      metrics,
      building.autoUnitType,
      building.level + 1,
    );
    const combatGain = Math.max(0, newMetric.combatValue - oldMetric.combatValue);
    const structureGain = Math.max(
      0,
      newMetric.structureDps - oldMetric.structureDps,
    );
    military =
      (combatGain + structureGain * 2) *
      preferences[building.autoUnitType] *
      (PLANNING_HORIZON / positive(unitMetrics.trainTime));
    production = military * 0.35;
    marginal += military;
  }

  const roiScore = marginal / positive(cost);
  return makeBuildCandidate(
    { type: "upgrade", buildingId: building.id },
    goal,
    cost,
    0.5,
    { economy, military, defense, production, income },
    roiScore * 12 + (state.players.red.gold >= cost ? 1 : 0),
  );
}

function actionSignature(action: AiPrimaryAction): string {
  switch (action.type) {
    case "wait":
      return "wait";
    case "build":
      return ["build", action.kind, action.coord.col, action.coord.row].join(":");
    case "buildBarracks":
      return [
        "barracks",
        action.unitType,
        action.coord.col,
        action.coord.row,
      ].join(":");
    case "upgrade":
      return ["upgrade", action.buildingId].join(":");
  }
}

function compareCandidate(a: Candidate, b: Candidate): number {
  return (
    b.baseScore - a.baseScore ||
    b.spatialScore - a.spatialScore ||
    actionSignature(a.action).localeCompare(actionSignature(b.action))
  );
}

function generateCandidates(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  metrics: UnitMetricsMap,
  snapshot: PlannerSnapshot,
  preferences: Readonly<Record<UnitType, number>>,
  emergency: boolean,
): Candidate[] {
  const cells = validBuildCells(state, config);
  const candidates: Candidate[] = [];
  const redBarracks = Object.values(state.buildings).filter(
    (building) => building.owner === AI_PLAYER && building.kind === "barracks",
  );
  const weightedOneBarracksSpend = UNIT_TYPES.reduce(
    (sum, unitType) =>
      sum +
      preferences[unitType] *
        (Math.max(0, config.units[unitType].cost) /
          positive(config.units[unitType].trainTime)),
    0,
  );
  const currentProductionSpend = UNIT_TYPES.reduce(
    (sum, unitType) =>
      sum +
      snapshot.productionCapacity[unitType] *
        Math.max(0, config.units[unitType].cost),
    0,
  );
  const expansionAmortization =
    Math.max(0, config.buildings.barracks.buildCost) / ECONOMY_HORIZON;
  const sustainableSpendTarget =
    Math.max(weightedOneBarracksSpend, currentProductionSpend) +
    expansionAmortization;
  const mineLevel = config.buildings.mine.levels[0];
  const mineIncome = Math.max(0, mineLevel?.income ?? 0);
  const mineCost = Math.max(0, config.buildings.mine.buildCost);
  const economyNeed = clamp(
    (sustainableSpendTarget - snapshot.redIncome + mineIncome) /
      positive(sustainableSpendTarget + mineIncome),
    0.08,
    1,
  );
  const mineRoi =
    ((mineIncome * ECONOMY_HORIZON) / positive(mineCost)) * economyNeed;
  const mines = cells
    .map((coord) => {
      const spatial = mineSpatialScore(coord, state, config, metrics, snapshot);
      return makeBuildCandidate(
        { type: "build", kind: "mine", coord },
        "economy",
        mineCost,
        spatial,
        {
          economy:
            mineIncome * ECONOMY_HORIZON * (0.2 + economyNeed * 0.8),
          income: mineIncome,
          spatial: spatial * 25,
        },
        mineRoi * 15 + spatial * 4 - (emergency ? 45 : 0),
      );
    })
    .sort(compareCandidate)
    .slice(0, 2);
  candidates.push(...mines);

  const towerLevel = config.buildings.tower.levels[0];
  const towerCost = Math.max(0, config.buildings.tower.buildCost);
  const towerPower =
    Math.max(0, towerLevel?.maxHp ?? 0) * 0.15 +
    towerDps(towerLevel ?? {}) * 12 +
    Math.max(0, towerLevel?.range ?? 0) * 12;
  const cityDurability =
    config.buildings.city.levels[0]?.maxHp ?? snapshot.redCity?.hp ?? 1;
  const defenseNeed = emergency
    ? 1
    : clamp(
        snapshot.enemyThreat /
          positive(snapshot.redPower + cityDurability * 0.15),
      );
  const towerNeedFactor = 0.1 + defenseNeed * 0.9;
  const towers = cells
    .map((coord) => {
      const spatial = towerSpatialScore(coord, state, config, metrics, snapshot);
      return makeBuildCandidate(
        { type: "build", kind: "tower", coord },
        "defense",
        towerCost,
        spatial,
        {
          defense: towerPower * (0.5 + spatial) * towerNeedFactor,
          spatial: spatial * 30,
        },
        (towerPower / positive(towerCost)) * 8 * towerNeedFactor +
          spatial * 2 +
          (emergency ? 35 : 0),
      );
    })
    .sort(compareCandidate)
    .slice(0, 3);
  candidates.push(...towers);

  const barracksCost = Math.max(0, config.buildings.barracks.buildCost);
  const currentProductionPower = UNIT_TYPES.reduce(
    (sum, unitType) =>
      sum +
      snapshot.productionCapacity[unitType] *
        (metrics[unitType].combatValue + metrics[unitType].structureDps * 2),
    0,
  );
  const desiredFieldValue =
    snapshot.bluePower * 1.15 +
    snapshot.enemyStructurePressure * 0.2 +
    (snapshot.blueCity?.hp ?? 0) * 0.08;
  const requiredProductionPower = Math.max(
    0,
    (desiredFieldValue - snapshot.redPower) / PLANNING_HORIZON,
  );
  const populationRoom = clamp(
    1 - snapshot.redUnits / Math.max(1, config.unitCap),
  );
  const capacityNeed =
    clamp(
      (requiredProductionPower - currentProductionPower) /
        positive(requiredProductionPower + currentProductionPower, 1),
    ) * populationRoom;
  const bootstrapValue = redBarracks.length === 0 ? 50 : 0;
  const requiredStructureProduction =
    snapshot.enemyStructurePressure / ECONOMY_HORIZON;
  const currentStructureProduction = UNIT_TYPES.reduce(
    (sum, unitType) =>
      sum +
      snapshot.productionCapacity[unitType] *
        metrics[unitType].structureDps,
    0,
  );
  const structureCapacityGap = clamp(
    (requiredStructureProduction - currentStructureProduction) /
      positive(requiredStructureProduction + currentStructureProduction, 1),
  );
  const maxStructureEfficiency = maxMetric(
    metrics,
    (metric) => metric.structureDpsPerGoldSecond,
  );
  for (const unitType of UNIT_TYPES) {
    if (snapshot.redUnits >= Math.max(1, config.unitCap)) {
      continue;
    }
    const unit = metrics[unitType];
    const throughput =
      (unit.combatValue +
        unit.structureDps * (2 + structureCapacityGap * 10)) /
      positive(unit.trainTime);
    const structureFit =
      unit.structureDpsPerGoldSecond / maxStructureEfficiency;
    const barracks = cells
      .map((coord) => {
        const spatial = barracksSpatialScore(
          coord,
          unitType,
          state,
          config,
          metrics,
          snapshot,
        );
        const preference = preferences[unitType];
        return makeBuildCandidate(
          { type: "buildBarracks", unitType, coord },
          unit.structureDpsPerGoldSecond ===
            maxMetric(metrics, (candidate) => candidate.structureDpsPerGoldSecond)
            ? "siege"
            : "army",
          barracksCost,
          spatial,
          {
            military: throughput * PLANNING_HORIZON * preference,
            production: throughput * 8 * preference,
            spatial: spatial * 25,
          },
          (throughput * preference * 18) / positive(barracksCost) +
            spatial * 5 +
            bootstrapValue +
            capacityNeed * preference * 25 +
            structureCapacityGap * structureFit * 45 +
            (emergency ? preference * 20 : 0),
        );
      })
      .sort(compareCandidate)
      .slice(0, 2);
    candidates.push(...barracks);
  }

  const upgrades = Object.values(state.buildings)
    .map((building) =>
      upgradeCandidate(
        building,
        state,
        config,
        metrics,
        preferences,
        emergency,
        economyNeed,
      ),
    )
    .filter((candidate): candidate is Candidate => candidate !== null);
  for (const kind of ["mine", "tower", "barracks"] as const) {
    const buildingIds = new Set(
      Object.values(state.buildings)
        .filter((building) => building.kind === kind)
        .map((building) => building.id),
    );
    candidates.push(
      ...upgrades
        .filter(
          (candidate) =>
            candidate.action.type === "upgrade" &&
            buildingIds.has(candidate.action.buildingId),
        )
        .sort(compareCandidate)
        .slice(0, 2),
    );
  }

  const wait = makeBuildCandidate(
    { type: "wait", duration: Math.max(config.aiDecisionInterval, 0.1) },
    "idle",
    0,
    0.5,
    {},
    emergency ? -10 : 0,
  );
  const trimmed = candidates.sort(compareCandidate).slice(0, 23);
  trimmed.push(wait);
  return trimmed;
}

function actionIsStructurallyValid(
  action: AiPrimaryAction,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
): boolean {
  switch (action.type) {
    case "wait":
      return true;
    case "build":
    case "buildBarracks":
      return isBuildCellLegal(state, config, action.coord);
    case "upgrade": {
      const building = state.buildings[action.buildingId];
      return Boolean(
        building &&
          building.owner === AI_PLAYER &&
          building.kind !== "city" &&
          building.level < config.buildings[building.kind].levels.length,
      );
    }
  }
}

function actionCost(
  action: AiPrimaryAction,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
): number {
  switch (action.type) {
    case "wait":
      return 0;
    case "build":
      return Math.max(0, config.buildings[action.kind].buildCost);
    case "buildBarracks":
      return Math.max(0, config.buildings.barracks.buildCost);
    case "upgrade": {
      const building = state.buildings[action.buildingId];
      if (!building || building.kind === "city") {
        return Number.POSITIVE_INFINITY;
      }
      return Math.max(
        0,
        config.buildings[building.kind].levels[building.level]?.upgradeCost ?? 0,
      );
    }
  }
}

function candidateUseKey(candidate: Candidate): string {
  const action = candidate.action;
  if (action.type === "build" || action.type === "buildBarracks") {
    return ["cell", action.coord.col, action.coord.row].join(":");
  }
  return actionSignature(action);
}

function committedCandidate(
  action: AiPrimaryAction,
  goal: AiGoal,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
): Candidate {
  return makeBuildCandidate(
    action,
    goal,
    actionCost(action, state, config),
    0.5,
    {},
    0,
  );
}

function initialModel(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  snapshot: PlannerSnapshot,
  metrics: UnitMetricsMap,
): SearchModel {
  let defense = 0;
  let production = 0;
  for (const building of Object.values(state.buildings)) {
    if (building.owner !== AI_PLAYER) {
      continue;
    }
    if (building.kind === "tower") {
      const level = buildingLevel(config, building);
      defense += building.hp * 0.12 + towerDps(level) * 12;
    } else if (building.kind === "barracks" && building.autoUnitType) {
      const unit = metricForLevel(metrics, building.autoUnitType, building.level);
      production +=
        (unit.combatValue + unit.structureDps * 2) /
        positive(config.units[building.autoUnitType].trainTime);
    }
  }
  const cityHp = snapshot.redCity?.hp ?? 0;
  return {
    gold: snapshot.redGold,
    income: snapshot.redIncome,
    economy: snapshot.redGold + snapshot.redIncome * ECONOMY_HORIZON,
    military: snapshot.redPower,
    defense,
    production,
    spatial: snapshot.territoryRatio * 100,
    survival:
      snapshot.redCityHpRatio * 100 -
      (snapshot.predictedCityDamage / positive(cityHp, 1)) * 100,
  };
}

function evaluateModel(
  model: SearchModel,
  state: Readonly<BattleState>,
  snapshot: PlannerSnapshot,
): number {
  if (state.winner === AI_PLAYER) {
    return 1_000_000_000;
  }
  if (state.winner === ENEMY_PLAYER || !snapshot.redCity) {
    return -1_000_000_000;
  }
  const survival =
    clamp(
      (model.survival +
        (model.defense / positive(snapshot.enemyThreat + 100)) * 35) /
        100,
    ) * 100;
  const offensivePower =
    snapshot.offensiveThreat * 0.35 +
    snapshot.predictedEnemyCityDamage * 0.5;
  const militaryBalance =
    ((model.military + offensivePower) /
      positive(
        model.military +
          offensivePower +
          snapshot.bluePower +
          snapshot.enemyThreat * 0.2 +
          snapshot.enemyStructurePressure * 0.2 +
          (snapshot.blueCity?.hp ?? 0) * 0.1,
        1,
      )) *
    100;
  const offensiveProgress =
    clamp(
      snapshot.predictedEnemyCityDamage /
        positive(snapshot.blueCity?.hp ?? 1),
    ) * 100;
  const military = militaryBalance * 0.82 + offensiveProgress * 0.18;
  const enemyEconomy =
    snapshot.blueGold + snapshot.blueIncome * ECONOMY_HORIZON;
  const economy =
    (model.economy / positive(model.economy + enemyEconomy, 1)) * 100;
  const productionTarget =
    (snapshot.bluePower +
      snapshot.enemyStructurePressure * 0.25 +
      (snapshot.blueCity?.hp ?? 0) * 0.1) /
      positive(PLANNING_HORIZON) +
    1;
  const production =
    clamp(model.production / positive(model.production + productionTarget, 1)) *
    100;
  const spatial = clamp(model.spatial / 100) * 100;
  return (
    survival * 0.4 +
    military * 0.25 +
    economy * 0.15 +
    production * 0.1 +
    spatial * 0.1
  );
}

function applyCandidate(
  model: SearchModel,
  candidate: Candidate,
  stepDuration: number,
): SearchModel {
  let gold = model.gold + model.income * stepDuration;
  let economy =
    model.economy + model.income * stepDuration +
    model.income * (stepDuration / PLANNING_HORIZON) * ECONOMY_HORIZON;
  let income = model.income;
  let military = model.military;
  let defense = model.defense;
  let production = model.production;
  let spatial = model.spatial;
  let survival = model.survival;

  if (candidate.cost <= gold + 0.0001) {
    gold = Math.max(0, gold - candidate.cost);
    economy = Math.max(0, economy - candidate.cost) + candidate.effects.economy;
    income += candidate.effects.income;
    military += candidate.effects.military;
    defense += candidate.effects.defense;
    production += candidate.effects.production;
    spatial += candidate.effects.spatial;
    survival +=
      candidate.goal === "defense"
        ? Math.min(25, candidate.effects.defense / 20)
        : 0;
  } else {
    const progress = clamp(gold / positive(candidate.cost));
    economy -= (1 - progress) * Math.min(15, candidate.cost * 0.05);
  }

  return {
    gold,
    income,
    economy,
    military,
    defense,
    production,
    spatial,
    survival,
  };
}

function sequenceBonus(sequence: readonly Candidate[]): number {
  return sequence.reduce(
    (sum, candidate, index) =>
      sum + candidate.baseScore * Math.pow(0.7, index) * 0.15,
    0,
  );
}

interface SearchResult {
  nodeCount: number;
  scores: ReadonlyMap<string, number>;
}

function beamSearch(
  state: Readonly<BattleState>,
  snapshot: PlannerSnapshot,
  model: SearchModel,
  candidates: readonly Candidate[],
): SearchResult {
  const firstScores = new Map<string, number>();
  let beam: SearchNode[] = [
    {
      model,
      sequence: [],
      used: new Set<string>(),
      score: evaluateModel(model, state, snapshot),
    },
  ];
  let nodeCount = 0;
  const stepDuration = PLANNING_HORIZON / SEARCH_DEPTH;

  for (let depth = 0; depth < SEARCH_DEPTH && nodeCount < MAX_SEARCH_NODES; depth += 1) {
    const expanded: SearchNode[] = [];
    outer: for (const node of beam) {
      for (const candidate of candidates) {
        const useKey = candidateUseKey(candidate);
        if (node.used.has(useKey)) {
          continue;
        }
        const nextModel = applyCandidate(node.model, candidate, stepDuration);
        const sequence = [...node.sequence, candidate];
        const score =
          evaluateModel(nextModel, state, snapshot) + sequenceBonus(sequence);
        const used = new Set(node.used);
        used.add(useKey);
        const nextNode: SearchNode = { model: nextModel, sequence, used, score };
        expanded.push(nextNode);
        nodeCount += 1;

        const rootSignature = actionSignature(sequence[0].action);
        const previous = firstScores.get(rootSignature);
        if (previous === undefined || score > previous) {
          firstScores.set(rootSignature, score);
        }
        if (nodeCount >= MAX_SEARCH_NODES) {
          break outer;
        }
      }
    }
    expanded.sort(
      (a, b) =>
        b.score - a.score ||
        actionSignature(a.sequence[0].action).localeCompare(
          actionSignature(b.sequence[0].action),
        ),
    );
    beam = expanded.slice(0, BEAM_WIDTH);
    if (beam.length === 0) {
      break;
    }
  }

  return { nodeCount, scores: firstScores };
}

interface ScoredCandidate {
  candidate: Candidate;
  score: number;
}

function scoreCandidates(
  candidates: readonly Candidate[],
  scores: ReadonlyMap<string, number>,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scores.get(actionSignature(candidate.action)) ?? candidate.baseScore,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        actionSignature(a.candidate.action).localeCompare(
          actionSignature(b.candidate.action),
        ),
    );
}

function chooseNearOptimal(
  scored: readonly ScoredCandidate[],
  rngState: number,
): { selected: ScoredCandidate; rngState: number } {
  const best = scored[0];
  if (!best) {
    throw new Error("AI planner requires at least the wait candidate.");
  }
  const tolerance = Math.max(Math.abs(best.score) * (1 - NEAR_OPTIMAL_RATIO), 0.001);
  const pool = scored.filter((entry) => best.score - entry.score <= tolerance);
  if (pool.length <= 1) {
    return { selected: best, rngState };
  }

  const random = nextRandom(rngState);
  const temperature = Math.max(tolerance * 0.45, 0.001);
  const weights = pool.map((entry) =>
    Math.exp((entry.score - best.score) / temperature),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random.value * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) {
      return { selected: pool[index], rngState: random.state };
    }
  }
  return { selected: pool[pool.length - 1], rngState: random.state };
}

function armyNeedsProduction(
  snapshot: PlannerSnapshot,
  config: Readonly<GameConfig>,
): boolean {
  return (
    snapshot.redUnits <
      Math.min(
        Math.max(1, config.unitCap),
        Math.max(3, snapshot.blueUnits),
      ) || snapshot.redPower < snapshot.bluePower * 1.1
  );
}

function desiredProductionActions(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  snapshot: PlannerSnapshot,
  preferences: Readonly<Record<UnitType, number>>,
  reserveGold: number,
  emergency: boolean,
): AiAction[] {
  const barracks = Object.values(state.buildings).filter(
    (building) =>
      building.owner === AI_PLAYER &&
      building.kind === "barracks" &&
      building.autoUnitType !== null,
  );
  if (barracks.length === 0) {
    return [];
  }
  const existingTypes = barracks
    .map((building) => building.autoUnitType)
    .filter((unitType): unitType is UnitType => unitType !== null);
  const highestPreference = existingTypes.reduce((best, unitType) =>
    preferences[unitType] > preferences[best] ? unitType : best,
  );
  const totalFriendlyPower = positive(snapshot.redPower, 1);
  const saving = !emergency && reserveGold > snapshot.redGold + 0.0001;
  const atCap = snapshot.redUnits >= Math.max(1, config.unitCap);
  const armyInsufficient = armyNeedsProduction(snapshot, config);
  const actions: AiAction[] = [];
  let keptForSavings = false;
  let keptForArmy = false;

  for (const building of barracks.sort((a, b) => a.id.localeCompare(b.id))) {
    const unitType = building.autoUnitType;
    if (!unitType) {
      continue;
    }
    const currentShare = snapshot.redUnitPower[unitType] / totalFriendlyPower;
    const clearlyOverrepresented =
      snapshot.redUnits >= UNIT_TYPES.length * 2 &&
      currentShare > preferences[unitType] + 0.28 &&
      currentShare > preferences[unitType] * 1.65;
    let shouldPause = atCap || clearlyOverrepresented;
    if (
      saving &&
      unitType !== highestPreference &&
      preferences[unitType] < 0.34 &&
      !building.production?.paid
    ) {
      shouldPause = true;
    }
    if (saving && unitType === highestPreference && !keptForSavings) {
      shouldPause = false;
      keptForSavings = true;
    }
    if (
      !atCap &&
      armyInsufficient &&
      unitType === highestPreference &&
      !keptForArmy
    ) {
      shouldPause = false;
      keptForArmy = true;
    }
    const isPaused =
      building.productionMode === "paused" ||
      building.productionMode === "pauseAfterCurrent";
    if (shouldPause !== isPaused) {
      actions.push({
        type: "setProductionPaused",
        buildingId: building.id,
        paused: shouldPause,
      });
    }
  }
  return actions;
}

function emergencyState(snapshot: PlannerSnapshot): boolean {
  if (!snapshot.redCity) {
    return true;
  }
  return (
    snapshot.predictedCityDamage >= Math.max(1, snapshot.redCity.hp) * 0.15 ||
    (snapshot.closestEnemyEta <= 6 &&
      snapshot.enemyThreat > snapshot.redPower * 0.2)
  );
}

function idlePlan(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  memory: Readonly<AiMemory>,
  seed: number,
): AiPlan {
  const primaryAction: AiPrimaryAction = {
    type: "wait",
    duration: Math.max(config.aiDecisionInterval, 0.1),
  };
  const preferences: Record<UnitType, number> = {
    warrior: 1 / UNIT_TYPES.length,
    archer: 1 / UNIT_TYPES.length,
    siege: 1 / UNIT_TYPES.length,
  };
  const trace: AiDecisionTrace = {
    seed,
    nodeCount: 0,
    candidates: [
      {
        action: primaryAction,
        goal: "idle",
        score: state.winner === AI_PLAYER ? 1_000_000_000 : 0,
        cost: 0,
        affordable: true,
        spatialScore: 0.5,
      },
    ],
    chosen: primaryAction,
    goalAction: primaryAction,
    goal: "idle",
    reserveGold: 0,
    interruptionReason: "none",
    emergency: false,
  };
  const nextMemory: AiMemory = {
    ...memory,
    seed,
    rngState: memory.seed === seed ? memory.rngState : seed,
    committedGoal: "idle",
    committedAction: null,
    commitUntil: state.elapsed,
    reserveGold: 0,
    lastUtility: trace.candidates[0].score,
  };
  return {
    actions: [primaryAction],
    primaryAction,
    reserveGold: 0,
    productionPreferences: preferences,
    utility: nextMemory.lastUtility,
    emergency: false,
    commitUntil: nextMemory.commitUntil,
    nextMemory,
    trace,
  };
}

/**
 * Configuration-driven macro planner. The config reference is intentionally kept
 * live; metrics and matchup values are re-derived for every decision.
 */
export class AiPlanner {
  private lastTrace: AiDecisionTrace | null = null;

  constructor(private readonly config: Readonly<GameConfig>) {}

  plan(
    state: Readonly<BattleState>,
    memory: Readonly<AiMemory>,
  ): AiPlan {
    const seed = normalizeSeed(this.config.aiSeed ?? memory.seed);
    if (!state.started || state.winner !== null) {
      const plan = idlePlan(state, this.config, memory, seed);
      this.lastTrace = plan.trace;
      return plan;
    }

    const metrics = deriveUnitMetrics(this.config);
    const matrix = buildMatchupMatrix(this.config);
    const snapshot = makeSnapshot(state, this.config, metrics);
    if (!snapshot.redCity || !snapshot.blueCity) {
      const plan = idlePlan(state, this.config, memory, seed);
      this.lastTrace = plan.trace;
      return plan;
    }
    const emergency = emergencyState(snapshot);
    const preferences = productionPreferences(
      snapshot,
      this.config,
      metrics,
      matrix,
    );
    let candidates = generateCandidates(
      state,
      this.config,
      metrics,
      snapshot,
      preferences,
      emergency,
    );

    const committedValid =
      memory.committedAction !== null &&
      actionIsStructurallyValid(memory.committedAction, state, this.config);
    if (
      committedValid &&
      memory.committedAction &&
      !candidates.some(
        (candidate) =>
          actionSignature(candidate.action) ===
          actionSignature(memory.committedAction as AiPrimaryAction),
      )
    ) {
      const wait = candidates.find((candidate) => candidate.action.type === "wait");
      candidates = candidates
        .filter((candidate) => candidate.action.type !== "wait")
        .slice(0, 22);
      candidates.push(
        committedCandidate(
          memory.committedAction,
          memory.committedGoal,
          state,
          this.config,
        ),
      );
      if (wait) {
        candidates.push(wait);
      }
    }

    const model = initialModel(state, this.config, snapshot, metrics);
    const search = beamSearch(state, snapshot, model, candidates);
    const scored = scoreCandidates(candidates, search.scores);
    const best = scored[0];
    if (!best) {
      const plan = idlePlan(state, this.config, memory, seed);
      this.lastTrace = plan.trace;
      return plan;
    }

    let selected: ScoredCandidate | undefined;
    let nextRngState = memory.seed === seed ? memory.rngState : seed;
    let interruptionReason: AiInterruptionReason = "none";
    const committedScore =
      memory.committedAction === null
        ? undefined
        : scored.find(
            (entry) =>
              actionSignature(entry.candidate.action) ===
              actionSignature(memory.committedAction as AiPrimaryAction),
          );

    if (memory.committedAction && !committedValid) {
      interruptionReason = "target-invalid";
    } else if (memory.committedAction && emergency) {
      interruptionReason = "emergency";
    } else if (
      memory.committedAction &&
      committedScore &&
      state.elapsed < memory.commitUntil
    ) {
      const switchingThreshold =
        committedScore.score +
        Math.max(Math.abs(committedScore.score) * (PLAN_SWITCH_RATIO - 1), 0.15);
      if (best.score <= switchingThreshold) {
        selected = committedScore;
        interruptionReason = "commitment-active";
      } else {
        selected = best;
        interruptionReason = "new-plan-superior";
      }
    } else {
      if (memory.committedAction) {
        interruptionReason = "commitment-expired";
      }
    }

    if (!selected) {
      const varied = chooseNearOptimal(scored, nextRngState);
      selected = varied.selected;
      nextRngState = varied.rngState;
    }

    if (emergency && selected.candidate.goal === "economy") {
      const urgent = scored.find(
        (entry) =>
          entry.candidate.goal === "defense" ||
          entry.candidate.goal === "army" ||
          entry.candidate.goal === "upgrade",
      );
      if (urgent) {
        selected = urgent;
      }
    }

    const goalAction = selected.candidate.action;
    const targetCost = selected.candidate.cost;
    const canExecute =
      targetCost <= snapshot.redGold + 0.0001 &&
      actionIsStructurallyValid(goalAction, state, this.config);
    const primaryAction: AiPrimaryAction = canExecute
      ? goalAction
      : {
          type: "wait",
          duration: Math.max(this.config.aiDecisionInterval, 0.1),
        };
    const protectProduction =
      emergency || armyNeedsProduction(snapshot, this.config);
    const reserveGold =
      goalAction.type !== "wait" && !canExecute && !protectProduction
        ? targetCost
        : 0;
    const productionActions = desiredProductionActions(
      state,
      this.config,
      snapshot,
      preferences,
      reserveGold,
      emergency,
    );
    const actions: AiAction[] = [...productionActions, primaryAction];
    const commitmentDuration = Math.max(
      6,
      this.config.aiDecisionInterval * 2,
    );
    const retainingCommitment =
      interruptionReason === "commitment-active" &&
      memory.committedAction !== null;
    const commitUntil =
      goalAction.type === "wait"
        ? state.elapsed
        : retainingCommitment
          ? memory.commitUntil
          : state.elapsed + commitmentDuration;
    const nextMemory: AiMemory = {
      seed,
      rngState: nextRngState,
      committedGoal:
        goalAction.type === "wait" ? "idle" : selected.candidate.goal,
      committedAction: goalAction.type === "wait" ? null : goalAction,
      commitUntil,
      reserveGold,
      lastUtility: selected.score,
    };
    const traceCandidates: AiCandidateTrace[] = scored.map((entry) => ({
      action: entry.candidate.action,
      goal: entry.candidate.goal,
      score: entry.score,
      cost: entry.candidate.cost,
      affordable: entry.candidate.cost <= snapshot.redGold + 0.0001,
      spatialScore: entry.candidate.spatialScore,
    }));
    const trace: AiDecisionTrace = {
      seed,
      nodeCount: search.nodeCount,
      candidates: traceCandidates,
      chosen: primaryAction,
      goalAction,
      goal: nextMemory.committedGoal,
      reserveGold,
      interruptionReason,
      emergency,
    };
    const plan: AiPlan = {
      actions,
      primaryAction,
      reserveGold,
      productionPreferences: preferences,
      utility: selected.score,
      emergency,
      commitUntil,
      nextMemory,
      trace,
    };
    this.lastTrace = trace;
    return plan;
  }

  getTrace(): Readonly<AiDecisionTrace> | null {
    return this.lastTrace;
  }
}

export function planAi(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  memory: Readonly<AiMemory>,
): AiPlan {
  return new AiPlanner(config).plan(state, memory);
}
