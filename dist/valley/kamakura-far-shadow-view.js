import { FAR_SHADOW as C, farShadowBox, farShadowTownBounds, createFarShadowGrid, farShadowStrength } from './kamakura-far-shadow.js';
import { facilityCastsShadow } from './kamakura-facilities.js';
import { createFarGroundField } from './kamakura-ground-density.js';
import { GROUND_FAR, groundFarRoadCoverage } from './kamakura-ground-far.js';

// THREE is injected by the existing post owner; no additional import-map or global resource owner.
export function createFarShadowView({ THREE, renderer, terrain, sources, sunDir, params, time, search, now }){
  let disposed=false,presented=false,field=null,wholeGrid=null,townGrid=null,phase=0;
  let proxyScene=null,material=null,houseProxy=null,townCamera=null,wholeCamera=null;
  let townTarget=null,wholeTarget=null,townBox=null,wholeBox=null,townBounds=null;
  let ready=false,work=0,preparationFrames=0,eye=null,bakeDraws=0,bakeTriangles=0,proxyDraws=0,proxyTriangles=0;
  const houseFarOn=new URLSearchParams(search).get('housefar')!=='0';
  const owned=new Set(),drawMs=[0,0],casters={terrainTriangles:0,canopyTriangles:0,houses:0,facilities:0};
  const uniforms={farTown:{value:null},farWhole:{value:null},farTownMatrix:{value:new THREE.Matrix4()},farWholeMatrix:{value:new THREE.Matrix4()},
    farTownBounds:{value:new THREE.Vector4()},farSun:{value:sunDir.clone().normalize()},
    farTint:{value:new THREE.Color(params.hemiSky??params.hazeCool??params.fogColor).multiplyScalar(C.tintGain)},
    farTexels:{value:new THREE.Vector2()},farRanges:{value:new THREE.Vector2()},farReady:{value:0},farFlying:{value:0},farStrength:{value:farShadowStrength(time)},farTaps:{value:9}};
  const mapStats=box=>box?{size:box.size,metersPerTexel:box.metersPerTexel,span:box.span,depthStep:box.depthStep}:null;
  function nearest(){
    if(!eye)return null;
    const bounds=terrain.bounds,x=Math.max(bounds.minX,Math.min(bounds.maxX,eye.x)),z=Math.max(bounds.minZ,Math.min(bounds.maxZ,eye.z));
    let distance=Math.hypot(x-eye.x,terrain.heightAt(x,z)-eye.y,z-eye.z),bearing=(Math.atan2(x-eye.x,eye.z-z)*180/Math.PI+360)%360;
    for(const box of sources.houses?.()?.boxes||[]){const d=Math.hypot(box.x-eye.x,terrain.heightAt(box.x,box.z)-eye.y,box.z-eye.z);
      if(d<distance){distance=d;bearing=(Math.atan2(box.x-eye.x,eye.z-box.z)*180/Math.PI+360)%360;}}
    return {distance,bearing};
  }
  const debug=()=>({ready,maps:{town:mapStats(townBox),whole:mapStats(wholeBox)},drawMs:drawMs.slice(),casters:{...casters},
    fade:{from:C.fadeFrom,to:C.fadeTo},strength:uniforms.farStrength.value,work,preparationFrames,
    triangles:proxyTriangles,draws:proxyDraws,
    mapBytes:(C.townSize**2+C.wholeSize**2)*3,bakeDraws,bakeTriangles,nearest:nearest()});
  if(new URLSearchParams(search).get('debug')==='1')globalThis.__kzFarShadow=debug;
  function ownGeometry(positions,indices,count){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));
    if(indices)g.setIndex(new THREE.BufferAttribute(indices,1));
    if(count!==undefined)g.setDrawRange(0,count);
    const submitted=count??indices?.length??positions.length/3;
    if(submitted>0){proxyDraws++;proxyTriangles+=submitted/3;}
    owned.add(g);return g;
  }
  function addGrid(job){
    const ground=new THREE.Mesh(ownGeometry(job.positions,job.indices,job.terrainCount),material),canopy=new THREE.Mesh(ownGeometry(job.canopy,job.canopyIndices,job.canopyCount),material);
    ground.frustumCulled=canopy.frustumCulled=false;proxyScene.add(ground,canopy);
    casters.terrainTriangles+=job.terrainCount/3;casters.canopyTriangles+=job.canopyCount/3;
    return ground;
  }
  function boxProxy(box,minY,maxY){
    const g=new THREE.BoxGeometry(box.w,Math.max(0,maxY-minY),box.d);owned.add(g);proxyDraws++;proxyTriangles+=g.index.count/3;
    const mesh=new THREE.Mesh(g,material);mesh.position.set(box.x,(minY+maxY)/2,box.z);mesh.rotation.y=box.rotY||0;mesh.updateMatrixWorld();proxyScene.add(mesh);
  }
  function cameraFor(box,matrix){
    const camera=new THREE.OrthographicCamera(box.left,box.left+box.span,box.bottom+box.span,box.bottom,box.near,box.far);
    camera.up.fromArray(box.up);camera.position.fromArray(box.L).multiplyScalar(box.origin);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const bias=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
    matrix.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);return camera;
  }
  function depthTarget(size){
    // DEPTH_COMPONENT16 + an R8 colour attachment: 60 MiB total, no mipmaps/MSAA.
    // A normal RGBA colour attachment would exceed the 80 MB total even with 16-bit depth.
    const depth=new THREE.DepthTexture(size,size,THREE.UnsignedShortType);depth.minFilter=depth.magFilter=THREE.NearestFilter;
    const target=new THREE.WebGLRenderTarget(size,size,{format:THREE.RedFormat,type:THREE.UnsignedByteType,depthTexture:depth,depthBuffer:true,stencilBuffer:false});
    target.texture.internalFormat='R8';target.texture.generateMipmaps=false;return target;
  }
  function releaseProxies(){
    proxyScene?.clear();proxyScene=null;proxyDraws=0;proxyTriangles=0;
    for(const g of owned)g.dispose();owned.clear();material?.dispose();material=null;
    houseProxy=null;field=null;wholeGrid=null;townGrid=null;townCamera=null;wholeCamera=null;
  }
  function drawMap(target,camera,index){
    const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,start=now();
    try{renderer.autoClear=true;renderer.setRenderTarget(target);renderer.render(proxyScene,camera);bakeDraws+=proxyDraws;bakeTriangles+=proxyTriangles;}
    finally{renderer.setRenderTarget(previous);renderer.autoClear=autoClear;drawMs[index]=now()-start;}
  }
  function prepareCasters(world){
    const houses=sources.houses?.(),far=world.getObjectByName('house-far');
    // The far geometry's bounding sphere is published only after the last construction slice.
    if(houses&&!far?.geometry.boundingSphere&&houseFarOn)return false;
    if(far?.geometry.boundingSphere){
      const source=far.geometry.attributes.position,g=ownGeometry(source.array.slice());
      houseProxy=new THREE.Mesh(g,material);houseProxy.frustumCulled=false;proxyScene.add(houseProxy);
      casters.houses=houses?.boxes?.length??0;
    }else if(houses){
      for(const box of houses.boxes){const y=terrain.heightAt(box.x,box.z);boxProxy(box,y,y+box.height);casters.houses++;}
    }
    for(const r of sources.facilities?.()?.records||[]){
      if(!r.meshes.some(m=>m.parent))continue;
      // Only solid buildings cast. A fence or a cloister is recorded as one box around its whole ring: as a caster it laid a
      // block of shade over the entire precinct (seen in the shadow diagnostic as a white rectangle at the shrine).
      if(r.node&&!facilityCastsShadow(r.node))continue;
      boxProxy(r.bounds,r.bounds.minY,r.bounds.maxY);casters.facilities++;
    }
    return true;
  }
  function advance(world){
    if(disposed||ready)return;
    if(!presented){presented=true;return;}
    preparationFrames++;
    const start=now();
    // Phase transitions return to the next animation frame; the two GPU renders can never share one frame.
    if(phase===0){field=createFarGroundField(sources.data,GROUND_FAR,groundFarRoadCoverage);phase=1;return;}
    if(phase===1){
      for(let n=0;n<C.frameWork&&!field.done;n+=C.batch){const before=field.work;field.step(C.batch);work+=field.work-before;if(now()-start>=C.sliceMs)break;}
      if(field.done){townBounds=farShadowTownBounds(terrain,sources.data);wholeGrid=createFarShadowGrid(terrain,terrain.bounds,C.wholeCell,field,townBounds);phase=2;}return;
    }
    const job=phase===2?wholeGrid:phase===3?townGrid:null;
    if(job){
      for(let n=0;n<C.frameWork&&!job.ready;n+=C.batch){const before=job.work;job.step(C.batch);work+=job.work-before;if(now()-start>=C.sliceMs)break;}
      if(!job.ready)return;
      if(phase===2){
        // Terrain sampling outside the map must not clamp edge heights into phantom walls.
        const clipped={minX:Math.max(townBounds.minX,terrain.bounds.minX),maxX:Math.min(townBounds.maxX,terrain.bounds.maxX),minZ:Math.max(townBounds.minZ,terrain.bounds.minZ),maxZ:Math.min(townBounds.maxZ,terrain.bounds.maxZ)};
        townGrid=createFarShadowGrid(terrain,clipped,C.townCell,field);phase=3;return;}
      proxyScene=new THREE.Scene();material=new THREE.MeshBasicMaterial({colorWrite:false,side:THREE.DoubleSide});
      const sun=[sunDir.x,sunDir.y,sunDir.z];
      const minY=Math.min(wholeGrid.minY,(terrain.meta?.height?.min_m??wholeGrid.minY)*(terrain.vscale??1));
      const maxY=Math.max(wholeGrid.maxY,(terrain.meta?.height?.max_m??wholeGrid.maxY)*(terrain.vscale??1));
      wholeBox=farShadowBox(terrain.bounds,minY,maxY,sun,C.wholeSize);
      townBox=farShadowBox(townBounds,minY,maxY,sun,C.townSize);
      // Keep the entire upstream terrain depth range, not just town-local occluders.
      townBox.origin=wholeBox.origin;townBox.near=wholeBox.near;townBox.far=wholeBox.far;
      townBox.depthStep=(townBox.far-townBox.near)/65535;
      if(townBox.depthStep>townBox.metersPerTexel*C.precisionShare)throw new RangeError('町の16bit影深度精度が不足しています');
      townCamera=cameraFor(townBox,uniforms.farTownMatrix.value);wholeCamera=cameraFor(wholeBox,uniforms.farWholeMatrix.value);
      addGrid(wholeGrid);addGrid(townGrid);phase=4;return;
    }
    if(phase===4){if(prepareCasters(world))phase=5;return;}
    if(phase===5){townTarget=depthTarget(C.townSize);drawMap(townTarget,townCamera,0);phase=6;return;}
    if(phase===6){
      // The finer town proxies are useful in both maps and avoid a canopy seam at the hand-off.
      wholeTarget=depthTarget(C.wholeSize);drawMap(wholeTarget,wholeCamera,1);
      uniforms.farTown.value=townTarget.depthTexture;uniforms.farWhole.value=wholeTarget.depthTexture;
      uniforms.farTownBounds.value.set(townBounds.minX,townBounds.minZ,townBounds.maxX,townBounds.maxZ);
      uniforms.farTexels.value.set(townBox.metersPerTexel,wholeBox.metersPerTexel);
      uniforms.farRanges.value.set(townBox.far-townBox.near,wholeBox.far-wholeBox.near);
      ready=true;uniforms.farReady.value=1;releaseProxies();phase=7;
    }
  }
  function dispose(){
    if(disposed)return;disposed=true;ready=false;uniforms.farReady.value=0;releaseProxies();
    for(const target of [townTarget,wholeTarget])if(target){const depth=target.depthTexture;target.depthTexture=null;target.dispose();depth.dispose();}
    townTarget=wholeTarget=null;uniforms.farTown.value=uniforms.farWhole.value=null;
    if(globalThis.__kzFarShadow===debug)delete globalThis.__kzFarShadow;
  }
  return {uniforms,advance,dispose,get ready(){return ready;},update(view){eye=view.position;uniforms.farFlying.value=sources.flying?.()?1:0;},setAdapt(step){uniforms.farTaps.value=step===1?4:9;}};
}
