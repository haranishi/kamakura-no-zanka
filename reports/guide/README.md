# 道しるべの純粋層・データ実装（7.1 / 7.2データ）

純粋層とデータは実装・Node検証済み。下記の仕様差は2026-10-27に受け入れを決定し7.1を完了。画面側は後段の実装メモを参照。
以下の初回作業記録では、ゲームの既定表示で変わったのは目的文だけ。今回の画面側変更とは区別する。
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

## 仕様とデータの隙間（当初の記録。下記決定で解決）

- forestとnorth/southは未接続。北はforest[8]→north[0]、南はforest[7]→south[0]をnav接続し、
  legs.kind=connectionで明示。特に南は約50mあり「庭と里内の短い接続だけ」と一致しない例外。道路の帯内探索とは分離した。
- b3は道路の全必須点を残してから既存入口区域の中心へ接続するため、入口の先まで進んで戻る区間がある。
  現行questは区域への最初の侵入で段が進む。決定：区域進入時にb4用へ再構築し、終端の特別扱いはしない。
- b6はforest→temple全逆順を保ち、temple上端(-86,-72)から現行temple_steps中心(-74,-66)へ13.416m戻す。
  決定：現行区域中心へ戻る形を受け入れ、questは変更しない。
- questのplanはfront/flankのみ、guideはfront/north/south。viewは入口区域などから北/南を明示的に選ぶ必要がある。
- 基準路探索・復帰探索の実ブラウザ処理時間は未測定。0.5m格子を動的に作るので、view結線時は構築/再探索の負荷も確認する。

### 決定（2026-10-27）：純粋層と画面側の接続

- 林道とnorth/southの空白は既存guideの `legs.kind=connection` で結ぶ。南の約50mは「庭・里内の短い接続だけ」の明示的な例外として受け入れる。
- b3は必須点を通って入口中心へ戻る固定路を維持する。questは入口区域への最初の進入でb4へ進むため、その時点でb3の案内を終え、b4の基準路へ作り直す。特別な終端処理は足さない。
- b6はtemple逆順の終端から現行temple_steps中心へ13.4m戻る形を受け入れる。
- planはb0〜b2・b5・b6ではfront固定。b3はquestのflankをnorthへ、それ以外をfrontへ対応させる。northの固定路から25m以上・southの固定路から10m以内に自由移動で3秒連続滞在したらsouthへ切り替える（逆も同じ）。両側の固定路は同じ開始位置で一度構築し、切替時に採用路・履歴・復帰路を交換する。b4はb3→b4の瞬間に最も近い入口中心のplanを保持する。再開時は再開位置に最も近い入口とする。
- modeはpaused→dialogue→result（死亡・暗転・選択・導入等）→combat（生きた戦闘状態の敵あり）→freeの優先順。tはヒットストップ前の活動秒、一時停止では止める。
- 足もとの矢はfreeのみ。b4の中心半径3m到達後は移動の標を消すが、目的文と距離を残しquestは進めない。敵を目的標にしない。
- waymarksはbold/subtle/off、不正・未保存はbold。boldは足もと・視界外の縁・30m以上の柱、subtleは小さく薄い足もとだけ、offは移動標なし。強調はoff以外をbold相当にし縁を強制。G中はoffを含めbold相当。会話・休止・結果では移動標を隠す。
- Gは共有requestGuideで5秒、終了後2秒待つ。120点（動きを減らす場合48点）のPoints一つを、現在地から道なりに最大40mへ流す。残経路が40m未満なら終点までとし、目的地を越えて粒を伸ばさない。自動では風を呼ばない。
- 足もとは前方1.6m・地面+0.06m、淡い金と暗い縁。脈打ちは1.1秒・±5%、動きを減らす場合は停止。縁は道の前方15mを見る。柱は高さ20m、30m付近で薄れる。描画追加は矢・柱・Pointsの最大3呼出（透過両面はforceSinglePass）。左上のsetCompass APIは保ち針を隠す。
- 初回はb0〜b2でhintキーguide-gを一度だけ表示。基準路は目的・plan・再開/復活でのみ変更、assessは30Hz以下（mode境界は即時）、復帰探索は強調/G中のみ0.5秒ごと。構築と復帰探索はperformance.nowで計りQAへ出す。実ブラウザの測定・撮影・理解試験は親が行う。

