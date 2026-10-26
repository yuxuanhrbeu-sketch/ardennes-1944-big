# 参与贡献 / Contributing

感谢你愿意帮忙。这个项目是**数据密集**型兵棋，改坏一个数字可能让整条战线的补给全断，
所以下面这套流程不是形式主义——它是踩坑踩出来的。

## 一、先跑基线

```bash
node tools/check_big.js              # 35 项，必须全绿
node tools/oob_big/check_oob_big.js  # 29 项，必须全绿
npm test                             # 12 个核查器串跑
```

**基线不绿就别动代码**——先开 issue 说明现状，否则你分不清"我改坏了"还是"本来就是坏的"。

## 二、按改动类型走对应流程

| 你要改什么 | 必须先读 | 改完必须跑 |
|---|---|---|
| 地图尺寸 / 地形 / 河流 / 道路 | `docs/HANDOVER.md` §5.4、§5.5 | `qa/geo_align.js` → `check_big.js` |
| 城镇（增删改坐标/等级/供给预算） | §5.2、§5.3、§5.3b（命名红线） | 四连：`scan_fake_names` → `diag_towns` → `coverage_area` → `audit_coords` |
| 作战序列 OOB（番号/编制/部署） | §4、§6 | `gen_data_big.js` → `check_oob_big.js` → `check_big.js` |
| 战斗 / 补给 / 兵种特性规则 | §7、§10 | `qa/type_buffs_check.js` + `qa/town_supply_flip_check.js` |
| 界面 / 渲染 | — | `node build.js` + `tools/shot.js` 拍图比对 |

## 三、铁律（会被 review 直接打回的）

1. **不要手改 `js/data_big_oob.js`** —— 它是 `tools/oob_big/gen_data_big.js` 的产物。
2. **禁止手估坐标** —— 一律用真实经纬度经 `qa/geo_convert.js` 换算（§5.3a）。
3. **禁止"锚点+方位"式自造地名**（如「巴斯托涅以东」）—— 必须是真实地名（§5.3b）。
4. **布防只走扇区**，不在别处硬编码算子坐标。
5. **别把荒野留白当 bug 修** —— 森林腹地不被补给覆盖是刻意设计（§5.3c）。
6. **浏览器直载脚本的顶层 `const` 必须分片唯一** —— 同名 `const` 在全局作用域会
   静默 SyntaxError，node 侧却全绿（§8-38 真踩过）。

## 四、提交

```bash
git checkout -b fix/supply-typo
# ...改...
npm test
node build.js
git commit -m "fix(supply): 修正 12 座师级补给点预算误写为 13"
git push origin fix/supply-typo
```

- 提交信息用 `type(scope): 摘要`：`fix` / `feat` / `data` / `docs` / `qa` / `refactor`。
- 数据类 PR 请在描述里贴 `npm test` 最后几行输出（证明全绿）。
- 视觉类改动请附 `tools/shot.js` 出的前后对比图。

## 五、可选：跑无头截图做视觉核验

```bash
npm start                                  # 本地服务 http://127.0.0.1:8423
# 另开一个终端：
set RELOAD=1&& set APP_URL=http://127.0.0.1:8423/dist/ardennes44_big.html&& node tools/shot.js shots\check.png "" 5000 1600 900
```

## 六、许可

提交即表示你同意以本仓库的 [MIT 许可](LICENSE) 发布你的贡献（照片等第三方素材除外，
见 [CREDITS.md](CREDITS.md)）。
