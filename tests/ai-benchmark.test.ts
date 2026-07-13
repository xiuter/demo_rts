import { describe, expect, it } from "vitest";
import { createConfig } from "../src/game/config";
import { hexDistance } from "../src/game/hex";
import { GameSimulation } from "../src/game/simulation";
import type {
  BuildingState,
  GameConfig,
  HexCoord,
  UnitType,
} from "../src/game/types";

type BuildGoal =
  | { kind: "mine" | "tower"; placement: "back" | "forward" }
  | { kind: "barracks"; unitType: UnitType; placement: "back" | "forward" };

interface PlayerScript {
  name: string;
  seed: number;
  decide(simulation: GameSimulation): void;
}

interface MatchAudit {
  minimumGold: number;
  invalidNumbers: string[];
  duplicateBuildingCell: string | null;
}

interface MatchResult {
  name: string;
  seed: number;
  winner: "blue" | "red" | null;
  elapsed: number;
  audit: MatchAudit;
  checkpoints: MatchCheckpoint[];
}

interface MatchCheckpoint {
  elapsed: number;
  redGold: number;
  redIncome: number;
  cityHp: string;
  redBuildings: string;
  units: string;
  production: string;
  trace: string;
}

const MATCH_SAFETY_LIMIT_SECONDS = 240;
const SCRIPT_DECISION_INTERVAL_SECONDS = 1;

function coordinateKey(coord: HexCoord): string {
  return `${coord.col},${coord.row}`;
}

function blueBarracks(simulation: GameSimulation): BuildingState[] {
  return Object.values(simulation.state.buildings).filter(
    (building) => building.owner === "blue" && building.kind === "barracks",
  );
}

function setProductionPaused(simulation: GameSimulation, paused: boolean): void {
  for (const barracks of blueBarracks(simulation)) {
    const alreadyInRequestedState = paused
      ? barracks.productionMode === "paused" ||
        barracks.productionMode === "pauseAfterCurrent"
      : barracks.productionMode === "running";
    if (alreadyInRequestedState) {
      continue;
    }
    const result = simulation.command({
      type: "setBarracksProductionPaused",
      player: "blue",
      buildingId: barracks.id,
      paused,
    });
    expect(result.ok).toBe(true);
  }
}

function chooseBuildCell(
  simulation: GameSimulation,
  placement: "back" | "forward",
): HexCoord | null {
  const ownCity = simulation.getCity("blue");
  const enemyCity = simulation.getCity("red");
  const validCells = simulation.getValidBuildCells("blue");
  validCells.sort((left, right) => {
    const leftPrimary = placement === "forward"
      ? hexDistance(left, enemyCity)
      : hexDistance(left, ownCity);
    const rightPrimary = placement === "forward"
      ? hexDistance(right, enemyCity)
      : hexDistance(right, ownCity);
    return (
      leftPrimary - rightPrimary ||
      hexDistance(right, enemyCity) - hexDistance(left, enemyCity) ||
      left.row - right.row ||
      left.col - right.col
    );
  });
  return validCells[0] ?? null;
}

function goalCost(config: Readonly<GameConfig>, goal: BuildGoal): number {
  return config.buildings[goal.kind].buildCost;
}

function issueBuild(simulation: GameSimulation, goal: BuildGoal): boolean {
  const coord = chooseBuildCell(simulation, goal.placement);
  if (!coord) {
    return false;
  }
  const result = goal.kind === "barracks"
    ? simulation.command({
        type: "buildBarracks",
        player: "blue",
        coord,
        unitType: goal.unitType,
      })
    : simulation.command({
        type: "build",
        player: "blue",
        coord,
        kind: goal.kind,
      });
  return result.ok;
}

function createGoalScript(
  name: string,
  seed: number,
  goals: readonly BuildGoal[],
): PlayerScript {
  let nextGoal = 0;
  return {
    name,
    seed,
    decide(simulation) {
      const goal = goals[nextGoal];
      if (!goal) {
        setProductionPaused(simulation, false);
        return;
      }

      // These are intentionally simple scripts: finish a fixed opening in order,
      // pausing only unpaid production while saving for the next building.
      if (simulation.state.players.blue.gold + 1e-8 < goalCost(simulation.config, goal)) {
        setProductionPaused(simulation, true);
        return;
      }
      if (issueBuild(simulation, goal)) {
        nextGoal += 1;
        setProductionPaused(simulation, nextGoal < goals.length);
      }
    },
  };
}

