# Design: 純粋ロジックの契約（Nodeで単体検査する層）

対象は `dist/valley/` の `combat.js` `enemy-ai.js` `companion-ai.js` `nav.js` `quest.js` `save.js`（と `terrain-height.js`）。第2弾で `guide.js` と `audio-rules.js` を足す（実装時に `tools/check-valley.mjs` の純粋層の一覧へ入れる）。
全モジュール共通：ES Modules・Three.js/DOM/Math.random/Date.now を使わない・状態はJSON化できる素の
オブジェクト・乱数は `rng()`（0以上1未満を返す関数）を引数で受ける・時刻は引数で受ける・NaNを出さない。
座標は design.md の約束（Y上、X東、Z南、yaw前方 `(-sin,0,-cos)`）。テストは `tests/valley-*.test.mjs`（`node --test`）。
**各モジュールに、重要な規則を一つ壊すと落ちるテストを置く**（実装を変異させて確かめる）。

## combat.js

- `MOVES`: design-gameplay.md の表どおりの凍結データ。`{id, kind, windup, active, recover, damage, posture, reach, arcDeg, lunge, blockable, telegraph, chainFrom?, chainWindow?, clip}`。
  id は `light1 light2 light3 heavy finisher counter soldier_slash soldier_thrust officer_a officer_b officer_c archer_shot ally_shot`。
  `counter` は弾き（parried）の直後0.9秒だけ、弾いた側が出せる反撃（予備.12・当たり.10・戻り.42・威力26・構え削り32）。窓は一度の反撃で消える。
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

## guide.js（第2弾・R16。純粋層実装済・view未結線）

- 基準路は目的・選んだ道・開始地点で一度固定する。現在位置から引き直さない。
  `world.roads` の折れ点を必須点として順に接続する。navの最短路は点間の通行検証に使う。
  b2はtemple→forestの見晴らしまで、b3正面はforest→lane、北/南迂回はnorth/southを経る。
  b6はforest→templeの逆順。里内と庭の短い接続だけnavで補う。
- 道区間内の探索は道路半幅＋主人公半径0.3mの帯へ制限する。点を飛ばす平滑化は禁止。
  通れない必須点は無条件に寄せず、同じ帯の通行可能点へ補正し、補正量を検査ログへ出す。
  帯内で到達不能なら経路なしを返し、別の道を黙って選ばない。
- 復帰用経路だけを0.5秒ごとに現在地から未通過区間の最寄り点へ引く。
  復帰後は基準路を続ける。復帰路を道外れと進捗の判定には使わない。
- `assess` の観測は `{t, pos, mode, objectiveId, plan, baselineId}`。
  modeはfree/combat/dialogue/paused/result。tはヒットストップ前の活動時間を呼出側から渡す。
- 道外れは基準路へのXZ最短距離≥25m。残距離は順序を守る投影点から終点までの長さ。
  九十九折の交差では前回区間か隣接区間へ投影し、遠い区間へ飛ばさない。
- freeの標本だけ30秒貯め、窓の始終の残距離の差<10mで立ち往生。30秒未満は判定しない。
  combat/dialogue/pausedへ入ると履歴を消し、時計を止める。復帰後は新たに30秒貯める。
  目的・道の変更、再開地点の変更、resultでも履歴・強調状態を消す。目的なしはnull。
- 強調は道外れ<20mかつ直近30秒で10m以上進んだら解除。解除まで履歴は続ける。
  20mは25mから5mの余裕を引いた未測定の設計値。境界での点滅を避ける。

## audio-rules.js（第2弾・R15。7.5実装済み、合成への結線は7.6・7.7）

