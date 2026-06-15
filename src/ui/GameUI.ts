import { hexKey } from "../game/hex";
import type { GameSimulation } from "../game/simulation";
import type { BuildingKind, BuildingState, HexCoord } from "../game/types";
import type { BattleScene } from "../phaser/BattleScene";
import { PLAYER_LABELS } from "../phaser/BattleScene";

const BUILDING_ICONS: Record<Exclude<BuildingKind, "city">, string> = {
  mine: "矿",
  barracks: "兵",
  tower: "塔",
};

const BUILDING_DESCRIPTIONS: Record<Exclude<BuildingKind, "city">, string> = {
  mine: "持续增加金币收入",
  barracks: "训练部队进攻敌城",
  tower: "自动攻击附近敌军",
};

interface TutorialStep {
  title: string;
  body: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  { title: "第一步：建立经济", body: "点击蓝色领地旁的亮点格，建造一座金矿。" },
  { title: "第二步：准备军队", body: "继续扩张，并建造一座兵营。" },
  { title: "第三步：训练步兵", body: "点击兵营，花费金币将步兵加入训练队列。" },
  { title: "第四步：升级建筑", body: "攒够金币后升级任意矿场、兵营或防御塔。" },
];

export class GameUI {
  private readonly root: HTMLElement;
  private readonly simulation: GameSimulation;
  private scene: BattleScene | null = null;
  private selectedCoord: HexCoord | null = null;
  private tutorialStep = 0;
  private tutorialActive = true;
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
              <span>${PLAYER_LABELS.red}</span>
              <div class="hp-track"><i id="red-hp"></i></div>
            </div>
          </div>
          <div class="versus-badge">VS</div>
          <div class="base-status player">
            <div class="base-copy align-right">
              <span>${PLAYER_LABELS.blue}</span>
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
        <div class="tutorial-bubble" id="tutorial-bubble">
          <button class="tutorial-skip" data-action="skip-tutorial">跳过</button>
          <strong id="tutorial-title"></strong>
          <p id="tutorial-body"></p>
          <div class="tutorial-dots" id="tutorial-dots"></div>
        </div>
      </div>

