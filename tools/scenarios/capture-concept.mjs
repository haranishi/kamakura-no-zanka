// 構想の絵（隠れ谷の夕景）と見比べるための固定画角 11 枚（01〜08＝始まりの段、09〜11＝里を救ったあと）。画面の文字と道しるべを消し、敵の思考を止めて撮る。乱数・カメラ・時刻は固定。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-concept.mjs --out <出力フォルダ> --w 1672 --h 941
// 01 は、番地の旗 &cam=concept と同じ構図（dist/valley/shots.js の concept）。影は主人公に追従するので、主人公を写る範囲の中へ置いてから撮る。
export default async function ({ st, step, call, v, shot, freeze, start }) {
  const cam = async (name, pos, look, fov, settle = 24) => { await call('camera', pos, look, fov); await step(settle); await shot(name); };
  await start('new'); await freeze(true); await step(40); await call('god', true);
  await v("(document.body.classList.add('hide-hud'), document.getElementById('toast')?.classList.remove('on'), __valley.game.settings.waymarks = 'off', __valley.game.aiPaused = true, 0)");
  await call('teleport', 0, 30, 0); await step(10);
  await cam('01-concept-overlook', [30, 70, 180], [82.4, 36.3, -2.6], 64, 30);
  await cam('02-terraces', [-10, 14, 128], [0, 2, 30], 55);
  await cam('04-village-from-east', [70, 12, 30], [0, 3, 4], 55);
  await call('teleport', 60, -10, 0); await step(10);
  await cam('03-river-bridge', [96, 6, -8], [130, 0, -46], 50);
  await cam('06-fort', [30, 70, 180], [262, 6, -140], 16);
  await call('teleport', -90, -80, 0); await step(10);
  await cam('05-temple', [-70, 6, -60], [-110, 4, -100], 55);
  await call('camera', null);
  await call('teleport', -33, -3, -1.6); await call('look', -1.5, 0.18); await step(40); await shot('07-village-walk');
  await call('teleport', 0, 60, 3.1); await call('look', 3.1, 0.15); await step(40); await shot('08-terrace-walk');
  // 09〜11：里を救ったあと（兵が去り、暮らしが戻る段）。絵は、この段の里に当たる。任務は、出来事を送って進める（遊びの規則は変えない）。
  const adv = async () => { for (let i = 0; i < 80; i++) { const q = await st(); if (q.talking) { await call('advanceDialogue', true); await step(10); } else if (q.pending || q.flow === 'cinematic') await step(30); else break; } };
  const ev = async (type, f = {}) => { await call('dispatch', { type, ...f }); await step(2); };
  await ev('enter_zone', { zone: 'temple_yard' }); await adv(); await ev('dialogue_end', { id: 'boy_arrives' });
  await ev('arrived', { place: 'viewpoint' }); await adv(); await ev('choose_plan', { plan: 'front' }); await ev('enter_zone', { zone: 'village_front' });
  await ev('enemy_down', { id: 'officer', how: 'routed' }); await adv(); await ev('interact', { id: 'archer_captive' }); await adv(); await ev('party_joined', { id: 'archer' });
  await v("(document.body.classList.add('hide-hud'), document.getElementById('toast')?.classList.remove('on'), __valley.game.hud.showChoice?.(false), 0)");
  await call('teleport', 0, 30, 0); await step(60);
  await cam('09-concept-overlook-saved', [30, 70, 180], [82.4, 36.3, -2.6], 64, 30);
  await cam('10-village-saved', [-34, 9, 34], [2, 2, 2], 50);
  await cam('11-terraces-saved', [-10, 14, 128], [0, 2, 30], 55);
}
