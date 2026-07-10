import { hexKey } from "../game/hex";
import type { GameSimulation } from "../game/simulation";
import type { BuildingKind, BuildingState, HexCoord, UnitType } from "../game/types";
import type { BattleScene } from "../phaser/BattleScene";
import { PLAYER_LABELS } from "../phaser/BattleScene";

const MINE_ICON_URL = new URL("../assets/gold-mine-icon.png", import.meta.url).href;

const BUILDING_ICONS: Record<Exclude<BuildingKind, "city">, string> = {
  mine: "",
  barracks: "兵",
  tower: "塔",
};

function mineIconImage(): string {
  return `<img src="${MINE_ICON_URL}" alt="" draggable="false">`;
}

export class GameUI {
  private readonly root: HTMLElement;
  private readonly simulation: GameSimulation;
  private scene: BattleScene | null = null;
  private selectedCoord: HexCoord | null = null;
  private lastRevision = -1;
  private lastDockTick = -1;
  private resultShown = false;
  private toastTimer = 0;

  constructor(root: HTMLElement, simulation: GameSimulation) {
    this.root = root;
    this.simulation = simulation;
    this.root.innerHTML = this.template();
    this.bindEvents();
    requestAnimationFrame(() => this.renderLoop());
  }

  attachScene(scene: BattleScene): void {
    this.scene = scene;
  }

  selectCell(coord: HexCoord): void {
    this.selectedCoord = coord;
    this.renderActionPanel();
  }

  private template(): string {
    return `
      <div class="hud hidden" id="hud">
        <section class="battle-header">
          <div class="base-status enemy">
            <div class="crest red">R</div>
            <div class="base-copy">
              <span id="red-name">${PLAYER_LABELS.red}</span>
              <div class="hp-track"><i id="red-hp"></i></div>
            </div>
          </div>
          <div class="versus-badge">VS</div>
          <div class="base-status player">
            <div class="base-copy align-right">
              <span id="blue-name">${PLAYER_LABELS.blue}</span>
              <div class="hp-track"><i id="blue-hp"></i></div>
            </div>
            <div class="crest blue">B</div>
          </div>
        </section>

        <section class="resource-strip">
          <div class="gold-readout"><span class="coin">◆</span><strong id="gold-value">120</strong></div>
          <div class="income-readout">每秒 <strong id="income-value">+4</strong></div>
          <div class="battle-time" id="battle-time">00:00</div>
          <button class="round-button" data-action="pause" aria-label="暂停">Ⅱ</button>
        </section>

        <section class="action-dock" id="action-dock"></section>
      </div>

      <section class="screen-overlay start-screen" id="start-screen">
        <div class="sunburst"></div>
        <div class="start-content">
          <div class="mini-crown">♛</div>
          <p class="eyebrow">竖屏即时策略</p>
          <h1>疆域铸造</h1>
          <p class="subtitle">每一枚金币，都决定疆域的走向</p>
          <div class="feature-row">
            <div><b class="mine-feature">${mineIconImage()}</b><span>经营经济</span></div>
            <div><b>兵</b><span>训练军队</span></div>
            <div><b>塔</b><span>稳固防线</span></div>
          </div>
          <div class="unit-roster">${this.unitRoleCards()}</div>
          <button class="primary-button" data-action="start">开始征战</button>
          <p class="start-tip">摧毁赤焰军团的主城即可获胜</p>
        </div>
      </section>

      <section class="screen-overlay modal-overlay hidden" id="pause-screen">
        <div class="game-modal">
          <p class="eyebrow">战局暂停</p>
          <h2>运筹一下</h2>
          <button class="primary-button small" data-action="resume">继续战斗</button>
          <button class="secondary-button" data-action="restart">重新开始</button>
        </div>
      </section>

      <section class="screen-overlay modal-overlay hidden" id="result-screen">
        <div class="game-modal result-modal">
          <div class="result-emblem" id="result-emblem">♛</div>
          <p class="eyebrow" id="result-kicker">战斗结束</p>
          <h2 id="result-title">疆域已定</h2>
          <p id="result-message"></p>
          <div class="result-stats">
            <div><span>战斗时长</span><strong id="result-time">00:00</strong></div>
            <div><span>累计收入</span><strong id="result-income">0</strong></div>
            <div><span>训练单位</span><strong id="result-units">0</strong></div>
            <div><span>建造建筑</span><strong id="result-buildings">0</strong></div>
          </div>
          <button class="primary-button small" data-action="restart">再战一局</button>
        </div>
      </section>

      <div class="toast" id="toast"></div>
      <div class="landscape-warning"><b>请旋转设备</b><span>竖屏体验更适合指挥战场</span></div>
    `;
  }

