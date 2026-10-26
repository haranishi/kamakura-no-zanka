// weapons.js — 太刀・薙刀・弓・矢・矢筒を手続きで作る（view層）。外部素材なし。
// 座標の約束：どの武器も、握り（右手・左手が触れる所）を原点に置き、長い軸を +Y に伸ばす。
// 向きと位置の最終合わせは、人物の手の骨（RightHand/LeftHand）へ付けるときの GRIP 表（config.js）で行う。
import * as THREE from 'three';

const TAU = Math.PI * 2;

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

// 柄巻き（菱巻き）：暗い藍の紐が斜めに交わり、間に鮫皮の白が見える。
function wrapTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#d8d3c4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a2233'; g.lineWidth = 15; g.lineCap = 'butt';
    for (let i = -2; i <= 3; i++) {
      g.beginPath(); g.moveTo(i * 32 - 16, -8); g.lineTo(i * 32 + 112, h + 8); g.stroke();
      g.beginPath(); g.moveTo(i * 32 + 112, -8); g.lineTo(i * 32 - 16, h + 8); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
    for (let i = -2; i <= 3; i++) {
      g.beginPath(); g.moveTo(i * 32 - 12, -8); g.lineTo(i * 32 + 116, h + 8); g.stroke();
    }
  }, [1, 5]);
}

