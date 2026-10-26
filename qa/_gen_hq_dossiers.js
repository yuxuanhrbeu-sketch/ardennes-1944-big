'use strict';
/* ============================================================
 * qa/_gen_hq_dossiers.js — 一次性生成直属营+缺失师旅档案分片（24o，2026-10-25）
 * 产出：js/dossiers_big_de4.js（德军直属营+167VG/9VG）
 *       js/dossiers_big_us3.js（美军直属营+78ID/3AD）
 *       js/dossiers_big_uk2.js（英军151旅+英直属若有）
 * 内容原则：intro 只写编制事实（OOB 表字段）+ 兵种职能通识；
 *          个别可查史实（海德特空降/653猎虎/999惩戒营）加一句，不虚构战绩。
 * 本脚本可重跑：直接覆盖三个产出文件。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['hex.js', 'data.js', 'data_big_oob.js', 'data_big.js']) {
  eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
}
const B = globalThis.DATA_BIG;
const M = B.OOB_BIG_META;

// id → dispName 反查表
const disp = {};
for (const r of B.OOB_DE) disp[r[0]] = r[1];
for (const r of B.OOB_US) disp[r[0]] = r[1];

const ROLE = [
  [/炮兵|FA Battalion|Artillery/, '野战炮兵营，以集中榴弹火力支援所属军、集团军正面的进攻与防御作战。'],
  [/AAA|防空/, '高射机枪营（Automatic Weapons），担负要地防空与对地压制射击双重任务。'],
  [/反坦克|坦克歼击|Antitank|Panzerjäger|Tank Destroyer/, '反坦克营，装备牵引/自行反坦克火器，执行反装甲伏击与直射支援。'],
  [/突击炮|Assault Gun/, '突击炮部队，为步兵冲击提供伴随直射火力。'],
  [/装甲兵|Tank Battalion/, '独立坦克营，通常配属步兵师遂行装甲突击与反冲击。'],
  [/工兵|Engineer/, '战斗工兵营，负责架桥、布雷、破障与阵地要塞化作业。'],
  [/通信|Signal/, '通信营，维系军、集团军司令部与所属各师的有线无线联络。'],
  [/空降兵|Fallschirmjager|Parachute/, '伞兵营，集团军直接掌握的机动预备队。'],
  [/火箭|RKT|Werfer/, '火箭炮部队，以多管火箭的瞬时覆盖火力实施压制。'],
  [/步兵|Infantry|Ost|Penal/, '步兵营，担任战线填补、守备与局部反击任务。'],
];
const roleIntro = raw => (ROLE.find(([re]) => re.test(raw || '')) || [null, '营级战斗/勤务分队，隶属上级司令部直接指挥。'])[1];

const fmtDate = s => (s || '').replace(/^(\d{4})\.(\d{2})-(\d{2})$/, '$1-$2-$3');

/* 手写师旅档案（match 兼容 div 形态） */
const HAND = [
  // —— 德军缺编师 ——
  { key: 'de_167vgd', side: 'DE', branch: '国防军', open: true,
    match: ['第167国民掷弹兵师'],
    name: '第167国民掷弹兵师（167. Volks-Grenadier-Division）',
    type: '国民掷弹兵师',
    strength: '下辖2个国民掷弹兵团、1个炮兵团及反坦克/工兵/信号直属分队',
    histDate: '1944-12-16（开局在场）',
    intro: '隶属第7集团军，开局展开在卢森堡东北埃希特纳赫正面的南翼，与美军第4步兵师隔绍尔河对峙。战役首日以佯动配合中路主攻，随后沿绍尔河一线转入阵地防御，逐步向德国边境收缩。',
    photo: '' },
  { key: 'de_9vgd', side: 'DE', branch: '国防军', open: true,
    match: ['第9国民掷弹兵师'],
    name: '第9国民掷弹兵师（9. Volks-Grenadier-Division）',
    type: '国民掷弹兵师',
    strength: '下辖2个国民掷弹兵团、1个炮兵团及反坦克/工兵/信号直属分队',
    histDate: '1944-12-16（开局在场）',
    intro: '隶属第7集团军的南翼师，开局负责掩护第5装甲集团军与第7集团军的接合部。战役中随南翼攻势向卢森堡方向牵制性推进，兵力火力均不及正规师，推进受阻后依托丘陵林地转入防御。',
    photo: '' },
  // —— 美军缺编师 ——
  { key: 'us_78id', side: 'US', branch: '美军', open: true,
    match: ['第78步兵师', '78th Infantry Division'],
    name: '美军第78步兵师（78th Infantry Division "Lightning"）',
    type: '步兵师',
    strength: '第309/310/311步兵团、第307野战炮兵营等师属分队',
    histDate: '1944-12-16（开局在场）',
    intro: '绰号“闪电”师。1944年12月从中欧整训区紧急北上进入比利时，团属各营率先投入封堵战线缺口，师主力随后在第5军编成内于南翼逐步展开，1945年1月转入对乌尔河方向的进攻。',
    photo: '' },
  { key: 'us_3ad', side: 'US', branch: '美军', open: true,
    match: ['第3装甲师', '3rd Armored'],
    name: '美军第3装甲师（3rd Armored Division "Spearhead"）',
    type: '装甲师',
    strength: '第36装甲步兵团、第32/33装甲团、第83装甲野战炮兵营等师属分队',
    histDate: '1944-12-16（开局在场）',
    intro: '绰号“先锋”。第1集团军手中最重要的装甲预备队之一，12月下旬在斯塔沃洛-特鲁瓦蓬之间投入战斗，封堵派佩尔战斗群的退路与南逃走廊，1945年1月参加巴拉基缺口方向的反击与曼海攻防。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/8/84/USA_3070551_of_the_3rd_Armored_Division_in_Chenee%2C_Belgium%2C_September_8%2C_1944.jpg' },
  // —— 英军缺编旅 ——
  { key: 'uk_151bde', side: 'UK', branch: '英军', open: false,
    match: ['第151步兵旅', 'Durham'],
    name: '英军第151步兵旅（151st Infantry Brigade, Durham Light Infantry）',
    type: '步兵旅',
    strength: '第6/8/9达勒姆轻步兵营',
    histDate: '1944-12-26（增援）',
    intro: '隶属英军第50（诺森布里亚）师的三个达勒姆轻步兵营。阿登战役期间作为英第30军预备队进入比利时，警戒马斯河桥头堡一线，阻止德军任何向西突破的企图，1945年初南下接防。',
    photo: '' },
  // —— 美军缺编师·第二批 ——
  { key: 'us_2ad', side: 'US', branch: '美军', open: false,
    match: ['第2装甲师'],
    name: '美军第2装甲师（2nd Armored Division "Hell on Wheels"）',
    type: '装甲师',
    strength: '第41装甲步兵团、第66/67装甲团、第14/78/92装甲野战炮兵营、第702坦克歼击营、第82装甲侦察营等',
    histDate: '1944-12-20（增援）',
    intro: '绰号“地狱轮”。第9集团军/第1集团军手中最富装甲突击经验的师之一。12月20日起自瑟勒芒斯方向北上，24-26日在塞尔与第2装甲师（德）遭遇战中将其前锋击溃，史称“塞尔口袋”，是美军在阿登最成功的机动反击之一。',
    photo: '' },
];

