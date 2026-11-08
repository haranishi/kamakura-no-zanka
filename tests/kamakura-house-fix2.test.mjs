import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {houseOpeningCell,houseOpeningFit,houseFoundationTop,houseWallSpans,houseIndexSeed,houseBroad,houseHash,HOUSE_BROAD_GLSL} from '../dist/valley/kamakura-house-texture.js';
import {houseBounds} from '../dist/valley/kamakura-houses.js';
import {parseGlb,readAccessor} from '../tools/lib/glb.mjs';
import {THREE,loadHouseMaterials} from './helpers/kamakura-house-view.mjs';

function safe(o,floor,eave,lo,hi){
 if(!o)return;
 assert(o.bottom>=Math.max(floor,lo)-1e-10);
 assert(o.bottom+o.height<=Math.min(eave,hi)-.10+1e-10);
 if(o.type==='door'){assert.equal(o.bottom,floor);assert(o.height>=1&&o.height<=1.75);}
 else {assert.equal(o.height,.5);assert(o.bottom-floor>=.65-1e-10);}
}
test('FX3 synthetic low/ordinary/tall walls fit openings without crossing sill or eave',()=>{
 let doors=0,windows=0;
 for(const height of [1.5,3,6])for(const scale of [.58,.82,1,1.39])for(let kind=0;kind<17;kind++)for(let id=0;id<16;id++)for(let face=0;face<4;face++)for(let cell=-3;cell<=3;cell++){
  const floor=.5*scale,eave=height*scale,seed=houseIndexSeed(id)[2];
  const o=houseOpeningFit(cell,kind,seed,face,-12,12,floor,eave,0,eave);
  safe(o,floor,eave,0,eave);
  if(o){if(o.type==='door')doors++;else windows++;}
 }
 assert(doors>0&&windows>0);
 // A 1.85m wall now admits both the shortened door and lowered window.
 const found=new Set();
 for(let cell=-3;cell<=3;cell++)for(let id=0;id<16;id++){
  const seed=houseIndexSeed(id)[2];
  for(let face=0;face<4;face++){const o=houseOpeningFit(cell,9,seed,face,-12,12,.55*.82,2.25*.82);if(o)found.add(o.type);}
 }
 assert(found.has('door')&&found.has('window'));
});

test('FX3 all private kinds retain openings against the F4 baseline and satisfy wall safety',
 {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有GLBの保持率検査を省略'},async t=>{
 const dir=process.env.KZ_WORLD_DIR,catalog=JSON.parse(await fs.readFile(path.join(dir,'houses.json')));
 const doc=parseGlb(await fs.readFile(path.join(dir,'houses_kit.glb'))),rows=[];
 let totalBaseline=0,totalRetained=0;
 for(const kind of catalog.kinds){
  const node=doc.json.nodes.find(n=>n.name.replace(/\.\d+$/,'')===kind.node),primitives=doc.json.meshes[node.mesh].primitives;
  const p=primitives.flatMap(p=>Array.from(readAccessor(doc,p.attributes.POSITION).array));
  const normals=primitives.flatMap(p=>Array.from(readAccessor(doc,p.attributes.NORMAL).array));
  const b=houseBounds(kind),eave=b.max[1]-(b.max[1]-b.min[1])*.28,foundation=houseFoundationTop(p,eave,normals),walls=new Map();
  for(const prim of primitives){
   const pos=readAccessor(doc,prim.attributes.POSITION).array,n=readAccessor(doc,prim.attributes.NORMAL).array;
   const indices=prim.indices===undefined?null:readAccessor(doc,prim.indices).array;
   const spans=houseWallSpans(pos,indices),heights=houseWallSpans(pos,indices,true);
   for(let i=0;i<pos.length/3;i++){
    if(Math.abs(n[i*3+1])>.05||spans[i*2+1]<=spans[i*2])continue;
    const axis=Math.abs(n[i*3+2])>Math.abs(n[i*3]),face=axis?(n[i*3+2]>0?0:1):(n[i*3]>0?2:3);
    const wall={face,min:spans[i*2],max:spans[i*2+1],lo:heights[i*2],hi:heights[i*2+1]};
    walls.set(JSON.stringify(wall),wall);
   }
  }
  let baseline=0,retained=0,added=0;const rejected={door:0,window:0},reasons={lowDoor:0,lowWindow:0,raisedWall:0},byScale={};
  for(const scale of [.58,.82,1,1.39]){
   let old=0,kept=0;
   for(const w of walls.values())for(let cell=-3;cell<=3;cell++)for(let id=0;id<16;id++){
    const seed=houseIndexSeed(id)[2],args=[cell,kind.index,seed,w.face,w.min*scale,w.max*scale];
    const candidate=houseOpeningCell(...args); // FIX3: the F4 baseline draws openings on every face.
    // F4 clipped at roof/stone/wall pixels: basement strips and upper towers did not
    // display candidates wholly outside their vertical spans, despite lacking a fit check.
    const oldBottom=candidate?.bottom+.5*scale;
    const visible=candidate&&Math.min(oldBottom+candidate.height,w.hi*scale,eave*scale)
      >Math.max(oldBottom,w.lo*scale,.5*scale)+1e-4;
    const o=houseOpeningFit(...args,foundation*scale,eave*scale,w.lo*scale,w.hi*scale);
    safe(o,foundation*scale,eave*scale,w.lo*scale,w.hi*scale);
    if(visible){old++;if(o)kept++;else {
      rejected[candidate.type]++;
      const avail=Math.min(eave,w.hi)*scale-.10-foundation*scale;
      const door=candidate.type==='door',height=door?Math.min(1.75,.9*avail):.5;
      const bottom=foundation*scale+(door?0:Math.min(candidate.bottom,Math.max(.65,.55*avail)));
      if(bottom<Math.max(foundation,w.lo)*scale)reasons.raisedWall++;
      else if(door&&height<1)reasons.lowDoor++;
      else reasons.lowWindow++;
     }}else if(o)added++;
   }
   baseline+=old;retained+=kept;byScale[scale]=old?+(kept/old).toFixed(6):null;
  }

  totalBaseline+=baseline;totalRetained+=retained;
  rows.push({kind:kind.index,retention:baseline?+(retained/baseline).toFixed(6):null,rejected,reasons,byScale});
 }
 const overallRetention=totalRetained/totalBaseline;
 t.diagnostic(JSON.stringify({openingRetentionByKind:rows,overallRetention}));
 // The baseline is the F4 rule (openings on every face). Unfit candidates (door under 1.0m, opening below its wall's own foot) are discarded
 // rather than clipped, so low-walled kinds lose some. Population >= .80, and no kind may lose almost everything.
 assert(overallRetention>=.80,`all kinds: retention ${overallRetention} < .80`);
 for(const row of rows)if(row.retention!==null)assert(row.retention>=.30,`kind ${row.kind}: retention ${row.retention} < .30`);
});