      <section class="screen-overlay start-screen" id="start-screen">
        <div class="sunburst"></div>
        <div class="start-content">
          <div class="mini-crown">♛</div>
          <p class="eyebrow">竖屏即时策略</p>
          <h1>疆域铸造</h1>
          <p class="subtitle">每一枚金币，都决定疆域的走向</p>
          <div class="feature-row">
            <div><b>矿</b><span>经营经济</span></div>
            <div><b>兵</b><span>训练军队</span></div>
            <div><b>塔</b><span>稳固防线</span></div>
          </div>
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
      } else if (action === "skip-tutorial") {
        this.tutorialActive = false;
        this.hideTutorial();
      } else if (action === "build") {
        this.handleBuild(target.dataset.kind as Exclude<BuildingKind, "city">);
      } else if (action === "upgrade") {
        this.handleUpgrade(target.dataset.buildingId ?? "");
      } else if (action === "train") {
        this.handleTrain(target.dataset.buildingId ?? "", target.dataset.unitType ?? "");
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
    this.tutorialStep = 0;
    this.tutorialActive = true;
    this.resultShown = false;
    this.renderTutorial();
    this.renderActionPanel();
  }

  private restartGame(): void {
    this.simulation.command({ type: "restart" });
    this.simulation.start();
    this.hide("pause-screen");
    this.hide("result-screen");
    this.show("hud");
    this.selectedCoord = null;
    this.scene?.setSelected(null);
    this.tutorialStep = 0;
    this.tutorialActive = true;
    this.resultShown = false;
    this.renderTutorial();
    this.renderActionPanel();
  }

  private handleBuild(kind: Exclude<BuildingKind, "city">): void {
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
    if (
      (this.tutorialStep === 0 && kind === "mine") ||
      (this.tutorialStep === 1 && kind === "barracks")
    ) {
      this.advanceTutorial();
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
    if (this.tutorialStep === 3) {
      this.advanceTutorial();
    }
    this.renderActionPanel();
  }

  private handleTrain(buildingId: string, unitType: string): void {
    const result = this.simulation.command({
      type: "enqueueUnit",
      player: "blue",
      buildingId,
      unitType,
    });
    if (!result.ok) {
      this.toast(result.reason ?? "无法训练");
      return;
    }
    if (this.tutorialStep === 2) {
      this.advanceTutorial();
    }
    this.renderActionPanel();
  }

  private renderLoop(): void {
    if (this.simulation.state.revision !== this.lastRevision) {
      this.lastRevision = this.simulation.state.revision;
      this.renderStatus();
      this.renderResult();
      const dockTick = Math.floor(this.simulation.state.elapsed * 2);
      if (dockTick !== this.lastDockTick) {
        this.lastDockTick = dockTick;
        this.renderActionPanel();
      }
    }
    requestAnimationFrame(() => this.renderLoop());
  }

  private renderStatus(): void {
    const blueCity = this.findCity("blue");
    const redCity = this.findCity("red");
    const blueMax = this.simulation.config.buildings.city.levels[0].maxHp;
    const redMax = blueMax;
    this.setStyleWidth("blue-hp", blueCity ? (blueCity.hp / blueMax) * 100 : 0);
    this.setStyleWidth("red-hp", redCity ? (redCity.hp / redMax) * 100 : 0);
    this.setText("gold-value", `${Math.floor(this.simulation.state.players.blue.gold)}`);
    this.setText("income-value", `+${this.simulation.getIncomeRate("blue")}`);
    this.setText("battle-time", this.formatTime(this.simulation.state.elapsed));
  }

  private renderActionPanel(): void {
    const dock = this.root.querySelector<HTMLElement>("#action-dock");
    if (!dock || !this.simulation.state.started) {
      return;
    }
    if (!this.selectedCoord) {
      dock.innerHTML = `
        <div class="dock-hint">
          <span class="tap-mark">+</span>
          <div><strong>选择边界地块</strong><small>在发光的空地建造，或点击建筑管理</small></div>
        </div>
      `;
      return;
    }

    const cell = this.simulation.state.cells[hexKey(this.selectedCoord)];
    const building = cell?.buildingId
      ? this.simulation.state.buildings[cell.buildingId]
      : undefined;
    if (building?.owner === "blue") {
      dock.innerHTML = this.buildingPanel(building);
      return;
    }

    if (this.simulation.canBuild("blue", this.selectedCoord)) {
      dock.innerHTML = this.buildPanel();
      return;
    }

    dock.innerHTML = `
      <div class="dock-hint unavailable">
        <span class="tap-mark">×</span>
        <div><strong>这里暂时无法建造</strong><small>先让领土与这个地块相连</small></div>
        <button class="dock-close" data-action="clear-selection">关闭</button>
      </div>
    `;
  }

  private buildPanel(): string {
    const kinds: Exclude<BuildingKind, "city">[] = ["mine", "barracks", "tower"];
    return `
      <div class="dock-title"><span>选择建筑</span><button data-action="clear-selection">×</button></div>
      <div class="build-cards">
        ${kinds
          .map((kind) => {
            const definition = this.simulation.config.buildings[kind];
            const affordable =
              this.simulation.state.players.blue.gold >= definition.buildCost;
            return `
              <button class="build-card ${affordable ? "" : "disabled"}" data-action="build" data-kind="${kind}">
                <i class="building-icon ${kind}">${BUILDING_ICONS[kind]}</i>
                <strong>${definition.label}</strong>
                <small>${BUILDING_DESCRIPTIONS[kind]}</small>
                <span class="price"><b>◆</b>${definition.buildCost}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  private buildingPanel(building: BuildingState): string {
    const definition = this.simulation.config.buildings[building.kind];
    const currentLevel = definition.levels[building.level - 1];
    const nextLevel = definition.levels[building.level];
    const hp = Math.max(0, Math.ceil(building.hp));
    const levelCopy =
      building.kind === "mine"
        ? `产出 +${currentLevel.income}/秒`
        : building.kind === "tower"
          ? `伤害 ${currentLevel.damage}`
          : building.kind === "barracks"
            ? `训练 ${building.level}级单位`
            : "领地核心";
    const upgrade =
      building.kind !== "city" && nextLevel
        ? `<button class="upgrade-button" data-action="upgrade" data-building-id="${building.id}">
             <span>升级至 Lv.${building.level + 1}</span><b>◆ ${nextLevel.upgradeCost}</b>
           </button>`
        : `<div class="max-level">${building.kind === "city" ? "主城不可升级" : "已达最高等级"}</div>`;
    const training =
      building.kind === "barracks" ? this.trainingPanel(building) : "";
    return `
      <div class="dock-title">
        <span>${definition.label} <b>Lv.${building.level}</b></span>
        <button data-action="clear-selection">×</button>
      </div>
      <div class="building-detail">
        <i class="building-icon ${building.kind}">${building.kind === "city" ? "城" : BUILDING_ICONS[building.kind]}</i>
        <div class="building-copy">
          <strong>${levelCopy}</strong>
          <small>耐久 ${hp} / ${currentLevel.maxHp}</small>
        </div>
        ${upgrade}
      </div>
      ${training}
    `;
  }

  private trainingPanel(building: BuildingState): string {
    const units = Object.values(this.simulation.config.units);
    const queue = Array.from({ length: this.simulation.config.queueCap }, (_, index) => {
      const order = building.queue[index];
      if (!order) {
        return `<i></i>`;
      }
      const progress =
        1 -
        order.remaining /
          Math.max(0.01, this.simulation.config.units[order.unitType].trainTime);
      return `<i class="filled" style="--progress:${Math.round(progress * 100)}%">${order.level}</i>`;
    }).join("");
    return `
      <div class="training-row">
        <div class="unit-list">
          ${units
            .map(
              (unit) => `
                <button class="unit-card" data-action="train" data-building-id="${building.id}" data-unit-type="${unit.id}">
                  <i>⚔</i>
                  <span><strong>${unit.label} Lv.${Math.min(building.level, unit.levels.length)}</strong><small>${unit.trainTime}秒完成</small></span>
                  <b>◆ ${unit.cost}</b>
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="queue-box"><span>训练队列</span><div>${queue}</div></div>
      </div>
    `;
  }

  private renderTutorial(): void {
    const bubble = this.root.querySelector<HTMLElement>("#tutorial-bubble");
    if (!bubble || !this.tutorialActive || this.tutorialStep >= TUTORIAL_STEPS.length) {
      this.hideTutorial();
      return;
    }
    bubble.classList.remove("hidden");
    const step = TUTORIAL_STEPS[this.tutorialStep];
    this.setText("tutorial-title", step.title);
    this.setText("tutorial-body", step.body);
    const dots = this.root.querySelector<HTMLElement>("#tutorial-dots");
    if (dots) {
      dots.innerHTML = TUTORIAL_STEPS.map(
        (_, index) => `<i class="${index === this.tutorialStep ? "active" : ""}"></i>`,
      ).join("");
    }
  }

  private advanceTutorial(): void {
    this.tutorialStep += 1;
    if (this.tutorialStep >= TUTORIAL_STEPS.length) {
      this.tutorialActive = false;
      this.hideTutorial();
      this.toast("教程完成，接下来由你决定金币的去向");
    } else {
      this.renderTutorial();
    }
  }

  private hideTutorial(): void {
    this.root.querySelector("#tutorial-bubble")?.classList.add("hidden");
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
