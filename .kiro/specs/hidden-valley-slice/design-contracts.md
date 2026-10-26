# Design: 純粋ロジックの契約（Nodeで単体検査する層）

対象は `dist/valley/` の `combat.js` `enemy-ai.js` `companion-ai.js` `nav.js` `quest.js` `save.js`（と `terrain-height.js`）。
全モジュール共通：ES Modules・Three.js/DOM/Math.random/Date.now を使わない・状態はJSON化できる素の
オブジェクト・乱数は `rng()`（0以上1未満を返す関数）を引数で受ける・時刻は引数で受ける・NaNを出さない。
座標は design.md の約束（Y上、X東、Z南、yaw前方 `(-sin,0,-cos)`）。テストは `tests/valley-*.test.mjs`（`node --test`）。
**各モジュールに、重要な規則を一つ壊すと落ちるテストを置く**（実装を変異させて確かめる）。

## combat.js

- `MOVES`: design-gameplay.md の表どおりの凍結データ。`{id, kind, windup, active, recover, damage, posture, reach, arcDeg, lunge, blockable, telegraph, chainFrom?, chainWindow?, clip}`。
  id は `light1 light2 light3 heavy finisher soldier_slash soldier_thrust officer_a officer_b officer_c archer_shot ally_shot`。
- `createFighter({id, team:'hero'|'ally'|'enemy', kind, x, z, yaw, hp, posture})` → Fighter（素のオブジェクト）。
- `startMove(f, moveId)` → boolean。状態が許す・連携窓内のときだけ true。`setBlock(f, on)`、`startDodge(f, yaw)`。
- `tick(f, dt)` → events。`{type:'phase', id, moveId, phase:'windup'|'active'|'recover'|'end'}` `{type:'stagger_start'|'stagger_end', id}`。構えの回復と崩れの時間もここ。
- `strike(att, def)` → null | `{outcome:'hit'|'blocked'|'parried'|'evaded'|'miss', damage, postureDamage, staggered, dead, moveId}`。
  攻撃側が当たり区間にあり、同じ技の同じ相手に未命中で、間合いと角度の内にあるときだけ結果を返す。同じ技で二度当たらない。
- `canFinish(att, def)` / `finish(att, def)`（崩れた相手・1.6m・前方）、`stealthStrike(att, def)`（背後90°・相手が未発見）、
  `applyDamage(f, hp, posture)`（矢など技を持たないもの）。死んだ者は何も受けない。

## enemy-ai.js

- `createBrain(kind:'soldier'|'archer'|'officer', {id, home, patrol?, seed})` → Brain（JSON化可）。
- `think(brain, view, dt)` → `{intent, events}`。`view = {t, self, hero, allies, noises, world, tokens}`。
  `self/hero/allies` は Fighter のスナップショット＋`ready`（技を始められる）。`world = {los(a,b), pathTo(a,b), walkable(x,z)}`。
  `tokens = {tryAcquire(id), release(id)}`（近接の同時攻撃を2人までにする共有の札）。
- `intent = {move:{x,z}|null, speed:'walk'|'run'|'stop', face:yaw|null, startMove:id|null, block, dodge, say?}`。
- `events`: `alerted` `suspicious` `shout{radius}` `routed` `surrendered`。警戒の伝播は呼び出し側が12m以内の味方へ渡す（brainは `hear(brain, noise)` を受ける）。
- 規則：気づきメーター（距離・視野110°・20m・屈むと10m・遮蔽・音）、状態遷移（巡回→疑い→確認→戦闘→離脱）、
  輪での回り込み（2.5〜4m）、弓兵は6〜24mを保ち射線が通るときだけ予兆つきで射る、侍大将は半分で号令・25%で退く、士気（design-gameplay.md）。

## companion-ai.js

- `createCompanion({id, mode:'follow'|'hold'|'cover'|'retreat', holdPoint?})`、`setMode(c, mode, point?)`、
  `thinkCompanion(c, view, dt)` → `{intent, events}`。intent は enemy-ai と同形＋`shoot:{targetId}|null`。
- 規則：負傷で速さ0.8倍・走らない／主人公の前と狭い道を塞がない（後ろ左2.5〜4m）／経路失敗は再探索して瞬間移動しない／
  援護は射線が通り24m以内、2.4秒に1射／体力0で倒れ、8秒・近くに敵がなければ30%で起きる／死なない。

## nav.js

- `buildNavGrid({minX, minZ, maxX, maxZ, cell:2, walkable(x,z)})`、`findPath(grid, from, to)` → `V2[]|null`（8方向・角を切らない・直線で滑らかに）、
  `losClear(walkableFn, a, b, step)`、`nearestWalkable(grid, p)`。経路は始点から始まり終点で終わる。到達不能は null。

## quest.js

- `createQuest(story)` → state。`reduce(state, event)` → `{state, effects}`（state は新しいオブジェクト）。
- `event`: `enter_zone{zone}` `interact{id}` `dialogue_end{id}` `enemy_down{id, how:'killed'|'routed'|'surrendered'}` `party_joined{id}`
  `pillage_tick{dt, pillagers}` `choose_plan{plan}` `player_down` `retry` `arrived{place}`。
- `effects`: `objective{text, marker?}` `dialogue{id}` `spawn{group}` `despawn{group}` `checkpoint{id}` `toast{text}` `resources{delta}` `ending{summary}`。
- 規則：beat の順序（design-gameplay.md）／正面と迂回の判定は最初に入った入口で決まる／倉の食糧は略奪の時間で減り下限0／
  どの経路でも弥十郎の救出と帰還へ到達する／`retry` は直近の区間の初めへ戻し、資源をその時点へ戻す／結果は選択と数値から文を作る。

## save.js

- `loadValley(storage)` → `{state, hasSave, notice}`、`saveValley(storage, state)` → `{ok, notice}`、`sanitize(raw)`、`migrate(raw)`。
- 版つき（`kamakura-valley-progress`・版1）・型と範囲の検証・未知の将来版と破損は初期状態へ戻し理由を返す・
  保存不可でも例外を出さない・`Infinity`/`NaN`/巨大な値を弾く・敵の生死が復元で重複・復活しない。
  `storage` は `getItem/setItem/removeItem` を持つ任意のオブジェクト（テストは偽物を渡す）。

## terrain-height.js（Three.js非依存。純関数）

`createTerrain(world)` → `{heightAt, slopeAt, normalAt, waterAt, surfaceAt, walkable, bounds}`。`world` は `world-data.js`。
地形の高さ・傾斜・通行・道の連続（廃寺から里まで歩ける）・建物と木の足跡が通行可能な点に重ならないことをNodeで検査する。
