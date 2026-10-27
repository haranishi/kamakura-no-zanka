# 道しるべの純粋層・データ実装（7.1 / 7.2データ）

純粋層とデータは実装・Node検証済み。下記の仕様差が未確定のため7.1の完了チェックは保留、view未結線。
ゲームの既定表示で変わるのは目的文。game/hud/input/quest/HTML/CSSは変更していない。
ブランチ feat/polish2-guide。git add/commit/push、smoke、ブラウザ実行はしていない。

## 変更と検証

- Part 1: `dist/valley/guide.js`、`tests/valley-guide{,-world}.test.mjs`。固定路・帯・補正・復帰・履歴・方向。
- Part 2: story-dataの目的文とguideTarget、world-dataのvillage_center、valley-worldの到達検査。
- Part 3（設定「道しるべ」）: 谷の設定は `dist/valley/main.js` の `applySettings`（保存キー `kamakura-valley-settings`）にあり、`dist/ui.js` は庭の設定で対象外。view の作業で、純粋な整形とつないで作る（未着手）。
- check-valleyのmoduleと純粋層一覧にguide追加。既存テストに旧目的文の一致期待はなく、置換不要だった。
- 開始: npm test 204/204、npm run check 合格（46必須・105構文・40module・16純粋層）。
- 終了: npm test 240/240、npm run check 合格（46必須・110構文・41module・17純粋層）。uiの内蔵検査は6→9。
- 新規Node単体21件・実世界15件。木と岩の配置が区域追加前と完全一致することも検査した。
- 実世界は同梱の地形・木・岩・建物・置物・柵を使い、主人公半径0.3mで経路を0.05m以下の間隔で検査。
- 新規素材・依存なし。セーブ版・任務達成条件・会話・段ID/順序は変更なし。

## 基準路の距離（m）

前値は `reports/baseline/polish2-guide-starts-before.json` のroadM。開始位置は同一。
新値は `polish2-guide-baselines.json`（経路座標、必須点、補正、区間種別も収録）。

| 段 | 道 | 前roadM | 新基準路 | 差 |
|---|---|---:|---:|---:|
| b0 | 共通 | 23.691 | 23.691 | 0 |
| b1 | 共通 | 4.123 | 4.123 | 0 |
| b2 | 共通 | 53.640 | 74.282 | +20.642 |
| b3 | 正面 | 48.870 | 72.075 | +23.205 |
| b3 | 北 | 73.620 | 126.317 | +52.697 |
| b3 | 南 | 94.468 | 152.829 | +58.361 |
| b4 | 正面 | 34.928 | 34.928 | 0 |
| b4 | 北 | 32.806 | 33.661 | +0.855 |
| b4 | 南 | 34.176 | 34.176 | 0 |
| b5 | 共通 | 10.198 | 10.198 | 0 |
| b6 | 共通 | 97.282 | 167.778 | +70.496 |

b0/b1/b2/b5/b6はfront/north/southの各指定でも検査。道によらない段なので距離は同じ。
b7/doneは目的地なし。旧b7の2.236mは測定用代替で、今回は基準路を作らない。
増分の主因は九十九折と迂回路の全必須点（旧navは短絡する）、および下記の終端接続。
b4北の差は格子2→0.5m・半径0.45→0.3m・実線分/セル四隅検査の条件差。

補正が出た「道路の必須折れ点」は0個。目的地だけ、b2の見晴らし岩中心(-50,-36)が障害物内なので、
同じforest帯内の(-49.25,-35.75)へ0.790569m補正した（JSONのcorrections）。旧測定の補正量は2m。
village_centerは(x,z)=(0,4)、半径3m（未測定の区域設計値）。倉(-34,10)の東、家1/5の間を抜けた
lane沿い、井戸(0,0)の南の広場。敵座標は使わず、三入口から到達し、中心そのものが通れることを検査。

## 目的文の新旧（文字数はUnicodeコードポイント）

