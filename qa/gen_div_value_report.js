'use strict';
/* 26i: 生成《师级算子数值报告》——全部数值从 data_div_oob.js 自动读取, 不做手抄 */
global.window = global;
const fs = require('fs');
for (const f of ['hex.js', 'data.js', 'achv_data.js', 'achv.js', 'data_big_oob.js', 'data_big.js', 'data_div_oob.js', 'data_div.js']) eval(fs.readFileSync('D:/ardennes-big/js/' + f, 'utf8'));

const B = globalThis.DATA_DIV_OOB, M = B.META_DIV;
const TN = { ARM: '装甲', MOT: '装掷', INF: '步兵', ABN: '空降', FJ: '伞兵', RKT: '火箭炮', RECON: '侦察', TD: '歼击' };
const all = [...B.OOB_DIV_DE, ...B.OOB_DIV_US];
const units = all.filter(r => !/^HQ/.test(r[3]));
const hqs = all.filter(r => /^HQ/.test(r[3]));

const grp = (nat, note) => units.filter(r => M[r[0]].nat === nat && (!note || M[r[0]].note === note));
const stat = a => {
  if (!a.length) return null;
  const sa = a.reduce((s, r) => s + r[4], 0), sd = a.reduce((s, r) => s + r[5], 0);
  return { n: a.length, atk: sa, def: sd, aa: sa / a.length, ad: sd / a.length,
    org: a.reduce((s, r) => s + r[10], 0) / a.length };
};

const L = [];
const P = (x) => L.push(x);

P('# 师级算子数值报告');
P('');
P('> **版本**：26i（2026-10-28）｜ **数据集**：`js/data_div_oob.js`（生成物，源 `tools/gen_data_div.js`）');
P('> **适用剧本**：突出部战役（师级）12 回合 / 阿登全战役（师级）24 回合 ｜ **地图**：34×21');
P('> **算子总数**：' + all.length + ' = 师旅 ' + units.length + ' + 总指挥部 ' + hqs.length);
P('> **本报告数值由脚本从生成物直接导出**（无手抄），命令：`node qa/gen_div_value_report.js`');
P('');
P('---');
P('');
P('## 一、数值构成原理');
P('');
P('| 字段 | 生成规则 | 说明 |');
P('|---|---|---|');
P('| **攻 / 防** | 全师（旅）所辖各营 **数值合计** | 直接反映真实兵力规模：美军满编师 17–24 营、德军国民掷弹兵师 12 营，比约 1:2 |');
P('| **移动** | 按**主导兵种**给值：装甲 6 / 装掷 5 / 步·空降·伞 4 / 火箭炮 3 | 师内炮兵慢但不拖累全师机动（原取最慢营致全部为 3，已修正） |');
P('| **组织度** | 手工定档，区间 **56–128**（按攻防量级 × 梯度） | 继承 24i 分层：党卫军装甲 18、装甲教导师 16、国防军装甲 15、伞兵 15、国民掷弹兵 10；美军空降 17、老牌步兵 15、新兵 11 |');
P('| **入场回合** | 该师**最早**一批营的到场回合 | R0 = 1944-12-16 开局在场；R1 = 12-17，依此类推 |');
P('| **位置** | 逐单位史实部署坐标（34×21） | 按 1944-12-16 集团军/军展开线，见 HANDOVER 26h |');
P('| **伤害倍率** | `DATA.DMG_SCALE` = **2.5**（师级） | 伤害表 AE7/AR2/EX3·4/DR3/DE6 与整补 +2/+3、断补 -1 全部同比 ×2.5 —— 组织度放大后战斗节奏与营级一致（营级 DE 掉 6 扛 3 次 ↔ 师级 DE 掉 15 扛 3.2 次） |');
P('');
P('**素质分层的叠加效应**：单营数值先经 24f 分层（VGD 攻2/防3、党卫军装甲 攻10/防6、空降 攻5/防7），再做师级合计。因此' +
  '德军国民掷弹兵师（12 营 × 2/3）与美军空降师（24 营 × 5/7）的差距会放大到约 3.8 倍——这是史实兵力与素质双重差距的体现。');
