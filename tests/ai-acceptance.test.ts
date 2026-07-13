import { describe, expect, it } from "vitest";
import {
  AiPlanner,
  createAiMemory,
  planAi,
  type AiCandidateTrace,
  type AiPrimaryAction,
} from "../src/game/ai";
import { createConfig, UNIT_TYPES } from "../src/game/config";
import { hexDistance, hexKey, hexNeighbors } from "../src/game/hex";
import { GameSimulation } from "../src/game/simulation";
import type {
  BarracksProductionMode,
  BattleState,
  BuildingKind,
  BuildingState,
  GameConfig,
  HexCoord,
  PlayerId,
  UnitState,
  UnitType,
} from "../src/game/types";

const AI_SEED = 0x51a7;

function configForTest(mutator?: (config: GameConfig) => void): GameConfig {
  const config = structuredClone(
    createConfig({ aiEnabled: false, aiSeed: AI_SEED }),
  );
  mutator?.(config);
  return config;
}

function startedSimulation(config = configForTest()): GameSimulation {
  const simulation = new GameSimulation(config);
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
  const definition = config.units[unitType].levels[level - 1];
  const unit: UnitState = {
    id,
    owner,
    unitType,
    level,
    hp: definition.maxHp,
    cooldown: 0,
    moveProgress: 0,
    nextCell: null,
    ...coord,
  };
  state.units[id] = unit;
  return unit;
}

function addBuilding(
  state: BattleState,
  config: Readonly<GameConfig>,
  id: string,
  owner: PlayerId,
  kind: BuildingKind,
  coord: HexCoord,
  options: {
    level?: number;
    unitType?: UnitType;
    productionMode?: BarracksProductionMode;
  } = {},
): BuildingState {
  const level = options.level ?? 1;
  const building: BuildingState = {
    id,
    owner,
    kind,
    level,
    hp: config.buildings[kind].levels[level - 1].maxHp,
    cooldown: 0,
    autoUnitType: kind === "barracks" ? (options.unitType ?? "warrior") : null,
    production: null,
    productionMode:
      kind === "barracks" ? (options.productionMode ?? "running") : null,
    ...coord,
  };
  state.buildings[id] = building;
  const cell = state.cells[hexKey(coord)];
  cell.owner = owner;
  cell.buildingId = id;
  return building;
}

/** Limits planner placement choices without changing the two initial cities. */
function restrictBuildCells(
  state: BattleState,
  redChoices: readonly HexCoord[],
): void {
  const choices = new Set(redChoices.map(hexKey));
  for (const cell of Object.values(state.cells)) {
    if (cell.buildingId) {
      cell.owner = state.buildings[cell.buildingId].owner;
    } else {
      cell.owner = choices.has(hexKey(cell)) ? "red" : "blue";
    }
  }
}

function candidatesMatching(
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
  predicate: (candidate: AiCandidateTrace) => boolean,
): AiCandidateTrace[] {
  const plan = planAi(state, config, createAiMemory(config, AI_SEED));
  return plan.trace.candidates.filter(predicate);
}

function bestScore(candidates: readonly AiCandidateTrace[]): number {
  expect(candidates.length).toBeGreaterThan(0);
  return Math.max(...candidates.map((candidate) => candidate.score));
}

function candidateAt(
  candidates: readonly AiCandidateTrace[],
  coord: HexCoord,
): AiCandidateTrace {
  const candidate = candidates.find((entry) => {
    const action = entry.action;
    return (
      (action.type === "build" || action.type === "buildBarracks") &&
      action.coord.col === coord.col &&
      action.coord.row === coord.row
    );
  });
  expect(candidate).toBeDefined();
  return candidate as AiCandidateTrace;
}

function assertPrimaryActionLegal(
  action: AiPrimaryAction,
  state: Readonly<BattleState>,
  config: Readonly<GameConfig>,
): void {
  if (action.type === "wait") {
    expect(action.duration).toBeGreaterThan(0);
    return;
  }
  if (action.type === "build" || action.type === "buildBarracks") {
    const cell = state.cells[hexKey(action.coord)];
    expect(cell).toBeDefined();
    expect(cell.buildingId).toBeNull();
    expect(cell.owner).not.toBe("blue");
    return;
  }
  const building = state.buildings[action.buildingId];
  expect(building).toBeDefined();
  expect(building.owner).toBe("red");
  expect(building.level).toBeLessThan(
    config.buildings[building.kind].levels.length,
  );
}