## 画面側の実装メモ（7.2・7.3、2026-10-27）

実ブラウザでの確認の結果（見つけて直した問題3つ・自動歩行・性能）は [view-verification.md](view-verification.md)。

実装は完了、7.2・7.3のチェックは親の実ブラウザ確認まで保留。保存形式・quest・戦闘・音・草木・容量の実装には変更を加えていない。依存・素材・通信・ビルド工程の追加なし。

| 決定 | 実装場所（dist/valley/） |
|---|---|
| 1 plan対応 | game.js updateGuide/rebuildGuide/onBeatChange、guide-view.js switchGuidePlan/nearestGuideEntrance |
| 2 4差分を受入 | design-contracts.md・design-wayfinding.md・本書の決定、tasks.md 7.1完了 |
| 3 mode・活動時間 | game.js guideMode/update（guideTimeはrawDt、一時停止で不変） |
| 4 freeだけ足もと | guide-view.js guideVisibility、guide-renderer.js update |
| 5 中心到達 | game.js updateGuideのreachedラッチ、guideVisibility（questへ達成通知なし） |
| 6 設定3値と保存 | guide-view.js normalizeWaymarks/guideVisibility、main.js applySettings/wire/persist、index.html set-waymarks |
| 7 G・風・粒 | input.js GAME_KEYS、game.js handleUiKeys/pressGuide/updateWorld、guide-view.js sampleGuidePath、guide-renderer.js startParticles/update（wind.js APIはそのまま） |
| 8 迷いの助け | game.js updateGuide、guideVisibility、guide-renderer.js update（強制縁・案内文、自動風なし） |
| 9 初回 | game.js updateGuide → hud.hint('guide-g',...)。他のhintを上書きせず空きを待つ |
| 10 控えめな形・動き | guide-renderer.js constructor/update、game.js reducedMotion、valley.css。matchMediaは一度だけ作り現在のmatchesを読む |
| 11 左上針を廃止 | hud.js setCompass（シグネチャ維持、距離だけ）、index.html/valley.css |
| 12 再構築・探索頻度・計測 | game.js placeHeroAt/rebuildGuide/updateGuide/refreshGuideRecovery、performance.nowのbaselineMs/recoveryMs |

静的navの元の実体はtestsから呼ぶtools/measure-guide-baselines.mjs内にあった。guide-nav.js createGuideNavへ移し、game・測定道具・実世界テストが同じ関数を使う。ゲームが既に作った地形・当たり表（木・岩・建物・柵・置物）を渡す。セーブには案内状態を保存しない。

描画はguide-renderer.jsへ分離。平たい矢は外縁と内側を一つのgeometryに収め、頂点ごとに地形高へ沿わせる。透過両面材質はforceSinglePassで矢1・柱1・粒1の最大3呼出に収める設計。これはコード上の上限であり、GPU実測の成功を意味しない。

QA（?qa=1のwindow.__valley）:

- guideView(): enabled/level/objectiveId/plan/baselineId/remaining/direction/emphasized/offRoad/stalled/mode/reached/baselineMs/recoveryMs、foot（visible/position/direction/yaw）、edge（visible/angle/text）、pillar（visible/position）、particles（count/remaining）。位置と角度は最後のview更新時。baselineIdはguide.jsの不透明な文字列ID。
- setGuidePlan('front'|'north'|'south'): 現在地から固定路を再構築するQA専用操作。questの選択や進行は変えない。
- setWaymarks(level): メニューと同じ整形・保存・即時反映を通る。不正値はbold。
- pressGuide(): Gと同じ処理。受理true/無視false。拒否時の通知なし。
- 既存のteleport/look/dispatch/step/freeze/windState/perfSamplesと併用できる。自動歩行はguideView().directionを使用し、b4ではreachedを移動検査の終点とする。再開・復活の検査はstart('continue')と既存のやり直し操作を通す。

検証環境: Node v24.22.1、ブラウザなし。

