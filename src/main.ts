import Phaser from "phaser";
import { GameSimulation } from "./game/simulation";
import { BattleScene } from "./phaser/BattleScene";
import { GameUI } from "./ui/GameUI";
import "./styles.css";

interface TerritoryDemoWindow extends Window {
  __territoryDemo?: {
    simulation: GameSimulation;
    scene?: BattleScene;
  };
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("Missing app root");
}

app.innerHTML = `
  <main class="page-shell">
    <div class="phone-frame">
      <div id="game-container"></div>
      <div id="ui-root"></div>
    </div>
    <aside class="desktop-note">
      <span>H5 Strategy Demo</span>
      <strong>疆域铸造</strong>
      <p>在有限金币中选择发展、扩军或筑防。手机竖屏体验最佳。</p>
    </aside>
  </main>
`;

const simulation = new GameSimulation();
const demoWindow = window as TerritoryDemoWindow;
const uiRoot = document.querySelector<HTMLElement>("#ui-root");
if (!uiRoot) {
  throw new Error("Missing UI root");
}
const ui = new GameUI(uiRoot, simulation);
const battleScene = new BattleScene(simulation, (coord) => ui.selectCell(coord));
demoWindow.__territoryDemo = { simulation, scene: battleScene };
ui.attachScene(battleScene);

new Phaser.Game({
  type: Phaser.AUTO,
  width: 390,
  height: 844,
  parent: "game-container",
  backgroundColor: "#17254d",
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 390,
    height: 844,
  },
  scene: [battleScene],
});
