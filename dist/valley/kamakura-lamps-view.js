// Three static batches; only the shared clock and camera uniforms change each frame.
import * as THREE from '../vendor/three.module.min.js';
import { atmosphereOptions } from './kamakura-atmosphere.js';
import { propGeometry } from './kamakura-props-kit.js';
import { LAMPS as C, lampsEnabled, lampsPolicy, selectLampHouses, lampLayout, lampFarWeight } from './kamakura-lamps.js';
function lanternColor() {
  const g=propGeometry('glow'),a=g.attributes.color;
  const color=Object.freeze([a.getX(0),a.getY(0),a.getZ(0)]);g.dispose();return color;
}
export const LAMPS_ART=Object.freeze({
  color:lanternColor(), // linear RGB: sampled from the existing lantern glow, never a second palette.
  openingDebug:0xff8800,poolDebug:0x00ffff,pointDebug:0xff00ff, // masks: opening / ground / distant point.
});
export const LAMPS_VERTEX=`
uniform vec3 uViewer;
uniform float uTime, uFar;
attribute vec3 aCenter;
attribute float aPhase;
varying float vLampFar, vLampAlive, vLampFlicker;
varying vec2 vLampUV;
void main() {
  float lampDistance=distance(aCenter,uViewer);
  vLampFar=smoothstep(${C.blendStart.toFixed(1)},${C.blendEnd.toFixed(1)},lampDistance);
  vLampAlive=1.0-smoothstep(uFar-${(C.blendEnd-C.blendStart).toFixed(1)},uFar,lampDistance);
  vLampFlicker=1.0+${C.flicker.toFixed(3)}*sin(uTime*${(Math.PI*2*C.frequency).toFixed(6)}+aPhase);
  vLampUV=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  gl_PointSize=${C.pixels.toFixed(1)};
}
`;
export const LAMPS_FRAGMENT=`
uniform vec3 uColor;
uniform float uGain, uDebug;
varying float vLampFar, vLampAlive, vLampFlicker;
varying vec2 vLampUV;
void main() {
#ifdef LAMP_POINT
  vec2 lampUV=gl_PointCoord*2.0-1.0;
  float lampMask=1.0-smoothstep(0.1,1.0,length(lampUV));
  float lampWeight=vLampFar;
#elif defined(LAMP_POOL)
  vec2 lampUV=vLampUV*2.0-1.0;
  float lampMask=pow(max(0.0,1.0-length(lampUV)),2.0);
  float lampWeight=1.0-vLampFar;
#else
  vec2 lampUV=abs(vLampUV*2.0-1.0);
  float lampMask=mix(${C.edge.toFixed(3)},1.0,pow(max(0.0,1.0-max(lampUV.x,lampUV.y)),0.5));
  float lampWeight=1.0-vLampFar;
#endif
  float lampAlpha=lampWeight*vLampAlive;
  if(lampAlpha<=0.0)discard;
  vec3 lampLight=uColor*uGain*vLampFlicker*lampMask;
  gl_FragColor=vec4(mix(lampLight,uColor,uDebug),lampAlpha*mix(lampMask,1.0,uDebug));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
function geometryBuilder() {
  const positions=[],uvs=[],centers=[],phases=[];
  function vertex(p,u,v,h) {positions.push(p.x,p.y,p.z);uvs.push(u,v);centers.push(h.x,h.y,h.z);phases.push(h.phase);}
  function quad(points,h,uv=[[0,0],[1,0],[1,1],[0,1]]) {for(const i of [0,1,2,0,2,3])vertex(points[i],uv[i][0],uv[i][1],h);}
  function finish() {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    g.setAttribute('aCenter',new THREE.Float32BufferAttribute(centers,3));g.setAttribute('aPhase',new THREE.Float32BufferAttribute(phases,1));return g;
  }
  return {vertex,quad,finish};
}
export function createKamakuraLamps(context) {
  const time=atmosphereOptions(context.search).time,lights=context.data?.meta?.lights;
  if(!lampsEnabled(context.search,time,lights))return null;
  const selected=selectLampHouses(context.houses?.boxes,context.data.houses,lights,context.data.meta.fires);
  const layouts=selected.slice(0,lampsPolicy(context.quality).limit).map(h=>lampLayout(h,context.terrain));
  if(!layouts.length)return null;
  const debug=new URLSearchParams(context.search).get('lampsdebug')==='1',group=new THREE.Group();group.name='kamakura-lamps';
  const viewer=new THREE.Vector3(),clock={value:0},far={value:C.far},gain=time==='dusk'?1:C.eveningGain;
  const builders=[geometryBuilder(),geometryBuilder(),geometryBuilder()],ends=[[],[],[]];
  for(const {house:h,openings,pool} of layouts) {
    const c=Math.cos(h.yaw),s=Math.sin(h.yaw);
    for(const o of openings)builders[0].quad([[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>({x:o.x+c*u*o.w/2,y:o.y+v*o.h/2,z:o.z-s*u*o.w/2})),h);
    const point=(i,j)=>{
      const x=pool.x+(i/C.poolGrid*2-1)*C.poolRadius,z=pool.z+(j/C.poolGrid*2-1)*C.poolRadius,y=context.terrain.heightAt(x,z)+C.groundOffset;
      if(!Number.isFinite(y))throw new Error('家の光の地面の高さが不正です');return {x,y,z};
    };
    for(let i=0;i<C.poolGrid;i++)for(let j=0;j<C.poolGrid;j++)builders[1].quad([point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)],h,[[i/C.poolGrid,j/C.poolGrid],[(i+1)/C.poolGrid,j/C.poolGrid],[(i+1)/C.poolGrid,(j+1)/C.poolGrid],[i/C.poolGrid,(j+1)/C.poolGrid]]);
    builders[2].vertex({...openings[0],y:h.y+C.windowY},0,0,h);
    for(let i=0;i<3;i++)ends[i].push((i===0?openings.length*6:i===1?C.poolGrid*C.poolGrid*6:1)+(ends[i].at(-1)||0));
  }
  const meshes=builders.map((b,i)=>{
    const color=debug?new THREE.Color([LAMPS_ART.openingDebug,LAMPS_ART.poolDebug,LAMPS_ART.pointDebug][i]):new THREE.Color(...LAMPS_ART.color);
    const material=new THREE.ShaderMaterial({vertexShader:LAMPS_VERTEX,fragmentShader:LAMPS_FRAGMENT,
      defines:i===1?{LAMP_POOL:1}:i===2?{LAMP_POINT:1}:{},uniforms:{uViewer:{value:viewer},uTime:clock,uFar:far,uColor:{value:color},uGain:{value:C.intensity*gain*(i===1?C.poolIntensity:i===2?C.pointGain:1)},uDebug:{value:+debug}},
      transparent:true,depthWrite:false,blending:i===1?THREE.AdditiveBlending:THREE.NormalBlending,side:THREE.DoubleSide,toneMapped:!debug});
    material.forceSinglePass=true;
    const mesh=i===2?new THREE.Points(b.finish(),material):new THREE.Mesh(b.finish(),material);mesh.frustumCulled=false;mesh.name=['lamp-openings','lamp-pools','lamp-points'][i];group.add(mesh);return mesh;
  });
  context.scene.add(group);
  let disposed=false,paused=false,step=0,limit=layouts.length,triangles=0,draws=0,nearCount=0,farCount=0;
  function applyPolicy() {
    const p=lampsPolicy(context.quality,step);limit=Math.min(layouts.length,p.limit);far.value=p.far;
    for(let i=0;i<3;i++){meshes[i].visible=limit>0&&(i===0?p.openings:i===1?p.pools:true);meshes[i].geometry.setDrawRange(0,limit?ends[i][limit-1]:0);}
  }
  applyPolicy();
  function inspect() {
    let nearest=null;
    for(let i=0;i<limit;i++) {
      const h=layouts[i].house,d=Math.hypot(h.x-viewer.x,h.y-viewer.y,h.z-viewer.z);
      if(d>=far.value || (step===3&&lampFarWeight(d)===0))continue;
      if(!nearest||d<nearest.distance)nearest={distance:d,bearing:(Math.atan2(h.x-viewer.x,viewer.z-h.z)*180/Math.PI+360)%360,id:h.id};
    }
    return {selected:selected.length,houses:limit,openings:nearCount,points:farCount,pools:step<2?nearCount:0,triangles,draws,nearest,work:{distanceTests:limit,matrixWrites:0,terrainTests:0},step};
  }
  if(new URLSearchParams(context.search).get('debug')==='1')globalThis.__kzLamps=inspect;
  return {
    update(frame) {
      if(disposed||paused)return;
      const pos=frame.camera?.position||context.camera?.position||frame.pos;viewer.set(pos.x,pos.y??0,pos.z);clock.value+=frame.dt;
      nearCount=0;farCount=0;triangles=0;draws=0;
      for(let i=0;i<limit;i++) {
        const h=layouts[i].house,d=Math.hypot(h.x-viewer.x,h.y-viewer.y,h.z-viewer.z);
        if(d>=far.value)continue;
        if(step<3&&d<C.blendEnd)nearCount++;
        if(d>C.blendStart)farCount++;
      }
      for(let i=0;i<3;i++)if(meshes[i].visible){draws++;if(i<2)triangles+=meshes[i].geometry.drawRange.count/3;}
    },
    setAdapt(value){if(disposed)return;step=Math.max(0,Math.min(3,value));applyPolicy();},
    setPaused(value){paused=!!value;},
    debugText(){return disposed?'':`灯 ${limit}・近 ${nearCount}・粒 ${farCount}`;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}if(globalThis.__kzLamps===inspect)delete globalThis.__kzLamps;},
  };
}
