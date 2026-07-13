import { describe, expect, it } from "vitest";
import {
  AiPlanner,
  buildMatchupMatrix,
  createAiMemory,
  deriveUnitMetrics,
  planAi,
} from "../src/game/ai";
import { createConfig, DEFAULT_CONFIG, UNIT_TYPES } from "../src/game/config";
import { hexNeighbors } from "../src/game/hex";
import { GameSimulation } from "../src/game/simulation";
import type {
  BattleState,
  GameConfig,
  HexCoord,
  PlayerId,
  UnitState,
  UnitType,
} from "../src/game/types";

function createStartedSimulation(
  overrides: Partial<GameConfig> = {},
): GameSimulation {
  const simulation = new GameSimulation(
    createConfig({ aiEnabled: false, aiSeed: 1729, ...overrides }),
  );
  simulation.start();
  return simulation;
}

function addUnit(
  state: BattleState,
  config: Readonly<GameConfig>,
  id: string,
  owner: PlayerId,
  unitType: UnitType,
  coord: HexCoord,
  level = 1,
): UnitState {
  const stats = config.units[unitType].levels[level - 1];
  const unit: UnitState = {
    id,
    owner,
    unitType,
    level,
    hp: stats.maxHp,
    cooldown: 0,
    moveProgress: 0,
    nextCell: null,
    ...coord,
  };
  state.units[id] = unit;
  return unit;
}

function actionKey(action: ReturnType<AiPlanner["plan"]>["trace"]["goalAction"]): string {
  if (action.type === "build" || action.type === "buildBarracks") {
    return `${action.type}:${"kind" in action ? action.kind : action.unitType}:${action.coord.col},${action.coord.row}`;
  }
  if (action.type === "upgrade") {
    return `${action.type}:${action.buildingId}`;
  }
  return action.type;
}

describe("configuration-driven AI metrics", () => {
  it("recomputes DPS, training efficiency, and matchups from config", () => {
    const baseMetrics = deriveUnitMetrics(DEFAULT_CONFIG);
    const baseMatrix = buildMatchupMatrix(DEFAULT_CONFIG);
    const modified = createConfig({
      units: {
        ...DEFAULT_CONFIG.units,
        archer: {
          ...DEFAULT_CONFIG.units.archer,
          cost: DEFAULT_CONFIG.units.archer.cost * 4,
          trainTime: DEFAULT_CONFIG.units.archer.trainTime * 2,
          levels: DEFAULT_CONFIG.units.archer.levels.map((level) => ({
            ...level,
            damage: level.damage * 0.5,
            range: level.range + 2,
          })),
        },
      },
    });
    const changedMetrics = deriveUnitMetrics(modified);
    const changedMatrix = buildMatchupMatrix(modified);

    expect(changedMetrics.archer.unitDps).toBeCloseTo(
      baseMetrics.archer.unitDps * 0.5,
    );
    expect(changedMetrics.archer.range).toBe(baseMetrics.archer.range + 2);
    expect(changedMetrics.archer.unitDpsPerGoldSecond).toBeLessThan(
      baseMetrics.archer.unitDpsPerGoldSecond / 8,
    );
    expect(changedMatrix.archer.warrior.exchangeEfficiency).toBeLessThan(
      baseMatrix.archer.warrior.exchangeEfficiency,
    );
  });

  it("changes composition preferences when a unit's configured value changes", () => {
    const simulation = createStartedSimulation({ startingGold: 1000 });
    const blueCity = simulation.getCity("blue");
    const towerCoord = hexNeighbors(
      blueCity,
      simulation.config.board.columns,
      simulation.config.board.rows,
    )[0];
    simulation.command({
      type: "build",
      player: "blue",
      kind: "tower",
      coord: towerCoord,
    });

    const baseline = planAi(
      simulation.state,
      simulation.config,
      createAiMemory(simulation.config, 19),
    );
    const boostedConfig = createConfig({
      aiEnabled: false,
      aiSeed: 19,
      startingGold: 1000,
      units: {
        ...simulation.config.units,
        siege: {
          ...simulation.config.units.siege,
          cost: 1,
          trainTime: 0.25,
          levels: simulation.config.units.siege.levels.map((level) => ({
            ...level,
            maxHp: level.maxHp * 4,
            damage: level.damage * 6,
            range: level.range + 2,
          })),
        },
      },
    });
    const boosted = planAi(
      simulation.state,
      boostedConfig,
      createAiMemory(boostedConfig, 19),
    );

    expect(boosted.productionPreferences.siege).toBeGreaterThan(
      baseline.productionPreferences.siege,
    );
    expect(boosted.productionPreferences.siege).toBe(
      Math.max(...UNIT_TYPES.map((unitType) => boosted.productionPreferences[unitType])),
    );
  });

  it("re-reads a live config reference on every decision", () => {
    const config = createConfig({ aiEnabled: false, aiSeed: 23 });
    const simulation = createStartedSimulation();
    const planner = new AiPlanner(config);
    const memory = createAiMemory(config, 23);
    const before = planner.plan(simulation.state, memory);

    config.units.siege = {
      ...config.units.siege,
      cost: 1,
      trainTime: 0.1,
      levels: config.units.siege.levels.map((level) => ({
        ...level,
        maxHp: level.maxHp * 10,
        damage: level.damage * 10,
        range: level.range + 4,
      })),
    };
    const after = planner.plan(simulation.state, memory);

    expect(after.productionPreferences.siege).toBeGreaterThan(
      before.productionPreferences.siege,
    );
    expect(after.trace.candidates).not.toEqual(before.trace.candidates);
  });
});

