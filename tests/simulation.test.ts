import { describe, expect, it } from "vitest";
import { createConfig, DEFAULT_CONFIG } from "../src/game/config";
import { hexNeighbors } from "../src/game/hex";
import { GameSimulation } from "../src/game/simulation";
import type { GameConfig, HexCoord } from "../src/game/types";

function advance(simulation: GameSimulation, seconds: number): void {
  const steps = Math.ceil(seconds / 0.1);
  for (let index = 0; index < steps; index += 1) {
    simulation.update(0.1);
  }
}

function createSimulation(overrides: Partial<GameConfig> = {}): GameSimulation {
  const simulation = new GameSimulation(createConfig({ aiEnabled: false, ...overrides }));
  simulation.start();
  return simulation;
}

function cityNeighbor(simulation: GameSimulation, player: "blue" | "red", index = 0): HexCoord {
  const city = simulation.getCity(player);
  return hexNeighbors(
    city,
    simulation.config.board.columns,
    simulation.config.board.rows,
  )[index];
}

describe("GameSimulation economy and construction", () => {
  it("adds base and mine income over time", () => {
    const simulation = createSimulation();
    advance(simulation, 1);
    expect(simulation.state.players.blue.gold).toBeCloseTo(124, 5);

    const target = cityNeighbor(simulation, "blue");
    expect(
      simulation.command({ type: "build", player: "blue", kind: "mine", coord: target }).ok,
    ).toBe(true);
    advance(simulation, 1);
    expect(simulation.getIncomeRate("blue")).toBe(7);
    expect(simulation.state.players.blue.gold).toBeCloseTo(71, 5);
  });

  it("only builds on connected empty cells and charges configured prices", () => {
    const simulation = createSimulation();
    const remote = { col: 0, row: 0 };
    expect(
      simulation.command({ type: "build", player: "blue", kind: "mine", coord: remote }),
    ).toMatchObject({ ok: false });

    const target = cityNeighbor(simulation, "blue");
    expect(
      simulation.command({ type: "build", player: "blue", kind: "mine", coord: target }),
    ).toEqual({ ok: true });
    expect(simulation.state.players.blue.gold).toBe(60);
    expect(simulation.state.cells[`${target.col},${target.row}`].owner).toBe("blue");
  });

  it("upgrades buildings to level three and applies new production", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    const target = cityNeighbor(simulation, "blue");
    simulation.command({ type: "build", player: "blue", kind: "mine", coord: target });
    const mine = Object.values(simulation.state.buildings).find(
      (building) => building.kind === "mine" && building.owner === "blue",
    );
    expect(mine).toBeDefined();
    if (!mine) return;

    expect(simulation.command({ type: "upgrade", player: "blue", buildingId: mine.id }).ok).toBe(
      true,
    );
    expect(simulation.command({ type: "upgrade", player: "blue", buildingId: mine.id }).ok).toBe(
      true,
    );
    expect(mine.level).toBe(3);
    expect(mine.hp).toBe(DEFAULT_CONFIG.buildings.mine.levels[2].maxHp);
    expect(simulation.getIncomeRate("blue")).toBe(14);
    expect(simulation.command({ type: "upgrade", player: "blue", buildingId: mine.id }).ok).toBe(
      false,
    );
  });
});

