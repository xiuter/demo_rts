export type PlayerId = "blue" | "red";
export type BuildingKind = "city" | "mine" | "barracks" | "tower";

export interface HexCoord {
  col: number;
  row: number;
}

export interface BuildingLevel {
  upgradeCost?: number;
  maxHp: number;
  income?: number;
  damage?: number;
  range?: number;
  attackInterval?: number;
}

export interface BuildingDefinition {
  kind: BuildingKind;
  label: string;
  buildCost: number;
  levels: BuildingLevel[];
}

export interface UnitLevel {
  maxHp: number;
  damage: number;
  speed: number;
  attackInterval: number;
}

export interface UnitDefinition {
  id: string;
  label: string;
  cost: number;
  trainTime: number;
  levels: UnitLevel[];
}

export interface GameConfig {
  board: {
    columns: number;
    rows: number;
  };
  startingGold: number;
  baseIncome: number;
  unitCap: number;
  queueCap: number;
  fixedStep: number;
  aiDecisionInterval: number;
  aiEnabled: boolean;
  buildings: Record<BuildingKind, BuildingDefinition>;
  units: Record<string, UnitDefinition>;
}

export interface CellState extends HexCoord {
  owner: PlayerId | null;
  buildingId: string | null;
}

export interface TrainingOrder {
  unitType: string;
  level: number;
  remaining: number;
}

export interface BuildingState extends HexCoord {
  id: string;
  owner: PlayerId;
  kind: BuildingKind;
  level: number;
  hp: number;
  cooldown: number;
  queue: TrainingOrder[];
}

export interface UnitState extends HexCoord {
  id: string;
  owner: PlayerId;
  unitType: string;
  level: number;
  hp: number;
  cooldown: number;
  moveProgress: number;
  nextCell: HexCoord | null;
}

export interface PlayerStats {
  incomeEarned: number;
  unitsProduced: number;
  buildingsBuilt: number;
}

export interface PlayerState {
  id: PlayerId;
  gold: number;
  stats: PlayerStats;
}

export interface BattleState {
  cells: Record<string, CellState>;
  buildings: Record<string, BuildingState>;
  units: Record<string, UnitState>;
  players: Record<PlayerId, PlayerState>;
  elapsed: number;
  paused: boolean;
  started: boolean;
  winner: PlayerId | null;
  revision: number;
}

export type GameCommand =
  | { type: "build"; player: PlayerId; kind: Exclude<BuildingKind, "city">; coord: HexCoord }
  | { type: "upgrade"; player: PlayerId; buildingId: string }
  | { type: "enqueueUnit"; player: PlayerId; buildingId: string; unitType: string }
  | { type: "pause"; value?: boolean }
  | { type: "restart" };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