describe("bounded deterministic planning", () => {
  it("is deterministic, bounded, near-optimal, and does not mutate inputs", () => {
    const simulation = createStartedSimulation();
    const memory = createAiMemory(simulation.config, 42);
    const stateBefore = structuredClone(simulation.state);
    const configBefore = structuredClone(simulation.config);
    const memoryBefore = structuredClone(memory);

    const first = planAi(simulation.state, simulation.config, memory);
    const second = planAi(simulation.state, simulation.config, memory);

    expect(second).toEqual(first);
    expect(first.trace.nodeCount).toBeLessThanOrEqual(256);
    expect(first.trace.candidates.length).toBeLessThanOrEqual(24);
    expect(simulation.state).toEqual(stateBefore);
    expect(simulation.config).toEqual(configBefore);
    expect(memory).toEqual(memoryBefore);

    for (let seed = 1; seed <= 20; seed += 1) {
      const plan = planAi(
        simulation.state,
        createConfig({ ...simulation.config, aiSeed: null }),
        createAiMemory(createConfig({ ...simulation.config, aiSeed: null }), seed),
      );
      const bestScore = plan.trace.candidates[0].score;
      expect(bestScore - plan.utility).toBeLessThanOrEqual(
        Math.max(Math.abs(bestScore) * 0.05, 0.001) + 1e-8,
      );
      expect(
        plan.trace.candidates.some(
          (candidate) => actionKey(candidate.action) === actionKey(plan.trace.goalAction),
        ),
      ).toBe(true);
    }
  });

  it("returns a legal wait fallback when no build or upgrade action exists", () => {
    const simulation = createStartedSimulation();
    const redCity = simulation.getCity("red");
    for (const cell of Object.values(simulation.state.cells)) {
      if (cell.col !== redCity.col || cell.row !== redCity.row) {
        cell.owner = "blue";
      }
    }
    simulation.state.players.red.gold = 0;

    const plan = planAi(
      simulation.state,
      simulation.config,
      createAiMemory(simulation.config, 7),
    );
    expect(plan.primaryAction.type).toBe("wait");
    expect(plan.trace.goalAction.type).toBe("wait");
    expect(plan.reserveGold).toBe(0);
  });

  it("interrupts economy plans when configured live damage threatens the city", () => {
    const simulation = createStartedSimulation({ startingGold: 1000 });
    const redCity = simulation.getCity("red");
    const nearby = hexNeighbors(
      redCity,
      simulation.config.board.columns,
      simulation.config.board.rows,
    );
    for (let index = 0; index < 4; index += 1) {
      addUnit(
        simulation.state,
        simulation.config,
        `blue-threat-${index}`,
        "blue",
        index % 2 === 0 ? "archer" : "warrior",
        nearby[index % nearby.length],
      );
    }

    const plan = planAi(
      simulation.state,
      simulation.config,
      createAiMemory(simulation.config, 11),
    );
    expect(plan.emergency).toBe(true);
    expect(plan.trace.goal).not.toBe("economy");
  });
});

describe("GameSimulation AI integration", () => {
  it("records a reproducible decision trace without unfair resources", () => {
    const simulation = new GameSimulation(
      createConfig({ aiEnabled: true, aiSeed: 314159 }),
    );
    simulation.start();
    const initialGold = simulation.state.players.red.gold;
    const steps = Math.ceil((simulation.config.aiDecisionInterval + 0.1) / simulation.config.fixedStep);
    for (let index = 0; index < steps; index += 1) {
      simulation.update(simulation.config.fixedStep);
    }

    const trace = simulation.getAiDecisionTrace();
    expect(trace?.seed).toBe(314159);
    expect(trace?.nodeCount).toBeLessThanOrEqual(256);
    if (trace) {
      (trace as { seed: number }).seed = 0;
      expect(simulation.getAiDecisionTrace()?.seed).toBe(314159);
    }
    expect(simulation.state.players.red.gold).toBeGreaterThanOrEqual(0);
    expect(simulation.state.players.red.gold).toBeLessThanOrEqual(
      initialGold + simulation.config.baseIncome * simulation.state.elapsed,
    );
  });
});
