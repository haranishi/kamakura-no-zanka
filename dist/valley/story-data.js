// story-data.js — 隠れ谷の縦切りの物語データ（data層）。任務の順序・台詞・結果文・資源の初期値。
// 物語の根拠は docs/10_STORY_AND_DESIGN_JA.md。台詞は一画面40字以内。旧臣の負い目と、村の「武士はもう要らない」の距離から始まり、
// 守られた結果で変わる。quest.js が id と結果文の表を読む。語句 '冬を越せる' '蓄えは半分' '次は匿えない' は検査が見る（変えない）。
const beats = [
  ['b0_temple', '庭へ降りる——縁側の前へ'], ['b1_boy', '穂太の話を聞く——駆け上がる子のそばへ'],
  ['b2_road', '見晴らし岩へ——石段を下り、林道を南東へ'], ['b3_viewpoint', '里へ——正面は南の林道、北は斜面道、南は畦道'],
  ['b4_village', '里を守る——倉と家のあいだへ'], ['b5_archer', '縛られた弥十郎を解く——縄のそばへ'],
  ['b6_escort', '廃寺へ戻る——林道を北西へ、石段の上まで'], ['b7_result', '帰還の報せを聞く'], ['done', '谷の灯を守った'],
];
// R16.6 / design-wayfinding.md。view未結線。結果中は移動目的なし。
const guideTargets = { b0_temple: 'temple_yard', b1_boy: 'boy', b2_road: 'viewpoint',
  b3_viewpoint: { front: 'village_front', north: 'village_north', south: 'village_south' },
  b4_village: 'village_center', b5_archer: 'captive', b6_escort: 'temple_steps', b7_result: null, done: null };
