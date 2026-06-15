import Phaser from "phaser";
import { hexKey } from "../game/hex";
import type { GameSimulation } from "../game/simulation";
import type { BuildingState, HexCoord, PlayerId, UnitState } from "../game/types";

const DESIGN_WIDTH = 390;
const DESIGN_HEIGHT = 844;
const HEX_RADIUS = 18;
const HEX_WIDTH = Math.sqrt(3) * HEX_RADIUS;
const ROW_HEIGHT = HEX_RADIUS * 1.5;
const BOARD_ORIGIN_X = 23;
const BOARD_ORIGIN_Y = 128;

type CellSelectHandler = (coord: HexCoord) => void;

export class BattleScene extends Phaser.Scene {
  private readonly simulation: GameSimulation;
  private readonly onCellSelect: CellSelectHandler;
  private boardGraphics!: any;
  private entityGraphics!: any;
  private labels!: any;
  private selected: HexCoord | null = null;
  private lastRevision = -1;

  constructor(simulation: GameSimulation, onCellSelect: CellSelectHandler) {
    super("battle");
    this.simulation = simulation;
    this.onCellSelect = onCellSelect;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#17254d");
    this.boardGraphics = this.add.graphics();
    this.entityGraphics = this.add.graphics();
    this.labels = this.add.group();
    this.input.on("pointerdown", (pointer: { x: number; y: number }) => {
      if (
        !this.simulation.state.started ||
        this.simulation.state.paused ||
        this.simulation.state.winner
      ) {
        return;
      }
      const coord = this.pixelToHex(pointer.x, pointer.y);
      if (coord) {
        this.selected = coord;
        this.onCellSelect(coord);
        this.renderBattle();
      }
    });
    this.renderBattle();
  }

  update(_time: number, delta: number): void {
    this.simulation.update(delta / 1000);
    if (this.simulation.state.revision !== this.lastRevision) {
      this.renderBattle();
    }
  }

  setSelected(coord: HexCoord | null): void {
    this.selected = coord;
    this.renderBattle();
  }

  private renderBattle(): void {
    if (!this.boardGraphics || !this.entityGraphics) {
      return;
    }
    this.lastRevision = this.simulation.state.revision;
    this.boardGraphics.clear();
    this.entityGraphics.clear();
    this.labels.clear(true, true);
    this.drawBackdrop();
    this.drawBoard();
    this.drawBuildings();
    this.drawUnits();
  }

  private drawBackdrop(): void {
    const graphics = this.boardGraphics;
    graphics.fillGradientStyle(0x263c70, 0x263c70, 0x15254d, 0x15254d, 1);
    graphics.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

    graphics.fillStyle(0x365c83, 0.32);
    for (let index = 0; index < 8; index += 1) {
      const y = 90 + index * 72;
      graphics.fillEllipse(index % 2 === 0 ? 28 : 355, y, 72, 28);
    }

    graphics.fillStyle(0xeed89a, 0.22);
    graphics.fillEllipse(195, 374, 382, 548);
    graphics.lineStyle(2, 0xf9e7b8, 0.16);
    graphics.strokeEllipse(195, 374, 372, 538);
  }

  private drawBoard(): void {
    const graphics = this.boardGraphics;
    const validCells = new Set(
      this.simulation.getValidBuildCells("blue").map((coord) => hexKey(coord)),
    );

    for (const cell of Object.values(this.simulation.state.cells)) {
      const center = this.hexToPixel(cell);
      const fill =
        cell.owner === "blue" ? 0x86c8f6 : cell.owner === "red" ? 0xf08d84 : 0xdec990;
      const border =
        cell.owner === "blue" ? 0x3b83cb : cell.owner === "red" ? 0xc54c52 : 0x9a8352;
      const points = this.hexPoints(center.x, center.y, HEX_RADIUS - 0.8);
      graphics.fillStyle(0x0d1732, 0.28);
      graphics.fillPoints(
        points.map((point) => new Phaser.Geom.Point(point.x + 1.5, point.y + 3)),
        true,
      );
      graphics.fillStyle(fill, 1);
      graphics.fillPoints(points, true);
      graphics.lineStyle(1.4, border, 0.9);
      graphics.strokePoints(points, true);

      const inner = this.hexPoints(center.x, center.y - 1, HEX_RADIUS - 4);
      graphics.lineStyle(1, 0xffffff, 0.18);
      graphics.strokePoints(inner, true);

      if (validCells.has(hexKey(cell)) && !cell.buildingId) {
        graphics.fillStyle(0xffffff, 0.2);
        graphics.fillCircle(center.x, center.y, 4);
      }
    }

    if (this.selected) {
      const center = this.hexToPixel(this.selected);
      graphics.lineStyle(3.5, 0xffe45d, 1);
      graphics.strokePoints(this.hexPoints(center.x, center.y, HEX_RADIUS + 1), true);
      graphics.lineStyle(1.5, 0xffffff, 0.9);
      graphics.strokeCircle(center.x, center.y, 7);
    }
  }

