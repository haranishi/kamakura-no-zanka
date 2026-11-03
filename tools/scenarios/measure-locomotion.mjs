// 測定：主人公の走り・歩きの足の滑り（cm）と、カメラの急な動き（m/秒²）を、実ゲームの入力（W・Shift と視点の向き）で測る。
//   足の滑り：clips.json の contacts（足が着いている区間・Blender の焼き込み）の間、その足首の骨の水平な位置が、着いた瞬間からどれだけ動いたか。
//     最も重い移動の動作（重み0.5以上）の区間だけを数える。足首は踏み込みで少し転がるので、速さが合っていても数cmは出る。許容は8cm（design-characters.md）。
//   場面：走り（5m/秒）の a 定速の直進・b 走り始め・c 停止・d 曲がる（90°）・e 壁際、歩き（2.5m/秒）の直進・停止、歩き→走りの切り替え。
//     走りの直進・停止は 30・60・144 コマ/秒でも測る（コマの速さで極端に変わらないこと）。
//   カメラ：カメラの位置の加速度（2回の差）。停止のように、主人公の位置が1コマで止まる場面で急に止まるかを見る。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-locomotion.mjs --strict（KZ_OUT=<json> で記録）
// 試験としては regress-locomotion.mjs がこの測定を読み、しきい値を当てる。
import fs from 'node:fs';

export const FLAT = { x: 2, z: 4, yaw: 0 };              // 里の中ほどの平らな所（家・木から離れている）。yaw 0 は −z へ進む
export const WALL = { x: -18, z: -12 };                 // house1 の中心（当たりは回転した 9×7m の長方形）

