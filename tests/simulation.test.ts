import { describe, expect, it } from "vitest";
import { createConfig, DEFAULT_CONFIG, UNIT_TYPES } from "../src/game/config";
import { hexDistance, hexNeighbors } from "../src/game/hex";
import { GameSimulation } from "../src/game/simulation";
import type {
  BuildingState,
  GameConfig,
  HexCoord,
  PlayerId,
  UnitState,
  UnitType,
} from "../src/game/types";

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

function cityNeighbor(
  simulation: GameSimulation,
  player: PlayerId,
  index = 0,
): HexCoord {
  const city = simulation.getCity(player);
  return hexNeighbors(
    city,
    simulation.config.board.columns,
    simulation.config.board.rows,
  )[index];
}

function buildBarracks(
  simulation: GameSimulation,
  unitType: UnitType = "warrior",
  player: PlayerId = "blue",
  neighborIndex = 0,
): BuildingState {
  const target = cityNeighbor(simulation, player, neighborIndex);
  expect(
    simulation.command({ type: "buildBarracks", player, unitType, coord: target }).ok,
  ).toBe(true);
  const barracks = Object.values(simulation.state.buildings).find(
    (building) =>
      building.kind === "barracks" &&
      building.owner === player &&
      building.autoUnitType === unitType &&
      building.col === target.col &&
      building.row === target.row,
  );
  if (!barracks) {
    throw new Error("Missing barracks");
  }
  return barracks;
}

function addUnit(
  simulation: GameSimulation,
  id: string,
  owner: PlayerId,
  unitType: UnitType,
  coord: HexCoord,
  level = 1,
): UnitState {
  const stats = simulation.config.units[unitType].levels[level - 1];
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
  simulation.state.units[id] = unit;
  return unit;
}

describe("three-unit configuration", () => {
  it("contains only warrior, archer, and siege with the designed values", () => {
    expect(Object.keys(DEFAULT_CONFIG.units)).toEqual(UNIT_TYPES);
    expect(DEFAULT_CONFIG.units.warrior).toMatchObject({
      label: "战士",
      summary: "高血前排",
      cost: 36,
      trainTime: 3.2,
      levels: [
        { maxHp: 125, damage: 8, range: 1, speed: 1.05, attackInterval: 0.95, structureDamageMultiplier: 0.6 },
        { maxHp: 190, damage: 12, range: 1, speed: 1.08, attackInterval: 0.9, structureDamageMultiplier: 0.6 },
        { maxHp: 280, damage: 18, range: 1, speed: 1.1, attackInterval: 0.85, structureDamageMultiplier: 0.65 },
      ],
    });
    expect(DEFAULT_CONFIG.units.archer).toMatchObject({
      label: "射手",
      summary: "远程高攻",
      cost: 44,
      trainTime: 4,
      levels: [
        { maxHp: 42, damage: 18, range: 2, speed: 0.95, attackInterval: 1, structureDamageMultiplier: 0.3 },
        { maxHp: 64, damage: 27, range: 2, speed: 1, attackInterval: 0.95, structureDamageMultiplier: 0.3 },
        { maxHp: 96, damage: 40, range: 2, speed: 1.05, attackInterval: 0.9, structureDamageMultiplier: 0.3 },
      ],
    });
    expect(DEFAULT_CONFIG.units.siege).toMatchObject({
      label: "攻城兵",
      summary: "建筑克星",
      cost: 60,
      trainTime: 5.5,
      levels: [
        { maxHp: 80, damage: 6, range: 1, speed: 0.75, attackInterval: 1.25, structureDamageMultiplier: 5 },
        { maxHp: 120, damage: 9, range: 1, speed: 0.8, attackInterval: 1.2, structureDamageMultiplier: 5.2 },
        { maxHp: 180, damage: 13, range: 1, speed: 0.85, attackInterval: 1.15, structureDamageMultiplier: 5.4 },
      ],
    });
  });

  it("keeps siege building DPS at least four times higher than the other units", () => {
    for (let level = 0; level < 3; level += 1) {
      const buildingDps = UNIT_TYPES.map((unitType) => {
        const stats = DEFAULT_CONFIG.units[unitType].levels[level];
        return (stats.damage * stats.structureDamageMultiplier) / stats.attackInterval;
      });
      expect(buildingDps[2] / Math.max(buildingDps[0], buildingDps[1])).toBeGreaterThanOrEqual(4);
      expect(
        DEFAULT_CONFIG.units.archer.levels[level].damage /
          DEFAULT_CONFIG.units.archer.levels[level].attackInterval,
      ).toBeGreaterThan(
        DEFAULT_CONFIG.units.warrior.levels[level].damage /
          DEFAULT_CONFIG.units.warrior.levels[level].attackInterval,
      );
    }
  });
});

