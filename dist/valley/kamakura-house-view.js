// View only. Reuses the bundled GLTFLoader, instancing and bounded chunk lifecycle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHouseTextures, createHouseMaterial, createHouse2Material, house2DitherMaterial, loadHouse2Module } from './kamakura-house-materials.js';
import { houseVariation, houseIndexSeed, houseWallSpans, houseFoundationTop, houseRoofSpans } from './kamakura-house-texture.js';
import { housePolicy, houseNodeName, houseBounds, houseBodyBounds, houseMatrix, houseBox, houseChunks, houseChunkDistance, houseLOD, HOUSE_FAR, houseFarEnabled, houseFarShape, houseFarBrightness, houseFarVisible, houseFarMask, houseFarDistance } from './kamakura-houses.js';

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
  const policy=housePolicy(terrain.meta?.house_policy,search);
  // Reject external resource links before handing the private, self-contained GLB to the loader.
  const dv = new DataView(houses.kit);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(houses.kit, 20, dv.getUint32(12, true))));
  if (json.buffers?.some(b => b.uri) || json.images?.some(b => b.uri) || json.extensionsUsed?.length) throw new Error('家のGLBは自己完結形式が必要です');
  const gltf = await new GLTFLoader().parseAsync(houses.kit, '');
  // The new pure module is never loaded on the legacy flag path.
  const h2options=new URLSearchParams(search);
  const h2on=h2options.get('house2')!=='0'&&quality!=='light'&&Array.from(houses.kinds.values()).some(k=>!/塀|門|fence|gate|wall/i.test(k.node)&&/町屋|小家|蔵|屋敷|番屋|舟小屋|townhouse|cottage|storehouse|mansion|boathouse|guardhouse/i.test(k.node));
  const h2=h2on?await loadHouse2Module():null;
  const detail={built:[],cache:new Map(),job:null,shown:0,triangles:0,draws:0,selection:null,distances:null,previous:new Int32Array(h2?policy.cap:0),previousCount:0,buildFrames:0,stages:0,maxStages:0};
  if(h2){detail.selection=new Int32Array(policy.cap);detail.distances=new Float64Array(policy.cap);}
  const limits=h2&&policy.extended?h2.HOUSE_DETAIL:h2?.HOUSE2;
  const finePixels={value:h2? h2.HOUSE_DETAIL.referenceHeight/(2*Math.tan(h2.HOUSE_DETAIL.referenceFov*Math.PI/360)):0};
  const drawingSize=new THREE.Vector2();
  function projection(renderer,camera){if(renderer?.getDrawingBufferSize&&camera?.isPerspectiveCamera)finePixels.value=renderer.getDrawingBufferSize(drawingSize).y*camera.projectionMatrix.elements[5]/2;}
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
  if(farEnabled||h2)scene.onAfterRender=afterPresentation;
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
    group.traverse(o => { if (o.isInstancedMesh) {o.dispose();if(h2&&o.userData.house2Items){owned.delete(o.geometry);o.geometry.dispose();for(const m of [o.customDepthMaterial,o.customDistanceMaterial]){materials.delete(m);m.dispose();}}} }); group.removeFromParent();
  }
  function dispose() {
    if (disposed) return; disposed = true;
    texture?.dispose();
    if(detail.job)for(const part of detail.job.meshes){part.mesh.dispose();part.mesh.removeFromParent();}
    for(const entry of detail.cache.values())for(const part of entry.meshes){part.mesh.dispose();part.mesh.removeFromParent();}
    if(globalThis.__kzHouse2===house2Stats)delete globalThis.__kzHouse2;
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
      templates.set(kind.index, { near, mid, body, far:shape, base:baseMain, main, frame:h2&&h2.houseFamily(kind)?h2.houseFrame(kind,positions,1,near.map(p=>({positions:p.geometry.attributes.position.array,indices:p.geometry.index?.array}))):null });
    }
    for (const ch of chunks) {
      ch.level = null; ch.group = null; ch.pending = null; ch.farShown=false; ch.minY=Infinity; ch.maxY=-Infinity;
      for (const item of ch.items) {
        const body = templates.get(item.kind).body;
        item.grounded = houseMatrix(item, terrain, body);
        if(h2){item.house2Eligible=!!templates.get(item.kind).frame;item.house2Weight=0;item.house2Variant=h2.house2Variant(item.id,templates.get(item.kind).frame?.family);item.house2Seed=houseIndexSeed(item.id);}
        if(farEnabled) {
          const shape=templates.get(item.kind).far;
          ch.minY=Math.min(ch.minY,item.grounded[13]+shape.min[1]*item.grounded[5]);
          ch.maxY=Math.max(ch.maxY,item.grounded[13]+shape.top*item.grounded[5]);
        }
        boxes.push({ ...houseBox(houses.kinds.get(item.kind), item.grounded, body), id: `house-${item.id}` });
      }
    }
  } catch (e) { dispose(); throw e; }
  if(h2){
    // A material is shared by near and mid; only near instances carry nonzero fade.
    const patched=new Set();
    for(const t of templates.values())for(const part of t.near)if(!patched.has(part.material)){patched.add(part.material);house2DitherMaterial(part.material);}
  }
  function house2Stats(){
    let nearest=null,best=Infinity;
    if(detail.shown)for(let i=0;i<detail.previousCount;i++){const item=houses.instances[detail.previous[i]];if(!item.house2Weight)continue;const m=item.grounded,dx=m[12]-eyeX,dz=m[14]-eyeZ,d=Math.hypot(dx,m[13]-eyeY,dz);if(d<best){best=d;nearest={type:houses.kinds.get(item.kind).node,tiltDegrees:Math.atan2(Math.hypot(m[4],m[6]),m[5])*180/Math.PI,distance:d,bearing:(Math.atan2(dx,-dz)*180/Math.PI+360)%360};}}
    return {enabled:!!h2,active:!!h2&&step<2,quality,adapt:step,built:detail.built,shown:detail.shown,cap:policy.cap,range:{full:policy.full,swap:policy.swap},policy,buildFrames:detail.buildFrames,buildStages:detail.stages,maxBuildStages:detail.maxStages,building:!!detail.job,limits:limits?{triangles:limits.triangles,draws:limits.draws}:null,partLimits:h2&&policy.extended?h2.HOUSE_DETAIL.parts:null,draws:detail.draws,triangles:detail.triangles,nearest};
  }
  if(options.get('debug')==='1')globalThis.__kzHouse2=house2Stats;
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
    projection(renderer,camera);
    if(!policy.extended&&scene.onAfterRender===afterPresentation)scene.onAfterRender=previousAfterRender;
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
    if(farEnabled||h2){eyeX=pos.x;eyeY=pos.y??0;eyeZ=pos.z;}
    if(farEnabled&&farAllowed&&!far?.ready)buildFarSlice();
    let budget = 2;
    for(const ch of sorted){const horizontal=houseChunkDistance(ch,pos);ch.distance=farEnabled?houseFarDistance(ch,pos,horizontal):horizontal;}
    sorted.sort(distanceSort);
    for (const ch of sorted) {
      const distance=ch.distance;
      const want = h2&&policy.extended&&step<2&&distance<policy.swap?0:houseLOD(distance, ch.level);
      if (ch.pending && want !== ch.pending.level) { releaseGroup(ch.pending.group); ch.pending = null; }
      if (want === 2) { releaseGroup(ch.group); ch.group = null; if(ch.level!==2)revision++;ch.level = 2; markFar(ch); continue; }
      if (want === ch.level) {markFar(ch);continue;}
      if (!ch.pending && budget) prepare(ch, want);
      const pending = ch.pending;
      while (pending?.jobs.length && budget) {
        const { part, items } = pending.jobs.shift(), mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        if(h2){
          mesh.geometry=part.geometry.clone();owned.add(mesh.geometry);
          mesh.geometry.setAttribute('house2Fade',new THREE.InstancedBufferAttribute(new Float32Array(items.length),1));
          mesh.userData.house2Items=items;
          const depth=house2DitherMaterial(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}));
          const distance=house2DitherMaterial(new THREE.MeshDistanceMaterial());materials.add(depth);materials.add(distance);
          mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;
        }
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
    if(h2)updateHouse2(pos);
    if(far?.ready){
      if(houseFarMask(far.state,chunks,revision,quality,step))far.mask.needsUpdate=true;
      far.mesh.visible=farChunkCount>0;
    }
  }

  // One kind is under construction; generator work and GPU allocations have separate hard budgets.
  function buildDetailSlice(kind) {
    const C=h2.HOUSE2,t=templates.get(kind);
    if(!detail.job)detail.job={kind,variant:0,generator:h2.houseBuildSteps(t.frame,0),cpu:0,maxSlice:0,meshes:[],shape:null,band:0};
    const job=detail.job,start=performance.now();let r,stages=0;
    if(!job.shape){
      do{r=job.generator.next();stages++;}while(!r.done&&stages<h2.HOUSE_DETAIL.stages&&performance.now()-start<C.sliceMs);
      if(r.done){job.shape=r.value;if(job.shape.triangles>h2.houseTriangleLimit(t.frame))throw new Error('家の型の三角形上限を超えました');}
    }
    detail.stages+=stages;detail.maxStages=Math.max(detail.maxStages,stages);
    if(!job.shape){const elapsed=performance.now()-start;job.cpu+=elapsed;job.maxSlice=Math.max(job.maxSlice,elapsed);return;}
    const shape=policy.extended?h2.houseDetailBand(job.shape,job.band===1):job.shape;
    const geometry=new THREE.BufferGeometry();owned.add(geometry);
    for(const [name,array,size] of [['position',shape.positions,3],['normal',shape.normals,3],['uv',shape.uvs,2],['house2Surface',shape.surfaces,1],['house2Tone',shape.tones,1],['house2Role',shape.roles,1]])geometry.setAttribute(name,new THREE.BufferAttribute(array,size));
    if(shape.fine){
      geometry.setAttribute('house2PartWidth',new THREE.BufferAttribute(shape.partWidth,1));geometry.setAttribute('house2PartEnd',new THREE.BufferAttribute(shape.partEnd,1));
      geometry.setAttribute('house2Distance',new THREE.InstancedBufferAttribute(new Float32Array(policy.cap),1));
      geometry.setAttribute('house2Scale',new THREE.InstancedBufferAttribute(new Float32Array(policy.cap),1));
    }
    if(options.get('house2debug')==='1'){
      const colors=new Float32Array(shape.positions.length),c=new THREE.Color(),palette=h2.HOUSE_PARTS.debug;
      for(let i=0;i<shape.roles.length;i++){c.setHex(palette[shape.roles[i]]);c.toArray(colors,i*3);}geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    }
    geometry.setAttribute('house2Fade',new THREE.InstancedBufferAttribute(new Float32Array(policy.cap),1));geometry.setAttribute('house2Yard',new THREE.InstancedBufferAttribute(new Float32Array(policy.cap),1));
    const fine=shape.fine?{pixels:finePixels,constants:h2.HOUSE_DETAIL}:null;
    const material=house2DitherMaterial(createHouse2Material(t.base,{texture,search,environment:scene.environment,constants:C,frame:shape.frame,debug:options.get('house2debug')==='1'}),true,fine);materials.add(material);
    const mesh=new THREE.InstancedMesh(geometry,material,policy.cap);mesh.name='house2-instances';mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.updateMatrix();
    if(shape.fine)mesh.onBeforeRender=(renderer,renderScene,camera)=>projection(renderer,camera);
    mesh.customDepthMaterial=house2DitherMaterial(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),true,fine);
    mesh.customDistanceMaterial=house2DitherMaterial(new THREE.MeshDistanceMaterial(),true,fine);materials.add(mesh.customDepthMaterial);materials.add(mesh.customDistanceMaterial);
    mesh.setColorAt(0,instanceSeed.setRGB(.5,.5,.5));scene.add(mesh);
    job.meshes.push({mesh,variant:job.variant,fine:!!shape.fine,triangles:shape.triangles,count:0,ids:new Int32Array(policy.cap).fill(-1),matrixChanged:false,fadeChanged:false});
    const elapsed=performance.now()-start;job.cpu+=elapsed;job.maxSlice=Math.max(job.maxSlice,elapsed);
    detail.built.push({type:houses.kinds.get(kind).node,variant:job.variant,fine:!!shape.fine,triangles:shape.triangles,ms:job.cpu,maxSliceMs:job.maxSlice});
    if(policy.extended&&job.band++===0)return;
    job.band=0;job.shape=null;
    if(++job.variant<C.variants){job.generator=h2.houseBuildSteps(t.frame,job.variant);job.cpu=0;job.maxSlice=0;}
    else {detail.cache.set(kind,{meshes:job.meshes});detail.job=null;}
  }
  function writeFine(attribute,index,value){if(attribute.getX(index)!==Math.fround(value)){attribute.setX(index,value);attribute.needsUpdate=true;}}
  function updateHouse2(pos) {
    const C=h2.HOUSE2;
    for(let i=0;i<detail.previousCount;i++)houses.instances[detail.previous[i]].house2Weight=0;
    for(const ch of sorted)for(const item of ch.items)item.house2Eligible=!!templates.get(item.kind).frame&&ch.level===0&&!!ch.group;
    let count=0;
    if(step<2&&farAllowed)count=h2.house2Selection(houses.instances,pos,detail.selection,detail.distances,policy.cap,policy.swap);
    let missing=-1;
    for(let i=0;i<count;i++){const item=houses.instances[detail.selection[i]];if(!detail.cache.has(item.kind)){missing=item.kind;break;}}
    if(step<2&&farAllowed&&(detail.job||missing>=0)){detail.buildFrames++;buildDetailSlice(detail.job?.kind??missing);}
    for(const entry of detail.cache.values())for(const part of entry.meshes){part.count=0;part.matrixChanged=false;part.fadeChanged=false;}
    detail.shown=0;detail.triangles=0;detail.draws=0;
    for(let i=0;i<count;i++){
      const index=detail.selection[i],item=houses.instances[index],entry=detail.cache.get(item.kind);if(!entry)continue;
      const distance=detail.distances[i],fade=h2.house2Fade(distance,policy),m=item.grounded;
      const scale=Math.min(Math.hypot(m[0],m[2]),m[5],Math.hypot(m[8],m[10]));
      let cost=0;
      for(const part of entry.meshes)if(part.variant===item.house2Variant&&(!part.fine||distance<h2.HOUSE_DETAIL.end))cost+=part.triangles;
      if(detail.triangles+cost>limits.triangles)continue;
      for(const part of entry.meshes){
        if(part.variant!==item.house2Variant||part.fine&&distance>=h2.HOUSE_DETAIL.end)continue;
        const at=part.count++,mesh=part.mesh;
        if(part.ids[at]!==index){part.ids[at]=index;mesh.setMatrixAt(at,instanceMatrix.fromArray(m));const seed=item.house2Seed;mesh.setColorAt(at,instanceSeed.setRGB(...seed));mesh.geometry.attributes.house2Yard.setX(at,seed[2]<C.yardChance?1:0);part.matrixChanged=true;}
        const a=mesh.geometry.attributes.house2Fade;if(a.getX(at)!==Math.fround(fade)){a.setX(at,fade);part.fadeChanged=true;}
        if(part.fine){writeFine(mesh.geometry.attributes.house2Distance,at,distance);writeFine(mesh.geometry.attributes.house2Scale,at,scale);}
        detail.triangles+=part.triangles;
      }
      item.house2Weight=fade;detail.previous[detail.shown++]=index;
    }
    detail.previousCount=detail.shown;
    for(const entry of detail.cache.values())for(const part of entry.meshes){const mesh=part.mesh;mesh.count=part.count;mesh.visible=part.count>0;
      if(mesh.visible)detail.draws++;if(part.matrixChanged){mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.geometry.attributes.house2Yard.needsUpdate=true;}if(part.fadeChanged)mesh.geometry.attributes.house2Fade.needsUpdate=true;}
    if(detail.draws>limits.draws)throw new Error('家の描画命令上限を超えました');
    // Existing near meshes keep their placement, bounds, materials and chunk lifecycle.
    for(const ch of sorted){if(ch.level!==0||!ch.group)continue;for(const mesh of ch.group.children){const a=mesh.geometry.attributes.house2Fade,items=mesh.userData.house2Items;let changed=false;
      for(let i=0;i<items.length;i++){const value=Math.fround(items[i].house2Weight);if(a.getX(i)!==value){a.setX(i,value);changed=true;}}if(changed)a.needsUpdate=true;}}
  }

  return { update, boxes, dispose, setAdapt: value => { if(step!==value){step=value;revision++;}for (const m of materials) m.userData.setHouseAdapt?.(step); }, ready: pos => chunks.filter(ch => houseChunkDistance(ch, pos) < 350).every(ch => ch.level === 0) };
}