- 凍結データ `STEP_TABLE` に7面（dirt/grass/gravel/leaves/wood/stone/water）の衝撃 `[gain, Hz, decayMs]`、粒 `[count, [lowHz, highHz], decayMs, spreadMs, jitter]`、5役割のcloth/equipment/weight、5歩容のnoise/density、左右のpitch差を集める。`SURFACES/GAITS/ROLES/FEET` は選択キーの配列。数値は試聴前の初期値。
- `pickStep({surface, gait, role, foot}, rng, last?)` → `{recipe, pitch, gain, seed}`。recipeは面・歩容・役割・足とmaterial/equipment/density。pitchは基準1の±6%（左右±1%＋乱数±5%）、gainは共通表の基準±2dB。seedは左右で偶奇を分け、直前と同じなら2増やす（32bit周回）。固定rngでも同じ組み合わせを続けない。
- `noiseRadius(kind)` / `noiseGain(kind)` → m / 線形gain。`config.js` の凍結 `AUDIO_NOISE` が正本。run=11/.8、walk=5/.45、crouch=1.5/.18、clash=18/1、hit=12/.85、stealth=3/.3。既存actors/battleの発見距離だけを同値で置換。configの画面側関数は呼ばない。
- `VARIANTS` は blade/hit/block/parry/hurt/fall/bow/arrow 各3。`pickVariant(kind, rng, last?)` → 0起点の番号、直前と同じなら次へ送る。`HIT_MATERIAL` はarmor/flesh/wood/rockのresonanceHz/decayMs。合成の層は後続タスク。
- `distanceRule(distance)` → `{audible, gain, lowpassHz}`。0以上のm、22m以上は不可聴・gain=0。内側は `(1-distance/22)^2`、高域は20kHzから1.2kHzへ線形減衰（22mで止まる）。
- `panOf(source:{x,z}, listener:{x,z,yaw})` → -1〜1。yaw前方は `(-sin,-cos)`、右が正、同座標は0。
- `BUSES` はambient=.7/steps=.8/combat=.9/ui=.65。`KIND_LEVELS` は種類→`[bus, baseGain]`。戦闘のbaseGainは共通AUDIO_NOISE表を参照（刃・受け・弾き=clash、命中・被弾・倒れ・矢=hit、弓=walk）。足の基準はpickStepが出すgainを掛ける。
- `duckAmbient({combat=false, dialogue=false}={})` → 通常1/戦闘.55/会話.35（重複時は.35）。`mixGain(kind, {effects=1, ambient=1, combat=false, dialogue=false}={})` → 種類基準×バス倍率×設定倍率、環境のみduckを掛ける。設定は0〜1。`PEAK_LIMIT=.98` はリミッター後の全標本の検査上限。実音の保証は7.7で測る。
- 未知の列挙値・不正rng（関数以外、0以上1未満以外）・非有限の数値はTypeError。距離負値と設定範囲外も拒否する。乱数は引数のみ。

## voice-bank.js（第2弾・R15。7.5実装済み）

- `VOICE_LIMIT=28`、`PRIORITY={otherStep:0,heroStep:1,otherCombat:2,heroCombat:3,ui:4}`、`AMBIENT_KINDS=[canopy,wind,river,insects,crow,fire,village]` は凍結データ。
- `createVoiceBank({limit=28, waitLimit=28, fadeMs=10}={})` → JSON化できる状態。状態機械はその状態だけを変更し、入力オプションや外部オブジェクトを保持しない。limitは1〜28、waitLimitは0〜28、fadeMsは正の有限値。
- `request(bank,{id,priority,kind,now,ambient=false,children=1})` → `{accepted,action:'start'|'steal'|'wait'|'reject',startAt?,victim?,events}`。now/startAt/eventsのat/endは**ミリ秒**、nowは単調非減少。idは全枠で一意な文字列。priorityは0〜4の整数。非有限時刻・不正優先度等は変更前にTypeError。
- eventsはadapter向けの`{action:'start'|'stop',id,at}`／`{action:'fade',id,at,end}`。受理したstartAtを実音へ予約する。満杯時は同順以下の最古（実際の開始時刻、同時なら要求順）を10msで絞り終了後に開始。フェード中もactiveに数える。予約済みの枠を再利用しない。
- フェード対象をすべて予約済みなら、同順以下の未置換の待機束へ予約を連鎖し、その開始からfadeMs後に次を開始（action=wait）。対象なし・待機満杯は拒否。成功は実際に確定した予約の数で、キャンセル後も累積数から引かない。
- `tick(bank,now)` → 期日までのstop/start/fadeを時刻順で返す。同時刻はstop後start。呼出側は返された時刻を音の時計へ対応させる。環境は種類ごと1束、28枠から除外する。
- `endChild(bank,id)` / `endTail(bank,id)` → 両条件完了時に解放しtrue（それ以外false）。最後の子の終了と響きの末尾を別々に通知する。`release(bank,id)` → booleanはadapterが両方完了を保証する場合、または明示停止・予約取消用。後続予約の開始時刻を早めない。
- `clear(bank)` → 全active/pending/ambientのid配列、登録を全消去。停止・ミュート・破棄で必ず使い、adapterもそのidの予約と音源を止める。壁時計タイマーは持たない。
- `stats(bank)` → `{requested,started,rejected,stolen,active,pending,ambient}`。startedは確定した予約成功数、stolenは置換予約数（待機連鎖を含む）。requested=started+rejected。active≤28、pending≤28、ambient≤7。
- 検証：追加単体20件、逐次変異12/12検出・全復元。全体の実行結果はtasks.mdの7.5メモ。

