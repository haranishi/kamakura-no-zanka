import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as THREE from '../dist/vendor/three.module.min.js';
import {prepareTownDress,TOWN_DRESS as C} from '../dist/valley/kamakura-town-dress.js';
import {townDressGeometry} from '../dist/valley/kamakura-town-dress-kit.js';
import {townBoxesOverlap} from '../dist/valley/kamakura-town-fill.js';
import {houseBox} from '../dist/valley/kamakura-houses.js';
import {buildColliders,moveActor} from '../dist/valley/collision.js';
import {createKamakuraTownDress,DRESS_VERTEX_PARS,DRESS_BEGIN_VERTEX,DRESS_PIXEL_VERTEX} from '../dist/valley/kamakura-town-dress-view.js';
const bounds={minX:-20000,maxX:20000,minZ:-20000,maxZ:20000};
const terrain={bounds,heightAt:()=>0,waterAt:()=>0,slopeAt:()=>0,walkable:()=>true};
const at=(p,u,v)=>({x:p.x+Math.cos(p.yaw)*u+Math.sin(p.yaw)*v,z:p.z-Math.sin(p.yaw)*u+Math.cos(p.yaw)*v});
function fixture(n=600,spacing=22,yaw=0){
  const plots=Array.from({length:n},(_,i)=>({...at({x:0,z:0,yaw},(i-n/2)*spacing,14),width:16,depth:22,yaw,state:'house',lane:'lane'}));
  const a=at({x:0,z:0,yaw},-18000,0),b=at({x:0,z:0,yaw},18000,0);
  return {data:{townPlots:plots,lanes:{lane:{width_m:3.2,xyz_m:[[a.x,-a.z,0],[b.x,-b.z,0]]}}},terrain};
}
function houses(context,definitions){
  const kinds=new Map(),instances=[];
  for(const [i,b] of definitions.entries()){
    kinds.set(i,{bbox_min:[-b.w/2,-b.d/2,0],bbox_max:[b.w/2,b.d/2,4]});
    const yaw=b.yaw??0,c=Math.cos(yaw),s=Math.sin(yaw);
    instances.push({kind:i,matrix:[c,0,-s,0,0,1,0,0,s,0,c,0,b.x,0,b.z,1]});
  }
  context.data.houses={kinds,instances};return instances.map(p=>houseBox(kinds.get(p.kind),p.matrix));
}
const fences=r=>r.items.filter(p=>C.fenceHeights[p.kind]);
test('townlife: house 55/25, garden 70% with 40% full returns; one material and continuous inset corners',t=>{
  for(const state of ['house','garden']){
    const c=fixture(1000);for(const p of c.data.townPlots)p.state=state;
    const r=prepareTownDress(c),byPlot=new Map();for(const p of fences(r)){if(!byPlot.has(p.plot))byPlot.set(p.plot,[]);byPlot.get(p.plot).push(p);}
    if(state==='house'){assert(Math.abs(r.fences.enclosed/1000-.55)<.04);assert(Math.abs(r.fences.half/1000-.25)<.04);}
    else{assert(Math.abs(r.fences.plots/1000-.7)<.04);assert(Math.abs(r.fences.enclosed/r.fences.plots-.4)<.05);}
    for(const list of byPlot.values()){
      assert.equal(new Set(list.map(p=>p.kind)).size,1);
      if(list[0].mode!=='enclosed')continue;
      assert(list.length>=5);assert(list.every(p=>p.w<=C.fenceSpan+1e-7));
      const sides=list.filter(p=>p.edge==='side'),back=list.find(p=>p.edge==='back');
      for(const side of sides)for(const end of [-1,1]){
        const corner=at({x:side.x,z:side.z,yaw:side.yaw},end*side.w/2,0);
        const horizontal=list.filter(p=>p!==side);
        const nearest=Math.min(...horizontal.flatMap(p=>[-1,1].map(sign=>{const q=at({x:p.x,z:p.z,yaw:p.yaw},sign*p.w/2,0);return Math.hypot(q.x-corner.x,q.z-corner.z);})));assert(nearest<=.3);
      }
      assert(back);
      for(const p of list)for(const u of [-p.w/2,p.w/2])for(const v of [-p.d/2,p.d/2]){
        const q=at(p,u,v),plot=c.data.townPlots[p.plot];assert(Math.abs(q.x-plot.x)<=plot.width/2-C.inset+1e-7);assert(Math.abs(q.z-plot.z)<=plot.depth/2-C.inset+1e-7);
      }
    }
    t.diagnostic(JSON.stringify({state,enclosedRatio:r.fences.enclosed/1000,halfRatio:r.fences.half/1000,segments:r.fences.segments,work:r.work}));
  }
});
test('townlife: rotated house facade (+z), gate width and real movement from lane into enclosure and back',()=>{
  for(const yaw of [0,.43,-1.2]){
    const c=fixture(60,30,yaw);
    houses(c,c.data.townPlots.map(p=>({...p,w:6,d:7,yaw:yaw+Math.PI})));
    const r=prepareTownDress(c),col=buildColliders({bounds:terrain.bounds,extraBoxes:r.boxes});
    let checked=0;
    for(const p of fences(r))if(p.edge==='front'&&p.mode==='enclosed'){
      const plot=c.data.townPlots[p.plot],gate=p.gate;
      const front=fences(r).filter(q=>q.plot===p.plot&&q.edge==='front');assert(front.length>=2);
      assert(Math.abs(front.reduce((sum,p)=>sum+p.w,0)-(plot.width-2*C.inset-C.gate))<1e-7);
      const start={...at(plot,gate,-14),y:0},end={...at(plot,gate,-6),y:0};
      const moved=moveActor(col,terrain,start,end.x-start.x,end.z-start.z,.3);assert(Math.hypot(moved.x-end.x,moved.z-end.z)<1e-6);
      const back=moveActor(col,terrain,{...moved,y:0},start.x-moved.x,start.z-moved.z,.3);assert(Math.hypot(back.x-start.x,back.z-start.z)<1e-6);checked++;
    }
    assert(checked>10);
  }
});
test('townlife: intersecting own and neighbouring rotated houses clip only unsafe intervals, leaving 0.6m clearance',()=>{
  const c=fixture(60,30),base=prepareTownDress(c),sample=fences(base).find(p=>p.mode==='enclosed'&&p.edge==='side'),plot=c.data.townPlots[sample.plot];
  const boxes=houses(c,[{x:sample.x,z:plot.z,w:3,d:4,yaw:.27},{x:plot.x-7,z:plot.z+5,w:3,d:3,yaw:-.4}]);
  const r=prepareTownDress(c);assert(r.skipped.house>0);
  const retained=fences(r).filter(p=>p.plot===sample.plot);assert(retained.length>=4);
  for(const p of fences(r))for(const b of boxes)assert(!townBoxesOverlap({...p,rotY:p.yaw},b,C.houseClearance-1e-7));
  assert.deepEqual(r,prepareTownDress(c));
});
test('townlife: adjacent plots retain exactly one shared side, independent of rotation; separate lane sides stay separate',()=>{
  for(const yaw of [0,.4]){
    const c=fixture(100,16,yaw),r=prepareTownDress(c),all=fences(r);
    assert(r.skipped.shared>0);
    for(let i=0;i<c.data.townPlots.length-1;i++){
      const a=c.data.townPlots[i],b=c.data.townPlots[i+1],mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
      const sides=all.filter(p=>(p.plot===i||p.plot===i+1)&&p.edge==='side'&&Math.abs((p.x-mid.x)*Math.cos(yaw)-(p.z-mid.z)*Math.sin(yaw))<1);
      for(let j=0;j<sides.length;j++)for(let k=j+1;k<sides.length;k++){
        if(sides[j].plot===sides[k].plot)continue;
        const project=p=>(p.x-mid.x)*Math.sin(yaw)+(p.z-mid.z)*Math.cos(yaw);
        assert(Math.abs(project(sides[j])-project(sides[k]))>=(sides[j].w+sides[k].w)/2-1e-7,'duplicate shared interval');
      }
    }
  }
});
test('townlife: far fences have a top face for overhead views and remain within the original frame budgets',()=>{
  for(const kind of ['bamboo','board','log']){
    const g=townDressGeometry(kind,true),p=g.attributes.position;let up=0;
    for(let i=0;i<p.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);if(b.sub(a).cross(c.sub(a)).y>0)up++;}
    assert(up>=2);g.dispose();
  }
  const c=fixture(1200,16),camera=new THREE.PerspectiveCamera(40,1,.1,10000),scene=new THREE.Scene();camera.position.set(0,5,14);
  const v=createKamakuraTownDress({...c,camera,scene,search:'?debug=1'}),frame={pos:camera.position};
  for(let i=0;i<2000;i++){v.update(frame);if(globalThis.__kzTownDress().ready)break;}
  const info=globalThis.__kzTownDress();assert(info.ready);assert(info.drawn.nearTriangles<=90000);assert(info.drawn.farTriangles<=30000);assert(info.drawn.draws<=16);assert(info.fences.enclosed>0&&info.fences.half>0);v.dispose();
});