// Zero-padded 2D FFT measures every 0.05m lag without a quadratic image-pair loop.
function fft(re,im,inverse){
 const n=re.length;
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len*=2){
  const angle=(inverse?2:-2)*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);
  for(let at=0;at<n;at+=len){let ur=1,ui=0;for(let j=0;j<len/2;j++){
   const a=at+j,b=a+len/2,vr=re[b]*ur-im[b]*ui,vi=re[b]*ui+im[b]*ur;
   re[b]=re[a]-vr;im[b]=im[a]-vi;re[a]+=vr;im[a]+=vi;
   const next=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=next;
  }}
 }
 if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
function stats(fn){
 const n=256,size=512,re=new Float64Array(size*size),im=new Float64Array(size*size);
 let mean=0,variance=0,peak=0;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const v=fn(x*.05,y*.05);re[y*size+x]=v;mean+=v;peak=Math.max(peak,Math.abs(v));}
 mean/=n*n;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*size+x;re[i]-=mean;variance+=re[i]**2;}
 variance/=n*n;
 const stride=n+1,sum=new Float64Array(stride*stride),squares=new Float64Array(stride*stride);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const v=re[y*size+x],k=(y+1)*stride+x+1;
  sum[k]=v+sum[k-1]+sum[k-stride]-sum[k-stride-1];
  squares[k]=v*v+squares[k-1]+squares[k-stride]-squares[k-stride-1];
 }
 const rect=(table,x,y,w,h)=>table[(y+h)*stride+x+w]-table[y*stride+x+w]-table[(y+h)*stride+x]+table[y*stride+x];
 const a=new Float64Array(size),b=new Float64Array(size);
 const transform=inverse=>{for(const column of [false,true])for(let i=0;i<size;i++){
  for(let j=0;j<size;j++){const k=column?j*size+i:i*size+j;a[j]=re[k];b[j]=im[k];}
  fft(a,b,inverse);
  for(let j=0;j<size;j++){const k=column?j*size+i:i*size+j;re[k]=a[j];im[k]=b[j];}
 }};
 transform(false);for(let i=0;i<re.length;i++){re[i]=re[i]**2+im[i]**2;im[i]=0;}transform(true);
 let max=-1,lag=[];
 // Exclude the central smooth lobe (<3.3m); retain >=50% overlap in both axes.
 for(let y=-128;y<=128;y++)for(let x=0;x<=128;x++){
  if(Math.hypot(x,y)*.05<3.3)continue;
  const w=n-x,h=n-Math.abs(y),count=w*h,ay=Math.max(0,-y),by=Math.max(0,y);
  const sa=rect(sum,0,ay,w,h),sb=rect(sum,x,by,w,h);
  const va=rect(squares,0,ay,w,h)-sa*sa/count,vb=rect(squares,x,by,w,h)-sb*sb/count;
  const corr=(re[((y+size)%size)*size+x]-sa*sb/count)/Math.sqrt(va*vb);
  if(corr>max){max=corr;lag=[x*.05,y*.05];}
 }
 const adjacent=re[1]/((n-1)*n*variance);
 return {mean,sd:Math.sqrt(variance),peak,max,lag,adjacent};
}
test('FX4 256x256 metre samples retain contrast and remove remote autocorrelation peaks',t=>{
 const old=stats((u,v)=>.2*(.65*Math.sin(u*2.1+v*.9)+.35*Math.sin(v*3.1)));
 const full=stats(houseBroad),light=stats((u,v)=>houseBroad(u,v,true));
 let ensemble=0;
 for(let id=0;id<16;id++)for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const seed=houseIndexSeed(id);ensemble+=houseBroad(x*.05+seed[1]*17,y*.05+seed[2]*17);
 }
 ensemble/=16*256*256;
 assert(Math.abs(ensemble)<.01);
 t.diagnostic(JSON.stringify({shiftedHouseMean:ensemble}));
 t.diagnostic(JSON.stringify({broadStats:{old,full,light},correlationDomain:'3.3m <= lag; |dx|,|dy| <= 6.4m; overlap Pearson normalization'}));
 assert(Math.abs(full.mean)<.04);assert(full.peak<=.20);
 assert(full.sd>=old.sd*.75&&full.sd<=old.sd*1.25);
 assert(full.max<.5);assert(old.max>.9,'same metric must reject the old waves');
 assert(light.peak<=.20&&Math.abs(light.mean)<.05);
 // The literal all-nonzero-lags requirement is incompatible with smooth metre noise.
 assert(full.adjacent>.9);
});