describe("AI configuration acceptance", () => {
  it("re-ranks economy, defense, and upgrades from live config values", () => {
    const simulation = startedSimulation();
    simulation.state.players.red.gold = 1_000;
    simulation.state.players.blue.gold = 1_000;
    const redCity = simulation.getCity("red");
    const mineCoord = hexNeighbors(
      redCity,
      simulation.config.board.columns,
      simulation.config.board.rows,
    )[0];
    const mine = addBuilding(
      simulation.state,
      simulation.config,
      "red-upgrade-mine",
      "red",
      "mine",
      mineCoord,
    );
    const threatCoord = { col: redCity.col, row: redCity.row + 3 };
    addUnit(
      simulation.state,
      simulation.config,
      "blue-pressure",
      "blue",
      "warrior",
      threatCoord,
    );

    const poorMine = configForTest((config) => {
      config.buildings.mine.levels[0].income = 0.05;
    });
    const richMine = structuredClone(poorMine);
    richMine.buildings.mine.levels[0].income = 20;
    const poorMineScore = bestScore(
      candidatesMatching(
        simulation.state,
        poorMine,
        ({ action }) => action.type === "build" && action.kind === "mine",
      ),
    );
    const richMineScore = bestScore(
      candidatesMatching(
        simulation.state,
        richMine,
        ({ action }) => action.type === "build" && action.kind === "mine",
      ),
    );
    expect(richMineScore).toBeGreaterThan(poorMineScore);

    const weakTower = configForTest((config) => {
      config.buildings.tower.levels[0].damage = 0;
    });
    const strongTower = structuredClone(weakTower);
    strongTower.buildings.tower.levels[0].damage = 250;
    const weakTowerScore = bestScore(
      candidatesMatching(
        simulation.state,
        weakTower,
        ({ action }) => action.type === "build" && action.kind === "tower",
      ),
    );
    const strongTowerScore = bestScore(
      candidatesMatching(
        simulation.state,
        strongTower,
        ({ action }) => action.type === "build" && action.kind === "tower",
      ),
    );
    expect(strongTowerScore).toBeGreaterThan(weakTowerScore);

    const cheapUpgrade = configForTest((config) => {
      config.buildings.mine.levels[1].upgradeCost = 1;
    });
    const expensiveUpgrade = structuredClone(cheapUpgrade);
    expensiveUpgrade.buildings.mine.levels[1].upgradeCost = 10_000;
    const cheapUpgradeScore = bestScore(
      candidatesMatching(
        simulation.state,
        cheapUpgrade,
        ({ action }) =>
          action.type === "upgrade" && action.buildingId === mine.id,
      ),
    );
    const expensiveUpgradeScore = bestScore(
      candidatesMatching(
        simulation.state,
        expensiveUpgrade,
        ({ action }) =>
          action.type === "upgrade" && action.buildingId === mine.id,
      ),
    );
    expect(cheapUpgradeScore).toBeGreaterThan(expensiveUpgradeScore);
  });
});

describe("AI spatial acceptance", () => {
  it("places mines away from imminent enemies", () => {
    const config = configForTest();
    const simulation = startedSimulation(config);
    const safe = { col: 0, row: 0 };
    const exposed = { col: 4, row: 2 };
    restrictBuildCells(simulation.state, [safe, exposed]);
    addUnit(
      simulation.state,
      config,
      "mine-raider",
      "blue",
      "warrior",
      exposed,
    );

    const mines = candidatesMatching(
      simulation.state,
      config,
      ({ action }) => action.type === "build" && action.kind === "mine",
    );
    const safest = [...mines].sort(
      (left, right) => right.spatialScore - left.spatialScore,
    )[0];
    expect(safest.action.type).toBe("build");
    if (safest.action.type !== "build") {
      throw new Error("Expected a mine candidate");
    }
    expect(hexDistance(safest.action.coord, exposed)).toBeGreaterThan(
      hexDistance(exposed, exposed),
    );
    expect(candidateAt(mines, safe).spatialScore).toBeGreaterThan(
      candidateAt(mines, exposed).spatialScore,
    );
  });

  it("scores towers for the incoming corridor and high-value city, using tower range", () => {
    const lowRange = configForTest((config) => {
      config.buildings.tower.levels[0].range = 0;
    });
    const highRange = structuredClone(lowRange);
    highRange.buildings.tower.levels[0].range = 6;
    const simulation = startedSimulation(lowRange);
    const corridor = { col: 4, row: 4 };
    const offPath = { col: 0, row: 0 };
    restrictBuildCells(simulation.state, [corridor, offPath]);
    addUnit(
      simulation.state,
      lowRange,
      "tower-lane-threat",
      "blue",
      "warrior",
      { col: 4, row: 7 },
    );

    const lowCandidates = candidatesMatching(
      simulation.state,
      lowRange,
      ({ action }) => action.type === "build" && action.kind === "tower",
    );
    const highCandidates = candidatesMatching(
      simulation.state,
      highRange,
      ({ action }) => action.type === "build" && action.kind === "tower",
    );
    expect(candidateAt(lowCandidates, corridor).spatialScore).toBeGreaterThan(
      candidateAt(lowCandidates, offPath).spatialScore,
    );
    expect(candidateAt(highCandidates, corridor).spatialScore).not.toBe(
      candidateAt(lowCandidates, corridor).spatialScore,
    );
  });

  it("pushes barracks forward when candidate cells are equally safe", () => {
    const config = configForTest();
    const simulation = startedSimulation(config);
    const rear = { col: 4, row: 0 };
    const forward = { col: 4, row: 8 };
    restrictBuildCells(simulation.state, [rear, forward]);
    const plan = planAi(
      simulation.state,
      config,
      createAiMemory(config, AI_SEED),
    );
    const preferredType = UNIT_TYPES.reduce((best, unitType) =>
      plan.productionPreferences[unitType] > plan.productionPreferences[best]
        ? unitType
        : best,
    );
    const barracks = plan.trace.candidates.filter(
      ({ action }) =>
        action.type === "buildBarracks" && action.unitType === preferredType,
    );
    expect(candidateAt(barracks, forward).spatialScore).toBeGreaterThan(
      candidateAt(barracks, rear).spatialScore,
    );
  });
});

