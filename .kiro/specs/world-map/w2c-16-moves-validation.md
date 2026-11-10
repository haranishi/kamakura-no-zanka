# W2c-16i 刀の動き：鎌倉の散策でも、斬り・強斬り・回避・受けが出る

鎌倉専用のつなぎを足し、第一章（谷）と共用の主人公・動き・当たり・刃の軌跡をそのまま使った。
Node の試験と、実 Chrome で実際に操作した録画の両方で確かめた。旗は `&moves=0`（歩く・走るだけ）。

## 実 Chrome で確かめたこと

八幡宮の手前の草地で、実際に操作して録画した（1280×720）。コンソールのエラーは 0。

- 1 回目のクリックはマウスの固定に使われ、2 回目から斬りになる。3 回続けて押すと、抜刀 → 斬り上げ → 振りかぶって斬り下ろし → 横の払い、と続く。
- F：深く沈んで溜めてから強く斬る。Space：前へ転がって回避し、そのまま走れる。右クリックを押している間：刀を斜めに立てた受けの構え。
- 刀は、最後の操作から約 6.5 秒で鞘に納まる（抜いている間は `__kzMoves().drawn` が true）。
- 敵・仲間・会話にあたる口は、呼ばれても何も起きない代役で、例外は出なかった。
- 指での操作（スマートフォン）では、刀の動きは出せない（ボタンが無く、画面を叩いても斬りにならない。既知の制約）。画面のボタンを押しても斬りは出ない（PC のクリック・指のタップの両方で確認）。
- 刃の軌跡は、この録画のコマでは細くて見分けにくい。動いている画面での見え方は、まだ誰も確かめていない。


## 依頼との対応

| 要求 | 対応 |
|---|---|
| 三連斬り・強斬り・回避・受け・抜納刀 | 実装。既存 hero.update を使用 |
| moves=0 と操作なしの位置互換 | 実装。旧経路をそのまま残し、600コマ比較 |
| C はゆっくり歩き、E・Tab・Q は無効 | 入力の窓口で遮断。hero-life の keys はそのまま |
| 軌跡・音・土ぼこり | SlashTrails と既存 audio / fx.dust へ接続 |
| 休止・飛行・位置指定 | reset で技・刀・速度・軌跡を解除 |
| 案内・debug・解放 | 案内2行、__kzMoves、所有した資源と差し替えを解放 |

## 実装前に確認したゲーム側の口

actors.js の Actor / HeroActor、game.js の生成・controlFrame・update と
battle.js の updateTrails / trailActor / onStrike を照合した。
新しい Battle は作らない。下表の代役には呼び出し回数を付けた。

| 口 | 呼ぶ場所 | 鎌倉での扱い |
|---|---|---|
| scene・roster | Actor / Character の生成 | 既存の本物 |
| terrain.heightAt・col | step・straightRoom・place・脚IK | 既存の本物。moveActor を維持 |
| terrain.slopeAt・waterAt・movementBlockedAt | moveActor | 既存の本物。海と斜面も同じ制限 |
| terrain.surfaceAt・world.buildings | onFootContact → stepSurfaceAt | 既存 audioView.attach の世界と地表 |
| hero・enemies・ally | tickCharacter・updateLungeView・nearestEnemy | 本人・空の敵配列・null |
| alertedEnemies() | HeroActor.update | 0 を返す代役 |
| audio.play | onCombatEvent・tickSword・tryDodge | 既存の音。draw / sheathe / swing / roll |
| audio.playStep・rng・pan | onFootContact | 既存 audioView.attach の本物 |
| fx.dust | tryDodge・onFootContact | 既存 prepareKamakuraFx.api の本物 |
| emitNoise | onFootContact | 警戒する敵がいないため無処理・計数 |
| hud.hint | 移動で急斜面に阻まれたとき | 既存の案内 |
| hud.toast | onCombatEvent の構え崩れ | 無処理・計数。被弾相手がなく通常は未到達 |
| contactTimeScale・footQA | tickCharacter・onFootContact | 既存の既定値1・任意のQAなし |
| battle.onStrike・time | tryInteract の闇討ち | E遮断＋敵なし。onStrike は無処理・計数 |
| fx.trails | Battle.updateTrails / trailActor | 接続側で同じ SlashTrails を所有し再利用 |
| hitStop・rig.kick / punchFov | Battle.onStrike | 無処理・計数。命中なしで呼ばれない |
| 会話・保存・仲間命令・狙い | Game のUI / story / battle | 呼ぶ Game を作らず、E・Tab・Q遮断 |
| npcs・戦果・任務・slowMo | 押し戻しや Battle の命中後 | 敵も Battle も作らず、素振りから到達しない |