/* 直属营档案：按 META 直属条目机械生成 */
const PHOTO_ASSIGN = {
  "us_2ad": "https://upload.wikimedia.org/wikipedia/commons/d/d9/Tanks_and_self-propeeled_guns_of_the_US_2d_armored_Division.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",};
const out = { DE: [], US: [] };
const HQ_RE = /^军直属$|^集团军直属$|^第7集团军(（南翼）)?直属$|^美军第[1-7](军|集团军)直属$/;
/* 已有独立档案（us_526aib 等）的营不重复生成：现存档案 match 精确命中其 dispName */
const existingExact = new Set();
for (const shard of ['de1', 'de2', 'de3', 'us1', 'us2', 'uk']) {
  for (const d of require(path.join(ROOT, 'js', 'dossiers_big_' + shard + '.js'))) {
    for (const k of d.match) existingExact.add(k);
  }
}
const HQ_BRANCH = div => (/美军第(\d)/.test(div) ? (div.indexOf('集团军') >= 0 ? '美军第' + RegExp.$1 + '集团军直属' : '美军第' + RegExp.$1 + '军直属')
  : div === '集团军直属' ? '集团军直属'
  : /^第7集团军/.test(div) ? '第7集团军直属'
  : '军直属');
const HAND_KEYS = new Set(HAND.map(d => d.key));

