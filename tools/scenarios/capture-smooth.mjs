// 撮影（盲検採点用・要件 R38.4）：走り出し・定速・停止・旋回を、固定の横カメラと追従カメラ（ゲームのカメラ）で、同じコマ間隔のコマ割り画像にする。
// 1枚＝8コマ（60コマ/秒で4コマごと＝約67ms）。主人公の周りを切り抜き、4×2に並べて幅1280のJPGにする（番号だけを入れ、版の名前は入れない）。
// 乱数・時計は capture-calls.mjs の deterministic で止める。入力は実際のキーと視点の向きだけ。固定カメラの置き場所は、その場面の撮り始めの論理の位置から決める
// （論理が同じ版どうしなら同じ置き場所。速さの表を変えた版とも、撮り始めの位置からの同じ相対位置で比べられる）。
// 場面の前に主人公を瞬間移動させるので、そのコマの足（脚のIKは着いた足を留める）が走りの姿のまま残る。立ち止まって足が待ちの姿に戻るまで、KZ_PRE コマ（既定150＝2.5秒。
// 以前は36コマで、走り出しの1コマ目から足を開いた姿に撮れて、IK の版だけ走り出しが悪く見えた＝2026-11-04 に盲検採点の誤読で発覚）待つ。
// KZ_EVERY＝1枚のコマの間隔（既定4＝約67ms。停止の後まで見るなら 6〜8）、KZ_ONLY＝撮る場面をカンマ区切りで絞る。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-smooth.mjs --out <dir> --tag before --strict（KZ_TAG でも可）
//   出力: <dir>/<tag>-<場面>-<side|follow>.jpg と <dir>/<tag>-capture-smooth.json（各コマの論理の位置・速さ）
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepare, START } from './smooth-journey.mjs';

const EVERY = Number(process.env.KZ_EVERY || 4), TILES = 8, CROP = { w: 400, h: 600 }, TILE = { w: 320, h: 480 };
const RUN = { KeyW: true, ShiftLeft: true }, WALK = { KeyW: true, ShiftLeft: false }, NONE = { KeyW: false, ShiftLeft: false };
// lead：撮り始めるまでの準備（秒・キー）。at：何枚目の前の操作（keys・turn＝その枚から視点を回す角とコマ数）
export const SCENES = [
  { name: 'run_start', lead: [], at: { 0: { keys: RUN } } },
  { name: 'run_steady', lead: [[1.5, RUN]], at: {} },
  { name: 'run_stop', lead: [[1.5, RUN]], at: { 2: { keys: NONE } } },
  { name: 'turn', lead: [[1.2, RUN]], at: { 1: { turn: Math.PI / 2, frames: 24 } } },
  // M2a で足した：通常移動からの停止と、走り→通常移動（Shift を離す）
  { name: 'walk_stop', lead: [[1.5, WALK]], at: { 2: { keys: NONE } } },
  { name: 'run_to_walk', lead: [[1.5, RUN]], at: { 2: { keys: WALK } } },
];
const tagOf = () => { const i = process.argv.indexOf('--tag'); return (i >= 0 ? process.argv[i + 1] : process.env.KZ_TAG) || 'shot'; };

