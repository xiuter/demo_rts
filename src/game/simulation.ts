import { createConfig } from "./config";
import { hexDistance, hexKey, hexNeighbors } from "./hex";
import { findHexPath } from "./pathfinding";
import type {
  BattleState,
  BuildingKind,
  BuildingState,
  CommandResult,
  GameCommand,
  GameConfig,
  HexCoord,
  PlayerId,
  UnitState,
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
  private pathVersion = 0;
  private readonly pathCache = new Map<string, HexCoord[]>();

  constructor(config: GameConfig = createConfig()) {
    this.config = config;
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
      case "upgrade":
        return this.upgrade(command.player, command.buildingId);
      case "enqueueUnit":
        return this.enqueueUnit(command.player, command.buildingId, command.unitType);
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

  getBuildingMaxHp(building: BuildingState): number {
    return this.getBuildingLevel(building).maxHp;
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

  restart(): void {
    this.idCounter = 0;
    this.accumulator = 0;
    this.aiAccumulator = 0;
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
      hp: this.config.buildings.city.levels[0].maxHp,
      cooldown: 0,
      queue: [],
      ...coord,
    };
    this.state.buildings[id] = city;
    const cell = this.state.cells[hexKey(coord)];
    cell.owner = owner;
    cell.buildingId = id;
  }

  private build(
    player: PlayerId,
    kind: Exclude<BuildingKind, "city">,
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
      hp: definition.levels[0].maxHp,
      cooldown: 0,
      queue: [],
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

    const oldMaxHp = definition.levels[building.level - 1].maxHp;
    this.state.players[player].gold -= cost;
    building.level += 1;
    building.hp += nextLevel.maxHp - oldMaxHp;
    this.touch();
    return success();
  }

  private enqueueUnit(player: PlayerId, buildingId: string, unitType: string): CommandResult {
    const building = this.state.buildings[buildingId];
    const definition = this.config.units[unitType];
    if (!building || building.owner !== player || building.kind !== "barracks") {
      return failure("请选择己方兵营");
    }
    if (!definition) {
      return failure("兵种不存在");
    }
    if (building.queue.length >= this.config.queueCap) {
      return failure("训练队列已满");
    }
    if (this.state.players[player].gold < definition.cost) {
      return failure("金币不足");
    }
    this.state.players[player].gold -= definition.cost;
    building.queue.push({
      unitType,
      level: Math.min(building.level, definition.levels.length),
      remaining: definition.trainTime,
    });
    this.touch();
    return success();
  }

  private step(delta: number): void {
    this.state.elapsed += delta;
    this.processIncome(delta);
    this.processTraining(delta);
    this.processTowers(delta);
    this.processUnits(delta);
    if (this.config.aiEnabled) {
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

  private processTraining(delta: number): void {
    for (const building of Object.values(this.state.buildings)) {
      if (building.kind !== "barracks" || building.queue.length === 0) {
        continue;
      }
      const order = building.queue[0];
      order.remaining = Math.max(0, order.remaining - delta);
      const unitCount = Object.values(this.state.units).filter(
        (unit) => unit.owner === building.owner,
      ).length;
      if (order.remaining <= 0 && unitCount < this.config.unitCap) {
        this.spawnUnit(building, order.unitType, order.level);
        building.queue.shift();
      }
    }
  }

  private spawnUnit(building: BuildingState, unitType: string, level: number): UnitState {
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
        target.hp -= level.damage ?? 0;
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
      unit.cooldown = Math.max(0, unit.cooldown - delta);

      const enemyUnit = Object.values(this.state.units)
        .filter(
          (candidate) =>
            candidate.owner !== unit.owner && hexDistance(unit, candidate) <= 1,
        )
        .sort((a, b) => a.hp - b.hp)[0];
      if (enemyUnit) {
        if (unit.cooldown <= 0) {
          enemyUnit.hp -= stats.damage;
          unit.cooldown = stats.attackInterval;
        }
        continue;
      }

      const enemyBuilding = Object.values(this.state.buildings)
        .filter(
          (building) =>
            building.owner !== unit.owner && hexDistance(unit, building) <= 1,
        )
        .sort((a, b) => (a.kind === "city" ? 1 : 0) - (b.kind === "city" ? 1 : 0))[0];
      if (enemyBuilding) {
        if (unit.cooldown <= 0) {
          this.damageBuilding(enemyBuilding, stats.damage);
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
    const player: PlayerId = "red";
    const buildings = Object.values(this.state.buildings).filter(
      (building) => building.owner === player,
    );
    const mines = buildings.filter((building) => building.kind === "mine");
    const barracks = buildings.filter((building) => building.kind === "barracks");
    const towers = buildings.filter((building) => building.kind === "tower");
    const gold = this.state.players[player].gold;

    if (mines.length === 0 && gold >= this.config.buildings.mine.buildCost) {
      this.aiBuild("mine");
      return;
    }
    if (barracks.length === 0 && gold >= this.config.buildings.barracks.buildCost) {
      this.aiBuild("barracks");
      return;
    }

    const queued = barracks.reduce((sum, building) => sum + building.queue.length, 0);
    const units = Object.values(this.state.units).filter((unit) => unit.owner === player).length;
    const infantry = this.config.units.infantry ?? Object.values(this.config.units)[0];
    const readyBarracks = barracks.find((building) => building.queue.length < this.config.queueCap);
    if (readyBarracks && units + queued < 10 && gold >= infantry.cost) {
      this.enqueueUnit(player, readyBarracks.id, infantry.id);
      return;
    }

    if (mines.length < 3 && gold >= this.config.buildings.mine.buildCost) {
      this.aiBuild("mine");
      return;
    }

    const mineToUpgrade = mines
      .filter((building) => building.level < this.config.buildings.mine.levels.length)
      .sort((a, b) => a.level - b.level)[0];
    if (mineToUpgrade) {
      const cost = this.config.buildings.mine.levels[mineToUpgrade.level].upgradeCost ?? 0;
      if (gold >= cost) {
        this.upgrade(player, mineToUpgrade.id);
        return;
      }
    }

    const barracksToUpgrade = barracks
      .filter((building) => building.level < this.config.buildings.barracks.levels.length)
      .sort((a, b) => a.level - b.level)[0];
    if (barracksToUpgrade) {
      const cost =
        this.config.buildings.barracks.levels[barracksToUpgrade.level].upgradeCost ?? 0;
      if (gold >= cost) {
        this.upgrade(player, barracksToUpgrade.id);
        return;
      }
    }

    if (towers.length < 3 && gold >= this.config.buildings.tower.buildCost) {
      this.aiBuild("tower");
      return;
    }

    if (readyBarracks && gold >= infantry.cost) {
      this.enqueueUnit(player, readyBarracks.id, infantry.id);
    }
  }

  private aiBuild(kind: Exclude<BuildingKind, "city">): void {
    const target = this.getCity("blue");
    const candidates = this.getValidBuildCells("red").sort(
      (a, b) => hexDistance(a, target) - hexDistance(b, target),
    );
    const chosen = candidates[0];
    if (chosen) {
      this.build("red", kind, chosen);
    }
  }

  private getBuildingLevel(building: BuildingState) {
    return this.config.buildings[building.kind].levels[building.level - 1];
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