describe("GameSimulation economy and construction", () => {
  it("adds base and mine income over time", () => {
    const simulation = createSimulation();
    advance(simulation, 1);
    expect(simulation.state.players.blue.gold).toBeCloseTo(122, 5);

    const target = cityNeighbor(simulation, "blue");
    expect(
      simulation.command({ type: "build", player: "blue", kind: "mine", coord: target }).ok,
    ).toBe(true);
    advance(simulation, 1);
    expect(simulation.getIncomeRate("blue")).toBe(4);
    expect(simulation.state.players.blue.gold).toBeCloseTo(66, 5);
  });

  it("uses fixed unit caps, production durations, and building durability", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    expect(simulation.getUnitCap()).toBe(40);
    expect(simulation.getProductionDuration("warrior")).toBe(3.2);
    expect(simulation.getBuildingMaxHp(simulation.getCity("blue"))).toBe(1000);

    const barracks = buildBarracks(simulation);
    expect(barracks.autoUnitType).toBe("warrior");
    expect(simulation.getBuildingMaxHp(barracks)).toBe(240);
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

    expect(simulation.command({ type: "upgrade", player: "blue", buildingId: mine.id }).ok).toBe(true);
    expect(simulation.command({ type: "upgrade", player: "blue", buildingId: mine.id }).ok).toBe(true);
    expect(mine.level).toBe(3);
    expect(mine.hp).toBe(simulation.getBuildingMaxHp(mine));
    expect(simulation.getIncomeRate("blue")).toBe(10);
    expect(simulation.command({ type: "upgrade", player: "blue", buildingId: mine.id }).ok).toBe(false);
  });

  it("allows either player to build any of the three specialized barracks", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    for (const [index, unitType] of UNIT_TYPES.entries()) {
      expect(buildBarracks(simulation, unitType, "blue", index).autoUnitType).toBe(unitType);
    }
  });
});

describe("automatic barracks production", () => {
  it("pauses for gold, then automatically starts when income is enough", () => {
    const simulation = createSimulation({ startingGold: 82 });
    const barracks = buildBarracks(simulation);
    advance(simulation, 0.2);
    expect(barracks.production?.paid).toBe(false);
    expect(barracks.production?.pauseReason).toBe("gold");

    advance(simulation, 18);
    expect(barracks.production?.paid).toBe(true);
    expect(barracks.production?.pauseReason).toBeNull();
  });

  it("finishes the paid cycle, then pauses without charging another cycle", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    const barracks = buildBarracks(simulation);
    advance(simulation, 0.1);
    expect(barracks.production?.paid).toBe(true);
    expect(1000 + simulation.state.players.blue.stats.incomeEarned - simulation.state.players.blue.gold).toBeCloseTo(116, 5);

    simulation.command({
      type: "setBarracksProductionPaused",
      player: "blue",
      buildingId: barracks.id,
      paused: true,
    });
    expect(barracks.productionMode).toBe("pauseAfterCurrent");
    advance(simulation, 5);
    expect(barracks.productionMode).toBe("paused");
    expect(barracks.production).toBeNull();
    expect(Object.values(simulation.state.units).filter((unit) => unit.owner === "blue")).toHaveLength(1);

    simulation.command({
      type: "setBarracksProductionPaused",
      player: "blue",
      buildingId: barracks.id,
      paused: false,
    });
    advance(simulation, 0.1);
    expect(barracks.productionMode).toBe("running");
    expect(barracks.production?.paid).toBe(true);
  });

  it("pauses an unpaid cycle immediately and waits to charge until resumed", () => {
    const simulation = createSimulation({ startingGold: 82 });
    const barracks = buildBarracks(simulation);
    advance(simulation, 0.1);
    expect(barracks.production?.paid).toBe(false);

    simulation.command({
      type: "setBarracksProductionPaused",
      player: "blue",
      buildingId: barracks.id,
      paused: true,
    });
    expect(barracks.productionMode).toBe("paused");
    advance(simulation, 20);
    expect(barracks.production?.paid).toBe(false);

    simulation.command({
      type: "setBarracksProductionPaused",
      player: "blue",
      buildingId: barracks.id,
      paused: false,
    });
    advance(simulation, 0.1);
    expect(barracks.production?.paid).toBe(true);
  });

  it("pauses only the selected barracks", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    const warriorBarracks = buildBarracks(simulation, "warrior", "blue", 0);
    const archerBarracks = buildBarracks(simulation, "archer", "blue", 1);
    advance(simulation, 0.1);

    simulation.command({
      type: "setBarracksProductionPaused",
      player: "blue",
      buildingId: warriorBarracks.id,
      paused: true,
    });
    advance(simulation, 5);
    expect(warriorBarracks.productionMode).toBe("paused");
    expect(archerBarracks.productionMode).toBe("running");
    expect(Object.values(simulation.state.units).some((unit) => unit.unitType === "archer")).toBe(true);
  });

  it("locks the current production level and applies upgrades to the next cycle", () => {
    const simulation = createSimulation({ startingGold: 1000 });
    const barracks = buildBarracks(simulation);
    advance(simulation, 0.2);
    expect(barracks.production?.level).toBe(1);

    simulation.command({ type: "upgrade", player: "blue", buildingId: barracks.id });
    advance(simulation, 3.3);
    expect(Object.values(simulation.state.units)[0].level).toBe(1);

    advance(simulation, 0.2);
    expect(barracks.production?.level).toBe(2);
    advance(simulation, 3.3);
    expect(Object.values(simulation.state.units).map((unit) => unit.level)).toContain(2);
  });

  it("pauses on the unit cap and resumes after a slot opens", () => {
    const simulation = createSimulation({ startingGold: 1000, unitCap: 1 });
    const barracks = buildBarracks(simulation);
    advance(simulation, 4);
    const firstUnit = Object.values(simulation.state.units).find((unit) => unit.owner === "blue");
    expect(firstUnit).toBeDefined();

    advance(simulation, 0.2);
    expect(barracks.production?.paid).toBe(false);
    expect(barracks.production?.pauseReason).toBe("unitCap");
    if (firstUnit) delete simulation.state.units[firstUnit.id];
    advance(simulation, 0.2);
    expect(barracks.production?.paid).toBe(true);
  });
});

