// 構想の絵（隠れ谷の夕景）と見比べるための固定画角 8 枚。画面の文字と道しるべを消し、敵の思考を止めて撮る。乱数・カメラ・時刻は固定。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-concept.mjs --out <出力フォルダ> --w 1672 --h 941
// 01 は、番地の旗 &cam=concept と同じ構図（dist/valley/shots.js の concept）。影は主人公に追従するので、主人公を写る範囲の中へ置いてから撮る。
export default async function ({ step, call, v, shot, freeze, start }) {
  const cam = async (name, pos, look, fov, settle = 24) => { await call('camera', pos, look, fov); await step(settle); await shot(name); };
  await start('new'); await freeze(true); await step(40); await call('god', true);
  await v("(document.body.classList.add('hide-hud'), document.getElementById('toast')?.classList.remove('on'), __valley.game.settings.waymarks = 'off', __valley.game.aiPaused = true, 0)");
  await call('teleport', 0, 30, 0); await step(10);
  await cam('01-concept-overlook', [-50, 40, 110], [-0.6, 0.4, -42.2], 58, 30);
  await cam('02-terraces', [-10, 14, 128], [0, 2, 30], 55);
  await cam('04-village-from-east', [70, 12, 30], [0, 3, 4], 55);
  await call('teleport', 60, -10, 0); await step(10);
  await cam('03-river-bridge', [86, 9, 20], [130, -1, -46], 55);
  await cam('06-fort', [20, 5, 40], [260, 60, -140], 40);
  await call('teleport', -90, -80, 0); await step(10);
  await cam('05-temple', [-70, 6, -60], [-110, 4, -100], 55);
  await call('camera', null);
  await call('teleport', -33, -3, -1.6); await call('look', -1.5, 0.18); await step(40); await shot('07-village-walk');
  await call('teleport', 0, 60, 3.1); await call('look', 3.1, 0.15); await step(40); await shot('08-terrace-walk');
}
