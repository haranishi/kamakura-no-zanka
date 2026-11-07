// View only: self-contained GLB, one static mesh per node/material, CPU placement once.
import * as THREE from 'three';
import { createHouseTextures, createHouseMaterial } from './kamakura-house-materials.js';
import { facilityMaterialRole } from './kamakura-house-texture.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { facilityPlacement, facilityFootprint, facilitySolid, facilityExcludesTrees, facilityCastsShadow, facilityVisible, FACILITY_HELD_BACK } from './kamakura-facilities.js';
export async function buildKamakuraFacilities(facilities, terrain, scene, quality='standard', { showHeldBack = false, search = globalThis.location?.search ?? '' } = {}) {
  const dv=new DataView(facilities.kit);
  if(dv.byteLength<20 || dv.getUint32(0,true)!==0x46546c67 || dv.getUint32(4,true)!==2 || dv.getUint32(8,true)!==dv.byteLength || dv.getUint32(16,true)!==0x4e4f534a) throw new Error('施設のGLBが不正です');
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(facilities.kit,20,dv.getUint32(12,true))));
  if(json.buffers?.some(b=>b.uri) || json.images?.length || json.textures?.length || json.extensionsUsed?.length || json.extensionsRequired?.length) throw new Error('施設のGLBは単色の自己完結形式が必要です');
  const gltf=await new GLTFLoader().parseAsync(facilities.kit,'');
  const geometries=new Set(), materials=new Set(), records=[], boxes=[], exclusionBoxes=[];
  let disposed=false,step=0,shadows=true,texture=null;
  const surfaceCache=new Map();
  // W2c-9g2: facility surfaces use the house atlas; ftex=0 retains the original PBR.
  function surface(base) {
    if(!texture)return base;
    if(Array.isArray(base))return base.map(surface);
    if(!surfaceCache.has(base)){const m=createHouseMaterial(base,{texture,quality,facilityRole:facilityMaterialRole(base.name)});surfaceCache.set(base,m);materials.add(m);}
    return surfaceCache.get(base);
  }
  const group=new THREE.Group();group.name='kamakura-facilities';
  function dispose() {if(disposed)return;disposed=true;group.removeFromParent();texture?.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
  gltf.scene.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of [].concat(o.material))materials.add(m);}});
  try {
    // Loader may keep an unused base material when it clones one for flat normals.
    for(const m of await gltf.parser.getDependencies('material'))materials.add(m);
    if(new URLSearchParams(search).get('ftex')!=='0')texture=await createHouseTextures();
    const byName=new Map();
    gltf.scene.traverse(o=>{const index=gltf.parser.associations.get(o)?.nodes;if(index!==undefined){const name=json.nodes[index].name;if(byName.has(name))throw new Error('施設の節が重複しています');byName.set(name,o);}});
    const meshNodes=json.nodes.filter(n=>n.mesh!==undefined);
    if(meshNodes.length!==facilities.nodes.length || meshNodes.some(n=>!facilities.nodes.some(f=>f.node===n.name))) throw new Error('施設の節の数が一致しません');
    gltf.scene.updateMatrixWorld(true);
    for(const n of facilities.nodes) {
      if(!showHeldBack&&FACILITY_HELD_BACK.has(n.part))continue;
      const node=byName.get(n.node);if(!node)throw new Error('施設に対応する節がありません');
      const parts=[],positions=[];let triangles=0;
      node.traverse(o=>{if(!o.isMesh)return;
        const g=o.geometry.clone().applyMatrix4(o.matrixWorld);geometries.add(g);
        const p=g.getAttribute('position');
        if(texture)g.setAttribute('houseLocalY',new THREE.Float32BufferAttribute(Array.from({length:p.count},(_,i)=>p.getY(i)),1));
        for(let i=0;i<p.count;i++)positions.push(p.getX(i),p.getY(i),p.getZ(i));
        triangles+=(g.index?.count??p.count)/3;parts.push({g,material:o.material});
      });
      if(triangles!==n.triangles || !parts.length || !positions.every(Number.isFinite)) throw new Error('施設の部品が一致しません');
      const bounds=facilityFootprint(n,positions,false), meshes=[];
      if(facilitySolid(n)||facilityExcludesTrees(n)) {
        const box=facilityFootprint(n,positions,n.part!=='stairs');
        if(facilitySolid(n))boxes.push(box);if(facilityExcludesTrees(n))exclusionBoxes.push(box);
      }
      // One anchor sample for each rigid node, even if it contains several material primitives.
      const placed=facilityPlacement(n,positions,terrain); let offset=0;
      for(const {g,material} of parts) {
        const count=g.getAttribute('position').array.length;
        g.setAttribute('position',new THREE.Float32BufferAttribute(placed.positions.slice(offset,offset+count),3));offset+=count;
        if(placed.rebuildNormals)g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
        const mesh=new THREE.Mesh(g,surface(material));mesh.position.copy(placed.position);mesh.updateMatrix();mesh.matrixAutoUpdate=false;
        mesh.name=n.node;mesh.castShadow=facilityCastsShadow(n);mesh.receiveShadow=true;group.add(mesh);meshes.push(mesh);
      }
      records.push({node:n,bounds,meshes});
    }
    group.updateMatrix();group.matrixAutoUpdate=false;scene.add(group);
  } catch(e) {dispose();throw e;}
  return {group,records,boxes,exclusionBoxes,dispose,
    setAdapt(policy) {step=policy.scale<=.58?3:policy.scale<=.7?2:0;for(const m of surfaceCache.values())m.userData.setHouseAdapt(step);shadows=policy.shadows;for(const r of records)for(const m of r.meshes)m.castShadow=shadows&&facilityCastsShadow(r.node);},
    update(pos) {if(disposed)return;for(const r of records){const visible=facilityVisible(r.node,r.bounds,pos,quality,step);for(const m of r.meshes)m.visible=visible;}}
  };
}
