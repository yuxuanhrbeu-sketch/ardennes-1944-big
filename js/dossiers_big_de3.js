'use strict';
/* ============================================================
 * dossiers_big_de3.js — 德军丙批（补充与合流）+ 美军甲批（第8/5军北肩），2026-10-25
 * ============================================================ */
const SHARD_DE3 = [
  /* —— 德军补充（第7集团军南翼战斗群与合流）—— */
  { key: 'de_212vgd', side: 'DE', branch: '国民掷弹兵', open: true,
    match: ['第212国民掷弹兵师'],
    name: '第212国民掷弹兵师（212. Volks-Grenadier-Division）',
    type: '国民掷弹兵师',
    strength: '第316/320/423国民掷弹兵团、第212炮兵团、歼击/工兵/通信营',
    histDate: '1944-12-16（开局在场）',
    intro: '南翼第7集团军的主力师。阿登首日在埃希特纳赫方向突破美军第4师防线部分地段，随后沿绍尔河与黑森高地反复拉锯，掩护中路装甲兵团的南肩。',
    photo: '' },

  { key: 'de_276vgd', side: 'DE', branch: '国民掷弹兵', open: true,
    match: ['第276国民掷弹兵师'],
    name: '第276国民掷弹兵师（276. Volks-Grenadier-Division）',
    type: '国民掷弹兵师',
    strength: '第986/987/988国民掷弹兵团、第276炮兵团、歼击/工兵/通信营',
    histDate: '1944-12-16（开局在场）',
    intro: '1944年秋由第276步兵师残部重建。阿登战役中在南翼配合第212师进攻，把美军第4师逐步压回绍尔河以西。',
    photo: '' },

  { key: 'de_340vgd', side: 'DE', branch: '国民掷弹兵', open: true,
    match: ['第340国民掷弹兵师'],
    name: '第340国民掷弹兵师（340. Volks-Grenadier-Division）',
    type: '国民掷弹兵师',
    strength: '第694/695/696国民掷弹兵团、第340炮兵团、歼击/工兵/通信营',
    histDate: '1944-12-16（开局在场）',
    intro: '1944年秋由第340步兵师残部重建。阿登战役中作为第7集团军二线师，在埃希特纳赫以南展开，1月初投入"北风行动"的南翼牵制。',
    photo: '' },

  { key: 'de_150pzb', side: 'DE', branch: '国防军', open: true,
    match: ['第150装甲旅'],
    name: '第150装甲旅「格里芬行动」（Panzer-Brigade 150 / Skorzeny）',
    type: '装甲旅（特务作战）',
    strength: '装甲营（缴获美军坦克/仿制谢尔曼）、装甲掷弹兵营×2、身穿美军制服的英语士兵分队',
    histDate: '1944-12-16（开局在场）',
    intro: '斯科尔兹尼指挥的特务部队，任务是在美军后方制造混乱、抢占马斯河桥。因仿制谢尔曼数量远少于计划，实际仅以小队渗透活动，12月下旬在马尔梅迪以南的试探被识破后解散为普通步兵旅。',
    photo: '' },

  /* —— 美军：第8军（北肩+中路，开局在场主力）—— */
  { key: 'us_99id', side: 'US', branch: '美军', open: true,
    match: ['第99步兵师'],
    name: '第99步兵师「 checkerboard 棋盘师」（99th Infantry Division）',
    type: '步兵师（新兵师）',
    strength: '第393/394/395步兵团、师属炮兵、歼击/工兵营',
    histDate: '1944-12-16（开局在场）',
    intro: '1944年11月才首次参战的新兵师，却打出了整个战役最关键的一仗：第394团在洛斯海姆缺口、第393/395团在埃尔森博恩 Ridge 死守，硬生生挡住党卫军第12装甲师与第3伞兵师三天，为援军争取了宝贵时间。全师伤亡惨重但防区从未真正崩塌。',
    photo: 'embed:ph26u' },

  { key: 'us_2id', side: 'US', branch: '美军', open: true,
    match: ['第2步兵师'],
    name: '第2步兵师「印第安头」（2nd Infantry Division）',
    type: '步兵师（老牌）',
    strength: '第9/23/38步兵团、师属炮兵、工兵/歼击营',
    histDate: '1944-12-16（开局在场）',
    intro: '一战老牌师，诺曼底登陆梯次中的老兵。阿登首日正在向罗尔河大坝进攻，被迫转身向东在克灵克特-埃尔森博恩一线构筑新防线，与第99师并肩顶住了党卫军装甲部队的猛攻，守住整个北肩。',
    photo: '' },

  { key: 'us_106id', side: 'US', branch: '美军', open: true,
    match: ['第106步兵师'],
    name: '第106步兵师「金狮」（106th Infantry Division）',
    type: '步兵师（新兵师）',
    strength: '第422/423/424步兵团、师属炮兵、歼击/工兵营',
    histDate: '1944-12-16（开局在场）',
    intro: '1944年12月才抵达前线的最末批新兵师。首日即被第18国民掷弹兵师合围在雪艾费尔高地，第422/423团约6,000-8,000人于12月19日投降——这是美军在欧洲战场最大规模的成建制投降。第424团与配属的第9装R战斗群残部突围后继续作战。',
    photo: '' },

  { key: 'us_9arml', side: 'US', branch: '美军', open: true,
    match: ['第9装甲师'],
    name: '第9装甲师（9th Armored Division）',
    type: '装甲师',
    strength: '第2/3/14坦克营、第27/52/60装甲步兵营、第9装A（RCCA/CCB/CCR战斗群）',
    histDate: '1944-12-16（开局在场）',
    intro: '分散配属的第9装R各战斗群首日就被冲散：CCR在圣维特血战，CCB守卫乌尔河桥与维尔茨，CCA后撤整补。残部在圣维特与巴斯托涅之间打满全场；一支部队后来在雷马根抢占鲁登道夫大桥（1945年3月，美军的意外大胜）。',
    photo: 'embed:ph26u' },

  { key: 'us_28id', side: 'US', branch: '美军', open: true,
    match: ['第28步兵师'],
    name: '第28步兵师「基斯顿」（28th Infantry Division）',
    type: '步兵师（被打残的老兵师）',
    strength: '第109/110/112步兵团、师属炮兵、歼击/工兵营',
    histDate: '1944-12-16（开局在场）',
    intro: '许特根森林战役后正在乌尔河一线休整的"受创之师"，恰好处在德军中路主攻的正面上。首日防线被第2装甲师与装甲教导师撕碎，第110团几乎全军覆灭掩护了全师撤退；残部与第9装R战斗群一起在维尔茨死守，师长卡法少将后被德军俘虏。',
    photo: 'embed:ph26u' },

  { key: 'us_4id', side: 'US', branch: '美军', open: true,
    match: ['第4步兵师'],
    name: '第4步兵师「常春藤」（4th Infantry Division）',
    type: '步兵师（老牌）',
    strength: '第8/12/22步兵团、师属炮兵、歼击/工兵营',
    histDate: '1944-12-16（开局在场）',
    intro: '独撑整个南肩：在埃希特纳赫-埃希特河一线，以一师之力挡住第7集团军三个师的猛攻近一周，为巴顿第三集团军北调争取了时间。巴斯托涅解围的南部屏障。',
    photo: 'embed:ph26u' },

  { key: 'us_8corps', side: 'US', branch: '美军', open: true,
    match: ['美军第8军'],
    name: '第8军军直属部队（VIII Corps, Middleton）',
    type: '军直属',
    strength: '军属炮兵群（155毫米榴弹炮/火箭炮营）、歼击营、工兵营（约6个营）',
    histDate: '1944-12-16（开局在场）',
    intro: '米德尔顿中将的第8军军部是首日被打懵的美军指挥中枢——它面对的是整个德军攻势的正面上。军直属炮兵群成了最早稳定防线的火力支柱，圣维特与巴斯托涅的守军全靠这些155毫米炮群支撑。',
    photo: '' },
];

/* 浏览器 <script> 直载兼容：node 走 module.exports，浏览器推入分片汇合点 */
if (typeof module !== 'undefined' && module.exports) { module.exports = SHARD_DE3; }
else { (globalThis.__DOSSIER_SHARDS = globalThis.__DOSSIER_SHARDS || []).push(...SHARD_DE3); }
