// View only: self-contained GLB, one static mesh per node/material, CPU placement once.
import * as THREE from 'three';
import { createHouseTextures, createHouseMaterial } from './kamakura-house-materials.js';
import { facilityMaterialRole, facilityPartRole, facilityTimberWeights, facilityInterior, houseInteriorOpeningFrame, houseHallWallFrames } from './kamakura-house-texture.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { facilityPlacement, facilityFootprint, facilitySolid, facilityExcludesTrees, facilityCastsShadow, facilityVisible, FACILITY_HELD_BACK, buddhaHallMode, enclosingBuddhaHalls, prepareRuinHall, prepareBurntHall, ruinsEnabled, RUIN_HALL } from './kamakura-facilities.js';
export async function buildKamakuraFacilities(facilities, terrain, scene, quality='standard', { showHeldBack = false, search = globalThis.location?.search ?? '' } = {}) {
  const dv=new DataView(facilities.kit);
  if(dv.byteLength<20 || dv.getUint32(0,true)!==0x46546c67 || dv.getUint32(4,true)!==2 || dv.getUint32(8,true)!==dv.byteLength || dv.getUint32(16,true)!==0x4e4f534a) throw new Error('施設のGLBが不正です');
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(facilities.kit,20,dv.getUint32(12,true))));
  if(json.buffers?.some(b=>b.uri) || json.images?.length || json.textures?.length || json.extensionsUsed?.length || json.extensionsRequired?.length) throw new Error('施設のGLBは単色の自己完結形式が必要です');
  const gltf=await new GLTFLoader().parseAsync(facilities.kit,'');
  const geometries=new Set(), materials=new Set(), records=[], boxes=[], exclusionBoxes=[], ruinHalls=[];
  let hallDimensions=null;
  const hallInspect=()=>({mode:'hall',burnt:0,hall:hallDimensions,posts:{standing:0,leaning:0},beams:0,piles:0,triangles:0,draws:0,frontClear:null,distance:null,bearing:null});
  const farEnabled=new URLSearchParams(search).get('facfar')!=='0',stats={flying:false,shown:0};
  scene.userData.kzHouseFarFacilities=stats;
  let disposed=false,step=0,shadows=true,texture=null;
  const surfaceCache=new Map();
  // W2c-9r1 house: anonymous facility colors -> catalog roles and node-height frames.
  const partsEnabled=new URLSearchParams(search).get('hparts')!=='0';
  const relief=new URLSearchParams(search).get('hrelief')!=='0';
  const hallEnabled=partsEnabled && new URLSearchParams(search).get('hall7')!=='0' && new URLSearchParams(search).get('facility7')!=='0';
  // W2c-9g2: facility surfaces use the house atlas; ftex=0 retains the original PBR.
  function surface(base, hint, node, floor, top, interiorFrame) {
    if(!texture)return base;
    if(Array.isArray(base))return base.map(m=>surface(m,hint,node,floor,top,interiorFrame));
    // W2c-9g3: mesh hints identify walls/roofs when the shared material is anonymous.
    const role=partsEnabled?facilityPartRole(node.part,base.name+' '+hint):facilityMaterialRole(base.name) || facilityMaterialRole(hint), key=`${base.uuid}:${role}:${partsEnabled?node.node:''}`;
    if(!surfaceCache.has(key)){const m=createHouseMaterial(base,{search,texture,quality,environment:scene.environment,facilityRole:role,parts:partsEnabled,relief,floor,top,interiorFrame,eave:partsEnabled?top-(top-floor)*.28:3});surfaceCache.set(key,m);materials.add(m);}
    return surfaceCache.get(key);
  }
  const group=new THREE.Group();group.name='kamakura-facilities';
  function dispose() {if(disposed)return;disposed=true;if(globalThis.__kzRuinHall===hallInspect)delete globalThis.__kzRuinHall;if(scene.userData.kzHouseFarFacilities===stats)delete scene.userData.kzHouseFarFacilities;group.removeFromParent();texture?.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
  gltf.scene.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of [].concat(o.material))materials.add(m);}});
  try {
    // Loader may keep an unused base material when it clones one for flat normals.
    for(const m of await gltf.parser.getDependencies('material'))materials.add(m);
    if(new URLSearchParams(search).get('ftex')!=='0')texture=await createHouseTextures({quality,parts:partsEnabled});
    const byName=new Map();
    gltf.scene.traverse(o=>{const index=gltf.parser.associations.get(o)?.nodes;if(index!==undefined){const name=json.nodes[index].name;if(byName.has(name))throw new Error('施設の節が重複しています');byName.set(name,o);}});
    const meshNodes=json.nodes.filter(n=>n.mesh!==undefined);
    if(meshNodes.length!==facilities.nodes.length || meshNodes.some(n=>!facilities.nodes.some(f=>f.node===n.name))) throw new Error('施設の節の数が一致しません');
    gltf.scene.updateMatrixWorld(true);
    const hasBurnt=ruinsEnabled(search)&&facilities.nodes.some(n=>n.part==='hall'&&n.ruin==='burnt');
    const footprints=buddhaHallMode(search)&&!hasBurnt?[]:facilities.nodes.map(n=>{
      const node=byName.get(n.node);if(!node)throw new Error('施設に対応する節がありません');
      const positions=[];let triangles=0,meshes=0;
      node.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position,v=new THREE.Vector3();meshes++;triangles+=(o.geometry.index?.count??p.count)/3;
        for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);positions.push(v.x,v.y,v.z);}});
      return {node:n,triangles,meshes,finite:positions.every(Number.isFinite),bounds:facilityFootprint(n,positions,false),base:n.part==='hall'?facilityFootprint(n,positions):null};
    });
    const buddhaHalls=enclosingBuddhaHalls(footprints),removed=buddhaHallMode(search)?[]:[...buddhaHalls];
    if(hasBurnt)for(const r of footprints)if(r.node.part==='hall'&&r.node.ruin==='burnt'&&!buddhaHalls.includes(r))removed.push(r);
    const gates=footprints.filter(r=>['gate','romon','nagayamon'].includes(r.node.part)).map(r=>r.bounds);
    for(const n of facilities.nodes) {
      if(!showHeldBack&&FACILITY_HELD_BACK.has(n.part))continue;
      const removedHall=removed.find(r=>r.node===n);
      if(removedHall){
        if(removedHall.triangles!==n.triangles||!removedHall.meshes||!removedHall.finite)throw new Error('施設の部品が一致しません');
        const b=removedHall.bounds,base={...removedHall.base,height:RUIN_HALL.baseHeight,hollow:RUIN_HALL.baseWidth};
        base.minY=terrain.heightAt(base.x,base.z);base.maxY=base.minY+base.height;
        // A low platform record preserves grass exclusion. Its hollow band leaves the
        // former interior open to prop placement instead of resurrecting a hall box.
        records.push({node:{...n,part:'platform',soft:true},bounds:base,meshes:[]});
        exclusionBoxes.push(base);
        const burnt=n.ruin==='burnt'&&ruinsEnabled(search)&&!buddhaHalls.includes(removedHall);
        const plan=(burnt?prepareBurntHall:prepareRuinHall)({...removedHall.base,height:b.height,minY:base.minY,maxY:base.minY+b.height},terrain,gates);ruinHalls.push(plan);
        continue;
      }
      const node=byName.get(n.node);if(!node)throw new Error('施設に対応する節がありません');
      const parts=[],positions=[];let triangles=0;
      node.traverse(o=>{if(!o.isMesh)return;
        const g=o.geometry.clone().applyMatrix4(o.matrixWorld);geometries.add(g);
        const p=g.getAttribute('position');
        if(texture)g.setAttribute('houseLocalY',new THREE.Float32BufferAttribute(Array.from({length:p.count},(_,i)=>p.getY(i)),1));
        for(let i=0;i<p.count;i++)positions.push(p.getX(i),p.getY(i),p.getZ(i));
        triangles+=(g.index?.count??p.count)/3;parts.push({g,material:o.material,hint:o.name});
      });
      if(triangles!==n.triangles || !parts.length || !positions.every(Number.isFinite)) throw new Error('施設の部品が一致しません');
      const bounds=facilityFootprint(n,positions,false), meshes=[];
      if(facilitySolid(n)||facilityExcludesTrees(n)) {
        const box=facilityFootprint(n,positions,n.part!=='stairs');
        if(facilitySolid(n))boxes.push(box);if(facilityExcludesTrees(n))exclusionBoxes.push(box);
      }
      // One anchor sample for each rigid node, even if it contains several material primitives.
      const placed=facilityPlacement(n,positions,terrain); let offset=0;
      let floor=Infinity,top=-Infinity;
      for(let i=1;i<positions.length;i+=3){floor=Math.min(floor,positions[i]);top=Math.max(top,positions[i]);}
      // W2c-12 facility7 FH5: infer opening from existing dark interior surfaces only.
      const interiors=[];
      if(partsEnabled && n.part==='hall' && new URLSearchParams(search).get('facility7')!=='0')for(const {g,material,hint} of parts){
        const list=[].concat(material);
        if(list.some(m=>facilityInterior([m.color.r,m.color.g,m.color.b],facilityPartRole(n.part,m.name+' '+hint))))
          interiors.push({positions:g.attributes.position.array,indices:g.index?.array});
      }
      const interiorFrame=n.part==='hall'?houseInteriorOpeningFrame(interiors):[0,1,0,0];
      bounds.minY=Infinity;bounds.maxY=-Infinity;
      for(let i=1;i<placed.positions.length;i+=3){bounds.minY=Math.min(bounds.minY,placed.position.y+placed.positions[i]);bounds.maxY=Math.max(bounds.maxY,placed.position.y+placed.positions[i]);}
      if(n.soft)floor=0; // Soil contact is at the datum, not the buried skirt bottom.
      for(const {g,material,hint} of parts) {
        // R3 classification uses original rigid component shapes, before terrain placement.
        if(texture && partsEnabled){
          const timber=facilityTimberWeights(g.attributes.position.array,g.index?.array,floor,top);
          g.setAttribute('houseTimber',new THREE.Float32BufferAttribute(timber,1));
          // W2c-13 hall7: before terrain placement, preserve original metre wall bounds.
          if(hallEnabled){
            const role=facilityPartRole(n.part,[].concat(material)[0].name+' '+hint);
            // Some valid GLBs omit normals and use GPU flat shading. Derive a temporary
            // normal field for classification without changing their rendered normals.
            const normalSource=g.attributes.normal?g:g.clone();
            if(normalSource!==g)normalSource.computeVertexNormals();
            const frame=houseHallWallFrames(g.attributes.position.array,normalSource.attributes.normal.array,timber,floor,top,role);
            if(normalSource!==g)normalSource.dispose();
            g.setAttribute('houseHallWall',new THREE.Float32BufferAttribute(frame,4));
          }
        }
        const count=g.getAttribute('position').array.length;
        g.setAttribute('position',new THREE.Float32BufferAttribute(placed.positions.slice(offset,offset+count),3));offset+=count;
        if(placed.rebuildNormals)g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
        const mesh=new THREE.Mesh(g,surface(material,hint,n,floor,top,interiorFrame));mesh.position.copy(placed.position);mesh.updateMatrix();mesh.matrixAutoUpdate=false;
        mesh.name=n.node;mesh.castShadow=facilityCastsShadow(n);mesh.receiveShadow=true;group.add(mesh);meshes.push(mesh);
      }
      records.push({node:n,bounds,meshes});
    }
    group.updateMatrix();group.matrixAutoUpdate=false;scene.add(group);
    if(buddhaHallMode(search)&&!ruinHalls.length&&new URLSearchParams(search).get('debug')==='1'){
      const enclosed=enclosingBuddhaHalls(records)[0]?.bounds;
      hallDimensions=enclosed?{width:enclosed.w,depth:enclosed.d,height:enclosed.height}:null;
      globalThis.__kzRuinHall=hallInspect;
    }
  } catch(e) {dispose();throw e;}
  return {group,records,boxes,exclusionBoxes,ruinHalls,dispose,
    setAdapt(policy) {step=policy.scale<=.58?3:policy.scale<=.7?2:0;for(const m of surfaceCache.values())m.userData.setHouseAdapt(step);shadows=policy.shadows;for(const r of records)for(const m of r.meshes)m.castShadow=shadows&&facilityCastsShadow(r.node);},
    update(pos, flying=false) {if(disposed)return;stats.flying=flying;stats.shown=0;for(const r of records){const visible=facilityVisible(r.node,r.bounds,pos,quality,step,flying&&farEnabled);if(visible)stats.shown++;for(const m of r.meshes)m.visible=visible;}}
  };
}
