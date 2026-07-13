import { AiPlanner, createAiMemory } from "./ai";
import { createConfig, UNIT_TYPES } from "./config";
import { hexDistance, hexKey, hexNeighbors } from "./hex";
import { findHexPath } from "./pathfinding";
import type { AiAction, AiDecisionTrace, AiMemory } from "./ai";
import type {
  BattleState,
  BuildingKind,
  BuildingState,
  CommandResult,
  GameCommand,
  GameConfig,
  HexCoord,
  PlayerId,
  UnitDefinition,
  UnitState,
  UnitType,
} from "./types";

const PLAYERS: PlayerId[] = ["blue", "red"];

function opponent(player: PlayerId): PlayerId {
  return player === "blue" ? "red" : "blue";
}

function success(): CommandResult {
  return { ok: true };
}

function failure(reason: string): CommandResult {
  return { ok: false, reason };
}

export class GameSimulation {
  readonly config: GameConfig;
  state: BattleState;
  private idCounter = 0;
  private accumulator = 0;
  private aiAccumulator = 0;
  private aiGoldReserve = 0;
  private aiPlanner: AiPlanner;
  private aiMemory: AiMemory;
  private pathVersion = 0;
  private readonly pathCache = new Map<string, HexCoord[]>();

  constructor(config: GameConfig = createConfig()) {
    this.config = config;
    this.aiPlanner = new AiPlanner(this.config);
    this.aiMemory = createAiMemory(this.config);
    this.state = this.createInitialState();
  }

  start(): void {
    this.state.started = true;
    this.state.paused = false;
    this.touch();
  }

  command(command: GameCommand): CommandResult {
    switch (command.type) {
      case "build":
        return this.build(command.player, command.kind, command.coord);
      case "buildBarracks":
        return this.buildBarracks(command.player, command.coord, command.unitType);
      case "setBarracksProductionPaused":
        return this.setBarracksProductionPaused(
          command.player,
          command.buildingId,
          command.paused,
        );
      case "upgrade":
        return this.upgrade(command.player, command.buildingId);
      case "pause":
        this.state.paused = command.value ?? !this.state.paused;
        this.touch();
        return success();
      case "restart":
        this.restart();
        return success();
    }
  }

  update(deltaSeconds: number): void {
    if (!this.state.started || this.state.paused || this.state.winner) {
      return;
    }
    this.accumulator += Math.min(deltaSeconds, 0.25);
    while (this.accumulator >= this.config.fixedStep) {
      this.step(this.config.fixedStep);
      this.accumulator -= this.config.fixedStep;
    }
  }

  getIncomeRate(player: PlayerId): number {
    let income = this.config.baseIncome;
    for (const building of Object.values(this.state.buildings)) {
      if (building.owner === player && building.kind === "mine") {
        income += this.getBuildingLevel(building).income ?? 0;
      }
    }
    return income;
  }

  getTrainableUnits(): UnitDefinition[] {
    return UNIT_TYPES.map((unitType) => this.config.units[unitType]);
  }

  getUnitCap(): number {
    return Math.max(1, this.config.unitCap);
  }

  getProductionDuration(unitType: UnitType): number {
    const definition = this.config.units[unitType];
    return definition.trainTime;
  }

  getBuildingMaxHp(building: BuildingState): number {
    return this.getBuildingMaxHpFor(building.kind, building.level);
  }

  getUnitMaxHp(unit: UnitState): number {
    return this.config.units[unit.unitType].levels[unit.level - 1].maxHp;
  }

  canBuild(player: PlayerId, coord: HexCoord): boolean {
    const cell = this.state.cells[hexKey(coord)];
    if (!cell || cell.buildingId || cell.owner === opponent(player)) {
      return false;
    }
    if (cell.owner === player) {
      return true;
    }
    return hexNeighbors(coord, this.config.board.columns, this.config.board.rows).some(
      (neighbor) => this.state.cells[hexKey(neighbor)]?.owner === player,
    );
  }

  getValidBuildCells(player: PlayerId): HexCoord[] {
    return Object.values(this.state.cells)
      .filter((cell) => this.canBuild(player, cell))
      .map(({ col, row }) => ({ col, row }));
  }