describe("unit roles and combat", () => {
  it("lets a warrior survive the archer first strike and win an equal-level duel", () => {
    const simulation = createSimulation();
    const warrior = addUnit(simulation, "blue-warrior", "blue", "warrior", { col: 4, row: 7 });
    const archer = addUnit(simulation, "red-archer", "red", "archer", { col: 4, row: 5 });
    expect(hexDistance(warrior, archer)).toBe(2);
    advance(simulation, 7);
    expect(simulation.state.units[archer.id]).toBeUndefined();
    expect(simulation.state.units[warrior.id]?.hp).toBeGreaterThan(0);
  });

  it("makes siege lose direct duels against both field units", () => {
    for (const opponentType of ["warrior", "archer"] as const) {
      const simulation = createSimulation();
      const siege = addUnit(simulation, `blue-siege-${opponentType}`, "blue", "siege", { col: 4, row: 7 });
      const enemy = addUnit(
        simulation,
        `red-${opponentType}`,
        "red",
        opponentType,
        { col: 4, row: opponentType === "archer" ? 5 : 6 },
      );
      advance(simulation, 14);
      expect(simulation.state.units[siege.id]).toBeUndefined();
      expect(simulation.state.units[enemy.id]?.hp).toBeGreaterThan(0);
    }
  });

  it("requires a warrior escort for one siege unit to break a level-one tower", () => {
    const solo = createSimulation({ startingGold: 1000 });
    const soloTowerCoord = cityNeighbor(solo, "red");
    solo.command({ type: "build", player: "red", kind: "tower", coord: soloTowerCoord });
    const soloTower = Object.values(solo.state.buildings).find((building) => building.kind === "tower");
    expect(soloTower).toBeDefined();
    const soloSiege = addUnit(solo, "solo-siege", "blue", "siege", soloTowerCoord);
    advance(solo, 5);
    expect(solo.state.units[soloSiege.id]).toBeUndefined();
    expect(soloTower && solo.state.buildings[soloTower.id]).toBeDefined();

    const escorted = createSimulation({ startingGold: 1000 });
    const towerCoord = cityNeighbor(escorted, "red");
    escorted.command({ type: "build", player: "red", kind: "tower", coord: towerCoord });
    const tower = Object.values(escorted.state.buildings).find((building) => building.kind === "tower");
    expect(tower).toBeDefined();
    addUnit(escorted, "escort-warrior", "blue", "warrior", towerCoord);
    addUnit(escorted, "escorted-siege", "blue", "siege", towerCoord);
    advance(escorted, 14);
    expect(tower && escorted.state.buildings[tower.id]).toBeUndefined();
  });

  it("lets ranged units attack from two cells away", () => {
    const simulation = createSimulation();
    const archer = addUnit(simulation, "blue-archer", "blue", "archer", { col: 4, row: 7 });
    const warrior = addUnit(simulation, "red-warrior", "red", "warrior", { col: 4, row: 5 });
    expect(hexDistance(archer, warrior)).toBe(2);
    advance(simulation, 0.1);
    expect(warrior.hp).toBeLessThan(DEFAULT_CONFIG.units.warrior.levels[0].maxHp);
  });

  it("attacks a closer building before a farther enemy unit", () => {
    const simulation = createSimulation();
    const redCity = simulation.getCity("red");
    const attacker = addUnit(
      simulation,
      "nearest-building-archer",
      "blue",
      "archer",
      cityNeighbor(simulation, "red"),
    );
    const fartherCell = Object.values(simulation.state.cells).find(
      (cell) => hexDistance(attacker, cell) === 2,
    );
    if (!fartherCell) throw new Error("Missing farther target cell");
    const enemy = addUnit(
      simulation,
      "farther-warrior",
      "red",
      "warrior",
      { col: fartherCell.col, row: fartherCell.row },
    );
    const cityHp = redCity.hp;
    advance(simulation, 0.1);

    expect(redCity.hp).toBeLessThan(cityHp);
    expect(enemy.hp).toBe(DEFAULT_CONFIG.units.warrior.levels[0].maxHp);
  });

  it("attacks a closer enemy unit before a farther building", () => {
    const simulation = createSimulation();
    const redCity = simulation.getCity("red");
    const attackerCell = Object.values(simulation.state.cells).find(
      (cell) => hexDistance(redCity, cell) === 2,
    );
    if (!attackerCell) throw new Error("Missing attacker cell");
    const attacker = addUnit(
      simulation,
      "nearest-unit-archer",
      "blue",
      "archer",
      { col: attackerCell.col, row: attackerCell.row },
    );
    const enemyCell = Object.values(simulation.state.cells).find(
      (cell) =>
        hexDistance(attacker, cell) === 1 &&
        (cell.col !== redCity.col || cell.row !== redCity.row),
    );
    if (!enemyCell) throw new Error("Missing nearer enemy cell");
    const enemy = addUnit(
      simulation,
      "nearer-warrior",
      "red",
      "warrior",
      { col: enemyCell.col, row: enemyCell.row },
    );
    expect(hexDistance(attacker, enemy)).toBe(1);
    expect(hexDistance(attacker, redCity)).toBe(2);
    const cityHp = redCity.hp;
    advance(simulation, 0.2);

    expect({ enemyHp: enemy.hp, cityHp: redCity.hp }).toEqual({
      enemyHp: DEFAULT_CONFIG.units.warrior.levels[0].maxHp -
        DEFAULT_CONFIG.units.archer.levels[0].damage,
      cityHp,
    });
  });

  it("prefers an enemy unit when a unit and building are equally close", () => {
    const simulation = createSimulation();
    const redCity = simulation.getCity("red");
    const attacker = addUnit(
      simulation,
      "tie-break-archer",
      "blue",
      "archer",
      cityNeighbor(simulation, "red"),
    );
    const enemy = addUnit(
      simulation,
      "tie-break-warrior",
      "red",
      "warrior",
      { col: redCity.col, row: redCity.row },
    );
    expect(hexDistance(attacker, enemy)).toBe(hexDistance(attacker, redCity));
    const cityHp = redCity.hp;
    advance(simulation, 0.1);

    expect(enemy.hp).toBeLessThan(DEFAULT_CONFIG.units.warrior.levels[0].maxHp);
    expect(redCity.hp).toBe(cityHp);
  });

  it("ends the match when a city is destroyed", () => {
    const boostedUnits = {
      ...DEFAULT_CONFIG.units,
      siege: {
        ...DEFAULT_CONFIG.units.siege,
        trainTime: 0.1,
        levels: DEFAULT_CONFIG.units.siege.levels.map((level) => ({
          ...level,
          maxHp: 700,
          damage: 500,
          speed: 4,
          attackInterval: 0.1,
          structureDamageMultiplier: 3,
        })),
      },
    };
    const simulation = createSimulation({ startingGold: 1000, units: boostedUnits });
    buildBarracks(simulation, "siege");
    advance(simulation, 10);
    expect(simulation.state.winner).toBe("blue");
    expect(simulation.state.paused).toBe(true);
  });
});

