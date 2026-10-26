'use strict';
/* 一次性：25 座指挥部档案分片（24r）—— js/dossiers_big_de5.js + us4.js
 * intro 原则：编制职能 + 有把握的史实指挥官，不确定的人名不写。
 * 可重跑覆盖。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const HQ = [
  // —— 德军（14）——
  { side: 'DE', key: 'hq2_q001', match: ['德军西线总司令部'], name: '德军西线总司令部（OB West）', type: '总指挥部', org: 20,
    intro: '西线总司令格特·冯·伦德施泰特元帅的统帅机构，名义上统辖西线全部地面部队。阿登攻势的实际策划与指挥由莫德尔元帅的B集团军群主导，希特勒与最高统帅部直接干预作战细节；总司令部承担全局协调与后方勤务。若被摧毁，全军士气崩溃：组织度与攻防各-4（下限1）。' },
  { side: 'DE', key: 'hq2_q002', match: ['第6装甲集团军司令部'], name: '第6装甲集团军司令部', type: '集团军司令部', org: 15,
    intro: '约瑟夫·"泽普"·迪特里希党卫军一级上将的司令部，北翼主攻兵团的指挥中枢，统辖党卫军第1/第2装甲军与第67军。迪特里希是希特勒旧部、警卫旗队师首任师长，指挥经验常受职业军官质疑。被毁则北翼全军组织度与攻防各-3（下限1）。' },
  { side: 'DE', key: 'hq2_q003', match: ['第5装甲集团军司令部'], name: '第5装甲集团军司令部', type: '集团军司令部', org: 15,
    intro: '哈索·冯·曼陀菲尔装甲兵上将的司令部，中路突击兵团的指挥中枢，麾下第47/第58装甲军承担直插马斯河的主攻。曼陀菲尔以机动战专才著称，是此役中评价最高的集团军司令。被毁则中路全军组织度与攻防各-3（下限1）。' },
  { side: 'DE', key: 'hq2_q004', match: ['第7集团军司令部'], name: '第7集团军司令部', type: '集团军司令部', org: 15,
    intro: '埃里希·布兰登贝格尔炮兵上将的司令部，南翼掩护兵团的指挥中枢，任务是以第53/第80/第85军封堵巴顿第3集团军北上反击的走廊。兵力最弱而责任极重。被毁则南翼全军组织度与攻防各-3（下限1）。' },
  { side: 'DE', key: 'hq2_q005', match: ['党卫军第1装甲军军部'], name: '党卫军第1装甲军军部', type: '军指挥部', org: 10,
    intro: '赫尔曼·普里斯党卫军上将的军部，辖警卫旗队与希特勒青年团两个装甲师——北翼突击矛头的直接指挥机构。被毁则该军各师组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q006', match: ['党卫军第2装甲军军部'], name: '党卫军第2装甲军军部', type: '军指挥部', org: 10,
    intro: '维利·比特里希党卫军上将的军部，辖"帝国"与"霍恩施陶芬"师，12月23日起进入战场作为北翼第二梯队。被毁则该军各师组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q007', match: ['第67军军部'], name: '第67军军部', type: '军指挥部', org: 10,
    intro: '第67军（LXVII）军部，辖第246/第272/第326国民掷弹兵师与第3装甲掷弹兵师，掩护北翼突击集群的左肩。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q008', match: ['第39装甲军军部'], name: '第39装甲军军部', type: '军指挥部', org: 10,
    intro: '第39装甲军军部，中路二线军，辖第167国民掷弹兵师，随突击集群之后扩展战果。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q009', match: ['第47装甲军军部'], name: '第47装甲军军部', type: '军指挥部', org: 10,
    intro: '海因里希·冯·吕特维茨装甲兵上将的军部，全战役最重的突击拳头——辖第2装甲师、装甲教导师、第26国民掷弹兵师与元首护卫旅，直指巴斯托涅-马斯河轴线。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q010', match: ['第58装甲军军部'], name: '第58装甲军军部', type: '军指挥部', org: 10,
    intro: '瓦尔特·克吕格尔装甲兵上将的军部，辖第116装甲师与第560国民掷弹兵师，在中路以北平行推进。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q011', match: ['第66军军部'], name: '第66军军部', type: '军指挥部', org: 10,
    intro: '瓦尔特·卢赫特炮兵上将的军部，中路北翼军，辖第18/第62国民掷弹兵师，负责圣维特方向的合围。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q012', match: ['第53军军部'], name: '第53军军部', type: '军指挥部', org: 10,
    intro: '第53军（LIII）军部，南翼核心军，辖第15装甲掷弹兵师、第9国民掷弹兵师与元首掷弹兵旅。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q013', match: ['第80军军部'], name: '第80军军部', type: '军指挥部', org: 10,
    intro: '第80军（LXXX）军部（巴普蒂斯特·克尼斯步兵上将），辖第212/第276/第340国民掷弹兵师，南翼东部正面。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'DE', key: 'hq2_q014', match: ['第85军军部'], name: '第85军军部', type: '军指挥部', org: 10,
    intro: '第85军（LXXXV）军部，辖第5伞兵师与第352/第79国民掷弹兵师，南翼最南端正面。被毁则该军组织度与攻防各-2（下限1）。' },
  // —— 美军（9）——
  { side: 'US', key: 'hq2_v001', match: ['美军第12集团军群司令部'], name: '美军第12集团军群司令部（美军总部）', type: '总指挥部', org: 20,
    intro: '奥马尔·布莱德雷中将的集团军群统帅机构，统辖第1集团军（霍奇斯）与第3集团军（巴顿）共60余万官兵。战役期间布莱德雷与蒙哥马利的指挥权之争贯穿始终。被毁则全军（美国籍）士气崩溃：组织度与攻防各-4（下限1）。' },
  { side: 'US', key: 'hq2_v002', match: ['美军第1集团军司令部'], name: '美军第1集团军司令部', type: '集团军司令部', org: 15,
    intro: '考特尼·霍奇斯中将的司令部，北线主力兵团的指挥中枢——第5军、第7军与配属的第18空降军在阿登北肩与圣维特方向苦战。被毁则该集团军所属部队组织度与攻防各-3（下限1）。' },
  { side: 'US', key: 'hq2_v003', match: ['美军第3集团军司令部'], name: '美军第3集团军司令部', type: '集团军司令部', org: 15,
    intro: '小乔治·S·巴顿上将的司令部。战役第三天巴顿许诺"48小时内转向北攻"，12月22日第3集团军以战争史上罕见的90度轴线转向，驰援巴斯托涅。被毁则该集团军所属部队组织度与攻防各-3（下限1）。' },
  { side: 'US', key: 'hq2_v004', match: ['美军第18空降军军部'], name: '美军第18空降军军部', type: '军指挥部', org: 10,
    intro: '马修·李奇微中将的军部，辖第82/第101空降师等，是布莱德雷手中最快的战略预备队——12月17日夜两个空降师紧急驰援阿登。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'US', key: 'hq2_v005', match: ['美军第5军军部'], name: '美军第5军军部', type: '军指挥部', org: 10,
    intro: '伦纳德·杰罗少将的军部，阿登北肩的守护者——第1/第2/第9/第99步兵师在其编成内挡住了党卫军第6装甲集团军的主攻。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'US', key: 'hq2_v006', match: ['美军第7军军部'], name: '美军第7军军部', type: '军指挥部', org: 10,
    intro: '劳顿·"闪电乔"·柯林斯少将的军部，辖第2/第3装甲师与第83/第84步兵师，是美军北翼反击的装甲主力。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'US', key: 'hq2_v007', match: ['美军第8军军部'], name: '美军第8军军部', type: '军指挥部', org: 10,
    intro: '特洛伊·米德尔顿中将的军部，阿登正面最薄弱地段的守军指挥部——德军主攻正落在它宽达百余公里的防线上；巴斯托涅保卫战的最初指挥机构。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'US', key: 'hq2_v008', match: ['美军第12军军部'], name: '美军第12军军部', type: '军指挥部', org: 10,
    intro: '曼顿·艾迪少将的军部，第3集团军北翼军——战役中期从卢森堡方向向北展开，与第3军共同构成反攻的南钳。被毁则该军组织度与攻防各-2（下限1）。' },
  { side: 'US', key: 'hq2_v009', match: ['美军第3军军部'], name: '美军第3军军部', type: '军指挥部', org: 10,
    intro: '约翰·米利金少将的军部，第3集团军反攻矛头之一——12月底沿阿登南缘向北突击，接应被围的巴斯托涅。被毁则该军组织度与攻防各-2（下限1）。' },
  // —— 英军（2）——
  { side: 'US', key: 'hq2_v010', match: ['英军第21集团军群司令部'], name: '英军第21集团军群司令部', type: '集团军司令部', org: 15,
    intro: '伯纳德·蒙哥马利元帅的司令部。战役爆发后第21集团军群接管美军北翼指挥权（12月20日起），英军军与预备队旅警戒马斯河一线——这是英军地面部队在突出部战役中的主要角色。被毁则英军各部组织度与攻防各-3（下限1）。' },
  { side: 'US', key: 'hq2_v011', match: ['英军第30军军部'], name: '英军第30军军部', type: '军指挥部', org: 10,
    intro: '布赖恩·霍罗克斯中将的军部，辖第43/第51/第53步兵师各旅与装甲旅，是1944年9月市场花园行动的原班指挥机构，此次沿马斯河布防。被毁则该军组织度与攻防各-2（下限1）。' },
];

/* 24s: 内嵌照片分配（键=vendor/photos manifest） */
const PHOTO_ASSIGN = {
  "hq2_q004": "https://upload.wikimedia.org/wikipedia/commons/8/8e/LTG_Brandenberger_surrender_Luger.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_q003": "https://upload.wikimedia.org/wikipedia/commons/2/2c/Bundesarchiv_Bild_146-1976-143-21%2C_Hasso_von_Manteuffel.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_q002": "https://upload.wikimedia.org/wikipedia/commons/0/01/Bundesarchiv_Bild_183-J27366%2C_Sepp_Dietrich.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v011": "https://upload.wikimedia.org/wikipedia/commons/c/ce/Horrocks_portrait.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v008": "https://upload.wikimedia.org/wikipedia/commons/9/9b/Manton_Sprague_Eddy.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v007": "https://upload.wikimedia.org/wikipedia/commons/c/ca/Troy_Houston_Middleton_1944.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_q006": "https://upload.wikimedia.org/wikipedia/commons/c/c1/Bundesarchiv_Bild_Wilhelm_Bittrich.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v010": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Bernard_Law_Montgomery%2C_1st_Viscount_of_Alamein.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v009": "https://upload.wikimedia.org/wikipedia/commons/2/23/John_Millikin_%28U.S._Army_major_general%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v006": "https://upload.wikimedia.org/wikipedia/commons/7/7c/Joseph_Lawton_Collins.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v005": "https://upload.wikimedia.org/wikipedia/commons/2/26/Leonard_T._Gerow.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v004": "https://upload.wikimedia.org/wikipedia/commons/8/8a/Major-General_Ridgway_and_Major-General_Gavin.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_v003": "https://upload.wikimedia.org/wikipedia/commons/0/0a/George_S._Patton_06.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_q013": "https://upload.wikimedia.org/wikipedia/commons/6/62/Baptist_Knie%C3%9F.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_q011": "https://upload.wikimedia.org/wikipedia/commons/1/13/Bundesarchiv_Bild_101I-236-1029-30A%2C_Russland%2C_Walther_Lucht.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  "hq2_q005": "https://upload.wikimedia.org/wikipedia/commons/8/82/Bundesarchiv_Bild_101III-Adendorf-122-28%2C_Hermann_Prie%C3%9F.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
  hq2_q001: "https://upload.wikimedia.org/wikipedia/commons/8/84/Bundesarchiv_Bild_183-J27784%2C_Arnheim%2C_Walter_Model%2C_Heinz_Harmel.jpg",
  hq2_v001: "https://upload.wikimedia.org/wikipedia/commons/1/1a/General_of_the_Army_Omar_Bradley_%28crop%29.jpg",
};

