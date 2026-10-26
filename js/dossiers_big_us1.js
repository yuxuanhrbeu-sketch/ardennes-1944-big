'use strict';
/* ============================================================
 * dossiers_big_us1.js — 全员部队档案·美军乙批（增援主力），2026-10-25
 * ============================================================ */
const SHARD_US1 = [
  { key: 'us_101abn', side: 'US', branch: '美军', open: false,
    match: ['第101空降师', '第101师'],
    name: '第101空降师「啸鹰」（101st Airborne Division, McAuliffe）',
    type: '空降师',
    strength: '第501/502/506空降步兵团、第327滑翔步兵团、第81/326空降炮兵营',
    histDate: '1944-12-18（增援）',
    intro: '整场战役的灵魂。12月18日夜乘卡车急进巴斯托涅，在德军合围前数小时入城。"Nuts!"（麦考利夫少将的答复）成为美军战史传奇。被围至12月26日第4装甲师解围，全师在围城中伤亡近2,000人，却牢牢钉住了德军中路装甲兵团整整一周。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/d/d3/101st_Airborne_troops_move_out_of_Bastogne.jpg' },

  { key: 'us_82abn', side: 'US', branch: '美军', open: false,
    match: ['第82空降师', '第82师'],
    name: '第82空降师「全美」（82nd Airborne Division, Ridgway）',
    type: '空降师',
    strength: '第504/505/508空降步兵团、第325滑翔步兵团、第80/319/320空降炮兵营',
    histDate: '1944-12-18（增援）',
    intro: '12月18日夜间急进韦尔博蒙，随即投入圣维特-维尔萨姆走廊的血战。在跨过萨尔姆河的反击中阻挡党卫军第9装甲师与第2装甲师三天，自身伤亡惨重但整个北肩的侧翼安全由它保住。李奇微少将的指挥风格在全役中极富攻击性。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/82nd_Airborne_drop_pattern%2C_D-Day%2C_6_June_1944.JPG' },

  { key: 'us_7ad', side: 'US', branch: '美军', open: false,
    match: ['第7装甲师'],
    name: '第7装甲师「幸运第七」（7th Armored Division, Hasbrouck）',
    type: '装甲师',
    strength: '第17/31/40坦克营、第23/38/48装甲步兵营、第440装A营',
    histDate: '1944-12-17（增援）',
    intro: '12月17日急进圣维特，接管该城防务并在圣维特桥头堡死守到12月23日——哈斯布鲁克少将指挥的"圣维特桥头堡"行动被认为是全役美军最精彩的机动作战之一。撤出后转投埃尔森博恩，12月下旬在斯塔沃洛-特鲁瓦蓬一线挡住派佩尔残部。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/6/69/M4_Sherman_tanks_of_the_U.S._7th_Armored_Division_near_St._Vith%2C_Belgium%2C_24_January_1945_%28148727210%29.jpg' },

  { key: 'us_10ad', side: 'US', branch: '美军', open: false,
    match: ['第10装甲师'],
    name: '第10装甲师（10th Armored Division, Roberts）',
    type: '装甲师',
    strength: '第3/11/21坦克营、第20/54/61装甲步兵营、第90装A营（O\'Hara/Desobry/Cherry战斗群）',
    histDate: '1944-12-18（增援）',
    intro: '三个战斗群分头急进：Desobry战斗群在诺维尔与第2装甲师血战至全灭，Cherry战斗群在东面被合围突围，O\'Hara战斗群退入巴斯托涅——与第101空降师一起死守围城。全师在巴斯托涅战役中伤亡过半。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/5/5d/U.S._10th_Armored_Division_troops_in_Bastogne%2C_Belgium%2C19_December_1944_%28148727462%29.jpg' },

  { key: 'us_30id', side: 'US', branch: '美军', open: false,
    match: ['第30步兵师', '第30师'],
    name: '第30步兵师「老希科利」（30th Infantry Division）',
    type: '步兵师（国民警卫队老牌）',
    strength: '第117/119/120步兵团、第113/197/230野炮营、第743坦克营',
    histDate: '1944-12-21（增援）',
    intro: '北肩反击的中坚。12月21日起投入马尔梅迪-斯塔沃洛方向，与第82空降师协同切断派佩尔战斗群的退路，在马尔梅迪战役中战果辉煌（希特勒青年团师在此损失惨重），被誉为"罗斯福的SS猎人"。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/6/63/M7_105-MM._SP_HOWITZER_OF_THE_30TH_DIVISION_IN_ACTION_near_la_Gleize.jpg' },

  { key: 'us_1id', side: 'US', branch: '美军', open: false,
    match: ['第1步兵师', '第1师'],
    name: '第1步兵师「大红一师」（1st Infantry Division）',
    type: '步兵师（老牌）',
    strength: '第16/18/26步兵团、第5/7/32野炮营、第634歼击营',
    histDate: '1944-12-19（增援）',
    intro: '从亚琛攻城战中被急调南下，12月19日起投入比特根巴赫-布吕利方向，与第2师并肩守住埃尔森博恩 Ridge 的东北肩。该师在北肩反击中的火力支援（155毫米群）是党卫军装甲部队无法逾越的关键。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/0/08/26th_Infantry_Regiment_near_Butgenbach.jpg' },

  { key: 'us_4ad', side: 'US', branch: '美军', open: false,
    match: ['第4装甲师'],
    name: '第4装甲师「打破他们」（4th Armored Division, Abrams/Gribbin）',
    type: '装甲师',
    strength: '第8/35/37坦克营、第10/51/53装甲步兵营、第94装A营',
    histDate: '1944-12-19（增援）',
    intro: '巴顿第三集团军的王牌。12月22日起从南向北强攻巴斯托涅，12月26日艾布拉姆斯中校的第37坦克营率先突入围城——巴斯托涅解围的时刻成为整个战役的转折点。此后持续向乌法利兹方向扩大走廊。',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/8/8b/Photograph_of_Tanks_of_the_4th_Armored_Division_-_NARA_-_12010181.jpg' },

  { key: 'us_9id', side: 'US', branch: '美军', open: true,
    match: ['第9步兵师'],
    name: '第9步兵师「老可靠」（9th Infantry Division）',
    type: '步兵师（老牌）',
    strength: '第39/47/60步兵团、师属炮兵、歼击/工兵营',
    histDate: '1944-12-16（开局在场）',
    intro: '许特根森林战役后正在埃尔森博恩以南休整。战役爆发后与第2师、第99师一道拼死守住埃尔森博恩 Ridge 南段，全师伤亡惨重但防区从未失守。',
    photo: '' },

  { key: 'us_9adcc', side: 'US', branch: '美军', open: true,
    match: ['第9装甲师'],
    name: '第9装甲师（各战斗群，9th Armored Division Combat Commands）',
    type: '装甲师（分散配属）',
    strength: 'RCCA（圣维特）/CCB（乌尔河-维尔茨）/CCR（巴恩）三个战斗群',
    histDate: '1944-12-16（开局在场）',
    intro: '被分散配属至第8军全线的"救火队"。CCA在圣维特与第7装R并肩死守，CCB在维尔茨血战，CCR随第106师残部突围——全师被冲散却处处硬顶，为援军赶到赢得了最关键的三天。',
    photo: '' },

  { key: 'us_526aib', side: 'US', branch: '美军', open: true,
    match: ['第526装甲步兵营'],
    name: '第526装甲步兵营（526th Armored Infantry Battalion）',
    type: '装甲步兵营（第1集团军直属）',
    strength: '装甲步兵连×3（M3半履带车载）',
    histDate: '1944-12-16（开局在场）',
    intro: '第1集团军直属的半履带装甲步兵营，战役首日在圣维特以北作为快速反应部队投入堵口，后配属第7装甲师作战。',
    photo: '' },
];

/* 浏览器 <script> 直载兼容：node 走 module.exports，浏览器推入分片汇合点 */
if (typeof module !== 'undefined' && module.exports) { module.exports = SHARD_US1; }
else { (globalThis.__DOSSIER_SHARDS = globalThis.__DOSSIER_SHARDS || []).push(...SHARD_US1); }
