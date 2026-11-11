// One merged surface per LOD. Static vertices, no frame-time allocation or shader injection.
import * as THREE from '../vendor/three.module.min.js';
import { dressPalette } from './kamakura-town-dress-kit.js';
import { HOUSE_PALETTE } from './kamakura-house-texture.js';
import { facilityVisible, buddhaHallMode } from './kamakura-facilities.js';
import { RUIN_HALL, ruinHallGeometry } from './kamakura-ruin-hall.js';
import { addColliderCircles, buildColliders } from './collision.js';

// Register boxes in the existing grid without replacing its shared tree-circle index.
function addBoxes(col, boxes) {
  const own=buildColliders({bounds:col.bounds,extraBoxes:boxes}),owned=new Set(own.boxes);
  col.boxes.push(...own.boxes);
  for(const [key,list] of own.grid){if(col.grid.has(key))col.grid.get(key).push(...list);else col.grid.set(key,[...list]);}
  return ()=>{
    let write=0;for(const b of col.boxes)if(!owned.has(b))col.boxes[write++]=b;col.boxes.length=write;
    for(const key of own.grid.keys()){const next=col.grid.get(key)?.filter(b=>!owned.has(b));if(next?.length)col.grid.set(key,next);else col.grid.delete(key);}
  };
}
const landmark=Object.freeze({part:'buddha'});
export function createKamakuraRuinHall(context) {
  const params=new URLSearchParams(context.search);
  if(params.get('facilities')==='0')return null;
  const plans=context.facilities?.ruinHalls?.filter(p=>p.burnt?params.get('ruins')!=='0':!buddhaHallMode(context.search));
  if(!plans?.length)return null;
  const C=RUIN_HALL, debug=params.get('ruinhalldebug')==='1',group=new THREE.Group(),sets=[],release=[];
  group.name='kamakura-ruin-hall';
  const palette={post:HOUSE_PALETTE.oldWood.map((v,i)=>v*(1-C.oldGrey)+HOUSE_PALETTE.oldStone[i]*C.oldGrey),
    beam:HOUSE_PALETTE.oldWood.map((v,i)=>v*(1-C.oldGrey)+HOUSE_PALETTE.oldStone[i]*C.oldGrey),
    pile:HOUSE_PALETTE.oldWood,bark:HOUSE_PALETTE.oldThatch.map(v=>v*C.barkDark),
    rope:HOUSE_PALETTE.oldThatch,repair:HOUSE_PALETTE.wood.map((v,i)=>v*(1-C.newWarm)+HOUSE_PALETTE.roof[i]*C.newWarm),base:HOUSE_PALETTE.stone,soil:HOUSE_PALETTE.oldEarth};
  const debugPalette={post:C.debugPost,beam:C.debugBeam,pile:C.debugPile,bark:C.debugPile,repair:C.debugRepair,rope:C.debugRepair,base:C.debugBase,soil:C.debugBase};
  const m=debug?new THREE.MeshBasicMaterial({vertexColors:true,fog:false,toneMapped:false}):new THREE.MeshLambertMaterial({vertexColors:true});
  const burntPalette=dressPalette(),color=new THREE.Color();
  const charred={post:burntPalette.char,beam:burntPalette.char,base:burntPalette.stone,ash:burntPalette.ash,grass:burntPalette.crop};
  for(const plan of plans){
    const pair={plan,full:null,far:null,visible:false,distance:Infinity};
    for(const far of [false,true]){
      const data=ruinHallGeometry(plan,far),g=new THREE.BufferGeometry(),colors=new Float32Array(data.positions.length);
      for(let i=0;i<data.kinds.length;i++){
        const kind=data.kinds[i];
        if(debug)color.setHex(debugPalette[kind]??(kind==='grass'?C.debugRepair:C.debugBase));else color.setRGB(...(plan.burnt?charred:palette)[kind]).multiplyScalar(data.shades[i]);
        colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
      }
      g.setAttribute('position',new THREE.BufferAttribute(data.positions,3));g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,m);mesh.position.set(plan.box.x,0,plan.box.z);mesh.rotation.y=plan.box.rotY;mesh.updateMatrix();mesh.matrixAutoUpdate=false;
      mesh.name=far?'ruin-frame':'ruin-detail';mesh.castShadow=true;mesh.receiveShadow=true;mesh.visible=false;group.add(mesh);pair[far?'far':'full']=mesh;
    }
    sets.push(pair);
    if(context.colliders){release.push(addColliderCircles(context.colliders,plan.circles));release.push(addBoxes(context.colliders,plan.boxes));}
  }
  context.scene.add(group);
  let disposed=false,step=0,viewerX=0,viewerY=0,viewerZ=0,flying=false;
  function inspect(){
    // Diagnostics may allocate on demand; steady update never constructs a frustum.
    let frustum=null;
    if(context.camera){context.camera.updateMatrixWorld();group.updateMatrixWorld(true);frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(context.camera.projectionMatrix,context.camera.matrixWorldInverse));}
    let nearest=null,nearestDistance=Infinity,triangles=0,draws=0,standing=0,leaning=0,beams=0,piles=0;
    const burnt=plans.filter(p=>p.burnt).length;
    for(const s of sets){
      if(!s.full.visible&&!s.far.visible)continue;
      const mesh=s.full.visible?s.full:s.far;if(frustum&&!frustum.intersectsObject(mesh))continue;triangles+=mesh.geometry.attributes.position.count/3;draws++;
      standing+=s.plan.posts.length;leaning+=s.plan.posts.filter(p=>p.lean>0).length;beams+=s.plan.beams.length;if(s.full.visible)piles+=s.plan.piles.length;
      for(const p of s.plan.posts){
        const c=Math.cos(s.plan.box.rotY),sn=Math.sin(s.plan.box.rotY),x=s.plan.box.x+c*p.u+sn*p.v,z=s.plan.box.z-sn*p.u+c*p.v;
        const d=Math.hypot(x-viewerX,z-viewerZ,flying?p.y-viewerY:0);
        if(d<nearestDistance){nearestDistance=d;nearest={x,z};}
      }
    }
    const b=plans[0].box;
    return {mode:'open',burnt,hall:{width:b.w,depth:b.d,height:b.height},posts:{standing,leaning},beams,piles,triangles,draws,
      frontClear:plans[0].frontClear,distance:nearest?nearestDistance:null,bearing:nearest?(Math.atan2(nearest.x-viewerX,-(nearest.z-viewerZ))*180/Math.PI+360)%360:null};
  }
  if(params.get('debug')==='1')globalThis.__kzRuinHall=inspect;
  return {
    update(frame){
      if(disposed)return;
      viewerX=frame.pos.x;viewerY=frame.pos.y??0;viewerZ=frame.pos.z;flying=!!frame.flying;
      const detail=Math.min(context.quality==='light'?C.lightDistance:C.farDistance,step>=2?C.adaptDistance:Infinity);
      for(const s of sets){
        const b=s.plan.box,ground=b.minY??0;
        // Full 3D distance in flight, including altitude; range policy matches the Buddha.
        s.distance=Math.hypot(viewerX-b.x,viewerZ-b.z,flying?Math.max(0,viewerY-ground-b.height):0);
        s.visible=facilityVisible(landmark,b,frame.pos,context.quality,step,flying&&params.get('facfar')!=='0');
        s.full.visible=false;s.far.visible=false;
      }
      for(let slot=0;slot<C.burntDraws;slot++){
        let nearest=null;
        for(const s of sets)if(s.visible&&!s.full.visible&&!s.far.visible&&(!nearest||s.distance<nearest.distance))nearest=s;
        if(!nearest)break;
        nearest.full.visible=nearest.distance<detail;nearest.far.visible=!nearest.full.visible;
      }
    },
    setAdapt(next){step=next;for(const s of sets){s.full.castShadow=next<3;s.far.castShadow=next<3;}},
    dispose(){
      if(disposed)return;disposed=true;group.removeFromParent();for(const r of release)r();
      for(const s of sets){s.full.geometry.dispose();s.far.geometry.dispose();}m.dispose();
      if(globalThis.__kzRuinHall===inspect)delete globalThis.__kzRuinHall;
    }
  };
}