describe("AI legal fallback acceptance", () => {
  it("pauses production at the configured unit cap and does not expand production", () => {
    const config = configForTest((mutable) => {
      mutable.unitCap = 40;
    });
    const simulation = startedSimulation(config);
    const redCity = simulation.getCity("red");
    const barracksCells = hexNeighbors(
      redCity,
      config.board.columns,
      config.board.rows,
    ).slice(0, UNIT_TYPES.length);
    const barracks = UNIT_TYPES.map((unitType, index) =>
      addBuilding(
        simulation.state,
        config,
        `cap-barracks-${unitType}`,
        "red",
        "barracks",
        barracksCells[index],
        { unitType },
      ),
    );
    for (let index = 0; index < config.unitCap; index += 1) {
      addUnit(
        simulation.state,
        config,
        `cap-unit-${index}`,
        "red",
        UNIT_TYPES[index % UNIT_TYPES.length],
        { col: index % config.board.columns, row: 3 + (index % 5) },
      );
    }

    const plan = planAi(
      simulation.state,
      config,
      createAiMemory(config, AI_SEED),
    );
    expect(
      plan.trace.candidates.some(
        ({ action }) => action.type === "buildBarracks",
      ),
    ).toBe(false);
    const pauses = plan.actions.filter(
      (action) => action.type === "setProductionPaused" && action.paused,
    );
    expect(new Set(pauses.map((action) => action.buildingId))).toEqual(
      new Set(barracks.map((building) => building.id)),
    );
    assertPrimaryActionLegal(plan.primaryAction, simulation.state, config);
  });

  it("falls back legally with no money/cells and abandons a destroyed goal", () => {
    const config = configForTest();
    const simulation = startedSimulation(config);
    simulation.state.players.red.gold = 0;
    restrictBuildCells(simulation.state, []);
    const memory = createAiMemory(config, AI_SEED);
    memory.committedGoal = "upgrade";
    memory.committedAction = {
      type: "upgrade",
      buildingId: "already-destroyed",
    };
    memory.commitUntil = 999;

    const plan = planAi(simulation.state, config, memory);
    expect(plan.trace.interruptionReason).toBe("target-invalid");
    expect(plan.primaryAction.type).toBe("wait");
    expect(plan.trace.goalAction.type).toBe("wait");
    expect(plan.reserveGold).toBe(0);
    assertPrimaryActionLegal(plan.primaryAction, simulation.state, config);
  });
});