## 風（第2弾・植生と案内の共有契約。未実装）

- 時刻・強さ・基底向き・導き向き・導きの混合率を一つの風状態で共有する。
  向きは世界XZの単位ベクトル。純粋なguideは数値だけ返し、viewがuniformへ渡す。
- 通常風を基底に保ち、Gで1秒かけて次の道区間へ混合し、開始4秒から1秒で基底へ戻す。
  1秒は既存案の遷移時間を往復へ適用（全体5秒に含む）。連打は終了後2秒待つ。休止中は進めない。
- 草・樹冠・導きの粒は同じ値を読む。動きを減らす設定は振幅と粒数だけ下げる。

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

## foot-contacts.js（第2弾・R15。7.6の接地通知）

- `createContactTracker()` → `{actors: []}`。`observeContacts(state, obs, table)` → `{state, contacts}`。返されたstateを次回へ渡す。入力state・obs・tableを変更せず、時計・乱数・画面・音源を読まない。複数actorの観測を交互に渡せる。
- `table = {[clip]: {duration, loop: true, contacts: [{foot, t}]}}`。秒、durationは正の有限値、tは `[0,duration)` の昇順、footはleft/right。同じ足が1周に複数回着いてよい（村人の歩きは4.2秒に左右3回ずつ）。通知の識別は、表の中の接地の番号 `index` で行う。空の接地列は許す。実データは `anim-contacts.js`（`tools/build-foot-contacts.mjs` が、`clips.json` の contacts を、実際の骨の動きから測った境界で挟んで作る）に置き、このモジュールは持たない。
- `obs = {actor, sources: [{clip,time,weight,speed,target}], moving, airborne, near, reset}`。actorは空でない文字列、4フラグとtargetはboolean。sourcesには表にある移動クリップのみを重複なしで渡す。timeは `[0,duration]` 秒、weightは非負の実効値、speedは符号付き実効再生倍率。未知clip・非有限値・範囲外・不正な表は変更前にTypeError（画面外でも検査）。
- 正のweightの最大だけを選ぶ。同率ならtargetを優先し、それでも同率なら入力順。全て0またはsourceなしなら選択なし。発音元が変わる観測は起点だけを作り、過去を鳴らさない。発音元以外の時刻も追い、混合を往復しても通知済みの周・足を再通知しない。
- 正転でtimeが前回より戻れば1周を加え、単調時刻の `(前回, 今回]` にある接地を時刻順に全列挙する。初回観測は起点のみ。durationちょうどは次周の0と同じ接地時刻で、続く0で二重にしない。観測間に丸1周以上進むとtimeだけでは復元不能なので、結線側は60Hzを保ち、休止や飛びではresetを渡す。
- `contacts = [{actor,clip,loop,index,foot,contactTime,ago}]`。`index` は表の `contacts` の添字。loopは最初の観測を0として観測した周回数、contactTimeは `loop*duration+t` 秒。agoは `(今回の単調再生時刻-contactTime)/今回のspeed` の実秒。観測間の速度変化を積分した値ではなく、今回の実効速度による換算値。速度が変わる際は変更後の更新区間で観測する。
- moving=false・airborne=true・speed<=0では通知しないが時刻は更新し、再開で遡らない。逆再生の時刻減少は周回に数えない。resetは全clipの前回時刻と選択を捨てて今回を起点にする。near=falseでは観測せず前回時刻と選択を消し、次のnear=trueで起点を作る。sourceから消えたclipも前回時刻を消す。
- **通知済みの識別子は起点を消しても保持する**。各actor/clip/接地番号（index）の通知済み最大loopだけを保存し、同じ識別子 `(actor, clip, loop, index)` は一度だけ。reset・画面外の間の実周回数は復元せず、次に観測した戻りから周回を続ける。同じ周を巻き戻して再生した足は再通知しない。別個体にactor識別子を再利用せず、追跡を全廃するときだけ新規trackerを作る。
- **巻き戻しの印**：sourceの任意の `restart`（boolean）。trueのclipだけ、前回時刻を捨てて周回を1つ進める（`play()` が0秒から再生し直した別の走り出し）。識別子が新しくなり、同じ周番号の通知済みに隠されない。印のないreset・時刻の乱れは従来どおり台帳で再通知しない。実ブラウザで、走りを1周に満たず繰り返すと2回目以降の最初の接地が鳴らなかったため追加（2026-10-27）。
- 結線手順：動作選択と速度・ヒットストップを反映 → mixerを進める → 全移動Actionのtime・getEffectiveWeight()・getEffectiveTimeScale()を採取 → observeContacts → 通知を音へ渡す。現在のcharactersは `mixer.update(dt * this.rate)` なので、speedにはActionの実効倍率にthis.rate（およびMixer側の倍率を使うならそれも）を掛け、実時間との倍率にする。targetは現在の移行先Action。Actionのtime書換えは、そのclipだけrestartで、休止復帰・テレポートは全clipのresetで伝える。22m内は描画15Hzの間引きから分けて観測する。
- Nodeの接地テストと逐次変異検査で確認。実データは測定済み（`tools/scenarios/measure-foot-contacts.mjs`・`reports/audio/foot-contacts-measured.json`）。characters/actors/audio-valleyとの結線と合成は後述の7.6節。出力遅延・動画・聴感の同期確認は未実施。