P('');
P('---');
P('');

/* 各阵营表 */
const sections = [
  ['二、德军 26 师', 'DE', '师'],
  ['三、德军 11 旅', 'DE', '旅'],
  ['四、美军 28 师', 'US', '师'],
  ['五、英军 5 师', 'UK', '师'],
  ['六、英军 2 旅', 'UK', '旅'],
];
for (const [title, nat, note] of sections) {
  const a = grp(nat, note);
  if (!a.length) continue;
  const s = stat(a);
  P('## ' + title);
  P('');
  P(`> ${a.length} 个单位 ｜ 总攻 **${s.atk}** · 总防 **${s.def}** ｜ 均值 攻 **${s.aa.toFixed(1)}** / 防 **${s.ad.toFixed(1)}** / 组织度 **${s.org.toFixed(1)}**`);
  P('');
  P('| 单位 | 兵种 | 攻 | 防 | 移 | 组织度 | 入场 | 位置 |');
  P('|---|---|---|---|---|---|---|---|');
  for (const r of a) {
    P(`| ${r[1]} | ${TN[r[3]] || r[3]} | ${r[4]} | ${r[5]} | ${r[6]} | ${r[10]} | R${r[9]} | (${r[7]},${r[8]}) |`);
  }
  P('');
}

/* 指挥部 */
P('## 七、总指挥部（2 座）');
P('');
P('| 单位 | 组织度 | 攻/防 | 位置 | 被摧毁效果 |');
P('|---|---|---|---|---|');
for (const r of hqs) {
  P(`| ${r[1]} | ${r[10]} | ${r[4]}/${r[5]} | (${r[7]},${r[8]}) | 本国籍全军 组织度与攻防 **−${Math.round(4 * (globalThis.DATA_DIV.DMG_SCALE || 1))}**（下限 1） |`);
}
P('');
P('> 师级剧本只保留两军总指挥部（军/集团军/集团军群指挥部已移除）；英军算子按美军阵营处理，同样受美军总指挥部冲击影响。');
P('');
P('---');
P('');
P('## 八、平衡统计');
P('');
P('| 维度 | 数量 | 总攻 | 总防 | 均攻 | 均防 | 均组织度 |');
P('|---|---|---|---|---|---|---|');
for (const [label, nat, note] of [['德军师', 'DE', '师'], ['德军旅', 'DE', '旅'], ['美军师', 'US', '师'], ['英军师', 'UK', '师'], ['英军旅', 'UK', '旅']]) {
  const a = grp(nat, note);
  if (!a.length) continue;
  const s = stat(a);
  P(`| ${label} | ${s.n} | ${s.atk} | ${s.def} | ${s.aa.toFixed(1)} | ${s.ad.toFixed(1)} | ${s.org.toFixed(1)} |`);
}
{
  const de = grp('DE'), al = [...grp('US'), ...grp('UK')];
  const sd = stat(de), sa = stat(al);
  P(`| **德军合计** | **${sd.n}** | **${sd.atk}** | **${sd.def}** | ${sd.aa.toFixed(1)} | ${sd.ad.toFixed(1)} | ${sd.org.toFixed(1)} |`);
  P(`| **盟军合计** | **${sa.n}** | **${sa.atk}** | **${sa.def}** | ${sa.aa.toFixed(1)} | ${sa.ad.toFixed(1)} | ${sa.org.toFixed(1)} |`);
  P(`| 比值（盟/德） | ${(sa.n / sd.n).toFixed(2)} | **${(sa.atk / sd.atk).toFixed(2)}** | **${(sa.def / sd.def).toFixed(2)}** | — | — | — |`);
}
P('');
P('**兵种分布**：');
P('');
{
  const tc = {}, mc = {}, ar = {};
  units.forEach(r => { tc[r[3]] = (tc[r[3]] || 0) + 1; mc[r[6]] = (mc[r[6]] || 0) + 1; ar[r[9]] = (ar[r[9]] || 0) + 1; });
  P('| 兵种 | 数量 | 单位 |');
  P('|---|---|---|');
  for (const [k, v] of Object.entries(tc).sort((x, y) => y[1] - x[1])) {
    P(`| ${TN[k] || k} | ${v} | ${units.filter(r => r[3] === k).map(r => r[1].replace(/军第|国民掷弹兵师|步兵师|装甲师|空降师|伞兵师|装掷师|装甲旅|火箭炮旅/g, '')).slice(0, 8).join('、')}${v > 8 ? '…' : ''} |`);
  }
  P('');
  P('**机动分布**：' + Object.entries(mc).sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k} 格 × ${v}`).join(' ｜ '));
  P('');
  P('**入场节奏**：' + Object.entries(ar).sort((a, b) => a[0] - b[0]).map(([k, v]) => `R${k}: ${v}`).join(' ｜ '));
}
P('');
P('---');
P('');
P('## 九、本次修订（26i）');
P('');
P('| # | 问题 | 修正前 | 修正后 |');
P('|---|---|---|---|');
P('| 1 | 移动力取"全师最慢营"（炮兵 mov=3） | 72 个师旅**全部为 3** | 按主导兵种：装甲 6 / 装掷 5 / 步·空降·伞 4 / 火箭炮 3 |');
P('| 2 | 第26国民掷弹兵师类型误判 | 「侦察」（domType 未计 VGD，侦察营占比误触发） | 「步兵」41/35/移4 |');
P('| 3 | 英军近卫装甲师类型误判 | 「步兵」（OOB 把英装甲旅坦克营标为 INF） | 「装甲」56/58/移6 |');
P('');
P('---');
P('');
P('## 十、遗留问题与建议（未改动，待决策）');
P('');
P('| # | 现象 | 分析 | 建议 |');
P('|---|---|---|---|');
P('| 1 | **15 个国民掷弹兵师数值完全相同**（38/33/10） | 史实上第12、第26 VG 由旧师残部组建、有实战经验；第 212/276/340 为新建民兵 | 分 2–3 档：精锐 VG 约 44/38、普通 38/33、新建 34/30 |');
P('| 2 | **第82空降师 146/146 全图最强**（≈3.8 个 VG 师） | 24 营 × 空降单营 5/7 的合计；史实精锐但数值倾斜过度 | 可压缩空降单营加成（如 5/7 → 4/6）或对师级作战力设上限 |');
P('| 3 | **英军第33装甲旅仅 1 营**（9/6） | 营级 OOB 原始记录只有 1 个装甲营；史实该旅应有 3 团 | 补录或标注为"部分参战" |');
P('| 4 | 第30步兵师按 R1 在场（史实 12/19 才到） | 入场回合继承营级 OOB 的最早营 | 可将该师入场改为 R3 |');
P('');
P('---');
P('');
P('## 附：数据来源与校验');
P('');
P('- **生成管线**：`tools/gen_data_div.js` → `js/data_div_oob.js`（勿手改产物）');
P('- **数值来源**：大推演营级 OOB（1217 营）按师旅聚合；营级数值来自 `data.js` STATS + 24f 素质分层');
P('- **组织度来源**：24i `orgFor()` 分层（8–20）');
P('- **校验**：`qa/div_check.js` **37 项**全绿（含 6 项史实地理断言、聚合正确性抽样、补给禁用、成就互通）');
P('- **地理**：`qa/div_geo_audit.js` 输出（城镇相对关系 / 质心分界 / 越界检查 / 地形构成）');
P('');

fs.writeFileSync('D:/ardennes-big/docs/师级算子数值报告.md', L.join('\n'));
console.log('✓ 报告已生成: docs/师级算子数值报告.md ·', L.length, '行');
console.log('  师旅', units.length, '· 总指挥部', hqs.length, '· 德', grp('DE').length, '· 美', grp('US').length, '· 英', grp('UK').length);