describe("AI performance and long-run acceptance", () => {
  it("keeps a 40v40 plan bounded and under the planning latency budget", () => {
    const config = configForTest((mutable) => {
      mutable.unitCap = 40;
    });
    const simulation = startedSimulation(config);
    for (let index = 0; index < 40; index += 1) {
      const col = index % config.board.columns;
      addUnit(
        simulation.state,
        config,
        `perf-red-${index}`,
        "red",
        UNIT_TYPES[index % UNIT_TYPES.length],
        { col, row: 2 + (index % 3) },
      );
      addUnit(
        simulation.state,
        config,
        `perf-blue-${index}`,
        "blue",
        UNIT_TYPES[(index + 1) % UNIT_TYPES.length],
        { col, row: 7 + (index % 3) },
      );
    }
    const planner = new AiPlanner(config);
    const memory = createAiMemory(config, AI_SEED);
    for (let index = 0; index < 10; index += 1) {
      planner.plan(simulation.state, memory);
    }

    const samples: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const startedAt = performance.now();
      const plan = planner.plan(simulation.state, memory);
      samples.push(performance.now() - startedAt);
      expect(plan.trace.nodeCount).toBeLessThanOrEqual(256);
    }
    samples.sort((left, right) => left - right);
    const percentile95 = samples[Math.ceil(samples.length * 0.95) - 1];
    expect(percentile95).toBeLessThanOrEqual(16);
  });

  it("survives a 300-second seeded replay with valid state and progress", () => {
    const config = configForTest((mutable) => {
      mutable.aiEnabled = true;
      mutable.startingGold = 500;
    });
    const simulation = startedSimulation(config);
    const blueCity = simulation.getCity("blue");
    const blueBuildCells = hexNeighbors(
      blueCity,
      config.board.columns,
      config.board.rows,
    ).slice(0, UNIT_TYPES.length);
    for (let index = 0; index < UNIT_TYPES.length; index += 1) {
      expect(
        simulation.command({
          type: "buildBarracks",
          player: "blue",
          coord: blueBuildCells[index],
          unitType: UNIT_TYPES[index],
        }).ok,
      ).toBe(true);
    }
    const initialRevision = simulation.state.revision;
    const fingerprints = new Set<string>();
    const requestedSeconds = 300;
    const steps = Math.ceil(requestedSeconds / config.fixedStep);

    for (let index = 0; index < steps; index += 1) {
      simulation.update(config.fixedStep);
      if (index % Math.max(1, Math.round(1 / config.fixedStep)) !== 0) {
        continue;
      }
      const state = simulation.state;
      fingerprints.add(
        [
          state.elapsed.toFixed(1),
          state.players.red.gold.toFixed(2),
          Object.keys(state.buildings).length,
          Object.keys(state.units).length,
          state.winner ?? "playing",
        ].join("|"),
      );
      expect(Number.isFinite(state.elapsed)).toBe(true);
      for (const player of ["blue", "red"] as const) {
        expect(Number.isFinite(state.players[player].gold)).toBe(true);
        expect(state.players[player].gold).toBeGreaterThanOrEqual(-1e-8);
        expect(
          Object.values(state.units).filter((unit) => unit.owner === player)
            .length,
        ).toBeLessThanOrEqual(config.unitCap);
      }

      const occupied = new Set<string>();
      for (const building of Object.values(state.buildings)) {
        const key = hexKey(building);
        expect(occupied.has(key)).toBe(false);
        occupied.add(key);
        expect(Number.isFinite(building.hp)).toBe(true);
        expect(Number.isFinite(building.cooldown)).toBe(true);
        expect(building.level).toBeGreaterThanOrEqual(1);
        expect(building.level).toBeLessThanOrEqual(
          config.buildings[building.kind].levels.length,
        );
        expect(state.cells[key]?.buildingId).toBe(building.id);
        if (building.production) {
          expect(Number.isFinite(building.production.remaining)).toBe(true);
          expect(Number.isFinite(building.production.duration)).toBe(true);
          expect(building.production.remaining).toBeGreaterThanOrEqual(-1e-8);
          expect(building.production.duration).toBeGreaterThan(0);
        }
      }
      for (const unit of Object.values(state.units)) {
        expect(UNIT_TYPES).toContain(unit.unitType);
        expect(Number.isFinite(unit.hp)).toBe(true);
        expect(Number.isFinite(unit.cooldown)).toBe(true);
        expect(Number.isFinite(unit.moveProgress)).toBe(true);
        expect(unit.level).toBeGreaterThanOrEqual(1);
        expect(unit.level).toBeLessThanOrEqual(
          config.units[unit.unitType].levels.length,
        );
      }
    }

    expect(simulation.state.revision).toBeGreaterThan(initialRevision);
    expect(fingerprints.size).toBeGreaterThan(1);
    expect(
      simulation.state.players.red.stats.buildingsBuilt +
        simulation.state.players.red.stats.unitsProduced,
    ).toBeGreaterThan(0);
    expect(
      simulation.state.winner !== null ||
        simulation.state.elapsed >= requestedSeconds - config.fixedStep * 2,
    ).toBe(true);
  });
});
