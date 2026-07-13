export type PlayerId = "blue" | "red";
export type BuildingKind = "city" | "mine" | "barracks" | "tower";
export type UnitType = "warrior" | "archer" | "siege";

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
  range: number;
  speed: number;
  attackInterval: number;
  structureDamageMultiplier: number;
}

export interface UnitDefinition {
  id: UnitType;
  label: string;
  icon: string;
  summary: string;
  accentColor: string;
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
  fixedStep: number;
  aiDecisionInterval: number;
  aiEnabled: boolean;
  /** Fixed AI seed for reproducible matches; null generates one seed per match. */
  aiSeed: number | null;
  buildings: Record<BuildingKind, BuildingDefinition>;
  units: Record<UnitType, UnitDefinition>;
}

export interface CellState extends HexCoord {
  owner: PlayerId | null;
  buildingId: string | null;
}

export type ProductionPauseReason = "gold" | "unitCap";
export type BarracksProductionMode = "running" | "pauseAfterCurrent" | "paused";

export interface BarracksProductionState {
  unitType: UnitType;
  level: number;
  remaining: number;
  duration: number;
  paid: boolean;
  pauseReason: ProductionPauseReason | null;
}

export interface BuildingState extends HexCoord {
  id: string;
  owner: PlayerId;
  kind: BuildingKind;
  level: number;
  hp: number;
  cooldown: number;
  autoUnitType: UnitType | null;
  production: BarracksProductionState | null;
  productionMode: BarracksProductionMode | null;
}

export interface UnitState extends HexCoord {
  id: string;
  owner: PlayerId;
  unitType: UnitType;
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
  | { type: "build"; player: PlayerId; kind: Exclude<BuildingKind, "city" | "barracks">; coord: HexCoord }
  | { type: "buildBarracks"; player: PlayerId; coord: HexCoord; unitType: UnitType }
  | {
      type: "setBarracksProductionPaused";
      player: PlayerId;
      buildingId: string;
      paused: boolean;
    }
  | { type: "upgrade"; player: PlayerId; buildingId: string }
  | { type: "pause"; value?: boolean }
  | { type: "restart" };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}