for (const [id, m] of Object.entries(M)) {
  if (!HQ_RE.test(m.div || '')) continue;
  if (existingExact.has(disp[id] || '\u0000')) continue;   // 已有独立档案
  const nat = m.nat || 'US';
  const side = nat === 'UK' ? 'US' : nat;   // 无英军直属条目；兜底归 US
  const from = fmtDate(m.from);
  const open = from === '1944-12-16';
  const extra = {
    D147: '12月17日凌晨在马尔梅迪以北实施本战役唯一一次师级空降，因导航误差与地面雾障仅约三分之一兵力完成集结。',
    D002: '重型坦克歼击营，装备“猎虎”重型坦克歼击车，配属南翼遂行反装甲作战。',
    D327: '惩戒营，由纪律处分人员编成，通常执行先导突击与消耗性守备任务。',
    U249: '自由法国轻步兵营两支，配属美军遂行警戒与扫荡。',
    U250: '第509伞兵步兵营，美军最资深的独立伞兵营之一，作为军预备队空投/机动使用。',
    U141: '合并建制条目：第134/387/445/460/461/531/602/639/863高射机枪营按档案合并为一行。',
  }[id];
  out[side].push({
    key: 'hq_' + id.toLowerCase(), side, branch: HQ_BRANCH(m.div), open,
    match: [disp[id] || ('#' + id)],
    name: (disp[id] || '#' + id) + '（' + (m.orig || '') + '）',
    type: m.raw || '步兵',
    strength: (m.parent || m.div || '') + ' · ' + (m.raw || ''),
    histDate: from + (open ? '（开局在场）' : '（增援）'),
    intro: '直接隶属' + (m.div || '上级司令部') + '。' + roleIntro(m.raw) + (extra ? extra : ''),
    photo: PHOTO_ASSIGN[id] || '',
  });
}

/* 组装分片文本（每个分片独立 const 变量名：浏览器 <script> 直载时共用全局作用域，
   三个分片若同名 const SHARD 会 SyntaxError 静默跳过 —— node 下 require 各自模块作用域无此问题） */
const header = (title, desc, varName) => `'use strict';
/* ============================================================
 * ${title} — 全员部队档案·${desc}（由 qa/_gen_hq_dossiers.js 生成，2026-10-25）
 * 内容原则：intro 只含编制事实与兵种职能通识，不虚构战绩；改内容请改生成脚本。
 * ============================================================ */
const ${varName} = [`;
const footer = varName => `];

if (typeof module !== 'undefined' && module.exports) { module.exports = ${varName}; }
else { (globalThis.__DOSSIER_SHARDS = globalThis.__DOSSIER_SHARDS || []).push(...${varName}); }
`;

const emit = (file, title, desc, rows) => {
  const varName = 'SHARD_' + file.match(/dossiers_big_(\w+)\.js/)[1].toUpperCase();
  const body = rows.map(d => '  ' + JSON.stringify(d) + ',').join('\n');
  fs.writeFileSync(path.join(ROOT, 'js', file), header(title, desc, varName) + '\n' + body + '\n' + footer(varName), 'utf8');
  console.log('生成', file, rows.length, '条 (' + varName + ')');
};

/* 德军直属营 + 167VG/9VG（师档案 match 兼容 div） */
const deHand = HAND.filter(d => d.side === 'DE');
const usHand = HAND.filter(d => d.side === 'US');
const ukHand = HAND.filter(d => d.side === 'UK');
emit('dossiers_big_de4.js', 'dossiers_big_de4.js', '集团军/军直属营与南翼师', [...deHand, ...out.DE]);
emit('dossiers_big_us3.js', 'dossiers_big_us3.js', '美军直属营与缺编师', [...usHand, ...out.US]);
emit('dossiers_big_uk2.js', 'dossiers_big_uk2.js', '英军缺编旅', ukHand);

console.log('合计 新增: DE', deHand.length + out.DE.length, '/ US', usHand.length + out.US.length, '/ UK', ukHand.length);
