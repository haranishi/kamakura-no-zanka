// 回帰：散らした大きな岩に当たりがある（岩の中へ入れない）。game.js が岩の当たりを登録し忘れると、Node の検査は通ったまま、
// 里の入口で主人公も敵も岩の中へ入って姿が見えなくなった。ここで、実際の当たりの表に岩があり、岩へ向かって歩くと止まることを確かめる。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-rock-colliders.mjs --strict
export default async function ({ v, freeze, start, step, call, log }) {
  await start('new'); await freeze(true); await step(30);
  const r = await v(`(() => {
    const g = __valley.game, seen = new Set(), rocks = [];
    for (const [, list] of g.col.grid) for (const o of list) if (o.type === 'circle' && o.id === 'rock' && !seen.has(o)) { seen.add(o); rocks.push({ x: o.x, z: o.z, r: o.r }); }
    rocks.sort((a, b) => b.r - a.r);
    return { count: rocks.length, list: rocks.filter(o => Math.abs(o.x) < 100 && Math.abs(o.z) < 100).slice(0, 10) };
  })()`);
  log('rock colliders', r.count);
  if (r.count < 20) throw new Error(`only ${r.count} rock colliders are registered (expected 20+)`);
  const walk = async (x, z, yaw) => {                                   // yaw の向きへ3秒歩く。動いた距離と、最後の位置を返す
    await call('teleport', x, z, yaw); await step(20);
    await call('key', 'KeyW', true); for (let i = 0; i < 18; i++) await step(10); await call('key', 'KeyW', false);
    const p = await v(`(() => { const h = __valley.game.hero.pos; return { x: h.x, z: h.z }; })()`);
    return { x: p.x, z: p.z, moved: Math.hypot(p.x - x, p.z - z) };
  };
  // 岩の東 4m から岩へ向かって歩く。比べるために、反対（東）へも歩いて、そこが歩ける場所だと確かめる（歩けない場所では検査にならない）
  for (const rock of r.list) {
    const sx = rock.x + rock.r + 4, free = await walk(sx, rock.z, -Math.PI / 2);
    if (free.moved < 3) continue;
    const hit = await walk(sx, rock.z, Math.PI / 2), d = Math.hypot(hit.x - rock.x, hit.z - rock.z);
    log('rock', rock.x.toFixed(1), rock.z.toFixed(1), 'r', rock.r.toFixed(2), '→ hero stopped', d.toFixed(2), 'm from the center after moving', hit.moved.toFixed(2), 'm');
    if (d < rock.r * 0.8) throw new Error(`the hero walked into the rock (${d.toFixed(2)} m from the center, r ${rock.r.toFixed(2)})`);
    return;
  }
  throw new Error('no rock had walkable ground beside it to test against');
}