test('FX4 emitted scalar GLSL agrees with JS for full/light noise; legacy waves stay outside parts',async()=>{
 const scalar=s=>s.replace(/\bfloat /g,'let ').replace(/\bvec2\(/g,'pair(');
 const noiseBody=HOUSE_BROAD_GLSL.match(/float houseValueNoise\(float u,float v\) \{([\s\S]*?)\n\}/)[1];
 const noise=new Function('u','v','floor','houseHash','pair',scalar(noiseBody));
 const valueNoise=(u,v)=>noise(u,v,Math.floor,p=>houseHash(...p),(x,y)=>[x,y]);
 for(const light of [false,true]){
  const body=HOUSE_BROAD_GLSL.match(/float houseBroad\(float u,float v\) \{([\s\S]*?)\n\}/)[1]
   .replace(/#ifdef HOUSE_LIGHT([\s\S]*?)#else([\s\S]*?)#endif/,(_,a,b)=>light?a:b);
  const broad=new Function('u','v','houseValueNoise','clamp',scalar(body));
  for(let i=0;i<1000;i++){
   const u=i*.137-42,v=i*.073-16;
   assert(Math.abs(broad(u,v,valueNoise,(v,a,b)=>Math.max(a,Math.min(b,v)))-houseBroad(u,v,light))<1e-12);
  }
 }
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 try{for(const parts of [false,true])for(const quality of ['standard','light'])for(const facilityRole of [null,2,3,5,8]){
  const m=createHouseMaterial(base,{parts,quality,facilityRole}),s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  try{m.onBeforeCompile(s);const code=s.fragmentShader;
   assert(code.includes('#if defined(HOUSE_PARTS) && !defined(HOUSE_BROAD_LEGACY)\n float broad=houseBroad(hPhotoUV.x,hPhotoUV.y);\n #else\n float broad = 0.20*(.65*sin(hp.x*2.1'));
   assert(code.indexOf('hPhotoUV+=vHouseRandom.yz*17.0')<code.indexOf('float broad=houseBroad'));
   assert(!/\b(dFdx|dFdy|fwidth)\(/.test(HOUSE_BROAD_GLSL));
  }finally{m.dispose();}
 }
 const legacy=createHouseMaterial(base,{parts:true,search:'?hbroad=0'});
 try{assert.equal(legacy.defines.HOUSE_BROAD_LEGACY,1);}finally{legacy.dispose();}
 }finally{base.dispose();}
});