describe("GameSimulation units and combat", () => {
  it("locks the trained unit level when it enters the queue", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    const target = cityNeighbor(simulation, "blue");
    simulation.command({ type: "build", player: "blue", kind: "barracks", coord: target });
    const barracks = Object.values(simulation.state.buildings).find(
      (building) => building.kind === "barracks" && building.owner === "blue",
    );
    expect(barracks).toBeDefined();
    if (!barracks) return;

    simulation.command({
      type: "enqueueUnit",
      player: "blue",
      buildingId: barracks.id,
      unitType: "infantry",
    });
    simulation.command({ type: "upgrade", player: "blue", buildingId: barracks.id });
    advance(simulation, 3.1);
    const firstUnit = Object.values(simulation.state.units)[0];
    expect(firstUnit.level).toBe(1);

    simulation.command({
      type: "enqueueUnit",
      player: "blue",
      buildingId: barracks.id,
      unitType: "infantry",
    });
    advance(simulation, 3.1);
    const levels = Object.values(simulation.state.units).map((unit) => unit.level);
    expect(levels).toContain(2);
  });

  it("supports multiple unit definitions through configuration", () => {
    const simulation = createSimulation({
      startingGold: 1000,
      units: {
        ...DEFAULT_CONFIG.units,
        archer: {
          id: "archer",
          label: "弓手",
          cost: 30,
          trainTime: 1,
          levels: [
            { maxHp: 70, damage: 20, speed: 1.1, attackInterval: 1 },
            { maxHp: 95, damage: 28, speed: 1.1, attackInterval: 0.9 },
            { maxHp: 130, damage: 40, speed: 1.15, attackInterval: 0.8 },
          ],
        },
      },
    });
    const target = cityNeighbor(simulation, "blue");
    simulation.command({ type: "build", player: "blue", kind: "barracks", coord: target });
    const barracks = Object.values(simulation.state.buildings).find(
      (building) => building.kind === "barracks" && building.owner === "blue",
    );
    if (!barracks) throw new Error("Missing barracks");

    expect(
      simulation.command({
        type: "enqueueUnit",
        player: "blue",
        buildingId: barracks.id,
        unitType: "archer",
      }).ok,
    ).toBe(true);
    advance(simulation, 1.1);
    expect(Object.values(simulation.state.units)[0].unitType).toBe("archer");
  });

  it("lets units capture empty cells while marching", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    const target = cityNeighbor(simulation, "blue");
    simulation.command({ type: "build", player: "blue", kind: "barracks", coord: target });
    const barracks = Object.values(simulation.state.buildings).find(
      (building) => building.kind === "barracks" && building.owner === "blue",
    );
    if (!barracks) throw new Error("Missing barracks");
    simulation.command({
      type: "enqueueUnit",
      player: "blue",
      buildingId: barracks.id,
      unitType: "infantry",
    });
    advance(simulation, 8);
    const ownedCells = Object.values(simulation.state.cells).filter(
      (cell) => cell.owner === "blue",
    );
    expect(ownedCells.length).toBeGreaterThan(2);
  });

  it("applies tower damage to enemy units in range", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    const blueTarget = cityNeighbor(simulation, "blue");
    const redTarget = cityNeighbor(simulation, "red");
    simulation.command({
      type: "build",
      player: "blue",
      kind: "barracks",
      coord: blueTarget,
    });
    simulation.command({ type: "build", player: "red", kind: "tower", coord: redTarget });
    const barracks = Object.values(simulation.state.buildings).find(
      (building) => building.kind === "barracks" && building.owner === "blue",
    );
    if (!barracks) throw new Error("Missing barracks");
    simulation.command({
      type: "enqueueUnit",
      player: "blue",
      buildingId: barracks.id,
      unitType: "infantry",
    });
    advance(simulation, 14);
    const unit = Object.values(simulation.state.units).find((candidate) => candidate.owner === "blue");
    expect(unit === undefined || unit.hp < simulation.getUnitMaxHp(unit)).toBe(true);
  });

  it("ends the match when a city is destroyed", () => {
    const boostedUnits = {
      infantry: {
        ...DEFAULT_CONFIG.units.infantry,
        trainTime: 0.1,
        levels: [
          { maxHp: 500, damage: 500, speed: 4, attackInterval: 0.1 },
          { maxHp: 600, damage: 600, speed: 4, attackInterval: 0.1 },
          { maxHp: 700, damage: 700, speed: 4, attackInterval: 0.1 },
        ],
      },
    };
    const simulation = createSimulation({ startingGold: 1000, units: boostedUnits });
    const target = cityNeighbor(simulation, "blue");
    simulation.command({ type: "build", player: "blue", kind: "barracks", coord: target });
    const barracks = Object.values(simulation.state.buildings).find(
      (building) => building.kind === "barracks" && building.owner === "blue",
    );
    if (!barracks) throw new Error("Missing barracks");
    simulation.command({
      type: "enqueueUnit",
      player: "blue",
      buildingId: barracks.id,
      unitType: "infantry",
    });
    advance(simulation, 10);
    expect(simulation.state.winner).toBe("blue");
    expect(simulation.state.paused).toBe(true);
  });
});

describe("GameSimulation AI", () => {
  it("uses normal commands without overspending and develops an economy and army", () => {
    const simulation = new GameSimulation(createConfig({ startingGold: 120, aiEnabled: true }));
    simulation.start();
    advance(simulation, 25);
    const redBuildings = Object.values(simulation.state.buildings).filter(
      (building) => building.owner === "red",
    );
    expect(simulation.state.players.red.gold).toBeGreaterThanOrEqual(0);
    expect(redBuildings.some((building) => building.kind === "mine")).toBe(true);
    expect(redBuildings.some((building) => building.kind === "barracks")).toBe(true);
    expect(simulation.state.players.red.stats.unitsProduced).toBeGreaterThan(0);
  });
});

