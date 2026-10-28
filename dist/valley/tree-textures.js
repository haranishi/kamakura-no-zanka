// Procedural foliage only. Raw RGBA preserves neutral RGB underneath zero alpha.
import * as THREE from 'three';
const TAU = Math.PI * 2;
const hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
function canvas() { const c = document.createElement('canvas'); c.width = c.height = 256; return c; }
function upload(c, g) {
  const pixels = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i + 3] < 6) pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 190;
  const map = new THREE.DataTexture(pixels.data, c.width, c.height, THREE.RGBAFormat);
  map.flipY = true; map.colorSpace = THREE.SRGBColorSpace; map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter; map.needsUpdate = true; return map;
}
export function needleTexture() {
  const c = canvas(), g = c.getContext('2d'); g.lineCap = 'round';
  // Nine fans and their lateral twigs follow the old needleTexture's grammar.
  const twig = (x, y, a, len, seed) => {
    g.strokeStyle = '#687657'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    const n = Math.floor(len / 2.1);
    for (let j = 1; j < n; j++) for (const side of [-1, 1]) {
      const t = j / n, k = .55 + .45 * t, px = x + Math.cos(a) * len * t, py = y + Math.sin(a) * len * t;
      const ang = a + side * (.55 + hash(seed + j, 3) * .55), l = (7 + hash(seed + j, 4) * 6) * (1 - .25 * t);
      g.strokeStyle = `rgb(${Math.round(50 + 32 * k)},${Math.round(76 + 47 * k)},${Math.round(46 + 27 * k)})`; g.lineWidth = 1.9;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(ang) * l, py + Math.sin(ang) * l); g.stroke();
    }
  };
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i / 8 - .5) * 1.9, len = 150 + hash(i, 11) * 60;
    twig(128, 246, a, len, i * 37);
    for (let k = 0; k < 4; k++) for (const side of [-1, 1]) { const t = .28 + k * .17; twig(128 + Math.cos(a) * len * t, 246 + Math.sin(a) * len * t, a + side * .85, 34 + hash(i, k) * 28, i * 71 + k); }
  }
  return upload(c, g);
}
// Small software rasterizer keeps the actual RGBA testable without a browser canvas.
function raster() {
  const data = new Uint8ClampedArray(256 * 256 * 4);
  const pixel = (x,y,value,alpha=255) => {
    if(x<0 || x>=256 || y<0 || y>=256)return;
    const i=(Math.floor(y)*256+Math.floor(x))*4;
    data[i]=data[i+1]=data[i+2]=Math.round(value*255); data[i+3]=alpha;
  };
  const line = (x,y,xx,yy,value) => {
    const steps=Math.ceil(Math.hypot(xx-x,yy-y)*2);
    for(let i=0;i<=steps;i++)pixel(x+(xx-x)*i/steps,y+(yy-y)*i/steps,value);
  };
  const polygon = points => {
    const ys=points.map(p=>p[1]);
    for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<=Math.min(255,Math.ceil(Math.max(...ys)));y++) {
      const xs=[];
      for(let i=0,j=points.length-1;i<points.length;j=i++) {
        const a=points[i],b=points[j];
        if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      }
      xs.sort((a,b)=>a-b);
      for(let i=0;i+1<xs.length;i+=2)for(let x=Math.ceil(xs[i]);x<=xs[i+1];x++) {
        const edge=Math.min(x-xs[i],xs[i+1]-x);
        pixel(x,y,.66+.3*Math.exp(-edge/1.7));
      }
    }
  };
  const finish = () => {
    const map=upload({width:256,height:256},{getImageData:()=>({data})});
    map.wrapS=map.wrapT=THREE.RepeatWrapping; return map;
  };
  return {pixel,line,polygon,finish};
}
function broadTexture(maple) {
  const r=raster(), count=maple ? 26 : 56;
  // Dense overlapping interior beneath the individually drawn leaves. Its serrated
  // perimeter is broken into leaf-sized scallops, with transparent gaps outside.
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
    const a=Math.atan2(y-128,x-128), radius=Math.hypot((x-128)/122,(y-128)/124);
    const edge=.97+.035*Math.sin(a*37)+.025*Math.sin(a*61);
    if(radius<edge)r.pixel(x,y,.62+hash(Math.floor(x/7),Math.floor(y/8))*.16);
  }
  // Five twigs fan through the tile; leaves overlap at staggered nodes.
  for(let b=0;b<5;b++)r.line(128,240,30+b*49,20,.62);
  let drawn=0;
  for(let i=0;i<count;i++) {
    const b=i%5,row=Math.floor(i/5),rows=Math.ceil(count/5),t=.08+row/(rows-1)*.85;
    const bx=128+(30+b*49-128)*t, by=240-220*t;
    const side=row%2 ? -1 : 1, x=bx+side*(12+hash(i,1)*9), y=by-5;
    const width=maple ? 20+hash(i,3)*8 : 13+hash(i,3)*5;
    // A slender long lamina overlaps neighboring nodes while preserving small leaf width.
    const length=maple ? width*1.65 : width*2.7, angle=side*.5;
    r.line(bx,by,x,y,.63);
    const transform=(px,py)=>[x+px*Math.cos(angle)-py*Math.sin(angle), y+px*Math.sin(angle)+py*Math.cos(angle)];
    const points=[];
    for(let k=0;k<80;k++) {
      const a=-Math.PI/2+k/80*TAU;
      const lobes=maple ? .65+.35*Math.cos(5*(a+Math.PI/2)) : 1;
      const tooth=k%2 ? .94 : 1;
      points.push(transform(Math.cos(a)*width/2*lobes*tooth,Math.sin(a)*length/2*lobes*tooth));
    }
    r.polygon(points); drawn++;
    r.line(...transform(0,length*.38),...transform(0,-length*.42),.6);
    for(let k=0;k<5;k++)for(const s of [-1,1])r.line(...transform(0,length*(.3-k*.13)),...transform(s*width*.33,length*(.18-k*.13)),.62);
  }
  // flipY maps the bottom canvas rows to v≈0. Reserve the entire 0..0.06 square.
  for(let y=240;y<256;y++)for(let x=0;x<16;x++)r.pixel(x,y,.62);
  const map=r.finish(); map.userData.leafCount=drawn; return map;
}
export function needleFringeTexture() {
  const r=raster();
  for(let x=0;x<256;x++) {
    const end=150+Math.floor(hash(x,12)*106);
    for(let y=0;y<end;y++) {
      const solid=y<141, gap=!solid && hash(Math.floor(x/3),Math.floor(y/13))>.72;
      if(!gap)r.pixel(x,y,.55+hash(x,Math.floor(y/4))*.3,solid ? 255 : 220+Math.floor(hash(x,y)*35));
    }
  }
  return r.finish();
}
export function mapleLeafTexture() { return broadTexture(true); }
export function zelkovaLeafTexture() { return broadTexture(false); }