// ページの中で1つの場面を動かし、毎コマ記録して要約を返す。plan は [{ t: 秒, keys: {...}, look: yaw|null, tag: 区間の名前 }]
export async function runPlan(v, { start, plan, dt = 1 / 60, settle = 0.6 }) {
  return v(`(() => {
    const g = __valley.game, h = g.hero, ch = h.character, meta = g.roster.meta.clips, input = __valley._input || null;
    const dt = ${dt}, plan = ${JSON.stringify(plan)}, start = ${JSON.stringify(start)};
    h.place(start.x, start.z, start.yaw); h.speed = 0; g.rig.yaw = start.yaw; g.rig.pitch = 0.2; g.rig.snap();
    for (const k of ['KeyW', 'ShiftLeft']) __valley.key(k, false);
    for (let i = 0; i < Math.round(${settle} / dt); i++) __valley.step(1, dt);
    const V = new ch.model.position.constructor(), feet = ['LeftFoot', 'RightFoot'];
    const stance = { LeftFoot: null, RightFoot: null }, low = { LeftFoot: null, RightFoot: null }, out = [], lows = [], cam = [], frames = [];
    // 立って待つ姿の足首の高さ＋4cm より低い間を「地面の近く」と見なす（動作の区間に頼らない滑りの物差し。混ぜの最中・停止の後も数える）
    ch.model.updateMatrixWorld(true);
    let lowY = 0; for (const foot of feet) { ch.bone(foot).getWorldPosition(V); lowY = Math.max(lowY, V.y - g.terrain.heightAt(V.x, V.z)); }
    lowY += 0.04;
    const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;
    let tag = null, t = 0, pi = -1, prevPos = null, prevClip = null; const adv = {};
    const total = plan.reduce((s, p) => s + p.t, 0);
    while (t < total - 1e-9) {
      let acc = 0, idx = 0; for (; idx < plan.length; idx++) { acc += plan[idx].t; if (t < acc - 1e-9) break; }
      if (idx !== pi) {
        pi = idx; const p = plan[idx]; tag = p.tag;
        for (const [k, on] of Object.entries(p.keys || {})) __valley.key(k, on);
        if (p.look != null) g.rig.yaw = p.look;
      }
      __valley.step(1, dt); t += dt;
      // 最も重い移動の動作
      let best = null, bw = 0;
      for (const [name, a] of ch.actions) { const m = meta[name]; if (!m?.contacts || m.kind !== 'cycle') continue; const w = a.getEffectiveWeight(); if (w > bw) { bw = w; best = { name, a, m }; } }
      ch.model.updateMatrixWorld(true);
      for (const [fi, foot] of feet.entries()) {
        ch.bone(foot).getWorldPosition(V);
        const side = fi ? 'right' : 'left';
        let on = false;
        if (best && bw >= 0.5) { const p = (best.a.time / best.m.seconds) % 1; on = (best.m.contacts[side] || []).some(w => inWin(p, w)); }
        const s = stance[foot];
        if (on && s && s.clip === best.name) { const d = Math.hypot(V.x - s.x, V.z - s.z); if (d > s.slip) s.slip = d; s.n++; }
        else {
          if (s && s.n >= 2) out.push({ tag: s.tag, clip: s.clip, foot, slip: +(s.slip * 100).toFixed(2), n: s.n, t: +t.toFixed(3) });
          stance[foot] = on ? { clip: best.name, tag, x: V.x, z: V.z, slip: 0, n: 1 } : null;
        }
        const isLow = V.y - g.terrain.heightAt(V.x, V.z) < lowY, l = low[foot];
        if (isLow && l) { const d = Math.hypot(V.x - l.x, V.z - l.z); if (d > l.slip) l.slip = d; l.n++; }
        else {
          if (l && l.n >= 2) lows.push({ tag: l.tag, foot, slip: +(l.slip * 100).toFixed(2), n: l.n });
          low[foot] = isLow ? { tag, x: V.x, z: V.z, slip: 0, n: 1 } : null;
        }
      }
      const c = g.camera.position; cam.push({ tag, x: c.x, y: c.y, z: c.z });
      const moved = prevPos ? Math.hypot(h.pos.x - prevPos.x, h.pos.z - prevPos.z) / dt : 0; prevPos = { x: h.pos.x, z: h.pos.z };
      // 体が止まっているのに、移動の動作だけが進んだ量（1周を1とする）。キーを離したあと「足だけ続く」の物差し
      if (best && bw >= 0.5 && prevClip && prevClip.name === best.name && moved === 0) adv[tag] = (adv[tag] || 0) + (((best.a.time - prevClip.time) % best.m.seconds) + best.m.seconds) % best.m.seconds / best.m.seconds;
      prevClip = best ? { name: best.name, time: best.a.time } : null;
      frames.push({ tag, t: +t.toFixed(4), x: +h.pos.x.toFixed(4), z: +h.pos.z.toFixed(4), yaw: +h.yaw.toFixed(4), speed: +h.speed.toFixed(3), moved: +moved.toFixed(3), clip: best?.name || null, w: +bw.toFixed(2), gait: ch.gait, ts: best ? +best.a.timeScale.toFixed(3) : 0, ct: best ? +best.a.time.toFixed(3) : 0, slide: +(h.slideTurn || 0).toFixed(3) });
    }
    for (const foot of feet) { const s = stance[foot]; if (s && s.n >= 2) out.push({ tag: s.tag, clip: s.clip, foot, slip: +(s.slip * 100).toFixed(2), n: s.n }); }
    for (const foot of feet) { const l = low[foot]; if (l && l.n >= 2) lows.push({ tag: l.tag, foot, slip: +(l.slip * 100).toFixed(2), n: l.n }); }
    for (const k of ['KeyW', 'ShiftLeft']) __valley.key(k, false);
    // カメラの加速度（m/秒²）を区間ごとに。2回の差を dt² で割る
    const camAcc = {};
    for (let i = 2; i < cam.length; i++) {
      const a = Math.hypot(cam[i].x - 2 * cam[i - 1].x + cam[i - 2].x, cam[i].y - 2 * cam[i - 1].y + cam[i - 2].y, cam[i].z - 2 * cam[i - 1].z + cam[i - 2].z) / (dt * dt);
      const k = cam[i].tag; camAcc[k] = Math.max(camAcc[k] || 0, a);
    }
    return { stances: out, lows, lowY: +lowY.toFixed(3), camAcc, adv, frames };
  })()`);
}