// The selection (a heap over thousands of fence segments, megabytes of instance data) is rebuilt only after the eye has moved
// TOWN_DRESS.refresh metres or the quality step changed. Without the rule every frame re-sends every buffer: this check then fails
// on the first still frame.
test('steady frames reuse the selection; a move of the eye or a quality step rebuilds it',()=>{
  const c=fixture(1200,16),camera=new THREE.PerspectiveCamera(40,1,.1,10000),scene=new THREE.Scene();camera.position.set(0,5,14);
  const v=createKamakuraTownDress({...c,camera,scene,search:'?debug=1'}),frame={pos:camera.position,time:0};
  try{
    for(let i=0;i<2000;i++){v.update(frame);if(globalThis.__kzTownDress().ready)break;}
    v.update(frame);
    const meshes=[];scene.traverse(o=>{if(o.isInstancedMesh&&o.count>0)meshes.push(o);});assert(meshes.length>0);
    const versions=()=>meshes.map(m=>m.instanceMatrix.version+m.geometry.attributes.aDressGround.version).join(',');
    const still=versions(),drawn=JSON.stringify(globalThis.__kzTownDress().drawn);
    for(let i=1;i<=120;i++){frame.time=i/60;v.update(frame);}                               // two seconds standing still
    assert.equal(versions(),still,'a still frame re-sent instance data');
    camera.position.x+=C.refresh*.6;v.update(frame);assert.equal(versions(),still,'a move shorter than the refresh distance rebuilt the selection');
    assert.equal(JSON.stringify(globalThis.__kzTownDress().drawn),drawn);
    camera.position.x+=C.refresh*.6;v.update(frame);const moved=versions();assert.notEqual(moved,still,'a move past the refresh distance did not rebuild');
    v.setAdapt(2);v.update(frame);assert.notEqual(versions(),moved,'a quality step did not rebuild');
  }finally{v.dispose();}
});

test('townlife GLSL compiler: fence thickness expansion, all shared dress variables, float types and projection inputs',t=>{
  const available=spawnSync('glslc',['--version'],{encoding:'utf8'});if(available.error?.code==='ENOENT')return t.skip('glslc unavailable');assert.equal(available.status,0);
  const dir=mkdtempSync(join(tmpdir(),'townlife-glsl-'));
  try{
    const code=`#version 310 es
precision highp float; precision highp int;
#define attribute in
#define varying out
uniform mat4 modelMatrix, instanceMatrix, modelViewMatrix, projectionMatrix, viewMatrix;
in vec3 position;
${DRESS_VERTEX_PARS}
void main(){
${DRESS_BEGIN_VERTEX}
gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(transformed,1.0);
${DRESS_PIXEL_VERTEX}
}`;
    const file=join(dir,'fence.vert');writeFileSync(file,code);
    const result=spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',join(dir,'fence.spv')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
