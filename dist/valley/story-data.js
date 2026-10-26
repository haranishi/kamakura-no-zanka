const beats = [
  ['b0_temple', '庭へ降りる'], ['b1_boy', '穂太の話を聞く'],
  ['b2_road', '水穂の里へ向かう'], ['b3_viewpoint', '里へ入る道を選ぶ'],
  ['b4_village', '里を守る'], ['b5_archer', '縛られた弥十郎を解く'],
  ['b6_escort', '廃寺へ戻る'], ['b7_result', '帰還の報せを聞く'], ['done', '谷の灯を守った'],
];
export const STORY = {
  beats: Object.fromEntries(beats.map(([id, objective]) => [id, { id, objective }])),
  dialogues: {
    boy_arrives: [{ speaker: '穂太', text: '里に兵が来た！' }],
    viewpoint_overlook: [{ speaker: '榊三郎景継', text: '正面は早い。脇道なら倉を守れる。' }],
    village_cleared: [{ speaker: '久作', text: 'まだ、助ける武士もいたか。' }],
    archer_joins: [{ speaker: '梓弥十郎', text: 'この弓で、帰り道を守ろう。' }],
    ambush_cleared: [{ speaker: '梓弥十郎', text: '先を急ごう。寺は近い。' }],
    result: [{ speaker: 'つばき', text: '次は私も手を貸す。' }],
  },
  places: { temple: '廃寺', village: '水穂の里', viewpoint: '見晴らし岩', temple_steps: '廃寺の石段' },
  resources: { food: 60, material: 0, funds: 0, morale: 50 }, trust: 40,
  pillage: { front: 0.8, flank: 0.2 },
  groups: {
    boy: ['boy'], road_scout: ['road_scout'],
    village_enemies: ['village_soldier_1', 'village_soldier_2', 'village_soldier_3', 'village_archer', 'officer'],
    escort_ambush: ['ambush_soldier_1', 'ambush_soldier_2', 'ambush_archer'],
  },
  results: { plentiful: 'この食糧なら冬を越せる。', scarce: 'この蓄えでは、次は匿えない。',
    front: '正面から里を守った。', flank: '脇道から倉を守った。', none: '里への道を振り返る。' },
};