function woodTexture(base = '#4a3524') {
  return canvasTexture(64, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(${20 + (i * 7) % 40},${14 + (i * 5) % 25},${8 + (i * 3) % 18},0.35)`;
      g.lineWidth = 1 + (i % 3);
      const x = (i * 29) % w;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + ((i * 13) % 7) - 3, h); g.stroke();
    }
  }, [1, 2]);
}

const steel = () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.92, roughness: 0.26, envMapIntensity: 1.2 });
const iron = c => new THREE.MeshStandardMaterial({ color: c, metalness: 0.75, roughness: 0.5 });
const lacquer = c => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.1, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15 });

// 反り（sori）つきの刃。エッジ側が凸、先（切先）は細く尖る。長さ L、ベースは y=0。
function bladeGeometry({ L = 0.72, sori = 0.018, w0 = 0.031, w1 = 0.022, th0 = 0.0075, th1 = 0.0052, n = 30 } = {}) {
  const pos = [], col = [];
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const taper = t > 0.93 ? Math.max(0, (1 - t) / 0.07) : 1;
    const w = (w0 + (w1 - w0) * t) * (0.18 + 0.82 * taper);
    const th = (th0 + (th1 - th0) * t) * taper;
    const y = t * L - (t > 0.93 ? 0 : 0);
    const bz = sori * 4 * t * (1 - t) + (t > 0.93 ? (t - 0.93) * -0.02 : 0);
    // 断面：棟(後ろ・平)2点、鎬の2点、刃先1点（x=厚み軸、z=幅軸。刃は +z）
    ring.push([
      [-th / 2, y, bz - w / 2], [th / 2, y, bz - w / 2], [th / 2, y, bz + w * 0.12], [0, y, bz + w / 2], [-th / 2, y, bz + w * 0.12],
    ]);
  }
  const light = [0.9, 0.93, 0.95], dark = [0.55, 0.58, 0.62];
  const quad = (a, b, c, d, color) => {
    for (const p of [a, b, c, a, c, d]) { pos.push(...p); col.push(...color); }
  };
  for (let i = 0; i < n; i++) {
    const r0 = ring[i], r1 = ring[i + 1];
    for (let k = 0; k < 5; k++) {
      const k2 = (k + 1) % 5;
      const edgeFace = k === 2 || k === 3; // 鎬から刃先の面は磨き（明るい）
      quad(r0[k], r1[k], r1[k2], r0[k2], edgeFace ? light : dark);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function curvedTube(L, sori, radius, segs = 24, radial = 12) {
  const pts = [];
  for (let i = 0; i <= segs; i++) { const t = i / segs; pts.push(new THREE.Vector3(0, t * L, sori * 4 * t * (1 - t))); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, radial, false);
}

function mesh(geometry, material, name) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true; m.receiveShadow = true; m.name = name || '';
  return m;
}

// 太刀：握り（柄の中心）が原点。drawn=抜いた姿（手に持つ）。hip=鞘と腰に残る柄（納刀のとき柄も見せる）
export function makeTachi() {
  const wrapMat = new THREE.MeshStandardMaterial({ map: wrapTexture(), roughness: 0.7, metalness: 0.0 });
  const drawn = new THREE.Group(); drawn.name = 'tachi-drawn';
  const tsuka = mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.25, 14), wrapMat, 'tsuka'); tsuka.scale.z = 0.86;
  const kashira = mesh(new THREE.CylinderGeometry(0.0185, 0.0165, 0.012, 14), iron(0x3a3a3c), 'kashira'); kashira.position.y = -0.131; kashira.scale.z = 0.86;
  const tsuba = mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.006, 28), iron(0x2a2a2e), 'tsuba'); tsuba.position.y = 0.128; tsuba.scale.z = 0.92;
  const habaki = mesh(new THREE.CylinderGeometry(0.0145, 0.0155, 0.032, 12), new THREE.MeshStandardMaterial({ color: 0xb89a4a, metalness: 0.85, roughness: 0.35 }), 'habaki'); habaki.position.y = 0.147; habaki.scale.z = 1.5;
  const blade = mesh(bladeGeometry(), steel(), 'blade'); blade.position.y = 0.16;
  drawn.add(tsuka, kashira, tsuba, habaki, blade);

  const hip = new THREE.Group(); hip.name = 'tachi-hip';
  const sayaMat = lacquer(0x33241a);          // 黒一色だと後ろ姿で「黒い棒」に見える。濃い茶の漆（照りで形が読める）
  const saya = mesh(curvedTube(0.78, 0.018, 0.0225), sayaMat, 'saya'); saya.position.y = 0.17;
  const koiguchi = mesh(new THREE.CylinderGeometry(0.025, 0.024, 0.04, 14), iron(0x4a3d2a), 'koiguchi'); koiguchi.position.y = 0.168;
  const hiltOnHip = new THREE.Group(); hiltOnHip.name = 'tachi-hip-hilt';
  for (const part of [tsuka, kashira, tsuba]) hiltOnHip.add(part.clone());
  hip.add(saya, koiguchi, hiltOnHip);
  return { drawn, hip, hiltOnHip };
}

// 薙刀：握り（柄の中ほど）が原点。刃は +Y 側の先。
export function makeNaginata() {
  const g = new THREE.Group(); g.name = 'naginata';
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture('#3d2b1c'), roughness: 0.75 });
  const shaft = mesh(new THREE.CylinderGeometry(0.0145, 0.0165, 1.55, 10), wood, 'shaft'); shaft.position.y = 0.45;
  const butt = mesh(new THREE.CylinderGeometry(0.0185, 0.0165, 0.04, 10), iron(0x303034), 'butt'); butt.position.y = -0.33;
  const collar = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10), iron(0x2a2a2e), 'collar'); collar.position.y = 1.19;
  const blade = mesh(bladeGeometry({ L: 0.5, sori: 0.05, w0: 0.045, w1: 0.05, th0: 0.009, th1: 0.007 }), steel(), 'blade'); blade.position.y = 1.2;
  g.add(shaft, butt, collar, blade);
  return g;
}

// 弓：握りが原点。全長1.7m。弦つき。弦の中点（矢をつがえる所）は userData.nock にある。
export function makeYumi() {
  const g = new THREE.Group(); g.name = 'yumi';
  const L = 1.7, grip = 0.6; // 握りは下から36%
  const pts = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28, y = t * L - grip;
    pts.push(new THREE.Vector3(0, y, -0.11 * Math.pow(Math.abs(2 * t - 1), 2.2) + (t < 0.36 ? 0 : 0)));
  }
  const bowMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.55, metalness: 0.0 });
  const limb = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0115, 8, false), bowMat, 'limb');
  const wrap = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.8 }), 'grip');
  const top = pts[pts.length - 1], bottom = pts[0];
  const stringMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.9 });
  const len = top.distanceTo(bottom);
  const string = mesh(new THREE.CylinderGeometry(0.0022, 0.0022, len, 4), stringMat, 'string');
  string.position.copy(top).add(bottom).multiplyScalar(0.5); string.position.z -= 0.0;
  g.add(limb, wrap, string);
  g.userData.nock = new THREE.Vector3(0, 0, -0.02);
  g.userData.stringTop = top.clone(); g.userData.stringBottom = bottom.clone();
  return g;
}

// 矢：原点は矢筈（弦にかける所）、+Y が矢じり。長さ0.82m。
export function makeArrow() {
  const g = new THREE.Group(); g.name = 'arrow';
  const wood = new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 0.7 });
  const shaft = mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.8, 6), wood, 'shaft'); shaft.position.y = 0.4;
  const head = mesh(new THREE.ConeGeometry(0.0085, 0.05, 5), iron(0x9aa0a4), 'head'); head.position.y = 0.825;
  const featherMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9, side: THREE.DoubleSide });
  for (let k = 0; k < 3; k++) {
    const f = mesh(new THREE.PlaneGeometry(0.014, 0.12), featherMat, 'feather'); f.position.y = 0.09;
    f.rotation.y = k * Math.PI / 3; f.castShadow = false; g.add(f);
  }
  g.add(shaft, head);
  return g;
}

// 矢筒（背中・弓兵用）：箱に矢羽を数本のぞかせる。原点は背の中心。
export function makeQuiver() {
  const g = new THREE.Group(); g.name = 'quiver';
  const box = mesh(new THREE.BoxGeometry(0.085, 0.5, 0.06), new THREE.MeshStandardMaterial({ map: woodTexture('#5a4630'), roughness: 0.7 }), 'box');
  box.rotation.z = 0.28;
  g.add(box);
  const featherMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9, side: THREE.DoubleSide });
  for (let k = 0; k < 6; k++) {
    const f = mesh(new THREE.PlaneGeometry(0.018, 0.13), featherMat, 'feather');
    f.position.set(-0.07 + (k % 3) * 0.022 - 0.0, 0.3 + (k % 2) * 0.03, ((k / 3) | 0) * 0.02 - 0.01); f.rotation.z = 0.28; f.castShadow = false; g.add(f);
  }
  return g;
}

export const WEAPON_KINDS = { tachi: makeTachi, naginata: makeNaginata, yumi: makeYumi, arrow: makeArrow, quiver: makeQuiver };
export { TAU };

// 縛めの縄（捕虜の胴と腕に巻く）。輪は骨のローカル Y 軸まわり。色は藁縄。
export function makeRopes() {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x6b4f2d, roughness: 0.95, metalness: 0 });     // 暗い藁色（明るい色は日なたで白い肋骨に見えた）
  for (const [y, r] of [[-0.1, 0.19], [-0.04, 0.2], [0.02, 0.2], [0.08, 0.19]]) {          // Spine01（胸）の位置を中心に。座っているときの胴は幅約0.4m
    const geo = new THREE.TorusGeometry(r, 0.01, 6, 28); geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.y = y; m.scale.z = 0.75; m.castShadow = true; g.add(m);
  }
  return g;
}
