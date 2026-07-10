import Phaser from "phaser";
import { hexKey } from "../game/hex";
import type { GameSimulation } from "../game/simulation";
import type { BuildingState, HexCoord, PlayerId, UnitState } from "../game/types";

const DESIGN_WIDTH = 390;
const DESIGN_HEIGHT = 844;
const HEX_RADIUS = 24;
const HEX_WIDTH = Math.sqrt(3) * HEX_RADIUS;
const ROW_HEIGHT = HEX_RADIUS * 1.5;
const PLAYFIELD_TOP = 112;
const PLAYFIELD_BOTTOM = 790;
const VIEW_SIDE_MARGIN = 18;
const DRAG_THRESHOLD = 7;
const MIN_ZOOM = 0.72;
const MAX_ZOOM = 1.46;
const DEFAULT_MAX_ZOOM = 1.08;
const STACKED_UNIT_SCALE = 0.86;
const MAX_VISIBLE_STACKED_UNITS = 6;
const UNIT_STACK_OFFSETS: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 0, y: 0 }],
  2: [
    { x: -5, y: 1 },
    { x: 5, y: -1 },
  ],
  3: [
    { x: 0, y: -6 },
    { x: -6, y: 4 },
    { x: 6, y: 4 },
  ],
  4: [
    { x: -6, y: -5 },
    { x: 6, y: -5 },
    { x: -6, y: 5 },
    { x: 6, y: 5 },
  ],
  5: [
    { x: 0, y: -7 },
    { x: -7, y: -1 },
    { x: 7, y: -1 },
    { x: -5, y: 7 },
    { x: 5, y: 7 },
  ],
  6: [
    { x: -7, y: -7 },
    { x: 7, y: -7 },
    { x: -8, y: 1 },
    { x: 8, y: 1 },
    { x: -5, y: 8 },
    { x: 5, y: 8 },
  ],
};

type CellSelectHandler = (coord: HexCoord) => void;

interface ViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

interface PointerTrack {
  id: number;
  startX: number;
  startY: number;
  previousX: number;
  previousY: number;
  x: number;
  y: number;
}

export class BattleScene extends Phaser.Scene {
  private readonly simulation: GameSimulation;
  private readonly onCellSelect: CellSelectHandler;
  private backdropGraphics!: any;
  private worldLayer!: any;
  private boardGraphics!: any;
  private entityGraphics!: any;
  private labels!: any;
  private selected: HexCoord | null = null;
  private lastRevision = -1;
  private readonly viewport: ViewportTransform = { x: 0, y: 0, zoom: 1 };
  private readonly pointers = new Map<number, PointerTrack>();
  private hasDragged = false;

