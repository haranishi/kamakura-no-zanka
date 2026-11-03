// 撮影（脚のIK・M2b）：棚田の段（高さ0.55m）を下る・登る場面を、段差を越える瞬間を中心に8コマ（4コマごと＝約67ms）のコマ割りにする。
// 平地の走り・止まりは、IK の有無で画素がほとんど変わらない（M2b の報告）。効き目は坂と段差にあるので、そこを見る道具。
// 1回目に同じ経路を流して「根の高さが最も大きく動くコマ」を探し、2回目にその前後を撮る（同じ版・同じ入力なら経路は同じ）。立ち時間は KZ_PRE コマ（既定150）。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-ledge.mjs --out <dir> --tag <名前> [--query "smooth=ik"] --strict
//   出力: <dir>/<tag>-<場面>.jpg（幅1280のJPG・コマの番号だけ入れる）と <dir>/<tag>-ledge.json（各コマの論理の位置と高さ）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepare } from './smooth-journey.mjs';

const EVERY = 4, TILES = 8, CROP = { w: 400, h: 600 }, TILE = { w: 320, h: 480 };
const W = { KeyW: true, ShiftLeft: false }, RUN = { KeyW: true, ShiftLeft: true };
// 棚田：z 52 から +z へ進むと下り、z 62 から −z へ進むと登り（yaw 0 は −z、π は +z へ進む）
export const LEDGES = [
  { name: 'terrace_walk', x: 0, z: 52, yaw: Math.PI, keys: W, secs: 4.0 },
  { name: 'terrace_run', x: 0, z: 52, yaw: Math.PI, keys: RUN, secs: 3.0 },
  { name: 'terrace_up', x: 0, z: 62, yaw: 0, keys: W, secs: 4.0 },
  { name: 'terrace_up_run', x: 0, z: 62, yaw: 0, keys: RUN, secs: 3.0 },
];
const tagOf = () => { const i = process.argv.indexOf('--tag'); return (i >= 0 ? process.argv[i + 1] : process.env.KZ_TAG) || 'shot'; };

async function place(ctx, wk) {
  const { v, step, key, call } = ctx;
  await call('camera', null);
  for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) await key(k, false);
  await call('teleport', wk.x, wk.z, wk.yaw); await call('look', wk.yaw, 0.2); await v('(__valley.game.hero.speed = 0, __valley.game.hero.crouch = false, 0)');
  await step(Number(process.env.KZ_PRE || 150));   // 瞬間移動の直後は足が前の姿のまま留まる。待ちの姿へ戻るまで立つ
}

async function findLedge(ctx, wk) {
  const { v, step, key } = ctx;
  await place(ctx, wk);
  for (const [k, on] of Object.entries(wk.keys)) await key(k, on);
  let best = { i: 0, d: 0 }, prev = await v('__valley.game.hero.pos.y');
  for (let i = 0; i < Math.round(wk.secs * 60); i++) { await step(1); const y = await v('__valley.game.hero.pos.y'), d = Math.abs(y - prev); if (d > best.d) best = { i, d }; prev = y; }
  for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) await key(k, false);
  return best;
}

async function shoot(ctx, wk, center) {
  const { v, step, key, call, st, page } = ctx;
  await place(ctx, wk);
  for (const [k, on] of Object.entries(wk.keys)) await key(k, on);
  await step(Math.max(0, center - EVERY * 3));   // 8コマの3コマ目あたりに、段差を越える瞬間が来る
  const h0 = (await st()).hero;
  const fx = -Math.sin(wk.yaw), fz = -Math.cos(wk.yaw), rx = Math.cos(wk.yaw), rz = -Math.sin(wk.yaw), ax = h0.x + fx * 1.2, az = h0.z + fz * 1.2;
  const gy = await v(`__valley.game.terrain.heightAt(${h0.x}, ${h0.z})`);
  await call('camera', [ax + rx * 4.6, gy + 1.0, az + rz * 4.6], [ax, gy + 0.45, az], 40);   // 横（進む向きの右手側4.6m）から。高さは撮り始めの足元の地面から
  const shots = [], log = [];
  for (let i = 0; i < TILES; i++) {
    await step(i === 0 ? 1 : EVERY);
    const p = await v(`(() => { const g = __valley.game, h = g.hero, V = new g.camera.position.constructor(h.pos.x, (h.pos.y ?? 0) + 0.85, h.pos.z).project(g.camera); return { x: (V.x + 1) / 2 * innerWidth, y: (1 - V.y) / 2 * innerHeight, w: innerWidth, h: innerHeight }; })()`);
    const x = Math.round(Math.max(0, Math.min(p.w - CROP.w, p.x - CROP.w / 2))), y = Math.round(Math.max(0, Math.min(p.h - CROP.h, p.y - CROP.h / 2)));
    shots.push(await page.screenshot({ clip: { x, y, width: CROP.w, height: CROP.h } }));
    const s = (await st()).hero; log.push({ i, x: +s.x.toFixed(3), y: +(await v('__valley.game.hero.pos.y')).toFixed(3), z: +s.z.toFixed(3) });
  }
  for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) await key(k, false);
  await call('camera', null);
  return { shots, log };
}

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
  if (!process.env.KZ_GRASS) await ctx.v('(__valley.game.veg.grass.group.visible = false, 0)');   // 背の高い草が足首を隠す。論理には触れない
  const tag = tagOf(), all = {}, only = process.env.KZ_ONLY ? process.env.KZ_ONLY.split(',') : null;
  await findLedge(ctx, LEDGES[0]);   // 空撮り（最初の場面だけ回ごとに絵が変わることがある）
  for (const wk of LEDGES) {
    if (only && !only.includes(wk.name)) continue;
    const best = await findLedge(ctx, wk), { shots, log } = await shoot(ctx, wk, best.i);
    const file = path.join(ctx.out, `${tag}-${wk.name}.jpg`);
    await sheet(ctx.page, shots, file); ctx.log('sheet', file, 'ledge frame', best.i, 'dy', best.d.toFixed(3)); all[wk.name] = { ledge: best, log };
  }
  await fs.writeFile(path.join(ctx.out, `${tag}-ledge.json`), JSON.stringify(all, null, 1) + '\n');
}
