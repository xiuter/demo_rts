# 疆域铸造 H5 Demo

一款以金币资源管理为核心的手机竖屏即时策略游戏 Demo。

## 玩法

- 在己方领土相邻的六边格建造金矿、三种专精兵营和防御塔。
- 升级金矿提高收入，升级兵营训练更强单位，升级防御塔提高伤害。
- 战士血量高、射手远程输出高、攻城兵擅长摧毁建筑，合理混编才能突破防线。
- 兵营会持续花费金币自动生产对应单位，也可以单独暂停以储蓄建设资金。
- 摧毁赤焰军团的主城即可获胜。

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://localhost:4173>。

## 验证

```bash
npm test
npm run test:e2e
npm run build
```

## 技术栈

- Phaser 3
- TypeScript
- Vite
- Vitest
- Playwright