async function playScene(ctx, sc, cam) {
  const { v, step, key, call, st, page } = ctx;
  await call('camera', null);
  for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) await key(k, false);
  await call('teleport', START.x, START.z, START.yaw); await call('look', START.yaw, 0.2); await v('(__valley.game.hero.speed = 0, __valley.game.hero.crouch = false, 0)'); await step(Number(process.env.KZ_PRE || 150));
  for (const [secs, keys] of sc.lead) { for (const [k, on] of Object.entries(keys)) await key(k, on); await step(Math.round(secs * 60)); }
  const h0 = (await st()).hero;
  if (cam === 'side') {
    // 横（進む向きの右手側4.6m）から、撮り始めの位置より進む向きへ1.2m先を見る。場面の間は動かさない
    const fx = -Math.sin(START.yaw), fz = -Math.cos(START.yaw), rx = Math.cos(START.yaw), rz = -Math.sin(START.yaw), ax = h0.x + fx * 1.2, az = h0.z + fz * 1.2;
    await call('camera', [ax + rx * 4.6, 1.15, az + rz * 4.6], [ax, 0.85, az], 40);
  }
  const shots = [], log = [];
  let turn = null;
  for (let i = 0; i < TILES; i++) {
    const op = sc.at[i];
    if (op?.keys) for (const [k, on] of Object.entries(op.keys)) await key(k, on);
    if (op?.turn) turn = { left: op.frames, each: op.turn / op.frames };
    const n = i === 0 ? 1 : EVERY;
    for (let f = 0; f < n; f++) {
      if (turn && turn.left > 0) { await v(`(__valley.game.rig.yaw += ${turn.each}, 0)`); turn.left--; }
      await step(1);
    }
    // 主人公の腰の高さを画面へ写し、その周りを切り抜く
    const p = await v(`(() => { const g = __valley.game, h = g.hero, V = new g.camera.position.constructor(h.pos.x, (h.pos.y ?? 0) + 0.85, h.pos.z).project(g.camera); return { x: (V.x + 1) / 2 * innerWidth, y: (1 - V.y) / 2 * innerHeight, w: innerWidth, h: innerHeight }; })()`);
    const x = Math.round(Math.max(0, Math.min(p.w - CROP.w, p.x - CROP.w / 2))), y = Math.round(Math.max(0, Math.min(p.h - CROP.h, p.y - CROP.h / 2)));
    shots.push(await page.screenshot({ clip: { x, y, width: CROP.w, height: CROP.h } }));
    const s = (await st()).hero; log.push({ scene: sc.name, cam, i, x: +s.x.toFixed(3), z: +s.z.toFixed(3) });
  }
  for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) await key(k, false);
  await call('camera', null);
  return { shots, log };
}

// 8枚を4×2に並べて JPG に（別の静かなページで並べて撮る。外部の道具は使わない。マウスの固定を使わないので pointerlock の守りは要らない）
async function sheet(page, shots, file) {
  const p = await page.context().browser().newPage({ viewport: { width: TILE.w * 4, height: TILE.h * 2 }, deviceScaleFactor: 1 });
  const imgs = shots.map((b, i) => `<div style="position:relative;width:${TILE.w}px;height:${TILE.h}px"><img src="data:image/png;base64,${b.toString('base64')}" style="width:100%;height:100%;display:block"><span style="position:absolute;left:4px;top:2px;font:12px sans-serif;color:#fff;text-shadow:0 0 2px #000">${i + 1}</span></div>`).join('');
  await p.setContent(`<body style="margin:0;background:#000"><div style="display:grid;grid-template-columns:repeat(4,${TILE.w}px)">${imgs}</div></body>`);
  await p.screenshot({ path: file, type: 'jpeg', quality: 82 });
  await p.close();
}

export default async function (ctx) {
  await prepare(ctx);
  await ctx.v("document.body.classList.add('hide-hud')");
  // 背の高い草が足首を隠す（走った先の草地で足が見えなかった）。足運びを見る撮影なので草だけ消す（KZ_GRASS=1 で残す）。論理には触れない
  if (!process.env.KZ_GRASS) await ctx.v('(__valley.game.veg.grass.group.visible = false, 0)');
  const tag = tagOf(), all = [];
  // 1回目の場面だけ、草の区画の作り始めなどで回ごとに絵が変わった（2026-11-04）。同じ場面を1回空撮りしてから撮る
  await playScene(ctx, SCENES[0], 'side');
  for (const sc of SCENES) for (const cam of ['side', 'follow']) {
    if (process.env.KZ_ONLY && !process.env.KZ_ONLY.split(',').includes(sc.name)) continue;
    const { shots, log } = await playScene(ctx, sc, cam);
    const file = path.join(ctx.out, `${tag}-${sc.name}-${cam}.jpg`);
    await sheet(ctx.page, shots, file); ctx.log('sheet', file); all.push(...log);
  }
  await fs.writeFile(path.join(ctx.out, `${tag}-capture-smooth.json`), JSON.stringify({ every: EVERY, tiles: TILES, frames: all }, null, 1) + '\n');
}
