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
const hero = '榊三郎景継', boy = '穂太', old = '久作', tsubaki = 'つばき', yajuro = '梓弥十郎';
export const STORY = {
  beats: Object.fromEntries(beats.map(([id, objective]) => [id, { id, objective, guideTarget: guideTargets[id] }])),
  dialogues: {
    boy_arrives: [
      { speaker: boy, text: 'お侍さま……っ。里に、兵が来た。' },
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
    village_cleared: [
      { speaker: old, text: 'まだ……武士の中にも、助ける者がいたか。' },
      { speaker: tsubaki, text: '倉の裏に、縛られた人がいます。あの兵たちに追われていた方です。' },
      { speaker: hero, text: '……そこにいるのか。' },
    ],
    archer_joins: [
      { speaker: yajuro, text: '……景継殿か。生きておられた。' },
      { speaker: hero, text: '弥十郎。お前こそ。' },
      { speaker: yajuro, text: '皆が散るとき、私は先に逃げた。この腕の傷は、その報いだ。' },
      { speaker: hero, text: '悔いるなら、生きて償え。お前の弓が要る。' },
      { speaker: yajuro, text: '……承知。この弓で、帰り道を守ろう。' },
    ],
    ambush_cleared: [
      { speaker: yajuro, text: 'これで追手は退いた。寺はすぐそこだ。' },
      { speaker: hero, text: '歩けるか。' },
      { speaker: yajuro, text: 'ご心配なく。この脚は、まだ動く。' },
    ],
    result: [
      { speaker: tsubaki, text: '里の者から、米を預かってきました。' },
      { speaker: old, text: '武士など要らんと思うておったが……あんた方は、違ったな。' },
      { speaker: tsubaki, text: '次に兵が来たら、私も手を貸します。' },
      { speaker: yajuro, text: '焚き火のそばは、久しぶりだ。' },
      { speaker: hero, text: 'ここが、帰る場所になる。' },
    ],
  },
  // 敵の掛け声（字幕）。音に頼らず状況が分かるように、画面にも出す。
  barks: {
    alert: ['何奴だ！', '敵だ、かかれ！', 'こっちにいるぞ！'],
    retreat: ['退け、退け！', '引き上げだ、逃げろ！'],
    surrender: ['待て、降る……！'],
    rally: ['怯むな、囲め！'],
    archer: ['射よ！'],
  },
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