const emit = (file, desc, rows) => {
  const varName = 'SHARD_' + file.match(/dossiers_big_(\w+)\.js/)[1].toUpperCase();
  const body = rows.map(d => {
    const [atk, def] = d.side === 'DE' ? [3, 4] : [4, 6];
    const side = d.key === 'hq2_v010' || d.key === 'hq2_v011' ? 'UK' : d.side;   // 英军两座：档案 side=UK（映射阵营过滤按 nat 直通）
    return '  ' + JSON.stringify({
      key: d.key, side, branch: d.side === 'DE' ? '统帅部' : (side === 'UK' ? '英军' : '美军'),
      open: true, match: d.match, name: d.name,
      type: d.type + `（组织度 ${d.org} · 攻${atk}/防${def}）`,
      strength: '指挥部 · 开局在场 · 位于所辖部队后方',
      histDate: '1944-12-16（开局在场）',
      intro: d.intro, photo: PHOTO_ASSIGN[d.key] || '',
    }) + ',';
  }).join('\n');
  const out = `'use strict';
/* ============================================================
 * ${file} — 全员部队档案·${desc}（由 qa/_gen_hq_specs_dossiers.js 生成，2026-10-25）
 * 内容原则：intro 只含编制职能与有把握的史实指挥官，不虚构；改内容请改生成脚本。
 * ============================================================ */
const ${varName} = [
${body}
];

if (typeof module !== 'undefined' && module.exports) { module.exports = ${varName}; }
else { (globalThis.__DOSSIER_SHARDS = globalThis.__DOSSIER_SHARDS || []).push(...${varName}); }
`;
  fs.writeFileSync(path.join(ROOT, 'js', file), out, 'utf8');
  console.log('生成', file, rows.length, '条');
};

emit('dossiers_big_de5.js', '司令部（24r）', HQ.filter(d => d.side === 'DE'));
emit('dossiers_big_us4.js', '司令部（24r）', HQ.filter(d => d.side !== 'DE'));