export function summarize(stances, tag) {
  const s = stances.filter(r => r.tag === tag).map(r => r.slip).sort((a, b) => a - b);
  if (!s.length) return { n: 0, max: 0, mean: 0, p90: 0 };
  return { n: s.length, max: s.at(-1), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p90: s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] };
}

export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

// 場面の一覧。各場面は、区間の名前（tag）ごとに要約する
export function plans() {
  const run = { KeyW: true, ShiftLeft: true }, walk = { KeyW: true, ShiftLeft: false }, stop = { KeyW: false, ShiftLeft: false };
  const wallStart = { x: WALL.x, z: WALL.z + 9, yaw: 0 };   // 家の南から北（−z）へ走ると壁に当たる
  return {
    run: { start: FLAT, plan: [{ t: 0.6, keys: run, tag: 'run_start' }, { t: 2.0, tag: 'run_steady' }, { t: 0.8, keys: stop, tag: 'run_stop' }] },
    turn: { start: FLAT, plan: [{ t: 1.2, keys: run, tag: 'pre' }, { t: 0.6, look: Math.PI / 2, tag: 'run_turn' }, { t: 0.6, tag: 'post' }, { t: 0.4, keys: stop, tag: 'end' }] },
    wall: { start: wallStart, plan: [{ t: 0.9, keys: run, tag: 'approach' }, { t: 1.5, tag: 'run_wall' }, { t: 0.4, keys: stop, tag: 'end' }] },
    walk: { start: FLAT, plan: [{ t: 0.6, keys: walk, tag: 'walk_start' }, { t: 2.0, tag: 'walk_steady' }, { t: 0.8, keys: stop, tag: 'walk_stop' }] },
    switch: { start: FLAT, plan: [{ t: 1.5, keys: walk, tag: 'pre' }, { t: 0.8, keys: run, tag: 'walk_to_run' }, { t: 0.6, tag: 'post' }, { t: 0.4, keys: stop, tag: 'end' }] },
  };
}

export async function measureAll(v, { rates = [60] } = {}) {
  const result = {};
  for (const hz of rates) {
    for (const [name, p] of Object.entries(plans())) {
      if (hz !== 60 && !['run', 'walk'].includes(name)) continue;
      const r = await runPlan(v, { ...p, dt: 1 / hz });
      const tags = [...new Set(p.plan.map(x => x.tag))];
      result[`${name}@${hz}`] = { slip: Object.fromEntries(tags.map(t => [t, summarize(r.stances, t)])), low: Object.fromEntries(tags.map(t => [t, summarize(r.lows, t)])), lowY: r.lowY, stances: r.stances, adv: Object.fromEntries(Object.entries(r.adv).map(([k, a]) => [k, +a.toFixed(3)])), camAcc: Object.fromEntries(Object.entries(r.camAcc).map(([k, a]) => [k, +a.toFixed(1)])), frames: r.frames };
    }
  }
  return result;
}

export async function prepare({ start, freeze, step, call, st }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; }
  await call('camera', null);
}

export default async function (ctx) {
  await prepare(ctx);
  const res = await measureAll(ctx.v, { rates: [60, 30, 144] });
  ctx.log('場面@コマ/秒   区間          [着地区間] 数 最大 平均（cm）  [地面の近く] 数 最大 平均（cm）  カメラの加速度（m/秒²）');
  for (const [k, r] of Object.entries(res)) for (const [tag, s] of Object.entries(r.slip)) {
    const l = r.low[tag];
    ctx.log(`${k.padEnd(14)} ${tag.padEnd(13)} ${String(s.n).padStart(3)} ${String(s.max).padStart(6)} ${String(s.mean).padStart(6)}    ${String(l.n).padStart(3)} ${String(l.max).padStart(6)} ${String(l.mean).padStart(6)}    ${String(r.camAcc[tag] ?? '-').padStart(7)}   止まった体で進んだ足の周期 ${r.adv[tag] ?? 0}`);
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(res, null, 1));
}