  getCity(player: PlayerId): BuildingState {
    const city = Object.values(this.state.buildings).find(
      (building) => building.owner === player && building.kind === "city",
    );
    if (!city) {
      throw new Error(`Missing ${player} city`);
    }
    return city;
  }

  getAiDecisionTrace(): Readonly<AiDecisionTrace> | null {
    const trace = this.aiPlanner.getTrace();
    return trace ? structuredClone(trace) : null;
  }

  restart(): void {
    this.idCounter = 0;
    this.accumulator = 0;
    this.aiAccumulator = 0;
    this.aiGoldReserve = 0;
    this.aiPlanner = new AiPlanner(this.config);
    this.aiMemory = createAiMemory(this.config);
    this.pathVersion = 0;
    this.pathCache.clear();
    this.state = this.createInitialState();
  }

  private createInitialState(): BattleState {
    const cells: BattleState["cells"] = {};
    for (let row = 0; row < this.config.board.rows; row += 1) {
      for (let col = 0; col < this.config.board.columns; col += 1) {
        const coord = { col, row };
        cells[hexKey(coord)] = { ...coord, owner: null, buildingId: null };
      }
    }

    const state: BattleState = {
      cells,
      buildings: {},
      units: {},
      players: {
        blue: {
          id: "blue",
          gold: this.config.startingGold,
          stats: { incomeEarned: 0, unitsProduced: 0, buildingsBuilt: 0 },
        },
        red: {
          id: "red",
          gold: this.config.startingGold,
          stats: { incomeEarned: 0, unitsProduced: 0, buildingsBuilt: 0 },
        },
      },
      elapsed: 0,
      paused: true,
      started: false,
      winner: null,
      revision: 0,
    };

    this.state = state;
    this.placeInitialCity("red", { col: Math.floor(this.config.board.columns / 2), row: 1 });
    this.placeInitialCity("blue", {
      col: Math.floor(this.config.board.columns / 2),
      row: this.config.board.rows - 2,
    });
    state.revision = 0;
    return state;
  }

  private placeInitialCity(owner: PlayerId, coord: HexCoord): void {
    const id = this.nextId("building");
    const city: BuildingState = {
      id,
      owner,
      kind: "city",
      level: 1,
      hp: this.getBuildingMaxHpFor("city", 1),
      cooldown: 0,
      autoUnitType: null,
      production: null,
      productionMode: null,
      ...coord,
    };
    this.state.buildings[id] = city;
    const cell = this.state.cells[hexKey(coord)];
    cell.owner = owner;
    cell.buildingId = id;
  }

  private build(
    player: PlayerId,
    kind: Exclude<BuildingKind, "city" | "barracks">,
    coord: HexCoord,
  ): CommandResult {
    if (this.state.winner) {
      return failure("战斗已经结束");
    }
    if (!this.canBuild(player, coord)) {
      return failure("只能在己方边界的空地建造");
    }
    const definition = this.config.buildings[kind];
    if (this.state.players[player].gold < definition.buildCost) {
      return failure("金币不足");
    }

    const id = this.nextId("building");
    const building: BuildingState = {
      id,
      owner: player,
      kind,
      level: 1,
      hp: this.getBuildingMaxHpFor(kind, 1),
      cooldown: 0,
      autoUnitType: null,
      production: null,
      productionMode: null,
      ...coord,
    };
    this.state.players[player].gold -= definition.buildCost;
    this.state.players[player].stats.buildingsBuilt += 1;
    this.state.buildings[id] = building;
    const cell = this.state.cells[hexKey(coord)];
    cell.owner = player;
    cell.buildingId = id;
    this.invalidatePaths();
    this.touch();
    return success();
  }