const hero = '榊三郎景継', boy = '穂太', old = '久作', tsubaki = 'つばき', yajuro = '梓弥十郎', narrator = '語り';
// 物語の本体（design-narrative.md §3〜§7）。行の when は banter.js の matches で読む（場面・道・食糧・信頼・断片の数）。
// pause は無言の間（秒。E でも進む）、look は見つめる相手、fragment／clue はその行が出す断片・手がかりの id。
export const SPEAKERS = [hero, boy, old, tsubaki, yajuro, narrator, '侍大将', '追手'];
export const STORY = {
  beats: Object.fromEntries(beats.map(([id, objective]) => [id, { id, objective, guideTarget: guideTargets[id] }])),
  dialogues: {
    boy_arrives: [
      { speaker: boy, text: 'お侍さま……っ。里に、兵が来た。' },
      { speaker: hero, text: '……', pause: 0.8, look: 'boy' },                       // 子の顔を見つめる間（b1。子への伏線）
      { speaker: boy, text: '倉の米を荷車に積んでる。みんな家に隠れてる。' },
      { speaker: hero, text: '数は。' },
      { speaker: boy, text: '十人はいない。偉そうなのが、一人。' },
      { speaker: hero, text: '分かった。ここで待て。' },
    ],
    viewpoint_overlook: [
      { speaker: hero, text: '荷車は倉の前。兵は五人。弓が一人、混じっている。' },
      { speaker: hero, text: '西の口から入れば早い。だが戦が長引けば、倉が荒らされる。' },
      { speaker: hero, text: '北の斜面か南の畦を回れば背後に出られる。時はかかるが、見つかりにくい。' },
    ],
    // 里の戦いのあと。久作の第一声は、選んだ道と残った食糧で変わる（§5.1。脇道で50未満は結果文の flankLoud と同じ境目）
    village_cleared: [
      { speaker: old, text: 'あんたの戦で、畑が踏まれた。……それでも、倉は残った。', group: 'kyusaku_first', when: { approach: 'front', food: [35, null] } },
      { speaker: old, text: '畑も倉も、ひどく荒れたな。……皆、生きてはいる。', group: 'kyusaku_first', when: { approach: 'front', food: [null, 35] } },
      { speaker: old, text: 'いつの間に片づけたのか。足音も聞こえなんだ。', group: 'kyusaku_first', when: { approach: 'flank', food: [50, null] } },
      { speaker: old, text: '静かに、とはいかなんだか。倉が荒れた。', group: 'kyusaku_first', when: { approach: 'flank', food: [null, 50] } },
      { speaker: old, text: '逃げてきた武士は、あんたで三人目だ。皆、同じ顔をする。', fragment: 'F3' },
      { speaker: tsubaki, text: '倉の裏に、縛られた人がいます。あの兵たちに追われていた方です。' },
      { speaker: hero, text: '……そこにいるのか。' },
    ],
    archer_joins: [
      { speaker: yajuro, text: '……景継殿か。生きておられた。' },
      { speaker: hero, text: '弥十郎。お前こそ。' },
      { speaker: yajuro, text: '皆が散るとき、私は先に逃げた。この腕の傷は、その報いだ。' },
      { speaker: hero, text: '……私もだ。', fragment: 'F4' },
      { speaker: hero, text: '悔いるなら、生きて償え。お前の弓が要る。' },
      { speaker: yajuro, text: '……承知。この弓で、帰り道を守ろう。' },
    ],
    ambush_cleared: [
      { speaker: yajuro, text: 'これで追手は退いた。寺はすぐそこだ。' },
      { speaker: hero, text: '歩けるか。' },
      { speaker: yajuro, text: 'ご心配なく。この脚は、まだ動く。' },
      { speaker: yajuro, text: '……あの夜、門に貴殿の姿がなかった。', fragment: 'F5' },
      { speaker: hero, text: '……', pause: 1.5 },                                    // 景継は答えない
    ],
    // 結末は三つの会話に分ける（1回あたり約5行。R24.2）。result → ending_truth → ending_coda の順に game.js がつなぐ
    result: [
      { speaker: tsubaki, text: '里の者から、米を預かってきました。' },
      { speaker: yajuro, text: 'あの兵たちも、腹を空かせていた。', clue: 'C4' },
      { speaker: old, text: '武士など要らんと思うておったが……あんた方は、違ったな。' },
      { speaker: tsubaki, text: '次に兵が来たら、私も手を貸します。' },
      { speaker: yajuro, text: '焚き火のそばは、久しぶりだ。' },
    ],
    // 真相の3行は、断片が0でも必ず出る（R20.3）。拾った数が3以上なら一言深くなる
    ending_truth: [
      { speaker: hero, text: 'あの夜、門を離れたのは、泣いている子がいたからだ。' },
      { speaker: yajuro, text: '……その子は。' },
      { speaker: hero, text: '山へ逃がした。名も知らぬ。' },
      { speaker: yajuro, text: 'ならば、離れてよい理由だ。', when: { fragments: [3, null] } },
      { speaker: hero, text: '……そう言うのは、お前だけだ。', when: { fragments: [3, null] } },
    ],
    ending_coda: [
      { speaker: hero, text: 'もう、いい。', when: { fragments: [5, null] }, fx: 'sode_burn' },   // 袖印を焚き火にくべる（案。音なし・炎が少し上がるだけ）
      { speaker: hero, text: '……', pause: 1.5, look: 'boy', when: { fragments: [5, null] } },
      { speaker: hero, text: 'ここが、帰る場所になる。' },
      { speaker: yajuro, text: '橋の向こうに、追手の本隊がいるはずだ。' },
      { speaker: hero, text: '……明日、考える。' },
      { speaker: narrator, text: '燃え残った火は、谷で、人の灯になった。', narration: true },
    ],
    // 調べる（E）で出す一行。断片 F1・F2 と手がかり C1
    relic_sode: [{ speaker: hero, text: '……あの門を。', fragment: 'F1' }],
    relic_far_look: [{ speaker: hero, text: 'あの夜、持ち場にいなかった。それだけは、確かだ。', fragment: 'F2' }],
    clue_scout_note: [{ speaker: hero, text: '兵糧の書き付け。腹を空かせた兵か。', clue: 'C1' }],
  },
  // 敵の掛け声（字幕）。音に頼らず状況が分かるように、画面にも出す。raid は里の兵が気づいたときに alert と混ぜる（C2）
  barks: {
    alert: ['何奴だ！', '敵だ、かかれ！', 'こっちにいるぞ！'],
    raid: ['米を出せ。腹が減った。'],
    retreat: ['退け、退け！', '引き上げだ、逃げろ！'],
    surrender: ['待て、降る……！', 'すまぬ……帰る所がない。'],
    rally: ['怯むな、囲め！'],
    archer: ['射よ！'],
  },
  // 過去の謎「門を離れた夜」の断片（R20）。dialogue の行に同じ id の fragment がある。その会話が出た時点で拾ったことになる（quest.js）
  fragments: [
    { id: 'F1', order: 1, kind: 'object', place: 'temple', dialogue: 'relic_sode', note: '焼け焦げた袖印' },
    { id: 'F2', order: 2, kind: 'view', place: 'viewpoint', dialogue: 'relic_far_look', note: '見晴らし岩から遠くを見る' },
    { id: 'F3', order: 3, kind: 'voice', place: 'village', dialogue: 'village_cleared', note: '久作の二行目' },
    { id: 'F4', order: 4, kind: 'voice', place: 'granary_back', dialogue: 'archer_joins', note: '景継「……私もだ。」' },
    { id: 'F5', order: 5, kind: 'voice', place: 'road_back', dialogue: 'ambush_cleared', note: '弥十郎「門に貴殿の姿がなかった」' },
  ],
  // 調べられる物・場所（E）。at は世界の座標(m)、r は案内が出る距離。drop は、その敵が倒れた所に落ちる物。beats の外では出ない
  // 袖印は焚き火の石の縁（庭は背の高い薄に覆われ、地面の物は見えない。火のまわりだけ草がない）。5つ拾った結末で、同じ火にくべる
  relics: [
    { id: 'sode', fragment: 'F1', at: { x: -89.3, z: -81.0 }, r: 2.4, beats: ['b0_temple', 'b1_boy', 'b2_road'], prompt: '袖印を調べる', dialogue: 'relic_sode', look: 'down' },
    { id: 'far_look', fragment: 'F2', at: { x: -46.4, z: -31.0 }, r: 3.6, beats: ['b3_viewpoint'], prompt: '遠くを見る', dialogue: 'relic_far_look', look: 'far', view: { x: 150, z: 128, h: 26 } },   // view：谷の向こうの山並み（南東。鎌倉の方角）
    { id: 'scout_note', clue: 'C1', drop: 'road_scout', r: 1.8, beats: ['b2_road'], prompt: '書き付けを拾う', dialogue: 'clue_scout_note', look: 'down' },
  ],
  // 敵の事情の手がかり（R21.3）。C3 と C4 は出来事で必ず出す。C1 は拾えば、C2 は掛け声の運次第
  clues: [
    { id: 'C1', kind: 'item', relic: 'scout_note', note: '物見の落とし物' },
    { id: 'C2', kind: 'bark', barks: ['raid', 'surrender'], note: '里の兵の掛け声と、投降の一言' },
    { id: 'C3', kind: 'officer', speaker: '侍大将', text: '新しき世の命だ。蔵を空けよ。恨むなら、恨め。', note: '侍大将が最初に戦いに入ったとき（字幕）' },
    { id: 'C4', kind: 'dialogue', dialogue: 'result', note: '結果の会話の一行' },
  ],
  // 掛け合いの場所の目安（円。world-data の座標）。banter の when.areas が読む
  areas: {
    temple: { x: -94, z: -83, r: 20 },
    upper_road: { x: -62, z: -60, r: 10 },
    village: { x: -4, z: 4, r: 42 },
    captive: { x: -10, z: 6, r: 10 },
  },
  // 掛け合い・独り言（R21.1）。条件がそろい、戦闘・会話・案内・掛け声の表示がないときに字幕で一度だけ出す（banter.js）。
  // b0〜b5 は主人公ひとり（独り言と里の人）、b6 から弥十郎との掛け合い。group は同じ場面の言い換えで、どれか一つだけ出る。
  banter: [
    { id: 'b0_alive', when: { beats: ['b0_temple'], minBeatT: 1 }, lines: [{ speaker: hero, text: '……生きている。まだ。' }] },
    { id: 'b0_sword', when: { beats: ['b0_temple'], minBeatT: 1 }, lines: [{ speaker: hero, text: '刀は、まだ腰にある。' }] },
    { id: 'b2_soldiers', when: { beats: ['b2_road'], areas: ['upper_road'] }, lines: [{ speaker: hero, text: '穂太の言った兵は、この先か。' }] },
    { id: 'b2_scout_killed', group: 'b2_scout', when: { beats: ['b2_road', 'b3_viewpoint'], after: 'scout_killed' }, lines: [{ speaker: hero, text: '物見か。……本隊は、里だな。' }] },
    { id: 'b2_scout_stealth', group: 'b2_scout', when: { beats: ['b2_road', 'b3_viewpoint'], after: 'scout_stealth' }, lines: [{ speaker: hero, text: '……腕は、鈍っていない。' }] },
    { id: 'b2_scout_spared', group: 'b2_scout', when: { beats: ['b2_road', 'b3_viewpoint'], after: 'scout_surrendered' }, lines: [{ speaker: hero, text: '行け。……二度と来るな。' }] },
    { id: 'b2_scout_fled', group: 'b2_scout', when: { beats: ['b2_road', 'b3_viewpoint'], after: 'scout_routed' }, lines: [{ speaker: hero, text: '逃げたか。……追うまでもない。' }] },
    { id: 'b3_plan_front', group: 'b3_plan', when: { beats: ['b3_viewpoint'], plan: 'front' }, lines: [{ speaker: hero, text: '正面から行く。早く終わらせる。' }] },
    { id: 'b3_plan_flank', group: 'b3_plan', when: { beats: ['b3_viewpoint'], plan: 'flank' }, lines: [{ speaker: hero, text: '回り込む。……気取られるな。' }] },
    { id: 'b4_unseen', when: { beats: ['b4_village'], approach: 'flank', seen: false, areas: ['village'], minBeatT: 4 }, lines: [{ speaker: hero, text: '……まだ、気づかれていない。' }] },
    { id: 'b5_old_kept', group: 'b5_old', when: { beats: ['b5_archer'], areas: ['village'], food: [50, null], captiveFreed: false }, lines: [{ speaker: old, text: '蓄えは、まだある。……礼は、後でさせてくれ。' }] },
    { id: 'b5_old_half', group: 'b5_old', when: { beats: ['b5_archer'], areas: ['village'], food: [35, 50], captiveFreed: false }, lines: [{ speaker: old, text: '半分は残った。……冬は、なんとかする。' }] },
    { id: 'b5_old_lost', group: 'b5_old', when: { beats: ['b5_archer'], areas: ['village'], food: [null, 35], captiveFreed: false }, lines: [{ speaker: old, text: '米は減ったが、命は減らなんだ。' }] },
    { id: 'b5_rope', when: { beats: ['b5_archer'], areas: ['captive'], captiveFreed: false }, lines: [{ speaker: tsubaki, text: '縄が固くて、私の手では解けませんでした。' }] },
    { id: 'b6_burden', when: { beats: ['b6_escort'], companion: true, ambush: null }, lines: [{ speaker: yajuro, text: 'この脚では足手まといだ。置いていってもいい。' }, { speaker: hero, text: '置いていくなら、拾いに来た意味がない。' }] },
    { id: 'b6_trust_high', group: 'b6_trust', when: { beats: ['b6_escort'], companion: true, ambush: null, trust: 'high' }, lines: [{ speaker: yajuro, text: '里の者は、我らを見送ってくれたな。' }] },
    { id: 'b6_trust_mid', group: 'b6_trust', when: { beats: ['b6_escort'], companion: true, ambush: null, trust: 'mid' }, lines: [{ speaker: yajuro, text: 'まだ、様子を見ているようだ。' }] },
    { id: 'b6_trust_low', group: 'b6_trust', when: { beats: ['b6_escort'], companion: true, ambush: null, trust: 'low' }, lines: [{ speaker: yajuro, text: '武士は要らぬ、か。' }, { speaker: hero, text: 'それでも、守る。' }] },
    { id: 'b6_way_front', group: 'b6_way', when: { beats: ['b6_escort'], companion: true, ambush: null, approach: 'front' }, lines: [{ speaker: yajuro, text: '正面から斬り込んだそうだな。無茶をする。' }, { speaker: hero, text: '時がなかった。' }] },
    { id: 'b6_way_quiet', group: 'b6_way', when: { beats: ['b6_escort'], companion: true, ambush: null, approach: 'flank', food: [50, null] }, lines: [{ speaker: yajuro, text: '里では、音もなく片づけたと聞いた。' }, { speaker: hero, text: '……昔の癖だ。' }] },
    { id: 'b6_way_loud', group: 'b6_way', when: { beats: ['b6_escort'], companion: true, ambush: null, approach: 'flank', food: [null, 50] }, lines: [{ speaker: yajuro, text: '回り込んだが、気取られたそうだな。' }, { speaker: hero, text: '……次は、うまくやる。' }] },
    { id: 'b6_boy', when: { beats: ['b6_escort'], companion: true, ambush: null }, lines: [{ speaker: yajuro, text: '寺に、子がいると聞いた。' }, { speaker: hero, text: '穂太だ。……待たせている。' }] },
    { id: 'b6_bow', when: { beats: ['b6_escort'], companion: true, ambush: null }, lines: [{ speaker: yajuro, text: '指図をくだされ。弓は、まだ引ける。' }] },
    { id: 'b6_after', when: { beats: ['b6_escort'], companion: true, ambush: 'cleared' }, lines: [{ speaker: yajuro, text: '……すまぬ。余計なことを言った。' }] },
  ],
  // 操作の案内（その場で一度だけ出す）
  hints: {
    move: 'W A S D で歩く　マウスで見回す　Shift で走る',
    crouch: 'C で屈む。屈むと、敵に気づかれにくい',
    attack: '左クリックで斬る（続けて三連）。右クリックで受ける',
    parry: '敵の刃が光ったら、見てから右クリックで弾く（早すぎると受けるだけ）。弾いたら左クリックで反撃',
    officer: '侍大将は続けて三度斬る。右クリックを押したままにすれば、三度とも受けられる',
    dodge: 'Space で転がって避ける',
    finisher: '崩れた敵には E で、とどめを刺せる',
    stealth: '気づかれていない敵の背後から E で、闇討ちできる',
    command: 'Q で弥十郎に指示（同行・待機・援護・撤退）',
  },
  places: { temple: '廃寺', village: '水穂の里', viewpoint: '見晴らし岩', temple_steps: '廃寺の石段' },
  resources: { food: 60, material: 0, funds: 0, morale: 50 }, trust: 40,
  pillage: { front: 0.8, flank: 0.1 },      // 敵1人・1秒あたり。脇道は静かに片づければ蓄えが50以上残る。騒ぎになる（敵に見つかる）と正面と同じ速さで荒らされる
  groups: {
    boy: ['boy'], road_scout: ['road_scout'],
    village_enemies: ['village_soldier_1', 'village_soldier_2', 'village_soldier_3', 'village_archer', 'officer'],
    escort_ambush: ['ambush_soldier_1', 'ambush_soldier_2', 'ambush_archer'],
  },
  results: {
    plentiful: 'この食糧なら冬を越せる。', meager: '蓄えは半分ほど。冬は切り詰めて越す。', scarce: 'この蓄えでは、次は匿えない。',
    moraleHigh: '仲間の足取りは軽い。', moraleMid: '仲間と帰る灯がある。', moraleLow: '里の灯を絶やすな。',
    trustHigh: '里は門を開く。', trustMid: '里は、まだ様子を見ている。', trustLow: '信頼はこれからだ。',
    front: '正面から里を守った。戦は早く終わった。', flank: '脇道から倉を守った。里は傷つかなかった。', flankLoud: '脇道から回ったが、気づかれて里は荒らされた。', none: '里への道を振り返る。',
  },
};