| 段 | 旧 | 新 |
|---|---|---|
| b0 | 庭へ降りる | 庭へ降りる——縁側の前へ |
| b1 | 穂太の話を聞く | 穂太の話を聞く——駆け上がる子のそばへ |
| b2 | 水穂の里へ向かう | 見晴らし岩へ——石段を下り、林道を南東へ |
| b3 | 里へ入る道を選ぶ | 里へ——正面は南の林道、北は斜面道、南は畦道 |
| b4 | 里を守る | 里を守る——倉と家のあいだへ |
| b5 | 縛られた弥十郎を解く | 縛られた弥十郎を解く——縄のそばへ |
| b6 | 廃寺へ戻る | 廃寺へ戻る——林道を北西へ、石段の上まで |
| b7/done | 帰還の報せを聞く／谷の灯を守った | 同じ（guideTargetはnull） |

設計表のb3は30字→22字へ短縮した。旧最長10字、新最長22字。既存CSSは幅制限と折返しあり、
固定高・切捨てなし。17px・字間0.1emでは22字は約411pxで、既存枠では2行になり得る。
文字数とCSSの静的確認まで。画面に収まるという実測の主張はしない。

## 変異（壊す→落ちる→復元）

`node tools/verify-guide-mutations.mjs`。27/27検出、結果は `polish2-guide-mutations.json`。
方向、必須点、道路帯、補正量、25m境界、30秒窓、10m境界、modeでの履歴消去、時計停止、
目的/道/再開の各リセット、result強調消去、解除のAND条件/20m境界、強調中の履歴継続、
交差での順序、通過済み進捗、復帰先制限、固定路の道外れ、非有限拒否、実障害物、
中心目標、目的文、設定の既定/3値保持/不正値拒否。最終テストは全変異の復元後に実行。

## viewへのAPIと親の確認点

`buildBaseline(world, {bounds, walkable, cell?}, {objectiveId, plan:'front'|'north'|'south', from})` を一度呼ぶ。
walkableは地形と静的障害物・主人公半径0.3mを含める。目的/道/開始位置が変わったとき再構築。
返り値はJSON可能な `{id,points,cumulative,length,mandatory,corrections,legs,...}`、到達不能/目的なしはnull。
`assess(baseline, previousStateOrNull, {t,pos,mode,objectiveId,plan,baselineId:baseline.id})` を観測ごとに呼び、
返されたstateを次へ渡す。出力はoffRoad/distance/remaining/stalled/emphasized/direction/directions/progress30。
directionsはalong/direct/angleDeg/nextを持つ。向きは世界XZの単位ベクトル（終端はゼロも可）。
`buildRecovery(baseline, nav, {pos,progress:state.progress})` を0.5秒ごとに呼ぶ。pointsは復帰後の固定路も含む。
復帰路はassessに渡さない。tはヒットストップ前の活動秒。非有限/不正観測/不一致baselineはTypeError。
履歴はfree連続30秒のみ。clockはfree区間内でのみ加算。state.progressは通過済み最大距離、remainingは現在投影。
親のブラウザ: 3画面比で全目的文の折返し・重なり、既定プレイ/旧矢の維持、設定保存の互換を確認する。
次のviewでは矢・標・G・風・中心到達時の標消去、中心後の戦闘目的説明、本人の3秒理解試験を行う。

## 仕様とデータの隙間（view前に判断を引き継ぐ）

- forestとnorth/southは未接続。北はforest[8]→north[0]、南はforest[7]→south[0]をnav接続し、
  legs.kind=connectionで明示。特に南は約50mあり「庭と里内の短い接続だけ」と一致しない例外。道路の帯内探索とは分離した。
- b3は道路の全必須点を残してから既存入口区域の中心へ接続するため、入口の先まで進んで戻る区間がある。
  現行questは区域への最初の侵入で段が進む。viewでの停止位置と、必須点の終端を揃える判断が必要。
- b6はforest→temple全逆順を保ち、temple上端(-86,-72)から現行temple_steps中心(-74,-66)へ13.416m戻す。
  「石段の上」までを終端とするか、既存区域中心まで戻すかは未確定。現在の実装は後者で、quest/gameは変更していない。
- questのplanはfront/flankのみ、guideはfront/north/south。viewは入口区域などから北/南を明示的に選ぶ必要がある。
- 基準路探索・復帰探索の実ブラウザ処理時間は未測定。0.5m格子を動的に作るので、view結線時は構築/再探索の負荷も確認する。