describe("GameSimulation adaptive AI", () => {
  it("keeps the first barracks running and fields an army before expanding", () => {
    const simulation = new GameSimulation(createConfig({ aiEnabled: true }));
    simulation.start();
    advance(simulation, 45);
    const redBarracks = Object.values(simulation.state.buildings).filter(
      (building) => building.owner === "red" && building.kind === "barracks",
    );
    const redUnits = Object.values(simulation.state.units).filter(
      (unit) => unit.owner === "red",
    );
    expect(redBarracks).toHaveLength(1);
    expect(redBarracks[0].autoUnitType).toBe("warrior");
    expect(redBarracks[0].productionMode).toBe("running");
    expect(simulation.state.players.red.stats.unitsProduced).toBeGreaterThanOrEqual(3);
    expect(redUnits.length).toBeGreaterThanOrEqual(3);
    expect(simulation.state.players.red.gold).toBeGreaterThanOrEqual(0);
  });

  it("answers a warrior-heavy army with an archer barracks", () => {
    const simulation = new GameSimulation(
      createConfig({ startingGold: 1000, aiDecisionInterval: 0.1, aiEnabled: true }),
    );
    for (let index = 0; index < 4; index += 1) {
      addUnit(simulation, `blue-warrior-${index}`, "blue", "warrior", { col: 2 + index, row: 8 });
    }
    simulation.start();
    advance(simulation, 15);
    const redTypes = Object.values(simulation.state.buildings)
      .filter((building) => building.owner === "red" && building.kind === "barracks")
      .map((building) => building.autoUnitType);
    expect(redTypes[0]).toBe("warrior");
    expect(redTypes).toContain("archer");
  });

  it("answers player defenses with a siege barracks", () => {
    const simulation = new GameSimulation(
      createConfig({ startingGold: 1000, aiDecisionInterval: 0.1, aiEnabled: true }),
    );
    simulation.state.players.blue.gold = 1000;
    simulation.start();
    simulation.command({
      type: "build",
      player: "blue",
      kind: "tower",
      coord: cityNeighbor(simulation, "blue"),
    });
    advance(simulation, 15);
    const redTypes = Object.values(simulation.state.buildings)
      .filter((building) => building.owner === "red" && building.kind === "barracks")
      .map((building) => building.autoUnitType);
    expect(redTypes[0]).toBe("warrior");
    expect(redTypes).toContain("siege");
    expect(simulation.state.players.red.gold).toBeGreaterThanOrEqual(0);
  });

  it("keeps a scripted mixed-army match within the three-to-five-minute target", () => {
    const simulation = new GameSimulation(createConfig({ aiEnabled: true }));
    simulation.start();
    const goals: Array<
      | { kind: "mine" | "tower" }
      | { kind: "barracks"; unitType: UnitType }
    > = [
      { kind: "mine" },
      { kind: "barracks", unitType: "warrior" },
      { kind: "mine" },
      { kind: "barracks", unitType: "archer" },
      { kind: "mine" },
      { kind: "barracks", unitType: "siege" },
      { kind: "tower" },
    ];
    let goalIndex = 0;

    while (!simulation.state.winner && simulation.state.elapsed < 300) {
      const goal = goals[goalIndex];
      const blueBarracks = Object.values(simulation.state.buildings).filter(
        (building) => building.owner === "blue" && building.kind === "barracks",
      );
      if (goal) {
        const cost = simulation.config.buildings[goal.kind].buildCost;
        if (simulation.state.players.blue.gold < cost) {
          for (const barracks of blueBarracks) {
            if (barracks.productionMode === "running") {
              simulation.command({
                type: "setBarracksProductionPaused",
                player: "blue",
                buildingId: barracks.id,
                paused: true,
              });
            }
          }
        } else {
          const coord = simulation.getValidBuildCells("blue")[0];
          const result = goal.kind === "barracks"
            ? simulation.command({
                type: "buildBarracks",
                player: "blue",
                unitType: goal.unitType,
                coord,
              })
            : simulation.command({ type: "build", player: "blue", kind: goal.kind, coord });
          if (result.ok) {
            goalIndex += 1;
            for (const barracks of blueBarracks) {
              simulation.command({
                type: "setBarracksProductionPaused",
                player: "blue",
                buildingId: barracks.id,
                paused: false,
              });
            }
          }
        }
      } else {
        for (const barracks of blueBarracks) {
          if (barracks.productionMode !== "running") {
            simulation.command({
              type: "setBarracksProductionPaused",
              player: "blue",
              buildingId: barracks.id,
              paused: false,
            });
          }
        }
      }
      simulation.update(0.1);
    }

    expect(goalIndex).toBe(goals.length);
    expect(simulation.state.winner).not.toBeNull();
    expect(simulation.state.elapsed).toBeGreaterThanOrEqual(180);
    expect(simulation.state.elapsed).toBeLessThanOrEqual(300);
  });
});