  private unitRoleCards(): string {
    return this.simulation
      .getTrainableUnits()
      .map(
        (unit) => `
          <div class="unit-role-card" style="--unit-accent:${unit.accentColor}">
            <i>${unit.icon}</i>
            <strong>${unit.label}</strong>
            <span>${unit.summary}</span>
          </div>
        `,
      )
      .join("");
  }

  private bindEvents(): void {
    this.root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!target) {
        return;
      }
      const action = target.dataset.action;
      if (action === "start") {
        this.startGame();
      } else if (action === "pause") {
        this.simulation.command({ type: "pause", value: true });
        this.show("pause-screen");
      } else if (action === "resume") {
        this.simulation.command({ type: "pause", value: false });
        this.hide("pause-screen");
      } else if (action === "restart") {
        this.restartGame();
      } else if (action === "build") {
        this.handleBuild(target.dataset.kind as Exclude<BuildingKind, "city" | "barracks">);
      } else if (action === "build-barracks") {
        this.handleBuildBarracks(target.dataset.unitType as UnitType);
      } else if (action === "upgrade") {
        this.handleUpgrade(target.dataset.buildingId ?? "");
      } else if (action === "set-production-pause") {
        this.handleProductionPause(
          target.dataset.buildingId ?? "",
          target.dataset.paused === "true",
        );
      } else if (action === "clear-selection") {
        this.selectedCoord = null;
        this.scene?.setSelected(null);
        this.renderActionPanel();
      }
    });
  }

  private startGame(): void {
    this.hide("start-screen");
    this.show("hud");
    this.simulation.start();
    this.scene?.resetView();
    this.resultShown = false;
    this.renderActionPanel();
  }

  private restartGame(): void {
    this.simulation.command({ type: "restart" });
    this.simulation.start();
    this.scene?.resetView();
    this.hide("pause-screen");
    this.hide("result-screen");
    this.show("hud");
    this.selectedCoord = null;
    this.scene?.setSelected(null);
    this.resultShown = false;
    this.renderActionPanel();
  }

  private handleBuild(kind: Exclude<BuildingKind, "city" | "barracks">): void {
    if (!this.selectedCoord) {
      return;
    }
    const result = this.simulation.command({
      type: "build",
      player: "blue",
      kind,
      coord: this.selectedCoord,
    });
    if (!result.ok) {
      this.toast(result.reason ?? "无法建造");
      return;
    }
    this.renderActionPanel();
  }

  private handleBuildBarracks(unitType: UnitType): void {
    if (!this.selectedCoord) {
      return;
    }
    const result = this.simulation.command({
      type: "buildBarracks",
      player: "blue",
      unitType,
      coord: this.selectedCoord,
    });
    if (!result.ok) {
      this.toast(result.reason ?? "无法建造兵营");
      return;
    }
    this.renderActionPanel();
  }

  private handleUpgrade(buildingId: string): void {
    const result = this.simulation.command({
      type: "upgrade",
      player: "blue",
      buildingId,
    });
    if (!result.ok) {
      this.toast(result.reason ?? "无法升级");
      return;
    }
    this.renderActionPanel();
  }

  private handleProductionPause(buildingId: string, paused: boolean): void {
    const result = this.simulation.command({
      type: "setBarracksProductionPaused",
      player: "blue",
      buildingId,
      paused,
    });
    if (!result.ok) {
      this.toast(result.reason ?? "无法调整兵营生产");
      return;
    }
    this.renderActionPanel();
  }

  private renderLoop(): void {
    if (this.simulation.state.revision !== this.lastRevision) {
      this.lastRevision = this.simulation.state.revision;
      this.renderStatus();
      this.renderResult();
      const dockTick = Math.floor(this.simulation.state.elapsed * 2);
      if (dockTick !== this.lastDockTick && this.shouldRefreshActionPanel()) {
        this.lastDockTick = dockTick;
        this.renderActionPanel();
      }
    }
    requestAnimationFrame(() => this.renderLoop());
  }

  private renderStatus(): void {
    const blueCity = this.findCity("blue");
    const redCity = this.findCity("red");
    const blueMax = blueCity ? this.simulation.getBuildingMaxHp(blueCity) : 1;
    const redMax = redCity ? this.simulation.getBuildingMaxHp(redCity) : 1;
    this.setText("blue-name", PLAYER_LABELS.blue);
    this.setText("red-name", PLAYER_LABELS.red);
    this.setStyleWidth("blue-hp", blueCity ? (blueCity.hp / blueMax) * 100 : 0);
    this.setStyleWidth("red-hp", redCity ? (redCity.hp / redMax) * 100 : 0);
    this.setText("gold-value", `${Math.floor(this.simulation.state.players.blue.gold)}`);
    this.setText("income-value", `+${this.simulation.getIncomeRate("blue")}`);
    this.setText("battle-time", this.formatTime(this.simulation.state.elapsed));
  }

  private shouldRefreshActionPanel(): boolean {
    if (!this.selectedCoord) {
      return false;
    }
    const cell = this.simulation.state.cells[hexKey(this.selectedCoord)];
    const building = cell?.buildingId
      ? this.simulation.state.buildings[cell.buildingId]
      : undefined;
    return building?.owner === "blue";
  }

  private renderActionPanel(): void {
    const dock = this.root.querySelector<HTMLElement>("#action-dock");
    if (!dock || !this.simulation.state.started) {
      return;
    }
    dock.classList.remove("is-idle", "is-build", "is-building", "is-invalid");
    if (!this.selectedCoord) {
      dock.classList.add("is-idle");
      dock.innerHTML = `
        <div class="dock-hint compact">
          <span class="tap-mark">+</span>
          <strong>点高亮空地建造，点建筑管理</strong>
        </div>
      `;
      return;
    }

    const cell = this.simulation.state.cells[hexKey(this.selectedCoord)];
    const building = cell?.buildingId
      ? this.simulation.state.buildings[cell.buildingId]
      : undefined;
    if (building?.owner === "blue") {
      dock.classList.add("is-building");
      dock.innerHTML = this.buildingPanel(building);
      return;
    }

    if (this.simulation.canBuild("blue", this.selectedCoord)) {
      dock.classList.add("is-build");
      dock.innerHTML = this.buildPanel();
      return;
    }

    dock.classList.add("is-invalid");
    dock.innerHTML = `
      <div class="dock-hint unavailable">
        <span class="tap-mark">×</span>
        <div><strong>这里暂时无法建造</strong><small>先让领土与这个地块相连</small></div>
        <button class="dock-close" data-action="clear-selection">关闭</button>
      </div>
    `;
  }

  private buildPanel(): string {
    const kinds: Exclude<BuildingKind, "city" | "barracks">[] = ["mine", "tower"];
    const barracksCost = this.simulation.config.buildings.barracks.buildCost;
    const trainableUnits = this.simulation.getTrainableUnits();
    return `
      <div class="dock-title">
        <span>选择建筑 <small>建造＝建筑费用 · 生产/轮＝每轮费用</small></span>
        <button data-action="clear-selection" aria-label="关闭建筑选择">×</button>
      </div>
      <div class="build-strip">
        <div class="build-row structure-row">
          ${kinds
            .map((kind) => {
              const definition = this.simulation.config.buildings[kind];
              const affordable =
                this.simulation.state.players.blue.gold >= definition.buildCost;
              return `
                <button class="build-chip structure-choice ${affordable ? "" : "disabled"}" data-action="build" data-kind="${kind}" aria-label="建造${definition.label}，花费 ${definition.buildCost} 金币">
                  <i class="building-icon ${kind}">${kind === "mine" ? mineIconImage() : BUILDING_ICONS[kind]}</i>
                  <span class="build-chip-copy">
                    <strong>${definition.label}</strong>
                    <small><em>建造</em><b>◆${definition.buildCost}</b></small>
                  </span>
                </button>
              `;
            })
            .join("")}
        </div>
        <div class="build-row barracks-row">
          ${trainableUnits
            .map((unit) => {
              const affordable = this.simulation.state.players.blue.gold >= barracksCost;
              return `
                <button class="build-chip barracks-choice ${affordable ? "" : "disabled"}" data-action="build-barracks" data-unit-type="${unit.id}" aria-label="建造${unit.label}营，${unit.summary}，花费 ${barracksCost} 金币；每轮生产花费 ${unit.cost} 金币">
                  <i class="building-icon barracks" style="--unit-accent:${unit.accentColor}">${unit.icon}</i>
                  <span class="build-chip-copy">
                    <strong>${unit.label}营<mark>${unit.summary}</mark></strong>
                    <small><em>建造</em><b>◆${barracksCost}</b></small>
                    <small><em>生产/轮</em><b>◆${unit.cost}</b></small>
                  </span>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  private buildingPanel(building: BuildingState): string {
    const definition = this.simulation.config.buildings[building.kind];
    const currentLevel = definition.levels[building.level - 1];
    const nextLevel = definition.levels[building.level];
    const hp = Math.max(0, Math.ceil(building.hp));
    const maxHp = this.simulation.getBuildingMaxHp(building);
    const autoUnit = building.autoUnitType
      ? this.simulation.config.units[building.autoUnitType]
      : null;
    const buildingLabel = building.kind === "barracks" && autoUnit
      ? `${autoUnit.label}营`
      : definition.label;
    const levelCopy =
      building.kind === "mine"
        ? `产出 +${currentLevel.income}/秒`
        : building.kind === "tower"
          ? `伤害 ${currentLevel.damage}`
          : building.kind === "barracks"
            ? `自动生产 ${autoUnit?.label ?? "单位"} · ${autoUnit?.summary ?? ""}`
            : "领地核心";
    const upgrade =
      building.kind !== "city" && nextLevel
        ? `<button class="upgrade-button" data-action="upgrade" data-building-id="${building.id}">
             <span>升 Lv.${building.level + 1}</span><b>◆ ${nextLevel.upgradeCost}</b>
           </button>`
        : `<div class="max-level">${building.kind === "city" ? "主城不可升级" : "已达最高等级"}</div>`;
    const production =
      building.kind === "barracks" ? this.productionPanel(building) : "";
    return `
      <div class="building-detail">
        <i class="building-icon ${building.kind}">${building.kind === "mine" ? mineIconImage() : autoUnit?.icon ?? (building.kind === "city" ? "城" : BUILDING_ICONS[building.kind])}</i>
        <div class="building-copy">
          <strong>${buildingLabel} <b>Lv.${building.level}</b></strong>
          <small>${levelCopy} · 耐久 ${hp}/${maxHp}</small>
        </div>
        ${upgrade}
        <button class="dock-close icon" data-action="clear-selection">×</button>
      </div>
      ${production}
    `;
  }

  private productionPanel(building: BuildingState): string {
    if (!building.autoUnitType) {
      return "";
    }
    const unit = this.simulation.config.units[building.autoUnitType];
    const production = building.production;
    const productionMode = building.productionMode ?? "running";
    const progress =
      production && production.paid
        ? 1 - production.remaining / Math.max(0.01, production.duration)
        : 0;
    const status =
      productionMode === "paused"
        ? "生产已暂停"
        : productionMode === "pauseAfterCurrent"
          ? production?.pauseReason === "unitCap"
            ? "等待空位，出兵后暂停"
            : "本轮结束后暂停"
          : production?.pauseReason === "gold"
        ? "金币不足，自动等待"
        : production?.pauseReason === "unitCap"
          ? "单位上限，等待空位"
          : production?.paid
            ? `正在生产 Lv.${production.level}`
            : "准备自动生产";
    const timeCopy =
      production?.paid && production.remaining > 0
        ? `${Math.ceil(production.remaining)}秒`
        : `每轮 ◆${unit.cost}`;
    const shouldResume = productionMode !== "running";
    const toggleLabel = shouldResume ? "继续生产" : "暂停生产";
    return `
      <div class="production-row">
        <div class="production-copy">
          <i>${unit.icon}</i>
          <span><strong>${unit.label}</strong><small>${status}</small></span>
          <b>${timeCopy}</b>
          <button class="production-toggle ${shouldResume ? "resume" : ""}" data-action="set-production-pause" data-building-id="${building.id}" data-paused="${shouldResume ? "false" : "true"}" aria-label="${toggleLabel}">${toggleLabel}</button>
        </div>
        <div class="production-track">
          <i style="width:${Math.max(0, Math.min(100, Math.round(progress * 100)))}%"></i>
        </div>
      </div>
    `;
  }

  private renderResult(): void {
    const winner = this.simulation.state.winner;
    if (!winner || this.resultShown) {
      return;
    }
    this.resultShown = true;
    const won = winner === "blue";
    this.setText("result-kicker", won ? "征服完成" : "主城陷落");
    this.setText("result-title", won ? "疆域尽归于你" : "整军再战");
    this.setText(
      "result-message",
      won ? "你的经营与军队击穿了赤焰防线。" : "重新规划金币投入，下一局扭转战势。",
    );
    this.setText("result-emblem", won ? "♛" : "⚑");
    this.setText("result-time", this.formatTime(this.simulation.state.elapsed));
    this.setText(
      "result-income",
      `${Math.floor(this.simulation.state.players.blue.stats.incomeEarned)}`,
    );
    this.setText(
      "result-units",
      `${this.simulation.state.players.blue.stats.unitsProduced}`,
    );
    this.setText(
      "result-buildings",
      `${this.simulation.state.players.blue.stats.buildingsBuilt}`,
    );
    this.show("result-screen");
  }

  private findCity(player: "blue" | "red"): BuildingState | undefined {
    return Object.values(this.simulation.state.buildings).find(
      (building) => building.owner === player && building.kind === "city",
    );
  }

  private toast(message: string): void {
    const toast = this.root.querySelector<HTMLElement>("#toast");
    if (!toast) {
      return;
    }
    window.clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    this.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  }

  private setText(id: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (element) {
      element.textContent = value;
    }
  }

  private setStyleWidth(id: string, value: number): void {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (element) {
      element.style.width = `${Math.max(0, Math.min(100, value))}%`;
    }
  }

  private show(id: string): void {
    this.root.querySelector(`#${id}`)?.classList.remove("hidden");
  }

  private hide(id: string): void {
    this.root.querySelector(`#${id}`)?.classList.add("hidden");
  }
}