  private buildBarracks(player: PlayerId, coord: HexCoord, unitType: UnitType): CommandResult {
    if (this.state.winner) {
      return failure("战斗已经结束");
    }
    if (!this.canBuild(player, coord)) {
      return failure("只能在己方边界的空地建造");
    }
    const unit = this.config.units[unitType];
    if (!unit) {
      return failure("兵种不存在");
    }
    const definition = this.config.buildings.barracks;
    if (this.state.players[player].gold < definition.buildCost) {
      return failure("金币不足");
    }

    const id = this.nextId("building");
    const building: BuildingState = {
      id,
      owner: player,
      kind: "barracks",
      level: 1,
      hp: this.getBuildingMaxHpFor("barracks", 1),
      cooldown: 0,
      autoUnitType: unitType,
      production: null,
      productionMode: "running",
      ...coord,
    };
    this.state.players[player].gold -= definition.buildCost;
    this.state.players[player].stats.buildingsBuilt += 1;
    this.state.buildings[id] = building;
    const cell = this.state.cells[hexKey(coord)];
    cell.owner = player;
    cell.buildingId = id;
    this.invalidatePaths();
    this.touch();
    return success();
  }

  private setBarracksProductionPaused(
    player: PlayerId,
    buildingId: string,
    paused: boolean,
  ): CommandResult {
    const building = this.state.buildings[buildingId];
    if (!building || building.owner !== player) {
      return failure("建筑不存在");
    }
    if (building.kind !== "barracks") {
      return failure("只有兵营可以暂停生产");
    }

    if (!paused) {
      building.productionMode = "running";
      this.touch();
      return success();
    }

    building.productionMode = building.production?.paid
      ? "pauseAfterCurrent"
      : "paused";
    this.touch();
    return success();
  }

  private upgrade(player: PlayerId, buildingId: string): CommandResult {
    const building = this.state.buildings[buildingId];
    if (!building || building.owner !== player) {
      return failure("建筑不存在");
    }
    if (building.kind === "city") {
      return failure("主城不能升级");
    }
    const definition = this.config.buildings[building.kind];
    if (building.level >= definition.levels.length) {
      return failure("建筑已经满级");
    }
    const nextLevel = definition.levels[building.level];
    const cost = nextLevel.upgradeCost ?? 0;
    if (this.state.players[player].gold < cost) {
      return failure("金币不足");
    }

    const oldMaxHp = this.getBuildingMaxHpFor(building.kind, building.level);
    this.state.players[player].gold -= cost;
    building.level += 1;
    building.hp += this.getBuildingMaxHpFor(building.kind, building.level) - oldMaxHp;
    this.touch();
    return success();
  }

  private step(delta: number): void {
    this.state.elapsed += delta;
    this.processIncome(delta);
    this.processAutoProduction(delta);
    this.processTowers(delta);
    this.processUnits(delta);
    if (this.config.aiEnabled && !this.state.winner) {
      this.aiAccumulator += delta;
      if (this.aiAccumulator >= this.config.aiDecisionInterval) {
        this.aiAccumulator = 0;
        this.runAiTurn();
      }
    }
    this.touch();
  }

  private processIncome(delta: number): void {
    for (const player of PLAYERS) {
      const amount = this.getIncomeRate(player) * delta;
      this.state.players[player].gold += amount;
      this.state.players[player].stats.incomeEarned += amount;
    }
  }

  private processAutoProduction(delta: number): void {
    for (const building of Object.values(this.state.buildings)) {
      if (building.kind !== "barracks" || !building.autoUnitType) {
        continue;
      }
      if (building.productionMode === "paused") {
        continue;
      }
      if (!building.production) {
        if (building.productionMode === "pauseAfterCurrent") {
          building.productionMode = "paused";
          continue;
        }
        building.production = this.createPendingProduction(building);
      }

      const production = building.production;
      if (!production.paid) {
        if (building.productionMode === "pauseAfterCurrent") {
          building.productionMode = "paused";
          continue;
        }
        this.tryStartProduction(building, production);
        continue;
      }

      production.remaining = Math.max(0, production.remaining - delta);
      if (production.remaining > 0) {
        production.pauseReason = null;
        continue;
      }

      const availableSlots = this.getAvailableUnitSlots(building.owner);
      if (availableSlots <= 0) {
        production.pauseReason = "unitCap";
        continue;
      }

      if (availableSlots > 0) {
        this.spawnUnit(building, production.unitType, production.level);
        building.production = null;
        if (building.productionMode === "pauseAfterCurrent") {
          building.productionMode = "paused";
        }
      }
    }
  }

