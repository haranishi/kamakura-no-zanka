// 撮影（M4・カメラの盲検採点用）：ゲームの画面そのもの（追従カメラ・プレイヤーが普段見る向き）を、同じ手順・同じ立ち時間で8コマのコマ割りにする。
// capture-smooth は主人公の周りを切り抜くので、切り抜きが主人公を追ってカメラの動きが消える。ここは画面全体を縮めて並べる（640×360 を2列×4段＝幅1280）。
// 場面：走り出し・定速・停止・旋回・歩き→止まり・走り→歩き・棚田の段の下り・壁の角を走り抜ける・壁から走り去る。
// 各コマの数値（主人公の画面の位置・画角・カメラの高さ・カメラの下の地面）を JSON に添える。番号だけを入れ、版の名前は入れない。
// 版は --query で切り替える（前＝smooth=camera、後＝既定）。上書きはページの準備の後なので、再読み込みで消えない。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-camera.mjs --out <dir> --tag <名前> [--query "smooth=camera"] --strict
//   KZ_ONLY＝撮る場面をカンマ区切りで絞る。KZ_PRE＝立ち時間（既定150コマ）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepare, START } from './smooth-journey.mjs';

const TILES = 8, TILE = { w: 640, h: 360 };
const RUN = { KeyW: true, ShiftLeft: true }, WALK = { KeyW: true, ShiftLeft: false }, NONE = { KeyW: false, ShiftLeft: false };
// lead：撮り始めるまで（秒・キー）、every：コマの間隔、at：何枚目の前の操作（keys・turn＝その枚から視点を回す角とコマ数）、skip：撮り始める前に進めるコマ
export const SCENES = [
  { name: 'run_start', every: 3, lead: [], at: { 0: { keys: RUN } } },
  { name: 'run_steady', every: 6, lead: [[1.5, RUN]], at: {} },
  { name: 'run_stop', every: 4, lead: [[1.5, RUN]], at: { 2: { keys: NONE } } },
  { name: 'turn', every: 6, lead: [[1.2, RUN]], at: { 1: { turn: Math.PI / 2, frames: 24 } } },
  { name: 'walk_stop', every: 4, lead: [[1.5, WALK]], at: { 2: { keys: NONE } } },
  { name: 'run_to_walk', every: 5, lead: [[1.5, RUN]], at: { 2: { keys: WALK } } },
  // 棚田（capture-ledge と同じ場所）：段を下りる瞬間（キーを押してから118コマ目）が3〜4枚目に来るよう、前に進める
  { name: 'terrace_run', every: 4, x: 0, z: 52, yaw: Math.PI, lead: [[1.8, RUN]], at: {} },
  // 家の南の面から0.7mを、角の外から走り抜ける。M3 のカメラはキーから74コマ目に1コマで1.2m寄る（regress-locomotion-camera）
  { name: 'wall_pass', every: 4, x: 18.41, z: -12.27, yaw: 1.35, lead: [[0.85, RUN]], at: {} },
  { name: 'wall_away', every: 6, x: 11.02, z: -13.6, yaw: 2.92, lead: [], at: { 0: { keys: RUN } } },
];
const tagOf = () => { const i = process.argv.indexOf('--tag'); return (i >= 0 ? process.argv[i + 1] : process.env.KZ_TAG) || 'shot'; };

async function playScene(ctx, sc) {
  const { v, step, key, call, page } = ctx;
  for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) await key(k, false);
  const at = { x: sc.x ?? START.x, z: sc.z ?? START.z, yaw: sc.yaw ?? START.yaw };
  await call('teleport', at.x, at.z, at.yaw); await call('look', at.yaw, 0.2);
  await v('(__valley.game.hero.speed = 0, __valley.game.hero.crouch = false, 0)');
  await step(Number(process.env.KZ_PRE || 150));
  for (const [secs, keys] of sc.lead) { for (const [k, on] of Object.entries(keys)) await key(k, on); await step(Math.round(secs * 60)); }
  const shots = [], log = [];
  let turn = null;
  for (let i = 0; i < TILES; i++) {
    const op = sc.at[i];
    if (op?.keys) for (const [k, on] of Object.entries(op.keys)) await key(k, on);
    if (op?.turn) turn = { from: await v('__valley.game.rig.yaw'), by: op.turn, frames: op.frames, done: 0 };
    const n = i === 0 ? 1 : sc.every;
    for (let s = 0; s < n; s++) {
      if (turn && turn.done < turn.frames) { turn.done++; await v(`(__valley.game.rig.yaw = ${turn.from} + ${turn.by} * (1 - Math.cos(Math.PI * ${turn.done} / ${turn.frames})) / 2, 0)`); }
      await step(1);
    }
    shots.push(await page.screenshot());
    log.push(await v(`(() => { const g = __valley.game, h = g.hero, c = g.camera, V = new c.position.constructor(h.pos.x, (h.pos.y ?? 0) + 1.0, h.pos.z).project(c);
      const r = x => Math.round(x * 1000) / 1000;
      return { i: ${i}, speed: r(h.speed), heroScreen: [r(V.x), r(V.y)], fov: r(c.fov), camY: r(c.position.y), camAboveGround: r(c.position.y - g.terrain.heightAt(c.position.x, c.position.z)), heroCamDist: r(Math.hypot(c.position.x - h.pos.x, c.position.z - h.pos.z)) }; })()`));
  }
  for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) await key(k, false);
  return { shots, log };
}

async function sheet(page, shots, file) {
  const p = await page.context().browser().newPage({ viewport: { width: TILE.w * 2, height: TILE.h * 4 }, deviceScaleFactor: 1 });
  const imgs = shots.map((b, i) => `<div style="position:relative;width:${TILE.w}px;height:${TILE.h}px"><img src="data:image/png;base64,${b.toString('base64')}" style="width:100%;height:100%;display:block"><span style="position:absolute;left:6px;top:4px;font:16px sans-serif;color:#fff;text-shadow:0 0 3px #000">${i + 1}</span></div>`).join('');
  await p.setContent(`<body style="margin:0;background:#000"><div style="display:grid;grid-template-columns:repeat(2,${TILE.w}px)">${imgs}</div></body>`);
  await p.screenshot({ path: file, type: 'jpeg', quality: 80 });
  await p.close();
}

export default async function (ctx) {
  await prepare(ctx);
  await ctx.v("document.body.classList.add('hide-hud')");
  const tag = tagOf(), all = {}, only = process.env.KZ_ONLY ? process.env.KZ_ONLY.split(',') : null;
  await playScene(ctx, SCENES[0]);   // 空撮り（最初の場面だけ回ごとに絵が変わることがある）
  for (const sc of SCENES) {
    if (only && !only.includes(sc.name)) continue;
    const { shots, log } = await playScene(ctx, sc), file = path.join(ctx.out, `${tag}-${sc.name}.jpg`);
    await sheet(ctx.page, shots, file); all[sc.name] = { every: sc.every, log }; ctx.log('sheet', file);
  }
  await fs.writeFile(path.join(ctx.out, `${tag}-capture-camera.json`), JSON.stringify(all, null, 1) + '\n');
}
