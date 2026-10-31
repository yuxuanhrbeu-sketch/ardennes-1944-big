# 素材来源与第三方许可 / Credits & Third-Party Notices

本仓库**代码与自研数据**以 [MIT](LICENSE) 许可发布。
但下列素材**不适用 MIT**，各自保留原有许可或公有领域状态——分发、二次开发时请遵守。

---

## 1. 档案插图（v1.1.0 起为中性占位图）

v1.0.0 曾内嵌 46 张公开来源的史实照片（Wikimedia Commons 等）。
**v1.1.0 起全部替换为一张自绘中性占位图**（`vendor/photos/placeholder_26u.jpg`），
不再分发任何第三方摄影作品；游戏内「部队档案卡 / 指挥官简报 / 胜利画面」的插图位
统一由该占位图呈现。占位图由本项目管理员提供，随 [MIT](LICENSE) 一并许可。

## 2. three.js（`vendor/three.min.js`、`vendor/three.module.min.js`）

- 许可：**MIT**（Copyright © 2010-2024 three.js authors）
- 来源：<https://github.com/mrdoob/three.js>（r160 系列）
- 说明：`three.min.js`（经典脚本版）由 `tools/mk_three_classic.js` 从 ES module 版转换生成，
  供单文件成品以 `gzip + base64 + DecompressionStream` 内联加载；升级 three 后需重跑该脚本。

## 3. 原版《阿登 1944》（`vendor/classic/ardennes44_classic.html`）

- 许可：**MIT**（与本项目同一作者作品，随本仓库一并开源）
- 说明：成品里的 01/02 剧本会在新窗口打开这份原版完整成品，属本项目的组成部分。

## 4. 地理与编制数据

- **城镇名**：真实地名，来自公开地理资料与史料（481 座，坐标按真实经纬度标定换算）。
- **作战序列（OOB）**：1192 个营的编制、隶属、番号来自公开的作战序列表与师史，
  属史实性事实数据；`tools/oob_big/source/*.csv` 为整理后的原始表。
- **人物姓名**：仅用于档案卡的史实说明，不含肖像权主张。

---

*照片许可历史表见 v1.0.0（git 历史）的 CREDITS.md。*