  private drawBuildings(): void {
    for (const building of Object.values(this.simulation.state.buildings)) {
      const { x, y } = this.hexToPixel(building);
      const color = building.owner === "blue" ? 0x2d8fe0 : 0xd94850;
      const dark = building.owner === "blue" ? 0x14548f : 0x8f2530;
      this.entityGraphics.fillStyle(0x0b1228, 0.3);
      this.entityGraphics.fillEllipse(x, y + 10, 27, 9);

      switch (building.kind) {
        case "city":
          this.drawCity(x, y, color, dark);
          break;
        case "mine":
          this.drawMine(x, y, color, dark);
          break;
        case "barracks":
          this.drawBarracks(x, y, color, dark);
          break;
        case "tower":
          this.drawTower(x, y, color, dark);
          break;
      }
      this.drawBuildingHealth(building, x, y);
      if (building.kind !== "city") {
        const label = this.add
          .text(x + 9, y - 15, `${building.level}`, {
            fontFamily: "Arial Black, sans-serif",
            fontSize: "9px",
            color: "#fff8d4",
            stroke: "#4a2c22",
            strokeThickness: 2,
          })
          .setOrigin(0.5);
        this.labels.add(label);
      }
    }
  }

  private drawCity(x: number, y: number, color: number, dark: number): void {
    const g = this.entityGraphics;
    g.fillStyle(dark);
    g.fillRoundedRect(x - 13, y - 8, 26, 20, 3);
    g.fillStyle(color);
    g.fillRect(x - 11, y - 11, 7, 20);
    g.fillRect(x + 4, y - 11, 7, 20);
    g.fillRoundedRect(x - 7, y - 5, 14, 17, 2);
    g.fillStyle(0xffe48a);
    g.fillRect(x - 2, y + 3, 4, 9);
    g.fillStyle(0xffffff, 0.85);
    g.fillTriangle(x, y - 17, x, y - 7, x + 11, y - 12);
    g.lineStyle(1.5, dark);
    g.lineBetween(x, y - 18, x, y - 6);
  }

  private drawMine(x: number, y: number, color: number, dark: number): void {
    const g = this.entityGraphics;
    g.fillStyle(0x64536a);
    g.fillCircle(x - 8, y + 1, 7);
    g.fillStyle(0x85758b);
    g.fillCircle(x + 7, y + 3, 8);
    g.fillStyle(0x42384d);
    g.fillEllipse(x, y + 3, 19, 12);
    g.fillStyle(0xffd44f);
    g.fillCircle(x - 4, y, 3.5);
    g.fillCircle(x + 4, y + 4, 3);
    g.lineStyle(3, dark);
    g.strokeCircle(x, y + 2, 11);
    g.lineStyle(2, color);
    g.lineBetween(x - 9, y - 7, x + 10, y + 10);
  }

  private drawBarracks(x: number, y: number, color: number, dark: number): void {
    const g = this.entityGraphics;
    g.fillStyle(0xf5d5a0);
    g.fillRoundedRect(x - 12, y - 4, 24, 16, 3);
    g.fillStyle(dark);
    g.fillTriangle(x - 15, y - 3, x + 15, y - 3, x, y - 15);
    g.fillStyle(color);
    g.fillTriangle(x - 11, y - 4, x + 11, y - 4, x, y - 12);
    g.fillStyle(0x6a392d);
    g.fillRect(x - 3, y + 3, 6, 9);
    g.fillStyle(0xffe28a);
    g.fillRect(x - 9, y + 1, 4, 4);
    g.fillRect(x + 5, y + 1, 4, 4);
  }