function createScripts(): PlayerScript[] {
  return [
    { name: "idle", seed: 101, decide() {} },
    createGoalScript("warrior-rush", 211, [
      { kind: "barracks", unitType: "warrior", placement: "forward" },
    ]),
    createGoalScript("archer-mass", 307, [
      { kind: "barracks", unitType: "archer", placement: "forward" },
    ]),
    createGoalScript("siege-push", 401, [
      { kind: "barracks", unitType: "siege", placement: "forward" },
      { kind: "barracks", unitType: "warrior", placement: "forward" },
    ]),
    createGoalScript("greedy-economy", 503, [
      { kind: "mine", placement: "back" },
      { kind: "mine", placement: "back" },
      { kind: "mine", placement: "back" },
      { kind: "barracks", unitType: "warrior", placement: "forward" },
      { kind: "barracks", unitType: "archer", placement: "forward" },
      { kind: "barracks", unitType: "siege", placement: "forward" },
    ]),
    createGoalScript("tower-mixed", 601, [
      { kind: "tower", placement: "back" },
      { kind: "barracks", unitType: "warrior", placement: "forward" },
      { kind: "barracks", unitType: "archer", placement: "forward" },
      { kind: "barracks", unitType: "siege", placement: "forward" },
      { kind: "tower", placement: "back" },
    ]),
  ];
}

function recordFinite(
  audit: MatchAudit,
  label: string,
  values: readonly number[],
): void {
  if (values.some((value) => !Number.isFinite(value)) && !audit.invalidNumbers.includes(label)) {
    audit.invalidNumbers.push(label);
  }
}

function auditMatch(simulation: GameSimulation, audit: MatchAudit): void {
  for (const player of Object.values(simulation.state.players)) {
    audit.minimumGold = Math.min(audit.minimumGold, player.gold);
    recordFinite(audit, `player:${player.id}`, [
      player.gold,
      player.stats.buildingsBuilt,
      player.stats.incomeEarned,
      player.stats.unitsProduced,
    ]);
  }

  const occupied = new Set<string>();
  for (const building of Object.values(simulation.state.buildings)) {
    const key = coordinateKey(building);
    if (occupied.has(key) && audit.duplicateBuildingCell === null) {
      audit.duplicateBuildingCell = key;
    }
    occupied.add(key);
    recordFinite(audit, `building:${building.id}`, [
      building.col,
      building.row,
      building.level,
      building.hp,
      building.cooldown,
    ]);
    if (building.production) {
      recordFinite(audit, `production:${building.id}`, [
        building.production.level,
        building.production.remaining,
        building.production.duration,
      ]);
    }
  }

  for (const unit of Object.values(simulation.state.units)) {
    recordFinite(audit, `unit:${unit.id}`, [
      unit.col,
      unit.row,
      unit.level,
      unit.hp,
      unit.cooldown,
      unit.moveProgress,
    ]);
    if (unit.nextCell) {
      recordFinite(audit, `next-cell:${unit.id}`, [unit.nextCell.col, unit.nextCell.row]);
    }
  }
  recordFinite(audit, "battle", [simulation.state.elapsed, simulation.state.revision]);
}

function countByUnitType(
  simulation: GameSimulation,
  owner: "blue" | "red",
): Record<UnitType, number> {
  const counts: Record<UnitType, number> = { warrior: 0, archer: 0, siege: 0 };
  for (const unit of Object.values(simulation.state.units)) {
    if (unit.owner === owner) {
      counts[unit.unitType] += 1;
    }
  }
  return counts;
}

function describeAction(action: NonNullable<ReturnType<GameSimulation["getAiDecisionTrace"]>>["chosen"]): string {
  if (action.type === "build") {
    return `build-${action.kind}@${coordinateKey(action.coord)}`;
  }
  if (action.type === "buildBarracks") {
    return `build-${action.unitType}@${coordinateKey(action.coord)}`;
  }
  if (action.type === "upgrade") {
    return `upgrade-${action.buildingId}`;
  }
  return "wait";
}

