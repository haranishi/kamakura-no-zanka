// View only. Reuses the bundled GLTFLoader, instancing and bounded chunk lifecycle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHouseTextures, createHouseMaterial } from './kamakura-house-materials.js';
import { houseVariation, houseIndexSeed, houseWallSpans, houseFoundationTop, houseRoofSpans } from './kamakura-house-texture.js';
import { houseNodeName, houseBounds, houseBodyBounds, houseMatrix, houseBox, houseChunks, houseChunkDistance, houseLOD, HOUSE_FAR, houseFarEnabled, houseFarShape, houseFarBrightness, houseFarVisible, houseFarMask, houseFarDistance } from './kamakura-houses.js';

// The mid view stands on a coarser terrain mesh (LOD2+), so its box sinks deeper than the detailed skirt to stay hidden.
const MID_EXTRA_SINK = HOUSE_FAR.midSink;
function simplified(kind, material) {
  const { min: a, max: b } = houseBounds(kind), h = b[1] - a[1], eave = b[1] - h * .28, bottom = a[1] - MID_EXTRA_SINK;
  const geometry = new THREE.BoxGeometry(b[0] - a[0], eave - bottom, b[2] - a[2]);
  geometry.translate((a[0] + b[0]) / 2, (bottom + eave) / 2, (a[2] + b[2]) / 2);
  // Two sloping roof faces: four triangles instead of all source roof detail.
  const roof = new THREE.BufferGeometry(), x = (a[0] + b[0]) / 2;
  roof.setAttribute('position', new THREE.Float32BufferAttribute([
    a[0],eave,a[2], a[0],eave,b[2], x,b[1],b[2], x,b[1],a[2],
    x,b[1],a[2], x,b[1],b[2], b[0],eave,b[2], b[0],eave,a[2]
  ], 3));
  roof.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]); roof.computeVertexNormals();
  return [{ geometry, material }, { geometry: roof, material }];
}
export async function buildKamakuraHouses(houses, terrain, scene, { search = '', quality = 'standard' } = {}) {
  // Reject external resource links before handing the private, self-contained GLB to the loader.
  const dv = new DataView(houses.kit);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(houses.kit, 20, dv.getUint32(12, true))));
  if (json.buffers?.some(b => b.uri) || json.images?.some(b => b.uri) || json.extensionsUsed?.length) throw new Error('家のGLBは自己完結形式が必要です');
  const gltf = await new GLTFLoader().parseAsync(houses.kit, '');
  const templates = new Map(), owned = new Set(), sourceGeometries = new Set(), materials = new Set();
  const chunks = houseChunks(houses), boxes = [];
  // W2c-9g: optional surface layer; shared resources never affect placement or LOD.
  const textured = new URLSearchParams(search).get('htex') !== '0';
  const parts = new URLSearchParams(search).get('hparts') !== '0';
  const relief = new URLSearchParams(search).get('hrelief') !== '0';
  const farEnabled=houseFarEnabled(search), options=new URLSearchParams(search);
  let texture = null, disposed = false, far=null, step=0, revision=0, farAllowed=false, farChunkCount=0;
  let eyeX=0,eyeY=0,eyeZ=0;
  const previousAfterRender=scene.onAfterRender;
  if(farEnabled)scene.onAfterRender=afterPresentation;
  const facilityStats={flying:false,shown:0};
  const debug=() => farStats();
  function farStats() {
    let shownHouses=0,shownWalls=0,farChunks=0,nearest=null,best=Infinity;
    for(let i=0;i<chunks.length;i++)if(far?.state.data[i]) {
      farChunks++;
      for(const item of chunks[i].items) {
        const shape=templates.get(item.kind).far;
        if(shape.wall)shownWalls++;else shownHouses++;
        const m=item.grounded,dx=m[12]-eyeX,dz=m[14]-eyeZ,d=Math.hypot(dx,m[13]-eyeY,dz);
        if(d<best){best=d;nearest={distance:d,bearing:(Math.atan2(dx,-dz)*180/Math.PI+360)%360};}
      }
    }
    const facilities=scene.userData.kzHouseFarFacilities??facilityStats;
    return {ready:!!far?.ready,houses:shownHouses,walls:shownWalls,triangles:far?.mesh.visible?far.mesh.geometry.attributes.position.count/3:0,draws:far?.mesh.visible?1:0,
      chunks:{total:chunks.length,far:farChunks,hidden:chunks.length-farChunks},nearest,
      facilities:{flying:facilities.flying,shown:facilities.shown}};
  }
  if(options.get('debug')==='1')globalThis.__kzHouseFar=debug;
  function releaseGroup(group) {
    if (!group) return;
    group.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); group.removeFromParent();
  }
  function dispose() {
    if (disposed) return; disposed = true;
    texture?.dispose();
    if(scene.onAfterRender===afterPresentation)scene.onAfterRender=previousAfterRender;
    far?.mesh.removeFromParent();far?.mask.dispose();
    if(globalThis.__kzHouseFar===debug)delete globalThis.__kzHouseFar;
    for (const ch of chunks) { releaseGroup(ch.group); releaseGroup(ch.pending?.group); }
    for (const g of owned) g.dispose(); for (const g of sourceGeometries) g.dispose(); for (const m of materials) m.dispose();
  }
  gltf.scene.traverse(o => { if (o.isMesh) { sourceGeometries.add(o.geometry); for (const m of [].concat(o.material)) materials.add(m); } });
  try {
    // Flat-normal loader clones can leave an unused source PBR material outside the scene graph.
    for(const material of await gltf.parser.getDependencies('material'))materials.add(material);
    if (textured) texture = await createHouseTextures({quality,parts});
    gltf.scene.updateMatrixWorld(true);
    for (const kind of houses.kinds.values()) {
      if (!houses.catalog.count_by_kind[kind.node]) continue;
      let node = null;
      gltf.scene.traverse(o => {
        const index = gltf.parser.associations.get(o)?.nodes;
        if (index !== undefined && houseNodeName(json.nodes[index].name) === kind.node) node = o;
      });
      if (!node) throw new Error('家の型に対応する節がありません');
      const near = [], positions = [], surfaceNormals = [];
      node.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld); owned.add(g);
        const p = g.getAttribute('position');
        if(parts && texture){
          g.setAttribute('houseWallSpan',new THREE.Float32BufferAttribute(houseWallSpans(p.array,g.index?.array),2));
          g.setAttribute('houseRoofHeight',new THREE.Float32BufferAttribute(houseRoofSpans(p.array,g.index?.array),2));
          g.setAttribute('houseWallHeight',new THREE.Float32BufferAttribute(houseWallSpans(p.array,g.index?.array,true),2));
        }
        const n=g.getAttribute('normal');
        for (let i = 0; i < p.count; i++) {
          positions.push(p.getX(i), p.getY(i), p.getZ(i));
          surfaceNormals.push(n?.getX(i)??0,n?.getY(i)??0,n?.getZ(i)??0);
        }
        if (Array.isArray(o.material)) {
          for (const group of g.groups) {
            const part = g.clone(); part.clearGroups(); part.setDrawRange(group.start, group.count); owned.add(part);
            near.push({ geometry: part, material: o.material[group.materialIndex] });
          }
        } else near.push({ geometry: g, material: o.material });
      });
      if (!near.length) throw new Error('家の部品がありません');
      const body=houseBodyBounds(positions);
      const shape=farEnabled?houseFarShape(positions,body,kind.node,near.map(p=>({positions:p.geometry.attributes.position.array,indices:p.geometry.index?.array}))):null;
      const baseMain=[...near].sort((a,b)=>(b.geometry.index?.count??b.geometry.attributes.position.count)-(a.geometry.index?.count??a.geometry.attributes.position.count))[0].material;
      if (texture) {
        const shared = new Map(), { min, max } = houseBounds(kind);
        for (const part of near) {
          if (!shared.has(part.material)) {
            const m = createHouseMaterial(part.material, { search, texture, quality, parts, relief, environment: scene.environment, foundation:houseFoundationTop(positions,max[1]-(max[1]-min[1])*.28,surfaceNormals), kind:kind.index, eave: max[1]-(max[1]-min[1])*.28, top: max[1] });
            if(farEnabled){
              const compile=m.onBeforeCompile;
              m.onBeforeCompile=(shader,renderer)=>{
                compile(shader,renderer);
                shader.fragmentShader=shader.fragmentShader.replace(/float brightness = ([^;]+);/,
                  `float brightness = mix($1,1.0+(vHouseRandom.x*2.0-1.0)*${HOUSE_FAR.brightness.toFixed(4)},smoothstep(${HOUSE_FAR.colorNear.toFixed(1)},${HOUSE_FAR.colorFar.toFixed(1)},length(vViewPosition)));`);
              };
              const key=m.customProgramCacheKey();m.customProgramCacheKey=()=>key+'-far-brightness';
            }
            shared.set(part.material,m); materials.add(m);
          }
          part.material = shared.get(part.material);
        }
      }
      // Current kit uses one flat main color per kind. Weight by primitive triangle count for future kits.
      const main = [...near].sort((a, b) => (b.geometry.index?.count ?? b.geometry.attributes.position.count) - (a.geometry.index?.count ?? a.geometry.attributes.position.count))[0].material;
      const mid = simplified(kind, main); for (const p of mid) {
        if(parts && texture){
          p.geometry.setAttribute('houseWallSpan',new THREE.Float32BufferAttribute(houseWallSpans(p.geometry.attributes.position.array,p.geometry.index?.array),2));
          p.geometry.setAttribute('houseRoofHeight',new THREE.Float32BufferAttribute(houseRoofSpans(p.geometry.attributes.position.array,p.geometry.index?.array),2));
          p.geometry.setAttribute('houseWallHeight',new THREE.Float32BufferAttribute(houseWallSpans(p.geometry.attributes.position.array,p.geometry.index?.array,true),2));
        }
        owned.add(p.geometry);
      }
      templates.set(kind.index, { near, mid, body, far:shape, base:baseMain, main });
    }
    for (const ch of chunks) {
      ch.level = null; ch.group = null; ch.pending = null; ch.farShown=false; ch.minY=Infinity; ch.maxY=-Infinity;
      for (const item of ch.items) {
        const body = templates.get(item.kind).body;
        item.grounded = houseMatrix(item, terrain, body);
        if(farEnabled) {
          const shape=templates.get(item.kind).far;
          ch.minY=Math.min(ch.minY,item.grounded[13]+shape.min[1]*item.grounded[5]);
          ch.maxY=Math.max(ch.maxY,item.grounded[13]+shape.top*item.grounded[5]);
        }
        boxes.push({ ...houseBox(houses.kinds.get(item.kind), item.grounded, body), id: `house-${item.id}` });
      }
    }
  } catch (e) { dispose(); throw e; }
  // Extend the existing surface shader, retaining its palette, texture means, fog and illumination.
  function maskShader(material, surface=false) {
    const previous=material.onBeforeCompile.bind(material), key=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      previous(shader,renderer);
      shader.uniforms.houseFarMask={value:far.mask};shader.uniforms.houseFarMaskWidth={value:far.state.data.length};
      shader.vertexShader=shader.vertexShader.replace('#include <common>', `#include <common>
        attribute float houseFarChunk;
        uniform sampler2D houseFarMask;
        uniform float houseFarMaskWidth;`);
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float houseFarOn=texture2D(houseFarMask,vec2((houseFarChunk+0.5)/houseFarMaskWidth,0.5)).r;
        transformed*=step(0.5,houseFarOn);`);
      if(surface) {
        shader.vertexShader=shader.vertexShader.replace('#include <common>', `#include <common>
          attribute vec3 houseFarLocal,houseFarNormal,houseFarScale;
          attribute vec4 houseFarSeed,houseFarFrame;
          varying vec4 vHouseFarFrame;
          varying float vHouseFarBrightness;`);
        // Appended after the shared begin_vertex body, before projection.
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>', `
          vHouseObj=houseFarLocal;vHouseN=houseFarNormal;
          vHouseScale=houseFarScale;vHouseRoofP=houseFarLocal*houseFarScale;
          vHouseRoofN=normalize(houseFarNormal/houseFarScale);
          vHouseRandom=houseFarSeed.xyz;vHouseNorth=max(0.0,-objectNormal.z);
          vHouseFarFrame=houseFarFrame;vHouseFarBrightness=houseFarSeed.w;
          #include <project_vertex>`);
        shader.fragmentShader=shader.fragmentShader
          .replace('uniform float houseOpenings, houseKind, houseFoundation;', `uniform float houseOpenings;
            varying vec4 vHouseFarFrame;varying float vHouseFarBrightness;
            #define houseKind vHouseFarFrame.x
            #define houseFoundation vHouseFarFrame.y`)
          .replace('uniform vec2 houseRoofBand;', '#define houseRoofBand vHouseFarFrame.zw')
          .replace(/float brightness = [^;]+;/,'float brightness = vHouseFarBrightness;');
      }
    };
    material.customProgramCacheKey=()=>key+'-housefar-'+surface;
  }
  function createFar() {
    let vertices=0;
    for(const ch of chunks)for(const item of ch.items)vertices+=templates.get(item.kind).far.positions.length/3;
    if(vertices/3>HOUSE_FAR.triangles || chunks.length>HOUSE_FAR.maskBytes)throw new Error('遠景の家の費用上限を超えました');
    const width=2**Math.ceil(Math.log2(Math.max(1,chunks.length))),data=new Uint8Array(width);
    const mask=new THREE.DataTexture(data,width,1,THREE.RedFormat,THREE.UnsignedByteType);
    mask.minFilter=mask.magFilter=THREE.NearestFilter;mask.generateMipmaps=false;mask.needsUpdate=true;
    const geometry=new THREE.BufferGeometry();owned.add(geometry);
    const sizes={position:3,normal:3,color:3,houseFarChunk:1,houseFarLocal:3,houseFarNormal:3,houseFarScale:3,houseFarSeed:4,houseFarFrame:4,houseWallSpan:2,houseWallHeight:2,houseRoofHeight:2};
    for(const [name,size] of Object.entries(sizes))geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(vertices*size),size));
    const template=templates.values().next().value;
    const base=template?.base.clone()??new THREE.MeshStandardMaterial();base.color.setRGB(1,1,1);materials.add(base);
    const diagnostic=options.get('housefardebug')==='1';
    const material=diagnostic?new THREE.MeshBasicMaterial({vertexColors:true,fog:false,toneMapped:false}):texture?
      createHouseMaterial(base,{search,texture,quality,parts,relief,environment:scene.environment}):base;
    materials.add(material);material.vertexColors=true;material.userData.setHouseAdapt?.(step);
    const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),distance=new THREE.MeshDistanceMaterial();
    materials.add(depth);materials.add(distance);
    const mesh=new THREE.Mesh(geometry,material);mesh.name='house-far';mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;mesh.visible=false;mesh.frustumCulled=false;
    mesh.matrixAutoUpdate=false;mesh.updateMatrix();scene.add(mesh);
    far={mesh,mask,state:{data,revision:-1},chunk:0,item:0,offset:0,ready:false,diagnostic};
    maskShader(material,!!texture&&!diagnostic);maskShader(depth);maskShader(distance);
  }
  const farColor=new THREE.Color();
  function buildFarSlice() {
    if(!far)createFar();
    const start=performance.now(),attrs=far.mesh.geometry.attributes;
    let budget=HOUSE_FAR.batch;
    while(far.chunk<chunks.length && budget-- && performance.now()-start<HOUSE_FAR.sliceMs) {
      const ch=chunks[far.chunk],item=ch.items[far.item],t=templates.get(item.kind),shape=t.far,m=item.grounded;
      const variation=parts&&texture?null:houseVariation(m[12],m[14]);
      const seed=variation?[variation.age,variation.offset[0]/17,variation.offset[1]/17]:houseIndexSeed(item.id);
      const scale=[Math.hypot(m[0],m[2]),m[5],Math.hypot(m[8],m[10])],brightness=parts&&texture?houseFarBrightness(item.id):1+(seed[0]*2-1)*HOUSE_FAR.brightness;
      const frame=[item.kind,t.main.userData.houseUniforms?.houseFoundation.value??0, t.main.userData.houseUniforms?.houseRoofBand.value.x??shape.eave,t.main.userData.houseUniforms?.houseRoofBand.value.y??shape.top];
      const local=shape.positions,normals=shape.normals;
      const spans=houseWallSpans(local),heights=houseWallSpans(local,null,true),roofs=houseRoofSpans(local);
      farColor.copy(t.base.color);
      if(far.diagnostic)farColor.setHex(shape.wall?HOUSE_FAR.debugWall:HOUSE_FAR.debugHouse);
      else if(!texture)farColor.multiplyScalar(brightness);
      for(let i=0;i<local.length;i+=3) {
        const v=far.offset++,j=i/3,x=local[i],y=local[i+1],z=local[i+2],nx=normals[i]/scale[0],ny=normals[i+1]/scale[1],nz=normals[i+2]/scale[2];
        const wx=m[0]/scale[0]*nx+m[8]/scale[2]*nz,wz=m[2]/scale[0]*nx+m[10]/scale[2]*nz,len=Math.hypot(wx,ny,wz);
        attrs.position.setXYZ(v,m[12]+m[0]*x+m[8]*z,m[13]+m[5]*y,m[14]+m[2]*x+m[10]*z);
        attrs.normal.setXYZ(v,wx/len,ny/len,wz/len);attrs.color.setXYZ(v,farColor.r,farColor.g,farColor.b);
        attrs.houseFarLocal.setXYZ(v,x,y,z);attrs.houseFarNormal.setXYZ(v,normals[i],normals[i+1],normals[i+2]);
        attrs.houseFarScale.setXYZ(v,...scale);attrs.houseFarSeed.setXYZW(v,...seed,brightness);attrs.houseFarFrame.setXYZW(v,...frame);
        attrs.houseFarChunk.setX(v,far.chunk);
        attrs.houseWallSpan.setXY(v,spans[j*2],spans[j*2+1]);attrs.houseWallHeight.setXY(v,heights[j*2],heights[j*2+1]);attrs.houseRoofHeight.setXY(v,roofs[j*2],roofs[j*2+1]);
      }
      if(++far.item===ch.items.length){far.item=0;far.chunk++;}
    }
    if(far.chunk===chunks.length){far.ready=true;far.mesh.geometry.computeBoundingSphere();revision++;}
  }
  // Loading prewarms LODs before any render. Only the real scene's first completed render opens this gate.
  function afterPresentation(renderer,renderScene,camera){
    previousAfterRender.call(scene,renderer,renderScene,camera);
    if(!disposed)farAllowed=true;
    if(scene.onAfterRender===afterPresentation)scene.onAfterRender=previousAfterRender;
  }
  function prepare(ch, level) {
    const group = new THREE.Group(); group.name = `houses-${ch.key}-${level}`; group.visible = false; scene.add(group);
    const kinds = new Map(), jobs = [];
    for (const item of ch.items) { if (!kinds.has(item.kind)) kinds.set(item.kind, []); kinds.get(item.kind).push(item); }
    for (const [kind, items] of kinds) for (const part of templates.get(kind)[level === 0 ? 'near' : 'mid']) jobs.push({ part, items });
    ch.pending = { group, jobs, level };
  }
  const sorted = chunks.slice(), distanceSort=(a,b)=>a.distance-b.distance;
  const instanceMatrix=new THREE.Matrix4(), instanceSeed=new THREE.Color();
  function markFar(ch) {
    if(!farEnabled)return;
    const shown=houseFarVisible(ch.level,ch.distance,quality,step);
    if(ch.farShown!==shown){ch.farShown=shown;farChunkCount+=shown?1:-1;revision++;}
  }
  function update(pos) {
    if (disposed) return;
    if(farEnabled){eyeX=pos.x;eyeY=pos.y??0;eyeZ=pos.z;if(farAllowed&&!far?.ready)buildFarSlice();}
    let budget = 2;
    for(const ch of sorted){const horizontal=houseChunkDistance(ch,pos);ch.distance=farEnabled?houseFarDistance(ch,pos,horizontal):horizontal;}
    sorted.sort(distanceSort);
    for (const ch of sorted) {
      const distance=ch.distance;
      const want = houseLOD(distance, ch.level);
      if (ch.pending && want !== ch.pending.level) { releaseGroup(ch.pending.group); ch.pending = null; }
      if (want === 2) { releaseGroup(ch.group); ch.group = null; if(ch.level!==2)revision++;ch.level = 2; markFar(ch); continue; }
      if (want === ch.level) {markFar(ch);continue;}
      if (!ch.pending && budget) prepare(ch, want);
      const pending = ch.pending;
      while (pending?.jobs.length && budget) {
        const { part, items } = pending.jobs.shift(), mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        mesh.name = 'house-instances'; mesh.castShadow = true; mesh.receiveShadow = true;
        items.forEach((item, i) => {
          mesh.setMatrixAt(i, instanceMatrix.fromArray(item.grounded));
          if(parts && texture){const seed=houseIndexSeed(item.id);instanceSeed.setRGB(...seed);mesh.setColorAt(i,instanceSeed);}
        });
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); pending.group.add(mesh); budget--;
      }
      if (pending && !pending.jobs.length) {
        releaseGroup(ch.group); ch.group = pending.group; ch.group.visible = true; ch.level = pending.level; ch.pending = null; revision++;
      }
      markFar(ch);
    }
    if(far?.ready){
      if(houseFarMask(far.state,chunks,revision,quality,step))far.mask.needsUpdate=true;
      far.mesh.visible=farChunkCount>0;
    }
  }
  return { update, boxes, dispose, setAdapt: value => { if(step!==value){step=value;revision++;}for (const m of materials) m.userData.setHouseAdapt?.(step); }, ready: pos => chunks.filter(ch => houseChunkDistance(ch, pos) < 350).every(ch => ch.level === 0) };
}