  private drawTower(x: number, y: number, color: number, dark: number): void {
    const g = this.entityGraphics;
    g.fillStyle(dark);
    g.fillRoundedRect(x - 7, y - 5, 14, 17, 4);
    g.fillStyle(0xe7d0a2);
    g.fillRoundedRect(x - 5, y - 8, 10, 18, 3);
    g.fillStyle(color);
    g.fillCircle(x, y - 9, 9);
    g.fillStyle(dark);
    g.fillRect(x - 2, y - 15, 4, 11);
    g.fillStyle(0xffe36d);
    g.fillCircle(x, y - 10, 3);
  }

  private drawBuildingHealth(building: BuildingState, x: number, y: number): void {
    const maxHp = this.simulation.getBuildingMaxHp(building);
    const ratio = Phaser.Math.Clamp(building.hp / maxHp, 0, 1);
    const width = building.kind === "city" ? 31 : 24;
    this.entityGraphics.fillStyle(0x19203a, 0.9);
    this.entityGraphics.fillRoundedRect(x - width / 2, y + 14, width, 4, 2);
    this.entityGraphics.fillStyle(ratio > 0.45 ? 0x66df72 : 0xffcf4d);
    this.entityGraphics.fillRoundedRect(x - width / 2 + 1, y + 15, (width - 2) * ratio, 2, 1);
  }

  private drawUnits(): void {
    for (const unit of Object.values(this.simulation.state.units)) {
      const position = this.unitPixel(unit);
      const color = unit.owner === "blue" ? 0x55b9ff : 0xff686e;
      const dark = unit.owner === "blue" ? 0x135e9d : 0x9f2631;
      const direction = unit.owner === "blue" ? -1 : 1;
      const g = this.entityGraphics;
      g.fillStyle(0x091126, 0.35);
      g.fillEllipse(position.x, position.y + 6, 13, 5);
      g.fillStyle(dark);
      g.fillCircle(position.x, position.y, 6);
      g.fillStyle(color);
      g.fillCircle(position.x, position.y - 2, 5);
      g.fillStyle(0xf8dcad);
      g.fillCircle(position.x, position.y - 3, 2.2);
      g.fillStyle(0xe8edf8);
      g.fillTriangle(
        position.x + direction * 3,
        position.y,
        position.x + direction * 9,
        position.y - 4,
        position.x + direction * 8,
        position.y + 4,
      );
      const ratio = Phaser.Math.Clamp(unit.hp / this.simulation.getUnitMaxHp(unit), 0, 1);
      g.fillStyle(0x13203b, 0.9);
      g.fillRect(position.x - 6, position.y - 10, 12, 2);
      g.fillStyle(0x6df079);
      g.fillRect(position.x - 6, position.y - 10, 12 * ratio, 2);
    }
  }

  private unitPixel(unit: UnitState): { x: number; y: number } {
    const start = this.hexToPixel(unit);
    if (!unit.nextCell) {
      return start;
    }
    const end = this.hexToPixel(unit.nextCell);
    return {
      x: Phaser.Math.Linear(start.x, end.x, Phaser.Math.Clamp(unit.moveProgress, 0, 1)),
      y: Phaser.Math.Linear(start.y, end.y, Phaser.Math.Clamp(unit.moveProgress, 0, 1)),
    };
  }

  private hexToPixel(coord: HexCoord): { x: number; y: number } {
    return {
      x: BOARD_ORIGIN_X + coord.col * HEX_WIDTH + (coord.row % 2) * (HEX_WIDTH / 2),
      y: BOARD_ORIGIN_Y + coord.row * ROW_HEIGHT,
    };
  }

  private pixelToHex(x: number, y: number): HexCoord | null {
    let best: HexCoord | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cell of Object.values(this.simulation.state.cells)) {
      const center = this.hexToPixel(cell);
      const distance = Phaser.Math.Distance.Between(x, y, center.x, center.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { col: cell.col, row: cell.row };
      }
    }
    return bestDistance <= HEX_RADIUS + 4 ? best : null;
  }

  private hexPoints(x: number, y: number, radius: number): any[] {
    const points: any[] = [];
    for (let index = 0; index < 6; index += 1) {
      const angle = Phaser.Math.DegToRad(60 * index - 30);
      points.push(
        new Phaser.Geom.Point(x + radius * Math.cos(angle), y + radius * Math.sin(angle)),
      );
    }
    return points;
  }
}

export const PLAYER_LABELS: Record<PlayerId, string> = {
  blue: "蔚蓝领主",
  red: "赤焰军团",
};