  private createPendingProduction(building: BuildingState) {
    const unitType = building.autoUnitType ?? this.getTrainableUnits()[0]?.id;
    if (!unitType) {
      throw new Error(`Missing auto unit for ${building.id}`);
    }
    const duration = this.getProductionDuration(unitType);
    return {
      unitType,
      level: Math.min(building.level, this.config.units[unitType].levels.length),
      remaining: duration,
      duration,
      paid: false,
      pauseReason: null,
    };
  }

  private tryStartProduction(building: BuildingState, production: NonNullable<BuildingState["production"]>): void {
    if (this.getAvailableUnitSlots(building.owner) <= 0) {
      production.pauseReason = "unitCap";
      return;
    }
    const definition = this.config.units[production.unitType];
    const reservedGold =
      building.owner === "red" && this.config.aiEnabled ? this.aiGoldReserve : 0;
    if (this.state.players[building.owner].gold < definition.cost + reservedGold) {
      production.pauseReason = "gold";
      return;
    }

    production.level = Math.min(building.level, definition.levels.length);
    production.duration = this.getProductionDuration(production.unitType);
    production.remaining = production.duration;
    production.paid = true;
    production.pauseReason = null;
    this.state.players[building.owner].gold -= definition.cost;
  }

  private getAvailableUnitSlots(player: PlayerId): number {
    const unitCount = Object.values(this.state.units).filter((unit) => unit.owner === player).length;
    return this.getUnitCap() - unitCount;
  }

  private spawnUnit(building: BuildingState, unitType: UnitType, level: number): UnitState {
    const definition = this.config.units[unitType];
    const stats = definition.levels[level - 1];
    const id = this.nextId("unit");
    const unit: UnitState = {
      id,
      owner: building.owner,
      unitType,
      level,
      hp: stats.maxHp,
      cooldown: 0,
      moveProgress: 0,
      nextCell: null,
      col: building.col,
      row: building.row,
    };
    this.state.units[id] = unit;
    this.state.players[building.owner].stats.unitsProduced += 1;
    return unit;
  }

  private processTowers(delta: number): void {
    for (const tower of Object.values(this.state.buildings)) {
      if (tower.kind !== "tower") {
        continue;
      }
      tower.cooldown = Math.max(0, tower.cooldown - delta);
      const level = this.getBuildingLevel(tower);
      const target = Object.values(this.state.units)
        .filter(
          (unit) =>
            unit.owner !== tower.owner &&
            hexDistance(tower, unit) <= (level.range ?? 0),
        )
        .sort((a, b) => hexDistance(tower, a) - hexDistance(tower, b))[0];
      if (target && tower.cooldown <= 0) {
        this.damageUnit(target, level.damage ?? 0);
        tower.cooldown = level.attackInterval ?? 1;
      }
    }
    this.removeDeadUnits();
  }

  private processUnits(delta: number): void {
    const units = Object.values(this.state.units);
    for (const unit of units) {
      if (this.state.winner) {
        break;
      }
      if (!this.state.units[unit.id]) {
        continue;
      }
      const definition = this.config.units[unit.unitType];
      const stats = definition.levels[unit.level - 1];
      const range = stats.range ?? 1;
      unit.cooldown = Math.max(0, unit.cooldown - delta);

      const enemyUnits = Object.values(this.state.units)
        .filter(
          (candidate) =>
            candidate.owner !== unit.owner && hexDistance(unit, candidate) <= range,
        )
        .map((target) => ({
          kind: "unit" as const,
          target,
          distance: hexDistance(unit, target),
        }));
      const enemyBuildings = Object.values(this.state.buildings)
        .filter(
          (building) =>
            building.owner !== unit.owner && hexDistance(unit, building) <= range,
        )
        .map((target) => ({
          kind: "building" as const,
          target,
          distance: hexDistance(unit, target),
        }));
      const attackTarget = [...enemyUnits, ...enemyBuildings].sort((a, b) => {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        if (a.kind !== b.kind) {
          return a.kind === "unit" ? -1 : 1;
        }
        if (a.kind === "building" && b.kind === "building") {
          const cityPriority = (a.target.kind === "city" ? 1 : 0) -
            (b.target.kind === "city" ? 1 : 0);
          if (cityPriority !== 0) {
            return cityPriority;
          }
        }
        if (a.target.hp !== b.target.hp) {
          return a.target.hp - b.target.hp;
        }
        return a.target.id.localeCompare(b.target.id);
      })[0];
      if (attackTarget) {
        if (unit.cooldown <= 0) {
          if (attackTarget.kind === "unit") {
            this.damageUnit(attackTarget.target, stats.damage);
          } else {
            this.damageBuilding(
              attackTarget.target,
              stats.damage * stats.structureDamageMultiplier,
            );
          }
          unit.cooldown = stats.attackInterval;
        }
        continue;
      }

      const target = this.getCity(opponent(unit.owner));
      const next = this.getNextStep(unit, target);
      if (!next) {
        continue;
      }
      unit.nextCell = next;
      unit.moveProgress += stats.speed * delta;
      if (unit.moveProgress >= 1) {
        unit.col = next.col;
        unit.row = next.row;
        unit.moveProgress -= 1;
        unit.nextCell = null;
        this.claimCell(unit);
      }
    }
    this.removeDeadUnits();
  }

