'use strict';
/* 一次性：按 集团军→军→师 汇总 1192 营编成树 */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/ardennes-big';
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
const M = globalThis.DATA_BIG.OOB_BIG_META;

const tree = {};   // army -> corps -> div -> n
let total = 0;
for (const [id, m] of Object.entries(M)) {
  const army = m.nat === 'UK' ? (m.army || '英军') : (m.army || '—');
  const corps = m.corps || '（无军级/直属）';
  const div = m.div || '—';
  tree[army] = tree[army] || {};
  tree[army][corps] = tree[army][corps] || {};
  tree[army][corps][div] = (tree[army][corps][div] || 0) + 1;
  total++;
}
const lines = [];
for (const army of Object.keys(tree)) {
  let an = 0;
  for (const c of Object.values(tree[army])) for (const n of Object.values(c)) an += n;
  lines.push(`【${army}】 ${an} 营`);
  for (const corps of Object.keys(tree[army])) {
    let cn = 0;
    for (const n of Object.values(tree[army][corps])) cn += n;
    lines.push(`  ├ ${corps} — ${cn} 营`);
    const divs = Object.entries(tree[army][corps]).sort((a, b) => b[1] - a[1]);
    for (const [d, n] of divs) lines.push(`  │   · ${d}（${n}）`);
  }
  lines.push('');
}
console.log('总营数', total);
console.log(lines.join('\n'));