function captureCheckpoint(simulation: GameSimulation): MatchCheckpoint {
  const redCounts = countByUnitType(simulation, "red");
  const blueCounts = countByUnitType(simulation, "blue");
  const redBuildings = Object.values(simulation.state.buildings).filter(
    (building) => building.owner === "red",
  );
  const barracks = redBuildings.filter((building) => building.kind === "barracks");
  const mines = redBuildings.filter((building) => building.kind === "mine").length;
  const towers = redBuildings.filter((building) => building.kind === "tower").length;
  const barracksTypes = ({ warrior: 0, archer: 0, siege: 0 } satisfies Record<UnitType, number>);
  for (const building of barracks) {
    if (building.autoUnitType) {
      barracksTypes[building.autoUnitType] += 1;
    }
  }
  const trace = simulation.getAiDecisionTrace();
  const barracksCandidates = trace?.candidates
    .filter((candidate) => candidate.action.type === "buildBarracks")
    .slice(0, 6)
    .map((candidate) =>
      `${candidate.action.type === "buildBarracks" ? candidate.action.unitType : "?"}:${candidate.score.toFixed(1)}`,
    )
    .join("/") ?? "none";
  return {
    elapsed: simulation.state.elapsed,
    redGold: simulation.state.players.red.gold,
    redIncome: simulation.getIncomeRate("red"),
    cityHp: `${simulation.getCity("red").hp.toFixed(0)}/${simulation.getCity("blue").hp.toFixed(0)}`,
    redBuildings: `m${mines} t${towers} b${barracksTypes.warrior}/${barracksTypes.archer}/${barracksTypes.siege}`,
    units: `r${redCounts.warrior}/${redCounts.archer}/${redCounts.siege} b${blueCounts.warrior}/${blueCounts.archer}/${blueCounts.siege}`,
    production: barracks
      .map((building) =>
        `${building.autoUnitType}:${building.productionMode}:${building.production?.paid ? "paid" : building.production?.pauseReason ?? "unpaid"}`,
      )
      .join("/") || "none",
    trace: trace
      ? `${trace.goal}:${describeAction(trace.chosen)} reserve=${trace.reserveGold.toFixed(0)} barracks=${barracksCandidates}`
      : "none",
  };
}

function describeCheckpoint(checkpoint: MatchCheckpoint): string {
  return [
    `${checkpoint.elapsed.toFixed(0)}s`,
    `gold=${checkpoint.redGold.toFixed(0)}`,
    `income=${checkpoint.redIncome.toFixed(0)}`,
    `city(red/blue)=${checkpoint.cityHp}`,
    `build=${checkpoint.redBuildings}`,
    `units=${checkpoint.units}`,
    `prod=${checkpoint.production}`,
    `trace=${checkpoint.trace}`,
  ].join(" ");
}

function runMatch(script: PlayerScript): MatchResult {
  const simulation = new GameSimulation(
    createConfig({ aiEnabled: true, aiSeed: script.seed }),
  );
  const audit: MatchAudit = {
    minimumGold: Number.POSITIVE_INFINITY,
    invalidNumbers: [],
    duplicateBuildingCell: null,
  };
  simulation.start();
  let nextScriptDecision = 0;
  let nextCheckpoint = 20;
  const checkpoints: MatchCheckpoint[] = [];
  const stepLimit = Math.ceil(
    MATCH_SAFETY_LIMIT_SECONDS / simulation.config.fixedStep,
  );

  for (let step = 0; !simulation.state.winner && step < stepLimit; step += 1) {
    if (simulation.state.elapsed + 1e-8 >= nextScriptDecision) {
      script.decide(simulation);
      nextScriptDecision += SCRIPT_DECISION_INTERVAL_SECONDS;
    }
    simulation.update(simulation.config.fixedStep);
    auditMatch(simulation, audit);
    if (simulation.state.elapsed + 1e-8 >= nextCheckpoint) {
      checkpoints.push(captureCheckpoint(simulation));
      nextCheckpoint += 20;
    }
  }

  return {
    name: script.name,
    seed: script.seed,
    winner: simulation.state.winner,
    elapsed: simulation.state.elapsed,
    audit,
    checkpoints,
  };
}

describe("default-config AI deterministic benchmark", () => {
  it("beats at least four of six naive public-command scripts fairly", () => {
    const results = createScripts().map(runMatch);
    const summary = results
      .map((result) =>
        `${result.name}(seed=${result.seed}):${result.winner ?? "safety-cap"}@${result.elapsed.toFixed(1)}s`,
      )
      .join(", ");
    const diagnostics = results
      .filter((result) => result.winner !== "red")
      .map((result) =>
        `${result.name} seed=${result.seed}\n  ${result.checkpoints.map(describeCheckpoint).join("\n  ")}`,
      )
      .join("\n");
    const failureMessage = `${summary}\n${diagnostics}`;

    for (const result of results) {
      expect(result.audit.minimumGold, failureMessage).toBeGreaterThanOrEqual(-1e-8);
      expect(result.audit.invalidNumbers, failureMessage).toEqual([]);
      expect(result.audit.duplicateBuildingCell, failureMessage).toBeNull();
    }

    const aiWins = results.filter((result) => result.winner === "red").length;
    expect(aiWins, failureMessage).toBeGreaterThanOrEqual(4);
  }, 15_000);
});
