import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { LOOK, applyLookOverrides } from '../dist/valley/config.js';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { shotOverride } from '../dist/valley/shots.js';
const { SKY, SUNSET_GLSL, valleyAtmosphere, skyMaterial, skyChannel, cloudWarmth, sunGlow, sunDisc, skyRadiance, LEGACY_ATMOS } = await load('atmosphere.js');
const { MIST, mistOpacity, mistShape, mistSide, mistVillageFade, mistSites, buildRidges } = await load('ridges.js');
const smoothstep = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
const cos = degrees => Math.cos(degrees*Math.PI/180);
// Execute the actual scalar shader functions, with only GLSL declarations translated to JS.
const shader = new Function('smoothstep', SUNSET_GLSL.replace(/float\s+(\w+)\(/g,'function $1(')
  .replace(/\bfloat\s+(\w+)(?=\s*[,\)])/g,'$1').replace(/\bfloat\s+/g,'let ')
  .replace(/\b(max|min)\(/g,'Math.$1(')+'; return {skyChannel,cloudWarmth,sunGlow,sunDisc,skyRadiance};')(smoothstep);
const close = (a,b) => assert(Math.abs(a-b)<1e-7,`${a} differs from ${b}`);
const colours = a => ['horizon','mid','zenith','sunColor'].map(key => new THREE.Color(a[key]).toArray());
const sky = (a,deg,dot) => colours(a)[0].map((_,i) => skyChannel(...colours(a).map(c=>c[i]),deg,dot));
const dispose = g => g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});

test('sunset bands are warm towards the sun, blue at zenith, continuous and monotonic inside each band', () => {
  const a=valleyAtmosphere(), front=sky(a,SKY.rimDeg,1), back=sky(a,SKY.rimDeg,-1), zenith=sky(a,90,0);
  assert(front[0]>back[0] && front[1]>back[1]); assert(zenith[2]>zenith[0] && zenith[2]>zenith[1]);
  for(const [start,end] of [[SKY.rimDeg,SKY.rimDeg+SKY.lowTopDeg],[SKY.rimDeg+SKY.lowTopDeg,SKY.rimDeg+SKY.midTopDeg]]) {
    for(const side of [-1,0,.5,1]) {
      const first=sky(a,start,side),last=sky(a,end,side);let previous=first;
      for(let i=1;i<=1000;i++) {
        const c=sky(a,start+(end-start)*i/1000,side);
        for(let j=0;j<3;j++) {assert((c[j]-previous[j])*Math.sign(last[j]-first[j])>=-1e-12);assert(Math.abs(c[j]-previous[j])<.002);}
        previous=c;
      }
    }
  }
  for(const boundary of [SKY.rimDeg,SKY.rimDeg+SKY.lowTopDeg,SKY.rimDeg+SKY.midTopDeg]) {
    const left=sky(a,boundary-1e-4,1),right=sky(a,boundary+1e-4,1); left.forEach((x,i)=>assert(Math.abs(x-right[i])<1e-7));
  }
  assert.deepEqual(sky(a,90,1),sky(a,90,-1));
});

