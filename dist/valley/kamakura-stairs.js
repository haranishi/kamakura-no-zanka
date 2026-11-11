// Pure stair metadata and allocation-free walking ramps; x east, z south, metres.
export const STAIRS = Object.freeze({
  edgeEpsilonM: 1e-8, // metres: inclusive edges tolerate projection roundoff.
  noseInsetM: .05, // metres below the line joining the stair noses.
  gridM: 32, // metres per numeric spatial-index cell.
  minRiseM: .2, maxRiseM: 60, // accepted vertical rise, metres.
  minWidthM: 1, maxWidthM: 40, // accepted clear width, metres.
  minLengthM: 1, maxLengthM: 200, // accepted centre-line length, metres.
  maxGrade: 1.2, // maximum rise/run ratio.
  maxBaseM: 50, // metres: accepted height of the lower nose above or below the model's own zero.
  maxLandingM: 20 // metres: accepted flat landing beyond the upper end.
});
export const stepsEnabled = search => new URLSearchParams(search).get('steps') !== '0';
export function validateSteps(node) {
  const s=node.steps;if(s===undefined)return;
  if(node.part!=='stairs'||!s||Array.isArray(s)||Object.keys(s).some(k=>!['from_xz','to_xz','rise_m','width_m','base_m','landing_m'].includes(k))||
    (s.base_m!==undefined&&!(Number.isFinite(s.base_m)&&Math.abs(s.base_m)<=STAIRS.maxBaseM))||
    (s.landing_m!==undefined&&!(Number.isFinite(s.landing_m)&&s.landing_m>=0&&s.landing_m<=STAIRS.maxLandingM))||
    ![s.from_xz,s.to_xz].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))||
    !Number.isFinite(s.rise_m)||s.rise_m<STAIRS.minRiseM||s.rise_m>STAIRS.maxRiseM||
    !Number.isFinite(s.width_m)||s.width_m<STAIRS.minWidthM||s.width_m>STAIRS.maxWidthM)throw new Error('石段の指定が不正です');
  const length=Math.hypot(s.to_xz[0]-s.from_xz[0],s.to_xz[1]-s.from_xz[1]);
  if(!Number.isFinite(length)||length<STAIRS.minLengthM||length>STAIRS.maxLengthM||s.rise_m/length>STAIRS.maxGrade)throw new Error('石段の長さか勾配が不正です');
}
// The ramp starts from the height the model itself is set down at (the anchor's ground plus rel_anchor, the rule of
// facilityPlacement), plus base_m: the lower nose in the model's own frame. Seen with the designed map: measured from the
// ground at the lower end instead, the ramp sank with every hollow made under the steps, and the hero walked inside them.
export function withStairRamps(terrain,nodes=[],{search=''}={}) {
  if(!stepsEnabled(search)||!nodes.some(n=>n.steps!==undefined))return terrain;
  const ramps=[],grid=new Map();
  for(const node of nodes){
    validateSteps(node);const s=node.steps;if(!s)continue;
    const x=s.from_xz[0],z=s.from_xz[1],dx=s.to_xz[0]-x,dz=s.to_xz[1]-z,length=Math.hypot(dx,dz);
    // landing_m: a flat landing beyond the upper end, at the height of the last nose. The ground under a landing slab may lie lower.
    const end=length+(s.landing_m??0),ex1=x+dx/length*end,ez1=z+dz/length*end;
    const ramp={id:node.node,x,z,ux:dx/length,uz:dz/length,length,end,half:s.width_m/2,rise:s.rise_m,base:terrain.heightAt(node.anchor_xz[0],node.anchor_xz[1])+node.rel_anchor+(s.base_m??0),slope:Math.atan(s.rise_m/length)*180/Math.PI};ramps.push(ramp);
    const ex=Math.abs(ramp.uz)*ramp.half,ez=Math.abs(ramp.ux)*ramp.half;
    const i0=Math.floor((Math.min(x,ex1)-ex-STAIRS.edgeEpsilonM)/STAIRS.gridM),i1=Math.floor((Math.max(x,ex1)+ex+STAIRS.edgeEpsilonM)/STAIRS.gridM);
    const j0=Math.floor((Math.min(z,ez1)-ez-STAIRS.edgeEpsilonM)/STAIRS.gridM),j1=Math.floor((Math.max(z,ez1)+ez+STAIRS.edgeEpsilonM)/STAIRS.gridM);
    // Iterate small offsets: a huge finite world coordinate may not change with key++.
    for(let a=0;a<=i1-i0;a++){
      const i=i0+a;if(!grid.has(i))grid.set(i,new Map());const column=grid.get(i);
      for(let b=0;b<=j1-j0;b++){
        const j=j0+b;if(!column.has(j))column.set(j,[]);column.get(j).push(ramp);
      }
    }
  }
  if(!ramps.length)return terrain;
  const rampY=(r,x,z)=>r.base+r.rise*Math.max(0,Math.min(1,((x-r.x)*r.ux+(z-r.z)*r.uz)/r.length))-STAIRS.noseInsetM;
  function find(x,z){
    const list=grid.get(Math.floor(x/STAIRS.gridM))?.get(Math.floor(z/STAIRS.gridM));if(!list)return null;
    let best=null,top=-Infinity;
    for(let i=0;i<list.length;i++){
      const r=list[i],dx=x-r.x,dz=z-r.z,u=dx*r.ux+dz*r.uz;
      if(u< -STAIRS.edgeEpsilonM||u>r.end+STAIRS.edgeEpsilonM||Math.abs(-dx*r.uz+dz*r.ux)>r.half+STAIRS.edgeEpsilonM)continue;
      const y=rampY(r,x,z);if(y>top){top=y;best=r;}
    }
    return best;
  }
  const heightAt=(x,z)=>{const r=find(x,z),base=terrain.heightAt(x,z);return r?Math.max(base,rampY(r,x,z)):base;};
  // On the landing the ramp is level.
  const slopeAt=(x,z)=>{const r=find(x,z);return r&&rampY(r,x,z)>terrain.heightAt(x,z)?((x-r.x)*r.ux+(z-r.z)*r.uz>r.length?0:r.slope):terrain.slopeAt(x,z);};
  // Retain bounds/water restrictions, replacing only the original slope test on ramps.
  function blockedPoint(x,z,radius){
    const r=find(x,z);if(!r)return terrain.movementBlockedAt?.(x,z,radius)??null;
    const why=terrain.movementBlockedAt?.(x,z,0)??null;
    return why==='slope'?(slopeAt(x,z)>=(terrain.maxSlope??Infinity)?'slope':null):why;
  }
  function movementBlockedAt(x,z,r=0){
    if(!find(x,z))return terrain.movementBlockedAt?.(x,z,r)??null;
    return blockedPoint(x,z,0)||blockedPoint(x+r,z,0)||blockedPoint(x-r,z,0)||blockedPoint(x,z+r,0)||blockedPoint(x,z-r,0);
  }
  return {...terrain,heightAt,slopeAt,movementBlockedAt,walkable:(x,z)=>find(x,z)?!movementBlockedAt(x,z):terrain.walkable(x,z),
    inspectStairs(pos){
      let distance=Infinity,bearing=null;
      for(const r of ramps){
        const dx=pos.x-r.x,dz=pos.z-r.z,u=Math.max(0,Math.min(r.end,dx*r.ux+dz*r.uz)),v=Math.max(-r.half,Math.min(r.half,-dx*r.uz+dz*r.ux));
        const x=r.x+r.ux*u-r.uz*v,z=r.z+r.uz*u+r.ux*v,ex=x-pos.x,ez=z-pos.z,d=Math.hypot(ex,ez,(pos.y??heightAt(x,z))-heightAt(x,z));
        if(d<distance){distance=d;bearing=(Math.atan2(ex,-ez)*180/Math.PI+360)%360;}
      }
      return {count:ramps.length,nearest:{distance:Number.isFinite(distance)?distance:null,bearing},under:find(pos.x,pos.z)?.id??null,height:heightAt(pos.x,pos.z),base:terrain.heightAt(pos.x,pos.z)};
    },
    disposeStairs(){grid.clear();ramps.length=0;}
  };
}