F は既存の飛行キーとも競合していたため、歩行中だけ capture で強斬りへ渡す。
飛行ボタンと飛行中の F は維持。moves=0 ではこの処理も追加しない。
入力の最初のクリックによるマウス固定は input.js を変更せず維持する。
beforeHero → hero.update → finishPose → 軌跡採取の順。IK と cinePose を分離しない。
新規のシェーダー・素材・依存・保存データの変更はない。

## Node の結果

- 開始時：通常の全試験 1523成功・38スキップ・失敗0（計1561）。
- 開始時：私有世界指定の全試験 1561成功・失敗0。
- 開始時：npm run check 成功。npm run smoke は listen EPERM。
- 終了時：通常 1530成功・38スキップ・失敗0（計1568、358.5秒）。
- 終了時：私有世界指定 1568成功・失敗0（357.6秒）。
- 終了時：check 成功（111モジュール・547構文検査）。smoke は再び listen EPERM。
- `NODE_OPTIONS=--max-old-space-size=1536 timeout 600 npm test`
- `KZ_WORLD_DIR=<指定の読み取り専用データ> NODE_OPTIONS=--max-old-space-size=1536 timeout 600 npm test`
- `npm run check` / `npm run smoke`
- 追加試験：7件成功。各技180コマ（3秒）、納刀完了まで追加360コマ。
- 600コマ×既定／smooth=0：各1800個の位置成分が完全一致。moves=0 の update 呼び出し0。
- 固定種の操作2000コマ：未定義呼び出し0、4種の斬り、音要求72回。
- 合成動作での軌跡：ピーク56三角形、メッシュ1。描画命令は実機未測定。
- GPU資源は geometry / material 各1回解放。debug とキーの購読、差し替えを復元。
- 試験は合成世界・同梱の人物の骨と皮・合成の動作を使用。画像の復号だけ省略。
- 試験環境作成中に骨メッシュ・地形境界・地表の必須成分不足を直した。製品側の例外は隠していない。

## 親側の実機確認

1. `/valley/index.html?world=kamakura&debug=1`。同じ画角の moves=0 版も撮影する。
2. 最初のクリックは視点固定だけ。続くクリック3回で抜刀・三連斬り・白青の短い帯を録画。
3. F で強斬り（飛行へ移らない）、Space で回避、右クリックで受け。刀は無操作数秒で納まる。
4. C はゆっくり歩きのみ。E・Tab・Q は無反応。通常歩行・Shift の走り・脚IK・布が保たれる。
5. 技の途中で休止→再開、飛行ボタン→F、飛行→Gで着地。技・刀・帯が残らない。
6. 家・幹・海・急斜面へ回避し、抜けないこと。コンソールエラー0を確認。
7. `__kzMoves()` で state / drawn / calls。無命中なので hitStop / rig.kick は0が期待値。
8. 標準／q=light、段階2・3、動きを減らす設定でも操作と軌跡を確認。描画命令増分は帯が見える間1の想定。
9. 同じ場所・固定画角で新旧を比較し、技以外の明るさ・色・主人公の位置を変えていないことを確認。

## 未確認と次の一歩

サーバーは listen EPERM。ブラウザ・録画・音の聴感・実FPSは未確認で、成功と扱わない。
git add / commit は index.lock の作成が Operation not permitted となり実行不可。変更は未コミットで親へ引き継ぐ。
新しい既知の製品不具合はNode試験で検出していない。Fの歩行時の用途だけ既存から変更した。
次は親が上の手順を実 Chrome で実行し、操作録画・固定画角比較・音・性能を検収する。