  private claimCell(unit: UnitState): void {
    const cell = this.state.cells[hexKey(unit)];
    const building = cell.buildingId ? this.state.buildings[cell.buildingId] : null;
    if (!building || building.owner === unit.owner) {
      cell.owner = unit.owner;
    }
  }

  private getNextStep(unit: UnitState, target: BuildingState): HexCoord | null {
    const cacheKey = `${this.pathVersion}:${unit.col},${unit.row}>${target.col},${target.row}`;
    let path = this.pathCache.get(cacheKey);
    if (!path) {
      path = findHexPath(
        unit,
        target,
        this.config.board.columns,
        this.config.board.rows,
      );
      this.pathCache.set(cacheKey, path);
    }
    return path[1] ?? null;
  }

  private damageUnit(unit: UnitState, damage: number): void {
    unit.hp -= damage;
  }

  private damageBuilding(building: BuildingState, damage: number): void {
    building.hp -= damage;
    if (building.hp > 0) {
      return;
    }
    const cell = this.state.cells[hexKey(building)];
    cell.buildingId = null;
    delete this.state.buildings[building.id];
    this.invalidatePaths();
    if (building.kind === "city") {
      this.state.winner = opponent(building.owner);
      this.state.paused = true;
    }
  }

  private removeDeadUnits(): void {
    for (const unit of Object.values(this.state.units)) {
      if (unit.hp <= 0) {
        delete this.state.units[unit.id];
      }
    }
  }

  private runAiTurn(): void {
    const plan = this.aiPlanner.plan(this.state, this.aiMemory);
    this.aiMemory = plan.nextMemory;
    this.aiGoldReserve = Number.isFinite(plan.reserveGold)
      ? Math.max(0, plan.reserveGold)
      : 0;

    for (const action of plan.actions) {
      const result = this.executeAiAction(action);
      if (
        result.ok &&
        (action.type === "build" ||
          action.type === "buildBarracks" ||
          action.type === "upgrade")
      ) {
        // The target was bought; do not hold the same balance for another AI tick.
        // Production actions earlier in the queue already encode which barracks
        // should remain deliberately paused.
        this.aiGoldReserve = 0;
      }
    }
  }

  private executeAiAction(action: AiAction): CommandResult {
    switch (action.type) {
      case "wait":
        return success();
      case "build":
        return this.build("red", action.kind, action.coord);
      case "buildBarracks":
        return this.buildBarracks("red", action.coord, action.unitType);
      case "upgrade":
        return this.upgrade("red", action.buildingId);
      case "setProductionPaused":
        return this.setBarracksProductionPaused("red", action.buildingId, action.paused);
    }
  }

  private getBuildingLevel(building: BuildingState) {
    return this.config.buildings[building.kind].levels[building.level - 1];
  }

  private getBuildingMaxHpFor(kind: BuildingKind, level: number): number {
    return this.config.buildings[kind].levels[level - 1].maxHp;
  }

  private invalidatePaths(): void {
    this.pathVersion += 1;
    this.pathCache.clear();
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  private touch(): void {
    this.state.revision += 1;
  }
}