  constructor(simulation: GameSimulation, onCellSelect: CellSelectHandler) {
    super("battle");
    this.simulation = simulation;
    this.onCellSelect = onCellSelect;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#17254d");
    this.backdropGraphics = this.add.graphics();
    this.worldLayer = this.add.container(0, 0);
    this.boardGraphics = this.add.graphics();
    this.entityGraphics = this.add.graphics();
    this.worldLayer.add([this.boardGraphics, this.entityGraphics]);
    this.labels = this.add.group();
    this.input.addPointer(1);
    this.input.on("pointerdown", (pointer: any) => this.handlePointerDown(pointer));
    this.input.on("pointermove", (pointer: any) => this.handlePointerMove(pointer));
    this.input.on("pointerup", (pointer: any) => this.handlePointerUp(pointer));
    this.input.on("pointerupoutside", (pointer: any) => this.handlePointerUp(pointer));
    this.input.on(
      "wheel",
      (pointer: any, _gameObjects: unknown, _deltaX: number, deltaY: number) => {
        if (!this.canControlView()) {
          return;
        }
        this.zoomAt(deltaY > 0 ? 0.9 : 1.1, pointer.x, pointer.y);
      },
    );
    this.resetView();
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

  coordToScreen(coord: HexCoord): { x: number; y: number } {
    const world = this.hexToWorld(coord);
    return {
      x: this.viewport.x + world.x * this.viewport.zoom,
      y: this.viewport.y + world.y * this.viewport.zoom,
    };
  }

  resetView(): void {
    const blueCity = this.simulation.getCity("blue");
    const redCity = this.simulation.getCity("red");
    const blue = this.hexToWorld(blueCity);
    const red = this.hexToWorld(redCity);
    const verticalSpan = Math.abs(blue.y - red.y) + HEX_RADIUS * 4.5;
    const availableHeight = PLAYFIELD_BOTTOM - PLAYFIELD_TOP;
    const zoom = Phaser.Math.Clamp(
      availableHeight / verticalSpan,
      MIN_ZOOM,
      DEFAULT_MAX_ZOOM,
    );
    const focus = {
      x: this.boardCenterX(),
      y: (blue.y + red.y) / 2,
    };
    this.viewport.zoom = zoom;
    this.viewport.x = DESIGN_WIDTH / 2 - focus.x * zoom;
    this.viewport.y = (PLAYFIELD_TOP + PLAYFIELD_BOTTOM) / 2 - focus.y * zoom;
    this.clampViewport();
    this.applyViewport();
  }

  private renderBattle(): void {
    if (!this.backdropGraphics || !this.boardGraphics || !this.entityGraphics) {
      return;
    }
    this.lastRevision = this.simulation.state.revision;
    this.backdropGraphics.clear();
    this.boardGraphics.clear();
    this.entityGraphics.clear();
    this.labels.clear(true, true);
    this.drawBackdrop();
    this.drawBoard();
    this.drawBuildings();
    this.drawUnits();
  }

  private drawBackdrop(): void {
    const graphics = this.backdropGraphics;
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
      const center = this.hexToWorld(cell);
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
      const center = this.hexToWorld(this.selected);
      graphics.lineStyle(3.5, 0xffe45d, 1);
      graphics.strokePoints(this.hexPoints(center.x, center.y, HEX_RADIUS + 1), true);
      graphics.lineStyle(1.5, 0xffffff, 0.9);
      graphics.strokeCircle(center.x, center.y, 7);
    }
  }

