#!/usr/bin/env node
'use strict';
/* ============================================================
 * tools/gen_credits.js —— 由厂片清单生成 CREDITS.md（素材来源与第三方许可）
 *
 *   node tools/gen_credits.js
 *
 * 数据来源：vendor/photos/manifest.json（tools/fetch_photos.js 下载时写入，
 *   形如 { "<Commons 原图 URL>": "<本地文件名>.jpg" }）。
 * 许可判定只做**保守标注**：文件名可确证机构的才写具体许可，
 *   其余统一写"见源文件页"，不猜。需要逐张核准时在有网环境跑
 *   `node tools/check_photo_licenses.js`（可选，见 docs/HANDOVER.md）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'vendor', 'photos', 'manifest.json');

function commonsFile(url) {
  // https://upload.wikimedia.org/wikipedia/commons/a/ab/NAME.jpg?utm_source=...
  const clean = url.split('?')[0];
  const name = clean.split('/').pop();
  return decodeURIComponent(name).replace(/_/g, ' ');
}

function licenseOf(url, name) {
  if (/^Bundesarchiv/i.test(name)) return 'CC BY-SA 3.0 DE（德国联邦档案馆，需署名 + 相同方式共享）';
  if (/^SC[-_ ]|\bSC[-_ ]?\d{6}\b|Signal|NARA|111-SC|^USA[ _]\d/i.test(name)) return '公有领域（美国陆军通信兵团 / 美国国家档案馆，PD-USGov）';
  if (/^(USA|U\.S\.|US)[ _]/i.test(name)) return '公有领域（美国政府作品，PD-USGov）';
  if (/portrait|Patton|Bradley|Collins|Gerow|Eddy|Millikin|Middleton|Ridgway|Gavin|Montgomery|Horrocks|Knie|Prie|Bittrich|Dietrich|Manteuffel|Model|Lucht|Brandenberger/i.test(name)) {
    return '见源文件页（人物肖像，多为官方照片 / PD）';
  }
  return '见源文件页';
}

let table = '| # | 本地文件 | Commons 源文件 | 许可（保守标注） |\n|---|---|---|---|\n';
let rows = [];
if (fs.existsSync(MANIFEST)) {
  const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  rows = Object.entries(man)
    .map(([url, file]) => ({ url, file, name: commonsFile(url) }))
    .sort((a, b) => a.file.localeCompare(b.file));
  rows.forEach((r, i) => {
    const page = 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(r.name.replace(/ /g, '_'));
    table += `| ${i + 1} | \`${r.file}\` | [${r.name.replace(/\|/g, '\\|')}](${page}) | ${licenseOf(r.url, r.name)} |\n`;
  });
} else {
  table += '| – | （未找到 vendor/photos/manifest.json） | – | – |\n';
}

const out = `# 素材来源与第三方许可 / Credits & Third-Party Notices

本仓库**代码与自研数据**以 [MIT](LICENSE) 许可发布。
但下列素材**不适用 MIT**，各自保留原有许可或公有领域状态——分发、二次开发时请遵守。

---

## 1. 历史照片（\`vendor/photos/\`，共 ${rows.length} 张）

游戏内以「部队档案卡 / 指挥官简报 / 胜利画面」插图形式呈现；
\`node build.js\` 会把这些照片以 base64 内联进单文件成品（断网也能显示）。

> **版权声明**：照片版权归原作者 / 摄影机构所有，本项目**未对其重新授权**，
> 仅在游戏内以史实插图方式引用。下表「许可」列为**保守标注**——
> 权威许可以每行 Commons 文件页为准；如需再分发，请逐一核对源文件页。
>
> 括注惯例：\`PD-USGov\` = 美国政府作品（在美国属公有领域）；
> \`CC BY-SA 3.0 DE\` = 需署名并以相同方式共享。

${table}
---

## 2. three.js（\`vendor/three.min.js\`、\`vendor/three.module.min.js\`）

- 许可：**MIT** © three.js authors
- 来源：<https://github.com/mrdoob/three.js>（r160 系列）
- 说明：\`three.min.js\`（经典脚本版）由 \`tools/mk_three_classic.js\` 从 ES module 版转换生成，
  供单文件成品以 \`gzip + base64 + DecompressionStream\` 内联加载；升级 three 后需重跑该脚本。

## 3. 原版《阿登 1944》（\`vendor/classic/ardennes44_classic.html\`）

- 许可：**MIT**（与本项目同一作者作品，随本仓库一并开源）
- 说明：成品里的 01/02 剧本会在新窗口打开这份原版完整成品，属本项目的组成部分。

## 4. 地理与编制数据

- **城镇名**：真实地名，来自公开地理资料与史料（481 座，坐标按真实经纬度标定换算）。
- **作战序列（OOB）**：1192 个营的编制、隶属、番号来自公开的作战序列表与师史，
  属史实性事实数据；\`tools/oob_big/source/*.csv\` 为整理后的原始表。
- **人物姓名**：仅用于档案卡的史实说明，不含肖像权主张（肖像见第 1 节）。

## 5. 不入库的抓图缓存

\`vendor/photos/bulk/\`（\`tools/fetch_photos_bulk.js\` 的下载暂存）已在 \`.gitignore\` 中排除，
不随仓库分发；其内容同样适用上述照片许可规则。

---

*本文件由 \`node tools/gen_credits.js\` 生成（照片表来自 \`vendor/photos/manifest.json\`），
请勿手工编辑表格部分。*
`;

fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), out, 'utf8');
console.log('已生成 CREDITS.md，照片 ' + rows.length + ' 张');