- 開始時 npm test: 240/240。npm run check: 46必須ファイル・110構文・41モジュール・17純粋層、合格。
- 追加 tests/valley-guide-view.test.mjs: 16件。冒頭に失敗理由、assertに原因型。旧設定/不正値、3段階とG/強調/mode/中心/減動、南北の25m/10m/3秒境界と中断、最近入口、40m折れ点/短経路/重複点/不正入力、復帰路の古い始点への逆走防止、navの地形・静的障害・半径を検査。
- 終了 npm test: 256/256、失敗0。npm run check: 46必須ファイル・114構文・44モジュール・19純粋層・56 HTML id・28 GLB、合格。git diff --check合格。
- 変異は手動で4回、各回壊す→上記テストだけ実行→落ちることを確認→元のファイルへ復元。既定bold→offは1件、subtleを強制strongは1件、3秒→2秒は南北の2件、経路X補間を0固定は2件が失敗。4/4検出。全復元後に全256件を再実行。
- npm run smokeはlocalhostのlistenがサンドボックスでEPERM。HTTP検査は未完了。実ブラウザ、描画数・三角形・性能・固定画角の前後撮影・3秒理解は未実施。親の環境で行う。
- 最初のgit switch -c feat/polish2-viewは.git/refsへの書込みが拒否され失敗。現在のfeat/polish2-guideに未ステージ差分を残した。親がブランチを作る。git add・commit・pushは一切していない。

解釈として明示する点: b3の南北路は開始位置を揃えて先に両方を構築し、3秒成立時にはその固定路へ交換して観測履歴と復帰路をリセットする（現在位置から必須点を逆に引き直さない）。目的地まで40m未満なら粒は終点まで。b4を保存から再開して入口遷移の瞬間が無い場合、再開地点の最近入口を使う。既存の戦闘用HUDは維持し、新しい案内には敵座標を一切使わない。

親が実ブラウザで確認すること（次の最小ステップは7.4）:

1. 足もとの矢: 全段・正面/北/南・九十九折で形と向き、前方1.6mと地面への沿い方、暗い縁、床とのちらつき。free以外で消え、敵へ向かないこと。
2. 縁の矢: カメラを左右・背面・上下へ向け、前方15mの道の方向・角度・距離・端の余白を確認。目的文や会話と重ならないこと。
3. 柱: 30m境界・接近時の薄れ・遮蔽物なし150mでの判読。b4の半径3mへ入ると全移動標が消え、目的文と距離は残り、任務が進まないこと。
4. G: free/戦闘で使え、会話/休止/結果/死亡では無効。subtle/offから5秒だけbold相当、5秒終了後2秒までは連打が無言で拒否されること。途中休止では風と粒の時間が止まること。
5. 粒: 最大120点、曲がり道・復帰路の先40m（残りが短いと終点まで）を流れ、障害物を横切らず、5秒で消えること。目的変更・復活で旧経路の粒が残らないこと。
6. 迷いの助け: 道外れ25m/自由移動30秒10m未満で強調と一行文・強制縁。offは自動案内なし。自動で風が吹かず、戦闘/会話/休止の履歴境界が守られること。b3の南北切替は両方向とも25m/10mで3秒連続を確認。
7. 初回: b0〜b2でG案内が一度だけ出ること。offでも表示し、同一セッションの再開/やり直しで二度出さないこと。
8. 設定: 三段階の即時反映・再読込み後の保存・キー無しの旧設定と不正値のbold。左上は全段階で目的文と距離だけ。
9. 3画面比: 1280×720・1440×900・1024×768、DPR1。目的文の折返し・縁・会話・操作表示の重なりを撮影比較する。
10. 動きを減らす: OSのprefers-reduced-motionで脈打ち停止・48粒、共有風の振幅0.4倍。通常は1.1秒±5%で落ち着いていること。
11. 性能: baselineMs/recoveryMs（b3は比較用の両路構築を含む）とperfSamplesの実標本。追加描画最大3、三角形少量、毎コマ探索なし、復帰探索は0.5秒間隔。再開・復活・設定変更の反復で資源が増えないこと。npm run smokeも再実行する。
12. 自動歩行と人の理解: guideViewだけで各区切りから次へ着くことを検査し、未見者の3秒理解は別に確認。中心後の戦闘目的とb5への進行は実プレイで確認する。