  private drawBuildings(): void {
    for (const building of Object.values(this.simulation.state.buildings)) {
      const { x, y } = this.hexToWorld(building);
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
        if (building.kind === "barracks" && building.autoUnitType) {
          const unit = this.simulation.config.units[building.autoUnitType];
          const unitIcon = this.add
            .text(x - 9, y - 15, unit.icon, {
              fontFamily: "Arial Black, sans-serif",
              fontSize: "8px",
              color: "#fff8d4",
              stroke: "#1d2747",
              strokeThickness: 2,
            })
            .setOrigin(0.5);
          this.labels.add(unitIcon);
          this.worldLayer.add(unitIcon);
        }
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
        this.worldLayer.add(label);
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
    const groups = new Map<string, { unit: UnitState; position: { x: number; y: number } }[]>();
    for (const unit of Object.values(this.simulation.state.units)) {
      const position = this.unitPixel(unit);
      const key = `${Math.round(position.x)},${Math.round(position.y)}`;
      const group = groups.get(key) ?? [];
      group.push({ unit, position });
      groups.set(key, group);
    }

    const orderedGroups = Array.from(groups.values()).sort(
      (a, b) => a[0].position.y - b[0].position.y,
    );
    for (const group of orderedGroups) {
      if (group.length === 1) {
        this.drawUnitSprite(group[0].unit, group[0].position, 1);
        continue;
      }

      const visibleCount = Math.min(group.length, MAX_VISIBLE_STACKED_UNITS);
      const offsets = UNIT_STACK_OFFSETS[visibleCount];
      const entries = group
        .slice(0, visibleCount)
        .map((entry, index) => {
          const offset = offsets[index];
          return {
            unit: entry.unit,
            position: {
              x: entry.position.x + offset.x,
              y: entry.position.y + offset.y,
            },
          };
        })
        .sort((a, b) => a.position.y - b.position.y);

      for (const entry of entries) {
        this.drawUnitSprite(entry.unit, entry.position, STACKED_UNIT_SCALE);
      }

      if (group.length > MAX_VISIBLE_STACKED_UNITS) {
        this.drawUnitOverflowLabel(group[0].position, group.length - MAX_VISIBLE_STACKED_UNITS);
      }
    }
  }

  private drawUnitSprite(
    unit: UnitState,
    position: { x: number; y: number },
    scale: number,
  ): void {
    const unitDefinition = this.simulation.config.units[unit.unitType];
    const accent = this.hexColor(unitDefinition.accentColor);
    const color = unit.owner === "blue" ? 0x55b9ff : 0xff686e;
    const dark = unit.owner === "blue" ? 0x135e9d : 0x9f2631;
    const direction = unit.owner === "blue" ? -1 : 1;
    const g = this.entityGraphics;
    g.fillStyle(0x091126, 0.35);
    g.fillEllipse(position.x, position.y + 6 * scale, 13 * scale, 5 * scale);

    if (unit.unitType === "warrior") {
      g.fillStyle(dark);
      g.fillCircle(position.x, position.y, 7 * scale);
      g.fillStyle(color);
      g.fillCircle(position.x, position.y - 2 * scale, 5 * scale);
      g.fillStyle(accent);
      g.fillCircle(position.x - direction * 4 * scale, position.y + 1 * scale, 4 * scale);
      g.lineStyle(1.5 * scale, 0xfff4c7, 0.95);
      g.lineBetween(
        position.x - direction * 4 * scale,
        position.y - 2 * scale,
        position.x - direction * 4 * scale,
        position.y + 4 * scale,
      );
    } else if (unit.unitType === "archer") {
      g.fillStyle(dark);
      g.fillTriangle(
        position.x - 5 * scale,
        position.y + 6 * scale,
        position.x,
        position.y - 8 * scale,
        position.x + 5 * scale,
        position.y + 6 * scale,
      );
      g.fillStyle(color);
      g.fillEllipse(position.x, position.y, 7 * scale, 11 * scale);
      g.fillStyle(0xf8dcad);
      g.fillCircle(position.x, position.y - 4 * scale, 2.2 * scale);
      g.lineStyle(1.5 * scale, accent, 1);
      g.strokeCircle(position.x + direction * 5 * scale, position.y, 5 * scale);
      g.lineBetween(
        position.x + direction * 5 * scale,
        position.y - 5 * scale,
        position.x + direction * 5 * scale,
        position.y + 5 * scale,
      );
    } else {
      g.fillStyle(dark);
      g.fillRoundedRect(
        position.x - 7 * scale,
        position.y - 5 * scale,
        14 * scale,
        12 * scale,
        2 * scale,
      );
      g.fillStyle(color);
      g.fillRoundedRect(
        position.x - 5 * scale,
        position.y - 3 * scale,
        10 * scale,
        8 * scale,
        1.5 * scale,
      );
      g.lineStyle(2 * scale, accent, 1);
      g.lineBetween(
        position.x - direction * 2 * scale,
        position.y - 2 * scale,
        position.x + direction * 7 * scale,
        position.y - 8 * scale,
      );
      g.fillStyle(accent);
      g.fillRoundedRect(
        position.x + direction * 4 * scale - 3 * scale,
        position.y - 10 * scale,
        7 * scale,
        4 * scale,
        1 * scale,
      );
    }

    const iconLabel = this.add
      .text(position.x, position.y + 1 * scale, unitDefinition.icon, {
        fontFamily: "Arial Black, sans-serif",
        fontSize: `${Math.max(7, 9 * scale)}px`,
        color: "#fff8d4",
        stroke: "#1d2747",
        strokeThickness: 2,
      })
      .setOrigin(0.5);
    this.labels.add(iconLabel);
    this.worldLayer.add(iconLabel);

    const ratio = Phaser.Math.Clamp(unit.hp / this.simulation.getUnitMaxHp(unit), 0, 1);
    const healthWidth = 12 * scale;
    g.fillStyle(0x13203b, 0.9);
    g.fillRect(position.x - healthWidth / 2, position.y - 10 * scale, healthWidth, 2 * scale);
    g.fillStyle(0x6df079);
    g.fillRect(position.x - healthWidth / 2, position.y - 10 * scale, healthWidth * ratio, 2 * scale);
  }

  private drawUnitOverflowLabel(position: { x: number; y: number }, overflow: number): void {
    const label = this.add
      .text(position.x + 15, position.y - 16, `+${overflow}`, {
        fontFamily: "Arial Black, sans-serif",
        fontSize: "8px",
        color: "#fff8d4",
        stroke: "#1d2747",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.labels.add(label);
    this.worldLayer.add(label);
  }

  private unitPixel(unit: UnitState): { x: number; y: number } {
    const start = this.hexToWorld(unit);
    if (!unit.nextCell) {
      return start;
    }
    const end = this.hexToWorld(unit.nextCell);
    return {
      x: Phaser.Math.Linear(start.x, end.x, Phaser.Math.Clamp(unit.moveProgress, 0, 1)),
      y: Phaser.Math.Linear(start.y, end.y, Phaser.Math.Clamp(unit.moveProgress, 0, 1)),
    };
  }

  private hexToWorld(coord: HexCoord): { x: number; y: number } {
    return {
      x: coord.col * HEX_WIDTH + (coord.row % 2) * (HEX_WIDTH / 2),
      y: coord.row * ROW_HEIGHT,
    };
  }

  private screenToHex(x: number, y: number): HexCoord | null {
    const world = this.screenToWorld(x, y);
    let best: HexCoord | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cell of Object.values(this.simulation.state.cells)) {
      const center = this.hexToWorld(cell);
      const distance = Phaser.Math.Distance.Between(world.x, world.y, center.x, center.y);
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

  private handlePointerDown(pointer: any): void {
    if (!this.canControlView()) {
      return;
    }
    const id = this.pointerId(pointer);
    this.pointers.set(id, {
      id,
      startX: pointer.x,
      startY: pointer.y,
      previousX: pointer.x,
      previousY: pointer.y,
      x: pointer.x,
      y: pointer.y,
    });
    if (this.pointers.size === 1) {
      this.hasDragged = false;
    }
  }

  private handlePointerMove(pointer: any): void {
    if (!this.canControlView()) {
      return;
    }
    const track = this.pointers.get(this.pointerId(pointer));
    if (!track) {
      return;
    }
    track.previousX = track.x;
    track.previousY = track.y;
    track.x = pointer.x;
    track.y = pointer.y;

    if (this.pointers.size >= 2) {
      this.handlePinchMove();
      this.hasDragged = true;
      return;
    }

    const travel = Phaser.Math.Distance.Between(track.startX, track.startY, track.x, track.y);
    if (travel < DRAG_THRESHOLD && !this.hasDragged) {
      return;
    }
    this.hasDragged = true;
    this.panBy(track.x - track.previousX, track.y - track.previousY);
    track.previousX = track.x;
    track.previousY = track.y;
  }

  private handlePointerUp(pointer: any): void {
    const id = this.pointerId(pointer);
    const track = this.pointers.get(id);
    const wasMultiTouch = this.pointers.size > 1;
    this.pointers.delete(id);
    if (!this.canControlView() || !track || wasMultiTouch || this.hasDragged) {
      if (this.pointers.size === 0) {
        this.hasDragged = false;
      }
      return;
    }
    const coord = this.screenToHex(pointer.x, pointer.y);
    if (coord) {
      this.selected = coord;
      this.onCellSelect(coord);
      this.renderBattle();
    }
  }

  private handlePinchMove(): void {
    const tracks = Array.from(this.pointers.values()).slice(0, 2);
    const [first, second] = tracks;
    if (!first || !second) {
      return;
    }
    const previousDistance = Phaser.Math.Distance.Between(
      first.previousX,
      first.previousY,
      second.previousX,
      second.previousY,
    );
    const currentDistance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
    const previousCenter = {
      x: (first.previousX + second.previousX) / 2,
      y: (first.previousY + second.previousY) / 2,
    };
    const currentCenter = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    if (previousDistance > 0) {
      this.zoomAt(currentDistance / previousDistance, currentCenter.x, currentCenter.y);
    }
    this.panBy(currentCenter.x - previousCenter.x, currentCenter.y - previousCenter.y);
    for (const track of tracks) {
      track.previousX = track.x;
      track.previousY = track.y;
    }
  }

  private zoomAt(factor: number, screenX: number, screenY: number): void {
    const nextZoom = Phaser.Math.Clamp(this.viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === this.viewport.zoom) {
      return;
    }
    const world = this.screenToWorld(screenX, screenY);
    this.viewport.zoom = nextZoom;
    this.viewport.x = screenX - world.x * nextZoom;
    this.viewport.y = screenY - world.y * nextZoom;
    this.clampViewport();
    this.applyViewport();
  }

  private panBy(deltaX: number, deltaY: number): void {
    this.viewport.x += deltaX;
    this.viewport.y += deltaY;
    this.clampViewport();
    this.applyViewport();
  }

  private applyViewport(): void {
    if (!this.worldLayer) {
      return;
    }
    this.worldLayer.setPosition(this.viewport.x, this.viewport.y);
    this.worldLayer.setScale(this.viewport.zoom);
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.viewport.x) / this.viewport.zoom,
      y: (y - this.viewport.y) / this.viewport.zoom,
    };
  }

  private clampViewport(): void {
    const bounds = this.boardBounds();
    const zoom = this.viewport.zoom;
    const boardWidth = (bounds.maxX - bounds.minX) * zoom;
    const boardHeight = (bounds.maxY - bounds.minY) * zoom;
    const availableHeight = PLAYFIELD_BOTTOM - PLAYFIELD_TOP;

    if (boardWidth <= DESIGN_WIDTH - VIEW_SIDE_MARGIN * 2) {
      this.viewport.x =
        DESIGN_WIDTH / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom;
    } else {
      const minX = DESIGN_WIDTH - VIEW_SIDE_MARGIN - bounds.maxX * zoom;
      const maxX = VIEW_SIDE_MARGIN - bounds.minX * zoom;
      this.viewport.x = Phaser.Math.Clamp(this.viewport.x, minX, maxX);
    }

    if (boardHeight <= availableHeight) {
      this.viewport.y =
        (PLAYFIELD_TOP + PLAYFIELD_BOTTOM) / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom;
    } else {
      const minY = PLAYFIELD_BOTTOM - VIEW_SIDE_MARGIN - bounds.maxY * zoom;
      const maxY = PLAYFIELD_TOP + VIEW_SIDE_MARGIN - bounds.minY * zoom;
      this.viewport.y = Phaser.Math.Clamp(this.viewport.y, minY, maxY);
    }
  }

  private boardBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const cell of Object.values(this.simulation.state.cells)) {
      const center = this.hexToWorld(cell);
      minX = Math.min(minX, center.x - HEX_RADIUS);
      minY = Math.min(minY, center.y - HEX_RADIUS);
      maxX = Math.max(maxX, center.x + HEX_RADIUS);
      maxY = Math.max(maxY, center.y + HEX_RADIUS);
    }
    return { minX, minY, maxX, maxY };
  }

  private boardCenterX(): number {
    const bounds = this.boardBounds();
    return (bounds.minX + bounds.maxX) / 2;
  }

  private canControlView(): boolean {
    return (
      this.simulation.state.started &&
      !this.simulation.state.paused &&
      !this.simulation.state.winner
    );
  }

  private pointerId(pointer: any): number {
    return pointer.id ?? pointer.pointerId ?? 0;
  }

  private hexColor(value: string): number {
    return Number.parseInt(value.replace("#", ""), 16);
  }
}

export const PLAYER_LABELS: Record<PlayerId, string> = {
  blue: "蔚蓝领主",
  red: "赤焰军团",
};
