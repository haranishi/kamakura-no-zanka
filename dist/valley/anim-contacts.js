// 足の接地位相（移動クリップ）。tools/build-foot-contacts.mjs が作る。手で書き換えない。
// 元：clips.json の contacts（Blender の焼き込み）を、実際の骨の動きから測った境界（reports/audio/foot-contacts-measured.json）の間に収めたもの。
// t は、クリップの先頭からの秒（0 以上 duration 未満）。foot は、その瞬間に着く足。
export const FOOT_CONTACTS = Object.freeze({
  CMU_Jog: { duration: 0.8, loop: true, contacts: [{ foot: 'left', t: 0.0664 }, { foot: 'right', t: 0.4664 }] },
  CMU_Run: { duration: 0.7333, loop: true, contacts: [{ foot: 'left', t: 0.033 }, { foot: 'right', t: 0.4334 }] },
  Casual_Walk: { duration: 4.2, loop: true, contacts: [{ foot: 'left', t: 0.0672 }, { foot: 'right', t: 0.735 }, { foot: 'left', t: 1.3986 }, { foot: 'right', t: 2.1 }, { foot: 'left', t: 2.7678 }, { foot: 'right', t: 3.5322 }] },
  Cautious_Crouch_Walk_Forward: { duration: 1.1333, loop: true, contacts: [{ foot: 'right', t: 0.5666 }, { foot: 'left', t: 1.1004 }] },
  Samurai_Walk: { duration: 1.3333, loop: true, contacts: [{ foot: 'left', t: 0 }, { foot: 'right', t: 0.7 }] },
  Walk_Fight_Forward: { duration: 1.7333, loop: true, contacts: [{ foot: 'left', t: 0.0292 }, { foot: 'right', t: 0.8996 }] },
});