test('actual scalar GLSL matches the CPU colour, hemisphere warmth, glow, disc and radiance formulas', () => {
  const palette=colours(valleyAtmosphere());
  for(let elevation=-10;elevation<=90;elevation+=.5)for(let bearing=0;bearing<=180;bearing+=3) {
    const dot=cos(bearing);
    for(let i=0;i<3;i++)close(shader.skyChannel(...palette.map(c=>c[i]),elevation,dot),skyChannel(...palette.map(c=>c[i]),elevation,dot));
    close(shader.cloudWarmth(dot),cloudWarmth(dot));
  }
  for(let angle=0;angle<=180;angle+=.01) {
    const dot=cos(angle);close(shader.sunGlow(dot),sunGlow(dot));close(shader.sunDisc(dot),sunDisc(dot));
    for(const cover of [0,.5,1])close(shader.skyRadiance(.7,.8,dot,cover),skyRadiance(.7,.8,dot,cover));
  }
  const m=skyMaterial(valleyAtmosphere(),{value:0});assert(m.fragmentShader.includes(SUNSET_GLSL));
  assert.match(m.fragmentShader,/skyRadiance\(col.r/);assert.match(m.fragmentShader,/cloudWarmth\(azimuthDot\)/);m.dispose();
});

test('URL colour overrides reach real material uniforms after the actual main look wiring, including old sun', () => {
  const original={...LOOK}, main=source('main.js'), wiring=main.slice(main.indexOf('applyLookOverrides();'),main.indexOf('installFog();'));
  const apply=new Function('LOOK','ATMOS','applyLookOverrides',wiring);
  try {
    for(const flag of ['', '?sun=old'])for(const [key,param,hex] of [['horc','horizon','12f040'],['midc','mid','50e020'],['zenc','zenith','1080fa'],['sunc','sunColor','f04020']]) {
      for(const k of Object.keys(LOOK))delete LOOK[k];
      const a=valleyAtmosphere(flag), before=skyMaterial(a,{value:0});
      apply(LOOK,a,()=>applyLookOverrides('?lk='+key+':'+hex));
      const after=skyMaterial(a,{value:0});
      assert.equal(after.uniforms[param].value.getHexString(),hex);
      assert.notDeepEqual(after.uniforms[param].value.toArray(),before.uniforms[param].value.toArray());
      // A uniform declaration alone would not catch an unused horizon: check visible base sky samples too.
      const changed=sky(a,param==='zenith'?80:param==='mid'?SKY.rimDeg+SKY.lowTopDeg:SKY.rimDeg,1);
      const previous=sky({...a,[param]:'#808080'},param==='zenith'?80:param==='mid'?SKY.rimDeg+SKY.lowTopDeg:SKY.rimDeg,1);
      assert(changed.some((x,i)=>Math.abs(x-previous[i])>.001));
      before.dispose();after.dispose();
    }
  } finally {for(const k of Object.keys(LOOK))delete LOOK[k];Object.assign(LOOK,original);}
  const off=valleyAtmosphere('?sky2=0');for(const k of ['horizon','mid','zenith'])assert.equal(off[k],LEGACY_ATMOS[k]);
});

test('cloud undersides warm over the sunward hemisphere; wide halo survives an occluded disc without unbounded HDR', () => {
  for(const bearing of [0,30,50,75,89])assert(cloudWarmth(cos(bearing))>0);
  for(const bearing of [90,100,150,180])close(cloudWarmth(cos(bearing)),0);
  assert.equal(cloudWarmth(1),1);
  assert(SKY.haloRadiusDeg>=20 && SKY.haloRadiusDeg<=30);
  assert(sunGlow(cos(20))>0);close(sunGlow(cos(SKY.haloRadiusDeg)),0);
  let last=Infinity;
  for(let i=0;i<=300;i++) {const glow=sunGlow(cos(i/10));assert(glow<=last+1e-12);last=glow;}
  for(const base of [0,.3,1,10])for(const light of [0,.5,1,10])for(const visibility of [0,1])assert(skyRadiance(base,light,1,visibility)<=SKY.radianceMax);
  assert(skyRadiance(.3,1,cos(15),0)>.3);
  assert(skyRadiance(.3,1,1,1)>skyRadiance(.3,1,1,0));
});

test('mist is dense at range, clears the village and nearby camera, and has surface area from above', t => {
  const terrain=createTerrain(WORLD), sites=mistSites(WORLD,terrain), g=buildRidges();g.userData.configure({a:valleyAtmosphere()});
  const mist=g.getObjectByName('valley-mist'), p=mist.geometry.attributes.position, perBand=(MIST.segments+1)*(MIST.rows+1);
  assert.equal(sites.length,8);assert(MIST.farThickness>=100);
  // Seen in a real browser, bands of .25 to .5 everywhere read as white plastic sheets. Mist is now a thin veil at range
  // (.15 to .4), thinner still while it fades in between `near` and `far`, and never the dominant shape.
  for(const distance of [250,450])for(const n of [0,.5,1]) {
    const alpha=mistOpacity(1,1,n,distance,140,-100);assert(alpha>=.15 && alpha<=.4,`${distance} ${n} ${alpha}`);
  }
  for(const n of [0,.5,1]) { const mid=mistOpacity(1,1,n,(MIST.near+MIST.far)/2,140,-100); assert(mid>0 && mid<mistOpacity(1,1,n,250,140,-100)); }
  assert(MIST.opacityMax<=.4 && MIST.near>=40 && MIST.far>MIST.near);
  assert.equal(mistOpacity(1,1,1,10,140,-100),0);
  const village=WORLD.flats.find(f=>f.id==='village');
  for(let x=-village.hx;x<=village.hx;x+=4)for(let z=village.z-village.hz;z<=village.z+village.hz;z+=4)assert.equal(mistVillageFade(x,z),0);
  for(let band=3;band<11;band++) {
    const i=band*perBand+Math.floor(MIST.segments/2)*(MIST.rows+1);
    close(p.getZ(i+MIST.rows)-p.getZ(i),MIST.depth);
    assert(p.getY(i+MIST.rows/2)>p.getY(i));
  }
  const stats=g.userData.stats();assert.equal(stats.triangles,8512);assert.equal(stats.drawCalls,2);assert.equal(stats.vertices,6463);
  t.diagnostic(JSON.stringify({trianglesAdded:stats.triangles-8512,drawsAdded:stats.drawCalls-2,work:stats.work}));dispose(g);
});

test('concept has at least four terrain-visible fog bands, including all three gaps between ridges', t => {
  const terrain=createTerrain(WORLD), view=shotOverride('concept',terrain), camera=new THREE.PerspectiveCamera(view.fov,16/9,.15,2200);
  camera.position.set(...view.pos);camera.lookAt(...view.look);camera.updateMatrixWorld();
  const g=buildRidges();g.userData.configure({a:valleyAtmosphere()});g.updateMatrixWorld(true);
  let peakShape=0;for(let v=0;v<=1;v+=.01)peakShape=Math.max(peakShape,mistShape(v,.65));
  assert(peakShape>.4&&peakShape<=1);assert.equal(mistShape(0,.65),0);assert.equal(mistShape(.65,.65),0);assert.equal(mistSide(0),0);assert.equal(mistSide(.5),1);assert.equal(mistSide(1),0);
  const p=g.getObjectByName('valley-mist').geometry.attributes.position, per=(MIST.segments+1)*(MIST.rows+1), counts=[];
  const ray=new THREE.Raycaster(), eye=camera.position;
  for(let band=0;band<11;band++) {
    let visible=0;
    for(let i=6;i<59;i++) {
      const point=new THREE.Vector3().fromBufferAttribute(p,band*per+i*(MIST.rows+1)+2), screen=point.clone().project(camera);
      if(Math.abs(screen.x)>1 || Math.abs(screen.y)>1)continue;
      const dir=point.clone().sub(eye), distance=dir.length();dir.normalize();ray.set(eye,dir);ray.far=distance-1;
      if(ray.intersectObject(g.getObjectByName('ridge-layers')).length)continue;
      let blocked=false;
      // A 4m ray sample follows the same terrain as the game; this does not model tree occlusion or GPU blending.
      for(let d=4;d<Math.min(distance,850);d+=4) {
        const at=eye.clone().addScaledVector(dir,d);if(terrain.heightAt(at.x,at.z)>at.y){blocked=true;break;}
      }
      const edge=mistSide(i/MIST.segments);
      // The band is at its densest a little below its middle. Even with the lowest noisy top (.65) and the lowest density, it stays visible there.
      if(!blocked && mistOpacity(peakShape,edge,0,distance,point.x,point.z)>.1)visible++;
    }
    counts.push(visible);
  }
  assert(counts.filter(n=>n>0).length>=4,JSON.stringify(counts));
  assert(counts.slice(0,3).every(n=>n>0),`ridge gaps hidden: ${JSON.stringify(counts)}`);
  t.diagnostic(JSON.stringify({geometricallyVisibleBands:counts.filter(n=>n>0).length,visibleSamplesPerBand:counts}));dispose(g);
});

test('grade: the sunset finish is applied before the URL overrides, and the old sun keeps the old finish', () => {
  const g = valleyAtmosphere('').grade; assert.equal(g, SKY.grade); assert(Object.isFrozen(g));
  assert(g.exposure > 1 && g.exposure <= 1.15); assert(g.warmth > 1 && g.warmth <= 1.2); assert(g.saturation >= 1 && g.saturation <= 1.12);
  assert.equal(valleyAtmosphere('?sun=old').grade, null);
  const main = source('main.js'), apply = main.indexOf('if (ATMOS.grade) Object.assign(post.params, ATMOS.grade);'), override = main.indexOf("post.params[key] = LOOK[k]");
  assert(apply > 0 && override > apply, 'the grade is set first; ?lk= wins afterwards');
});
