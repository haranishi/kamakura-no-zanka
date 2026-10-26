# Tasks: 隠れ谷の縦切り

担い手: **Me**=本体の主エージェント／**CX**=Codex（`CODEX_HOME=/Users/hara/.codex-work`、自己完結の指示で並行）／**OP**=独立評価役（Opus・読み取り専用）。
完了は証拠（テスト結果・実ファイル・実挙動）で判断する。各タスクの要件番号は requirements.md。

## 0 土台
- [x] 0.1 要件・設計・タスク・物語の要約・ステアリング更新 _(R13)_
- [x] 0.2 `provenance/meshy-v19.json`（task_id・設定・消費クレジット・SHA256）と `provenance/valley-textures.json` を作る _(R4.3)_ ✅ `provenance/meshy-v19.json`（7体＋小道具9、SHA256照合）・`valley-textures.json`
- [x] 0.3 `tools/check-package.mjs` と `tools/smoke.mjs` を `/valley/` に対応させ、既存の庭の検査を壊さない _(R13)_ ✅ `tools/check-valley.mjs`（check-packageから呼ぶ）・`smoke.mjs` に `/valley/` の84ファイル

## 1 世界
- [x] 1.1 `world-data.js`（地図・道・建物配置・敵と村人の初期配置・トリガー・森の濃さ）。通行と重なりをNodeで検査 _(R2)_ ✅ `tests/valley-world.test.mjs`（配置の通行・全行程の経路・飾りの重なり）
- [x] 1.2 `terrain-height.js` と近景・遠景メッシュ、質感の重ね合わせ。歩ける道が廃寺から里まで連続することを検査 _(R2.1, R2.3)_ ✅ 歩ける道が廃寺から里まで連続（経路テスト）。急斜面の質感を岩へ譲る
- [x] 1.3 大気（空・太陽・PMREM・高さ依存の霧）と後処理（MSAA→ブルーム→階調→ビネット）。固定画角1〜2で確認 _(R3.1, R3.2)_ ✅ 固定画角と `?lk=` で見た目の調整を試せる
- [x] 1.4 植生（杉の三段・下草・稲穂・岩）と風。軽量品質で装飾を減らす _(R3.1, R3.4)_ ✅ 区画ごとの InstancedMesh（視錐台・距離で除外）。草は低く細く密に
- [x] 1.5 水（川・岸・泡）と遠景（橋・関所・山砦・三層の稜線）_(R2.2)_ ✅ `water.js`（川・泡・流れ）・橋は川を横切る向き・関所・山砦・馬防柵
- [x] 1.6 Blender軽量化（`tools/blender/optimize_asset.py`）→ 廃寺・農家5・倉・橋・柵・小道具の配置と当たり _(R2)_ ✅ 農家・神殿・柵・橋を軽量化、Meshy 小道具9点＋Drive建物。当たりは `world-colliders.js`
- [x] 1.7 固定画角の撮影道具（`shots.js`＋`tools/valley-capture.mjs`）。乱数・時刻固定、落ち着いてから撮る _(R3.3)_ ✅ `shots.js` ＋ `tools/valley-play.mjs` ＋ `tools/scenarios/capture-set.mjs`（23枚）

## 2 人物と動作
- [x] 2.1 Meshyで7体の生成・骨入れ・台帳記録（実施中）_(R4)_ ✅ 7体（主人公・弥十郎・雑兵・侍大将・男・女・子）。台帳は provenance
- [x] 2.2 `tools/blender/build_valley_character.py`（湊の写し替えの道具を本作用に）で7体へ約45本の動作を焼く _(R5.1)_ ✅ `tools/blender/build_valley_character.py`。役割ごとに37〜57本の動作
- [x] 2.3 武器の手続き生成（太刀・薙刀・弓・矢・矢筒）`tools/blender/build_valley_props.py` _(R5.2)_ ✅ 武器は Three.js の手続き生成（`weapons.js`）に変更。Blenderで作る必要がなくなった
- [x] 2.4 `characters.js`（読み込み・複製・動作制御・武器取り付け・変種・更新頻度）と足滑りの計測 _(R4.2, R5)_ ✅ `characters.js`（読み込み・複製・動作・武器・ひるみ・腕の力抜き）・`bow.js`

## 3 遊びの規則（純粋ロジック・CX）
- [x] 3.1 `combat.js`＋テスト _(R6)_ ✅ `combat.js`＋テスト（反撃を追加）
- [x] 3.2 `enemy-ai.js` と `nav.js`＋テスト _(R7)_ ✅ `enemy-ai.js`・`nav.js`＋テスト
- [x] 3.3 `companion-ai.js`＋テスト _(R8)_ ✅ `companion-ai.js`＋テスト
- [x] 3.4 `quest.js`・`story-data.js`（台詞は Me）・`save.js`＋テスト _(R9, R10)_ ✅ `quest.js`・`story-data.js`・`save.js`＋テスト

## 4 結線と見た目の仕上げ（Me）
- [x] 4.1 三人称の操作とカメラ（ばね・遮蔽で手前へ寄せる）・当たり・屈み・ロックオン _(R2.4, R6, R11)_ ✅ `input.js` `camera-rig.js` `collision.js`・Tab狙い・戦闘中の弱いカメラ補助
- [x] 4.2 戦闘の結線（予兆・命中の重さ・火花・揺れ・音）と敵・仲間の配置 _(R6, R7, R8)_ ✅ `battle.js`（予兆の光・照準線・ヒットストップ・火花・揺れ・士気）
- [x] 4.3 HUD・会話・結果・メニュー・設定・字幕 _(R1, R11, R12)_ ✅ `hud.js` `index.html` `valley.css`（目的・方角・体力と構え・会話・字幕・結果・メニュー・設定）
- [x] 4.4 合成音（風・川・足音・刃・被弾・弓・太鼓）_(R12)_ ✅ `audio-valley.js`（24種を再生確認。音の良し悪しは耳での確認が必要）
- [x] 4.5 `?qa=1` のフック `window.__valley`（時刻固定・瞬間移動・状態・1コマ送り）_(R13)_ ✅ `qa.js`（`window.__valley`）

## 5 検証と改善の周回（最大3周）
- [x] 5.1 Node単体・変異テスト・配布検査 _(R13.1)_ ✅ `npm test` 162件・変異で落ちることを確認
- [ ] 5.2 ブラウザの通し（自動操作）・固定画角撮影・性能（標準/軽量・静止/移動/戦闘）_(R13.2)_
- [ ] 5.3 **OP** 画面採点（固定画角と企画の三人称画を比べる）_(R13.3)_
- [ ] 5.4 **OP** 体験採点（通しの記録と静止画）。指摘は実在をコードで確かめてから直す _(R13.3)_
- [ ] 5.5 指摘の修正（周回タグ・旧値→新値）と再撮影。同じ失敗が2周続いたら原因と残件を報告 _(R13.3)_

## 6 引き渡し
- [ ] 6.1 README・検証記録・Obsidianの記録（Vault `70_Web・開発・技術/Web制作_3D表現/`）・素材のDrive退避と置き場所の記録
- [ ] 6.2 非公開リポジトリへ小さなcommit→PR（main直接pushなし）。マージとSNS投稿は本人の操作