## step-surface.js / step-synth.js（7.6、純粋層）

- `classifySurface(weights,{water=0,wood=false,stone=false}={})` → SURFACESの1種。weightsはgrass/dirt/rock/gravel/mud/litterの有限な0〜1。waterは非負の水深、wood/stoneはboolean。不正入力はTypeError。優先・境界値はdesign-audio.mdの7.6節。
- `stepSurfaceAt(x,z,{terrain,world})` → surface。有限座標、terrain.surfaceAt/waterAtとworld.buildings[].{x,z,rotY,footprint:{w,d}}、world.zones.temple_steps.{x,z,r}を読む薄いadapter。建物は逆Y回転・各辺に1mのmargin、円区域は境界を含む。Three.jsは使わない。
- `roleOf(who)` → hero/ally/enemy_light/enemy_heavy/villager。7体の対応はhero/archer/soldier/officer/villager_m/villager_f/child。未知はTypeError。
- `gaitOfClip(clip)` → CMU_Run/CMU_Jogはrun、Cautious_Crouch_Walk_Forwardはcrouch、他の非空文字列はwalk。不正型・空文字列はTypeError。
- `stepLayers({recipe,pitch,gain,seed})` → `{type,startMs,durationMs,gain,freq,q,filter}[]`。入力はpickStepの返り値。全層にgain/pitchを適用し、densityで粒数をroundする。seedはuint32、乱数は既存mulberry32。filterはbandpass/lowpass/highpass/null。recipeや範囲の不正はTypeError、入力を変更しない。
- 規則の検査対象へ両ファイルを追加。音声ノードと時計はaudio-valley/qaだけが扱う。

## 7.6 のview/app側の接続

- `Character.resetContacts()`は次回観測のresetを立てる。`play(name,options)`はrestartまたはfrom指定を同じActionでも反映し、巻き戻したActionの名前だけ`contactRestart`に積む（他のActionの起点は捨てない。出ていく動作の接地は切り替えのコマでも続ける）。`update(dt)`はmixer更新後にFOOT_CONTACTS内の正weightの全ActionをobserveContactsへ渡し（積んだ名前はrestart）、resetとrestartを消費、`onContact({actor,clip,loop,index,foot,contactTime,ago})`へ通知。actorは各Character生成時の一意文字列で、再生成した個体に同じ追跡IDを使わない。
- `Actor.tickCharacter(dt)`でnear/airborne/contactTimeScaleを設定する。全てのHero/Enemy/Ally/NpcのCharacter更新を集約。`Actor.onFootContact(c)`で面・役割・歩容を選び、lastStepによる連続回避、他者の距離減衰・定位、主人公の発見ノイズとdustを行う。古い距離積算とstep_*発音は除去。
- gameのヒットストップはdtを縮め、Character.rateは個体の動作速度。contactTimeScale=dt/rawDtを追加で掛け、agoを実時間へ換算する。更新間隔が50msを超す場合と休止中は全個体の起点をresetする。
- `ValleyAudio.playStep(step,options)` → boolean。optionsはpan/lowpassHz/gainScale。1束を1枠としsources上限28でfalse、stepRejectReason='limit'。休止・ミュート・context未準備・生成失敗でもfalseだが上限拒否には数えない。release/stopは束の全子を処理し、通常終了は最長層+40msの音声時刻のonendedで解放する。
- QAのみgame.footQAを作る。`__valley.footLog(on)`と`stepStats()`の記録契約はdesign-audio.md。Nodeのノード代役による結線検査は実ブラウザ・音の検査の代用にしない。
