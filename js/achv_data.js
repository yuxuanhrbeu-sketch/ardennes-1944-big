'use strict';
/* achv_data.js — 成就点阵/图标/清单（自原版《阿登1944》data.js 提取, 24v）
 * 数据冻结: 与原版逐字一致 → 两版成就语义完全互通。 */
const ACH_PALETTE = {
    '.': null,           // 透明
    k: '#1c1f1a',        // 炭黑描边
    s: '#6b7280',        // 钢灰
    w: '#e8e2d0',        // 雪白 / 羊皮纸
    o: '#556b2f',        // 橄榄绿
    f: '#565c4c',        // 德军原野灰
    b: '#33547a',        // 美军蓝
    r: '#8c3b2f',        // 暗红
    g: '#c9a227',        // 黄铜
    y: '#e6c85c',
    h: '#f2ead2',        // 高光（羊皮纸亮部）
    d: '#262b25',        // 暗部（24w 渲染立体化）
    e: '#9aa3ad',        // 金属亮灰（24w 新图标）        // 亮黄铜
  };

  const ACH_ICONS = {
    // 雪花（首战 / 完整战役）—— 加粗臂与实心中段，40px 下也读得出
    snow: [
      '................', '.......kk.......', '.......kk.......', '..k....kk....k..',
      '...k...kk...k...', '....k..kk..k....', '.....kkkkkk.....', '..kkkkwwwwkkkk..',
      '.....kkkkkk.....', '....k..kk..k....', '...k...kk...k...', '..k....kk....k..',
      '.......kk.......', '.......kk.......', '................', '................',
    ],
    // 两面军旗（双人热座）—— 旗面填满、旗杆到底
    commanders: [
      '................', '..kk........kk..', '..kgk.......kbk.', '..kggk......kbk.',
      '..kgggk.....kbk.', '..kggggk....kbk.', '..kgggk.....kbk.', '..kggk......kbk.',
      '..kgk.......kbk.', '..kk........kk..', '..kk........kk..', '..kk........kk..',
      '..kk........kk..', '................', '................', '................',
    ],
    // 望远镜（观摩）
    binoculars: [
      '................', '................', '..kkk....kkk....', '.kwwwk..kwwwk...',
      '.kwwwkkkkwwwk...', '.kwwwk..kwwwk...', '.kwwwk..kwwwk...', '..kkk....kkk....',
      '................', '................', '................', '................',
      '................', '................', '................', '................',
    ],
    // 被划掉的算子（歼灭模式）
    annihilation: [
      '................', '.kkkkkkkkkkkkkk.', '.kwwwwwwwwwwwwk.', '.kwwrkwwwwkrwwk.',
      '.kwwwrkwwkrwwwk.', '.kwwwwrkkrwwwwk.', '.kwwwwwrrwwwwwk.', '.kwwwwwrrwwwwwk.',
      '.kwwwwrkkrwwwwk.', '.kwwwrkwwkrwwwk.', '.kwwrkwwwwkrwwk.', '.kwwwwwwwwwwwwk.',
      '.kkkkkkkkkkkkkk.', '................', '................', '................',
    ],
    // 黄铜桥（莱茵守望 / 三桥）
    bridge_gold: [
      '................', '................', '.kkkkkkkkkkkkkk.', '.kggggggggggggk.',
      '.kkkkkkkkkkkkkk.', '..k..k....k..k..', '...kk......kk...', '..k..k....k..k..',
      '..k..k....k..k..', '.bbbbbbbbbbbbbb.', '.bbbbbbbbbbbbbb.', '..kk......kk....',
      '..kk......kk....', '................', '................', '................',
    ],
    // 工兵便桥（工兵堵口）
    engineer_bridge: [
      '................', '................', '.kkkkkkkkkkkkkk.', '.kooooooooooook.',
      '.kkkkkkkkkkkkkk.', '..k..k....k..k..', '...kk......kk...', '..k..k....k..k..',
      '..k..k....k..k..', '................', '................', '................',
      '................', '................', '................', '................',
    ],
    // 西向箭头越过河流（抵达马斯河 / 强渡）
    west_arrow_river: [
      '................', '..k.............', '..kk............', '..kkk...........',
      '..kkkkkkkkkkkkk.', '..kkkkkkkkkkkkk.', '..kkk...........', '..kk............',
      '..k.............', '.bbbbbbbbbbbbbb.', '.bbbbbbbbbbbbbb.', '................',
      '................', '................', '................', '................',
    ],
    // 双城镇（双枢纽）
    twin_towns: [
      '................', '.kkkkk....kkkkk.', '.kwwwk....kwwwk.', '.kwwwk....kwwwk.',
      '.kwwwk....kwwwk.', '.kkkkk....kkkkk.', '....kk....kk....', '.....kk..kk.....',
      '......kkkk......', '.......kk.......', '................', '................',
      '................', '................', '................', '................',
    ],
    // 盾牌与弹孔（不投降）
    shield: [
      '................', '..kkkkkkkkkkkk..', '..kswwwwwwwwsk..', '..kswwwwwwwwsk..',
      '..kswwwkkwwwsk..', '..kswwkrrkwwsk..', '..kswwkrrkwwsk..', '..kswwwkkwwwsk..',
      '..ksrwwwwwwrsk..', '..ksrrwwwwrrsk..', '...ksrrrrrrsk...', '....ksrrrrsk....',
      '.....kssssk.....', '......kssk......', '.......kk.......', '................',
    ],
    // 钳形合击（削平突出部 / 决定性防御）
    pincer: [
      '................', '..kk........kk..', '..kkk......kkk..', '...kkk....kkk...',
      '....kkk..kkk....', '.....kk..kk.....', '......k..k......', '.......kk.......',
      '......k..k......', '.....kk..kk.....', '....kkk..kkk....', '...kkk....kkk...',
      '..kkk......kkk..', '..kk........kk..', '................', '................',
    ],
    // 坦克侧影（装甲楔子 / 派佩尔的驰骋）
    tank: [
      '................', '................', '........kkkkk...', '........kssssk..',
      '..kkkkk.ksssssk.', '..kkkkk.ksssssk.', '.kkkkkkkkkkkkkk.', '.koooooooooooook',
      '.koooooooooooook', '.kkkkkkkkkkkkkk.', '..kffkffkffkff..', '..kkkkkkkkkkkk..',
      '................', '................', '................', '................',
    ],
    // 铁拳与履带（反坦克小组）—— 亮色拳面 + 指节刻线，下方履带
    fist: [
      '................', '....kkkkkkk.....', '...kwwwwwwwk....', '..kwwkwwkwwk....',
      '..kwwkwwkwwk....', '..kwwwwwwwwk....', '..kwwkwwkwwk....', '..kwwwwwwwwk....',
      '...kwwwwwwwk....', '....kkkkkkk.....', '..kkkkkkkkkkk...', '..k.k.k.k.k.k...',
      '................', '................', '................', '................',
    ],
    // 野战炮侧影（炮火准备）—— 长炮管 + 炮架 + 双轮，间接火力最易识别的形状
    artillery: [
      '................', '.....kkkk.......', '....kkssk.......', '...kkssk........',
      '..kkssk.........', '.kkssk..........', 'kkssk...........', 'kkkkkkkkkkk.....',
      'kooooooooook....', 'kkkkkkkkkkk.....', '..kkk...kkk.....', '..kkk...kkk.....',
      '..kkk...kkk.....', '................', '................', '................',
    ],
    // 俯冲战机（空地协同）
    aircraft: [
      '................', '.......kk.......', '......kkkk......', '.....kkkkkk.....',
      '..kkkkkkkkkkkk..', '...kkkkkkkkkk...', '......kkkk......', '.......kk.......',
      '.......kk.......', '......kkkk......', '................', '................',
      '................', '................', '................', '................',
    ],
    // 包围圈（合围）
    ring: [
      '................', '.....rrrrrr.....', '...rr......rr...', '..r..kkkkkk..r..',
      '.r..kk....kk..r.', '.r.kk......kk.r.', '.r.k........k.r.', '.r.k........k.r.',
      '.r.kk......kk.r.', '.r..kk....kk..r.', '..r..kkkkkk..r..', '...rr......rr...',
      '.....rrrrrr.....', '................', '................', '................',
    ],
    // 雾与西向箭头（秋雾）
    fog_arrow: [
      '................', '....wwww........', '...wwwwww.......', '................',
      '..k.............', '..kk............', '..kkk...........', '..kkkkkkkkkkkkk.',
      '..kkkkkkkkkkkkk.', '..kkk...........', '..kk............', '..k.............',
      '................', '.....wwwwww.....', '......wwww......', '................',
    ],
    // 山脊与炮位（埃尔森博恩岭）
    ridge: [
      '................', '.......k........', '......kkk.......', '.....kkkkk......',
      '....kkkkkkk.....', '...kkkkkkkkk....', '..kkkkkkkkkkk...', '.kkkkkkkkkkkkk..',
      '....k.....k.....', '...kkk...kkk....', '...kkk...kkk....', '................',
      '................', '................', '................', '................',
    ],
    // 星与西向箭头（圣诞反击）
    star_arrow: [
      '................', '.......g........', '......ggg.......', '.......g........',
      '................', '..k.............', '..kk............', '..kkkkkkkkkkkk..',
      '..kkkkkkkkkkkk..', '..kk............', '..k.............', '................',
      '................', '................', '................', '................',
    ],
    // 勋章缎带（满墙勋章 / 收藏类）
    ribbon: [
      '................', '....kkkkkkkk....', '...kgggggggggk..', '...kgwwwwwwwgk..',
      '...kgwkkkkkwgk..', '...kgwkgggkwgk..', '...kgwkgrgkwgk..', '...kgwkgggkwgk..',
      '...kgwkkkkkwgk..', '...kgwwwwwwwgk..', '...kgggggggggk..', '....kkk..kkk....',
      '.....kr..rk.....', '.....kr..rk.....', '....krr..rrk....', '....kkk..kkk....',
    ],
    /* —— 阶段 C 新增（长尾 13 条）—— */
    // 爆点（时间引信：炮兵远程射击直接打出 DE）
    shell_burst: [
      '................', '.......w........', '...w...w...w....', '....w..w..w.....',
      '.....w.w.w......', '..wwwwkkkwwww...', '.....wkkkw......', '....wkkgkkw.....',
      '.....wkkkw......', '..wwwwkkkwwww...', '.....w.w.w......', '....w..w..w.....',
      '...w...w...w....', '.......w........', '................', '................',
    ],
    // 车辙与箭头（侦察的价值）
    recon: [
      '................', '................', '..ssss..........', '..s..s..k.......',
      '..ssss.kk.......', '.......kkk......', '......kkkkk.....', '.....kkkkkkk....',
      '......kkkkk.....', '.......kkk......', '..ssss..kk......', '..s..s..k.......',
      '..ssss..........', '................', '................', '................',
    ],
    // 油桶（油料纪律）
    fuel: [
      '................', '...kkkkkkkkkk...', '...koooooooook..', '...kokkkkkkook..',
      '...kokggggkook..', '...kokggggkook..', '...kokkkkkkook..', '...koooooooook..',
      '...kokkkkkkook..', '...kokggggkook..', '...kokggggkook..', '...kokkkkkkook..',
      '...koooooooook..', '...kkkkkkkkkk...', '................', '................',
    ],
    // 倾斜的天平（以弱胜强）—— 亮色横梁 + 两只吊盘，暗色在这个尺寸下会糊掉
    scales: [
      '................', '.......ww.......', '.......ww.......', '.wwwwwwwwwwwwww.',
      '.w............w.', '.w....wwww....w.', '.www..wwww..www.', '..ww..wwww..ww..',
      '...w...ww...w...', '.......ww.......', '.......ww.......', '......wwww......',
      '.....wwwwww.....', '................', '................', '................',
    ],
    // 三道刻痕（三连破 / 累计类共用）
    tally: [
      '................', '..............w.', '............ww..', '..........ww....',
      '..w..w..ww..w...', '..w..w.w.w..w...', '..w..ww..w..w...', '..w.ww...w..w...',
      '..www....w..w...', '..ww.....w..w...', '..w......w..w...', '..w......w..w...',
      '................', '................', '................', '................',
    ],
    // 补给箱（补给官：用满支援资产）
    supply: [
      '................', '..kkkkkkkkkkkk..', '..koooooooooook.', '..kokggggggkook.',
      '..kokgkkkkgkook.', '..kokgkggkgkook.', '..kokgkkkkgkook.', '..kokggggggkook.',
      '..kokkkkkkkkook.', '..kokggggggkook.', '..kokgkkkkgkook.', '..kokggggggkook.',
      '..koooooooooook.', '..kkkkkkkkkkkk..', '................', '................',
    ],
    // 降落伞（空降死守）
    parachute: [
      '................', '.....kkkkkk.....', '...kkwwwwwwkk...', '..kwwwwwwwwwwk..',
      '.kwwkkwwwwkkwwk.', '.kwwwwwwwwwwwwk.', '..kwwwwwwwwwwk..', '...kwwwwwwwwk...',
      '....k.k..k.k....', '.......kk.......', '.......kk.......', '......kkkk......',
      '.....kkkkkk.....', '......kkkk......', '................', '................',
    ],
    // 破损的军旗（惨胜）
    torn_flag: [
      '................', '...k............', '...kkrrrrrrr....', '...krrrrrrrrr...',
      '...krrrrrrrr....', '...krrrrrr......', '...krrrrrrrr....', '...krrrrr.......',
      '...krrrrrr......', '...krrrr........', '...k............', '...k............',
      '...k............', '...kk...........', '................', '................',
    ],
    // —— 24w 新增（立体化渲染首用 h 高光/d 暗部/e 金属）——
    eagle: [
      '................', '.......kk.......', '......keek......', '.....kehhhek....',
      '....kehhhhhek...', '...kehhkkkhhk...', '..kehhk...khhk..', '..kehk..kk..khk.',
      '..kek..keek..kk.', '..kk..keeeek.k..', '...k.keeeeeek...', '....keeeeeeek...',
      '...keeeeeeeek...', '..keeeekkeeeek..', '..kkkkk..kkkkk..', '................',
    ],
    target: [
      '................', '....kkkkkkkk....', '..kkeeeeeeeekk..', '..kehhhhhhhhek..',
      '.kehhhwwwwhhhhek', '.kehhwwwwwwhhek.', '.kehhwwkkwwhhek.', '.kehhwwkkwwhhek.',
      '.kehhwwwwwwhhek.', '.kehhhwwwwhhhhek', '..kehhhhhhhhek..', '..kkeeeeeeeekk..',
      '....kkkkkkkk....', '................', '................', '................',
    ],
  };

  // 24 条核心成就（判定实现见 js/achv.js 的 CHECKS 表，键 = id）
  const ACHIEVEMENTS = [
    // —— 参与与完成 ——
    { id: 'first_snow', name: '雪原首战', en: 'FIRST SNOW', tier: 'bronze', cat: '参与', icon: 'snow',
      desc: '完成任意一局推演', hint: '打完一局就有', quote: '1944 年 12 月 16 日，五点半。你也在场了。' },
    { id: 'long_winter', name: '完整的冬天', en: 'THE LONG WINTER', tier: 'bronze', cat: '参与', icon: 'snow',
      desc: '打完《阿登全战役》24 个回合', hint: '走完整个冬天', quote: '从 12 月 16 日到 1 月 16 日——突出部被削平，你走完了全程。' },
    { id: 'two_commanders', name: '两位指挥官', en: 'TWO COMMANDERS', tier: 'bronze', cat: '参与', icon: 'commanders',
      desc: '完成一局双人热座', hint: '同一张地图，两个脑子', quote: '同一张地图，两个脑子。这才是兵棋的原始玩法。' },
    { id: 'observer', name: '参谋席上', en: 'OBSERVER', tier: 'bronze', cat: '参与', icon: 'binoculars',
      desc: '完整看完一局 AI 对战观摩', hint: '不插手，只看', quote: '不插手，只看。看懂一局，胜过乱打十局。' },
    { id: 'annihilation', name: '歼灭', en: 'ANNIHILATION', tier: 'bronze', cat: '参与', icon: 'annihilation',
      desc: '完成一局歼灭模式（无回合限制）', hint: '没有回合上限的那种打法', quote: '没有回合上限，只有最后的建制。' },
    // —— 胜负里程碑 ——
    { id: 'wacht_am_rhein', name: '莱茵守望', en: 'WACHT AM RHEIN', tier: 'gold', cat: '胜负', icon: 'bridge_gold',
      desc: '德军在《突出部》达成决定性胜利（渡河装甲 ≥ 6）', hint: '六个装甲单位抵达马斯河', quote: '"莱茵守望"是这次行动的真名。你把它兑现了。' },
    { id: 'to_the_meuse', name: '抵达马斯河', en: 'TO THE MEUSE', tier: 'silver', cat: '胜负', icon: 'west_arrow_river',
      desc: '德军任意剧本至少有一个装甲/摩托化单位渡河', hint: '至少让一支部队摸到河边', quote: '先头部队看见了马斯河。历史上，他们离它只剩 6 公里。' },
    { id: 'both_hubs', name: '双枢纽', en: 'BOTH HUBS', tier: 'gold', cat: '胜负', icon: 'twin_towns',
      desc: '同一局中占领圣维特与巴斯托涅', hint: '两个名字，一条公路', quote: '两个名字，一条公路，整个战役的支点。' },
    { id: 'nuts', name: '不投降', en: 'NUTS!', tier: 'gold', cat: '胜负', icon: 'shield',
      desc: '美军：巴斯托涅守军曾断补，仍守到第 8 回合且城镇未被占领', hint: '被围住也要守住那座城', quote: '"Nuts!" —— 1944 年 12 月 22 日，麦克奥利夫用这一个词回答了德军的劝降书。' },
    { id: 'shoulder_to_shoulder', name: '削平突出部', en: 'SHOULDER TO SHOULDER', tier: 'gold', cat: '胜负', icon: 'pincer',
      desc: '《阿登全战役》美军决定性胜利（三枢纽全收复 + 德军战损 ≥ 35%）', hint: '把突出部推回去', quote: '1 月 16 日，两军在豪法利兹会师。突出部没有了。' },
    { id: 'decisive_defense', name: '决定性防御', en: 'DECISIVE DEFENSE', tier: 'silver', cat: '胜负', icon: 'pincer',
      desc: '美军在《突出部》达成决定性胜利', hint: '守住，并且守得很干净', quote: '"守住"从来不是被动——它是把敌人耗死在同一片雪地上。' },
    // —— 战术技巧 ——
    { id: 'panzerkeil', name: '装甲楔子', en: 'PANZERKEIL', tier: 'silver', cat: '战术', icon: 'tank',
      desc: '以纯装甲编队在开阔地形打出 DE（歼灭守军）', hint: '集中坦克，别掺步兵', quote: '坦克不是用来换防的。集中，然后捅穿。' },
    { id: 'crossing_our', name: '强渡', en: 'CROSSING THE OUR', tier: 'silver', cat: '战术', icon: 'west_arrow_river',
      desc: '从非河格攻击河格上的守军并打出 DE', hint: '河对岸的敌人也能吃掉', quote: '河不是墙——前提是你知道桥在哪。' },
    { id: 'panzerfaust', name: '铁拳', en: 'PANZERFAUST', tier: 'silver', cat: '战术', icon: 'fist',
      desc: '配属反坦克小组的步兵挡下纯装甲攻击且自身存活', hint: '给步兵发一支铁拳', quote: '一个人、一发火箭、一辆坦克：成本核算从来不对称。' },
    { id: 'artillery_prep', name: '炮火准备', en: 'ARTILLERY PREPARATION', tier: 'silver', cat: '战术', icon: 'artillery',
      desc: '一次攻击中两个炮兵营同时支援并打出 DE', hint: '让炮兵先说话', quote: '步兵要占的地方，炮兵先替他们犁一遍。' },
    { id: 'cab_rank', name: '空地协同', en: 'CAB RANK', tier: 'silver', cat: '战术', icon: 'aircraft',
      desc: '同一回合内空袭与地面攻击同一目标并将其击破', hint: '天上地下一起打一个点', quote: 'P-47 在公路上空排队点名。谁先谁后都无所谓，反正都要挨。' },
    { id: 'kessel', name: '合围', en: 'KESSEL', tier: 'silver', cat: '战术', icon: 'ring',
      desc: '使敌方至少一个团级单位连续断补 3 个回合', hint: '掐断它的补给线', quote: '包围不是画个圈，是让对方的卡车开不进来。' },
    { id: 'engineers_hold', name: '工兵堵口', en: 'ENGINEERS HOLD', tier: 'silver', cat: '战术', icon: 'engineer_bridge',
      desc: '工兵营在城镇格驻守满 3 个回合', hint: '工兵也能当步兵用', quote: '1944 年 12 月，工兵用炸药和步枪干着步兵的活。' },
    // —— 史实彩蛋 ——
    { id: 'peipers_ride', name: '派佩尔的驰骋', en: "PEIPER'S RIDE", tier: 'gold', cat: '史实', icon: 'tank',
      desc: '用派佩尔装甲营推进到乌尔特河以西', hint: '让那支战斗群跑起来', quote: '派佩尔最远摸到拉格莱兹，他没能过河——你可以试试。' },
    { id: 'trois_ponts', name: '三桥', en: 'TROIS-PONTS', tier: 'silver', cat: '史实', icon: 'bridge_gold',
      desc: '守住任意一座桥梁格满 3 个回合', hint: '桥就是咽喉', quote: '1944 年 12 月 18 日，一座桥被炸掉，一支装甲军的路线就此终结。' },
    { id: 'herbstnebel', name: '秋雾', en: 'HERBSTNEBEL', tier: 'silver', cat: '史实', icon: 'fog_arrow',
      desc: '第 1 回合内占领至少 2 座美军城镇', hint: '趁着雾还没散', quote: '行动的备选名是"秋雾"。雾一散，攻势也就慢了。' },
    { id: 'elsenborn_ridge', name: '埃尔森博恩岭', en: 'ELSENBORN RIDGE', tier: 'gold', cat: '史实', icon: 'ridge',
      desc: '美军在《突出部》胜利，且洛斯海姆与马尔梅迪全程未失守', hint: '北翼那堵墙', quote: '德军在这里撞上了一堵由炮兵和步兵砌成的墙。' },
    { id: 'christmas_counter', name: '圣诞反击', en: 'CHRISTMAS COUNTERATTACK', tier: 'silver', cat: '史实', icon: 'star_arrow',
      desc: '《阿登全战役》第 13~16 回合内收复任意一座枢纽城镇', hint: '反攻的第一周', quote: '12 月 26 日，第 4 装甲师的坦克突进巴斯托涅——圣诞礼物送到了。' },
    // —— 收藏 ——
    { id: 'ribbon_rack', name: '满墙勋章', en: 'RIBBON RACK', tier: 'gold', cat: '收藏', icon: 'ribbon',
      desc: '解锁其余全部成就', hint: '墙上不留空位', quote: '墙上没有空位了。雪原上每一场，你都留下了痕迹。' },
    /* —— 阶段 C：13 条长尾（跟踪字段在 js/achv.js 中早已在写）—— */
    { id: 'time_on_target', name: '时间引信', en: 'TIME ON TARGET', tier: 'silver', cat: '战术', icon: 'shell_burst',
      desc: '炮兵远程射击直接打出 DE（歼灭守军）', hint: '不用冲锋也能让对方减员', quote: '不用冲锋也能让对方减员——这就是炮兵存在的理由。' },
    { id: 'recon_value', name: '侦察的价值', en: 'RECONNAISSANCE', tier: 'silver', cat: '战术', icon: 'recon',
      desc: '单回合内用侦察营移动 8 格及以上', hint: '先看见的人，先决定', quote: '先看见的人，先决定。' },
    { id: 'fuel_discipline', name: '油料纪律', en: 'FUEL DISCIPLINE', tier: 'silver', cat: '战术', icon: 'fuel',
      desc: '德军终局仍有燃料，且至少一个装甲/摩托化单位渡河（未缴获任何油库）', hint: '不靠抢油库也能开到马斯河', quote: '巴顿说过：我的兵能啃皮带，但坦克得喝汽油。' },
    { id: 'against_odds', name: '以弱胜强', en: 'AGAINST THE ODDS', tier: 'silver', cat: '战术', icon: 'scales',
      desc: '以 1:2 或更差的战列打出 DE', hint: '兵力表不会打仗', quote: '兵力表不会打仗；决心、地形和一点运气会。' },
    { id: 'three_in_day', name: '三连破', en: 'THREE IN A DAY', tier: 'silver', cat: '战术', icon: 'tally',
      desc: '同一阶段内由 3 个不同单位各打出一次 DE', hint: '一天之内崩掉三处防线', quote: '一天之内三处防线崩掉——这才是攻势的样子。' },
    { id: 'supply_wizard', name: '补给官', en: 'SUPPLY WIZARD', tier: 'silver', cat: '战术', icon: 'supply',
      desc: '一局中使用过全部 5 种支援资产（反坦克小组/野战救护所/炮火急袭/补充兵员/野战工事）', hint: '让后方也打一场仗', quote: '前线打赢的每一仗，后方都已经先打过一遍。' },
    { id: 'airborne_hold', name: '空降死守', en: 'AIRBORNE HOLD', tier: 'silver', cat: '战术', icon: 'parachute',
      desc: '空降兵团在断补状态下守住巴斯托涅 3 个阶段及以上', hint: '被卡车送去，剩下的路自己走', quote: '他们是被卡车送去的，剩下的路自己走完。' },
    { id: 'pyrrhic_victory', name: '惨胜', en: 'PYRRHIC VICTORY', tier: 'bronze', cat: '胜负', icon: 'torn_flag',
      desc: '美军获胜，但自身战损达到 40% 及以上', hint: '赢了，代价写在花名册上', quote: '赢了，但代价写在你自己的花名册上。' },
    { id: 'last_kilometers', name: '最后的几公里', en: 'THE LAST FEW KILOMETERS', tier: 'gold', cat: '史实', icon: 'west_arrow_river',
      desc: '《阿登全战役》中德军装甲推进到地图 c ≤ 12 一线（塞勒方向）', hint: '离马斯河只剩几公里', quote: '塞勒，距马斯河 6 公里。历史上，这就是终点。' },
    { id: 'ten_offensives', name: '十次攻势', en: 'TEN OFFENSIVES', tier: 'bronze', cat: '参与', icon: 'tally',
      desc: '累计完成 10 局推演', hint: '雪地里的第十道刻痕', quote: '雪地里第十道刻痕。' },
    { id: 'veteran_bulge', name: '突出部老兵', en: 'VETERAN OF THE BULGE', tier: 'silver', cat: '参与', icon: 'snow',
      desc: '累计完成 25 局推演', hint: '你比多数参谋更熟那片林子', quote: '二十五次阿登。你已经比多数参谋更熟那片林子。' },
    { id: 'a_thousand', name: '千点血债', en: 'A THOUSAND', tier: 'silver', cat: '收藏', icon: 'tally',
      desc: '终身累计被歼战力（双方纸面攻+防）达到 1000', hint: '每个数字后面都是一张花名册', quote: '一千点战力，每个数字后面都是一张花名册。' },
    { id: 'twenty_crossings', name: '二十次渡河', en: 'TWENTY CROSSINGS', tier: 'silver', cat: '收藏', icon: 'bridge_gold',
      desc: '终身累计有 20 个装甲/摩托化单位冲出马斯河', hint: '每一条河都记得', quote: '每一条河都记得。雪也记得。' },
    { id: 'big_field', name: '百营之战', en: 'FIELD OF BATTALIONS', tier: 'silver', cat: '大推演', icon: 'eagle',
      desc: '完成一局阿登大推演（41 回合全流程）', hint: '打完 03 剧本', quote: '一千二百个营，四十一天。参谋部的沙盘从没这么大过。' },
    { id: 'big_veteran', name: '大推演老兵', en: 'GRAND WARGAMER', tier: 'silver', cat: '大推演', icon: 'ribbon',
      desc: '完成 3 局大推演', hint: '累计 3 局 03 剧本', quote: '第二次推演时，你开始记得每一个师的番号。' },
    { id: 'britannia', name: '帝国的承诺', en: 'BRITANNIA', tier: 'bronze', cat: '大推演', icon: 'pincer',
      desc: '英军部队在大推演中参战', hint: '让英军第30军的任何一支部队行动', quote: '12 月 20 日，蒙哥马利接管北翼。英国佬终于上场了。' },
    { id: 'hq_hunter', name: '军部猎手', en: 'HQ HUNTER', tier: 'silver', cat: '大推演', icon: 'target',
      desc: '摧毁一座敌方军指挥部', hint: '军指挥部组织度 10，位于该军后方', quote: '军部被端，整个军失去头脑——组织度与攻防全线下挫。' },
    { id: 'decapitation', name: '斩首行动', en: 'DECAPITATION', tier: 'gold', cat: '大推演', icon: 'target',
      desc: '摧毁一座敌方集团军司令部', hint: '集团军司令部组织度 15，毁则全集团军 -3', quote: '司令部的电台沉默了整整一个下午。' },
    { id: 'checkmate', name: '将旗落地', en: 'CHECKMATE', tier: 'gold', cat: '大推演', icon: 'eagle',
      desc: '摧毁敌方总指挥部', hint: '总指挥部组织度 20，毁则全军 -4——几乎不可能', quote: '当统帅部的旗帜倒下，前线的一切都失去了意义。' },
    { id: 'hundred_guns', name: '钢铁绞肉机', en: 'THE GRINDER', tier: 'silver', cat: '大推演', icon: 'tally',
      desc: '任意一个回合内，双方合计损失不少于 10 个营', hint: '大推演的消耗规模——单回合 10 营', quote: '参谋部的伤亡表每天都要换新的一页。' },
    { id: 'full_division', name: '齐装满员', en: 'AT FULL STRENGTH', tier: 'gold', cat: '大推演', icon: 'shield',
      desc: '大推演终局时，你的某一支师（10 营以上）没有任何一个营阵亡', hint: '把它带好——每一个营都要活着', quote: '从 12 月 16 日到 1 月 25 日，一个营都没少。这不是运气，是指挥。' },
    { id: 'meuse_shadow', name: '马斯河的影子', en: 'SHADOW OF THE MEUSE', tier: 'silver', cat: '大推演', icon: 'west_arrow_river',
      desc: '大推演中德军任何部队进抵马斯河一线', hint: '推到 c≤5 的渡口纵深', quote: '河对岸就是法国。1944 年的德军从没走这么远。' },
    { id: 'winter_lone', name: '冰原孤军', en: 'LONE IN THE ICE', tier: 'silver', cat: '大推演', icon: 'supply',
      desc: '任一单位连续断补 10 个阶段仍然存活', hint: '大推演的长战线——被切断也撑住', quote: '补给线断了十天，他们还在阵地上。' },
    { id: 'iron_rain', name: '钢铁暴雨', en: 'IRON RAIN', tier: 'silver', cat: '大推演', icon: 'shell_burst',
      desc: '一次火箭炮齐射（含溅射）造成至少 3 个营退出战斗', hint: '覆盖齐射：目标及其相邻格都吃伤害', quote: 'Nebelwerfer 的啸声落下时，整条街都在燃烧。' },
    { id: 'bastogne_gate', name: '巴斯托涅之闸', en: 'THE GATE OF BASTOGNE', tier: 'gold', cat: '大推演', icon: 'shield',
      desc: '第101空降师在巴斯托涅连续驻守不少于 12 个阶段', hint: '守满 12 个阶段不丢城', quote: '"Nuts!"——麦考利夫的答复之后，是十二个阶段的死守。' },
    { id: 'ardennes_1944', name: '阿登 1944', en: 'ARDENNES 1944', tier: 'gold', cat: '大推演', icon: 'eagle',
      desc: '解锁全部大推演成就', hint: '集齐本页所有「大推演」成就', quote: '把这场战役的每一个角落都走过一遍——你已经是 1944 年冬天的老兵。' },
  ];
globalThis.ACH_DATA = { ACH_PALETTE, ACH_ICONS, ACHIEVEMENTS };
