// Existing river stones and harbour hulls, with original timber construction; no additional palette or assets.
import * as THREE from '../vendor/three.module.min.js';
import { rockGeometry, RIVERLIFE_ART } from './kamakura-riverlife-kit.js';
import { harborGeometry, HARBOR_ART } from './kamakura-harbor-kit.js';
import { WORKS } from './kamakura-works.js';
import { riverlifeHash as hash } from './kamakura-river-rocks.js';
export const WORKS_ART = Object.freeze({
  rockDebug: RIVERLIFE_ART.rockDebug, deckDebug: RIVERLIFE_ART.deckDebug, pileDebug: RIVERLIFE_ART.pierDebug, boatDebug: RIVERLIFE_ART.foamDebug, // unlit masks, inherited.
  wetHeight: .6, wetRatio: RIVERLIFE_ART.wetGain/RIVERLIFE_ART.dryGain, // m / gain: sea-wetted stone below the splash line.
  mastHeight: HARBOR_ART.mastHeight, yardHeight: HARBOR_ART.sailBottom, yardWidth: HARBOR_ART.sailWidth, // m: existing rig lowered and furled at the yard.
  furledDiameter: .28, furledSides: 6, mastWidth: .12, yardDiameter: .1, // m / sides / m / m: rolled sail and timber rig.
  farPierPosts: 2, // pairs: end supports in distant piers.
  farFootTurn: 20, farFootSkew: Object.freeze([0,-5,10,-8]), farFoot: Object.freeze([.5,.46,.5,.44]), // degrees / degrees / radius: the far block's foot.
  farCrownTurn: 35, farCrown: Object.freeze([.3,.24,.34,.2]), farCrownHeight: Object.freeze([.5,.36,.44,.3]), // degrees / radius / height: its tilted top.
  stoneScale: .96, // diameter fraction: far rounded silhouette follows the near boulder.
  // Parent (real Chrome): the river stone (a smooth warped dome with a mossy top) read as rows of green bushes when it was
  // made two to four metres wide. A sea wall is built of bare, broken stone: an angular block, the colour of the dry stone only.
  boulderSides: 7, boulderRings: 4, // tessellation: 42 triangles, the budget of the stone it replaces.
  boulderRough: .3, boulderCuts: 4, cutMin: .26, cutMax: .4, // radius fraction pushed in or out / flat faces / their distance from the centre.
  boulderTop: 1.14, boulderFoot: .76, boulderGrain: .16, // gains: sun-bleached crown, shaded foot, variation from point to point.
  toneMin: .8, toneRange: .36, // gain: each stone is a little lighter or darker than its neighbours.
});
const A=WORKS_ART, W=WORKS;
const tint = hex => new THREE.Color(hex);
function builder() {
  const positions=[],colors=[],centers=[],sails=[];
  function tri(a,b,c,color,center=[0,0,0],sail=0) {positions.push(...a,...b,...c);for(let i=0;i<3;i++){colors.push(color.r,color.g,color.b);centers.push(...center);sails.push(sail);}}
  function quad(a,b,c,d,color,center,sail) {tri(a,b,c,color,center,sail);tri(a,c,d,color,center,sail);}
  function add(geometry,color=null,center=[0,0,0],sail=0,filter=null) {
    const g=geometry.index?geometry.toNonIndexed():geometry,p=g.attributes.position,c=g.attributes.color;
    for(let i=0;i<p.count;i+=3) {
      if(filter&&!filter(g,i)) continue;
      tri([p.getX(i),p.getY(i),p.getZ(i)],[p.getX(i+1),p.getY(i+1),p.getZ(i+1)],[p.getX(i+2),p.getY(i+2),p.getZ(i+2)],color??new THREE.Color(c.getX(i),c.getY(i),c.getZ(i)),center,typeof sail==='function'?sail(g,i):sail);
    }
    g.dispose();if(g!==geometry)geometry.dispose();
  }
  function box(x,y,z,w,h,d,color,center=[0,0,0],yaw=0,sail=0) {const g=new THREE.BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,y,z);add(g,color,center,sail);}
  function pole(p,width,color,center,cap=true) {
    const g=new THREE.CylinderGeometry(width/2,width/2,p.top-p.bottom,4,1,true);g.translate(p.x,(p.top+p.bottom)/2,p.z);add(g,color,center);
    const y=p.top,r=width/2;if(cap)quad([p.x-r,y,p.z],[p.x,y,p.z+r],[p.x+r,y,p.z],[p.x,y,p.z-r],color,center);
  }
  function finish() {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    g.setAttribute('aWorksCenter',new THREE.Float32BufferAttribute(centers,3));g.setAttribute('aWorksSailPart',new THREE.Float32BufferAttribute(sails,1));g.computeVertexNormals();g.computeBoundingSphere();return g;
  }
  return {tri,quad,add,box,pole,finish};
}
// Original low-poly boulder. All four variants keep the sphere's vertex order, so an instance may take any of them.
export function boulderGeometry(variant=0) {
  const source=rockGeometry(0),sc=source.attributes.color,sp=source.attributes.position;let dry=0,best=Infinity;
  // One source of colour: the dry band of the existing river stone (no moss, no wet foot; the splash line is added in the shader).
  for(let i=0;i<sp.count;i++){const d=Math.abs(sp.getY(i)-.5);if(d<best){best=d;dry=i;}}
  const stone=new THREE.Color(sc.getX(dry),sc.getY(dry),sc.getZ(dry));source.dispose();
  const g=new THREE.SphereGeometry(.5,A.boulderSides,A.boulderRings),p=g.attributes.position,colors=[];
  const cuts=Array.from({length:A.boulderCuts},(_,k)=>{
    const yaw=hash(variant*7+k,101)*Math.PI*2,pitch=(hash(variant*7+k,103)-.3)*1.2,c=Math.cos(pitch);
    return {x:Math.cos(yaw)*c,y:Math.sin(pitch),z:Math.sin(yaw)*c,o:A.cutMin+(A.cutMax-A.cutMin)*hash(variant*7+k,107)};
  });
  const keys=[];let lo=Infinity,hi=-Infinity;
  for(let i=0;i<p.count;i++){
    let x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    // The sphere repeats its seam column and its poles; the key follows the position, so the copies stay welded.
    const key=Math.round(x*97)+Math.round(y*89)*31+Math.round(z*83)*961;keys.push(key);
    const r=1+A.boulderRough*(hash(key,variant+113)-.6);x*=r;y*=r;z*=r;
    for(const c of cuts){const d=x*c.x+y*c.y+z*c.z-c.o;if(d>0){x-=d*c.x;y-=d*c.y;z-=d*c.z;}}
    p.setXYZ(i,x,y,z);lo=Math.min(lo,y);hi=Math.max(hi,y);
  }
  for(let i=0;i<p.count;i++){
    const y=(p.getY(i)-lo)/(hi-lo);p.setY(i,y); // height exactly 0..1: the seat and the waterline rule rely on it.
    const gain=(A.boulderFoot+(A.boulderTop-A.boulderFoot)*y)*(1+A.boulderGrain*(hash(keys[i],127)-.5));
    colors.push(stone.r*gain,stone.g*gain,stone.b*gain);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
export function worksRockGeometry(far=false) {
  const models=Array.from({length:4},(_,i)=>boulderGeometry(i));
  // SphereGeometry retains unused seam-pole vertices; give those a finite unit normal as well.
  for(const g of models){const n=g.attributes.normal,p=g.attributes.position;for(let i=0;i<n.count;i++)if(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))===0)n.setXYZ(i,0,p.getY(i)>.5?1:-1,0);}
  if(!far) {
    const g=models[0];g.translate(0,-.5,0);
    for(let i=1;i<models.length;i++) {
      models[i].translate(0,-.5,0);g.setAttribute('aWorksShape'+i,models[i].attributes.position.clone());models[i].dispose();
    }
    return g;
  }
  const b=builder(),source=models[0],p=source.attributes.position,c=source.attributes.color;
  const colorAt=y=>{let at=0,delta=Infinity;for(let i=0;i<p.count;i++)if(Math.abs(p.getY(i)-y)<delta){delta=Math.abs(p.getY(i)-y);at=i;}return new THREE.Color(c.getX(at),c.getY(at),c.getZ(at));};
  // Parent (real Chrome, 600 m through a long lens): a pointed double pyramid made the wall a row of small tents. The far stone is
  // a lopsided block instead: four leaning sides and a tilted flat top (ten triangles; the buried underside is not drawn).
  const middle=colorAt(.5),top=colorAt(1),bottom=colorAt(0),foot=[],crown=[];
  for(let i=0;i<4;i++) {
    const a=(A.farFootTurn+i*90+A.farFootSkew[i])*Math.PI/180,d=(A.farCrownTurn+i*90)*Math.PI/180,r=A.farFoot[i]*A.stoneScale,q=A.farCrown[i]*A.stoneScale;
    foot.push([Math.cos(a)*r,-.5,Math.sin(a)*r]);crown.push([Math.cos(d)*q,A.farCrownHeight[i],Math.sin(d)*q]);
  }
  for(let i=0;i<4;i++) {const j=(i+1)%4,side=middle.clone().lerp(bottom,i%2?.35:.6);b.tri(foot[i],crown[i],crown[j],side);b.tri(foot[i],crown[j],foot[j],side);}
  b.tri(crown[0],crown[2],crown[1],top);b.tri(crown[0],crown[3],crown[2],top);
  for(const g of models)g.dispose();return b.finish();
}
export function worksPierGeometry(piers,far=false,debug=false) {
  const b=builder(),wood=tint(HARBOR_ART.wood),plank=tint(HARBOR_ART.plank),yellow=tint(A.deckDebug),orange=tint(A.pileDebug);
  for(const p of piers) {
    const center=[p.x,p.y,p.z],edge=debug?yellow:wood,support=debug?orange:wood;
    if(far) {
      for(const s of p.spans)b.box(s.x,p.deck-W.thickness/2,s.z,s.length,W.thickness,p.width,debug?yellow:plank,center,-Math.atan2(s.uz,s.ux));
      // Four long piles keep the end silhouette seated in the bed; no floating slab.
      for(const pile of [...p.piles.slice(0,A.farPierPosts),...p.piles.slice(-A.farPierPosts)])b.box(pile.x,(pile.top+pile.bottom)/2,pile.z,W.pileDiameter,pile.top-pile.bottom,W.pileDiameter,support,center);
      continue;
    }
    for(const board of p.boards) {
      const dx=board.ux*board.length/2,dz=board.uz*board.length/2,ox=-board.uz*p.width/2,oz=board.ux*p.width/2,y=p.deck,color=debug?yellow:plank.clone().multiplyScalar(board.tone);
      b.quad([board.x-dx-ox,y,board.z-dz-oz],[board.x-dx+ox,y,board.z-dz+oz],[board.x+dx+ox,y,board.z+dz+oz],[board.x+dx-ox,y,board.z+dz-oz],color,center);
    }
    for(const s of p.spans) {
      const dx=s.ux*s.length/2,dz=s.uz*s.length/2,ox=-s.uz*p.width/2,oz=s.ux*p.width/2;
      const corners=[[s.x-dx-ox,s.z-dz-oz],[s.x-dx+ox,s.z-dz+oz],[s.x+dx+ox,s.z+dz+oz],[s.x+dx-ox,s.z+dz-oz]];
      for(let i=0;i<4;i++){const a=corners[i],d=corners[(i+1)%4];b.quad([a[0],p.deck,a[1]],[a[0],p.deck-W.thickness,a[1]],[d[0],p.deck-W.thickness,d[1]],[d[0],p.deck,d[1]],edge,center);}
    }
    for(const pile of p.piles)b.pole(pile,W.pileDiameter,support,center,false);
    for(const post of p.bollards)b.pole(post,W.pileDiameter,support,center);
    for(const beam of p.beams) {
      // Open underside girder: only its four long faces (8 triangles).
      const g=new THREE.BoxGeometry(beam.length,W.beamDepth,W.beamWidth).toNonIndexed();g.rotateY(-Math.atan2(beam.ux,beam.uz));g.translate(beam.x,p.deck-W.thickness-W.beamDepth/2,beam.z);
      b.add(g,support,center,0,(_,i)=>i>=12); // Box sides x are internal end caps; retain the other four faces.
    }
  }
  return b.finish();
}
export function worksBoatGeometry(far=false,debug=false) {
  const b=builder(),cyan=tint(A.boatDebug),wood=tint(HARBOR_ART.wood),mat=tint(HARBOR_ART.mat);
  // Keep both public hull recipes: small craft have spare poles/net bundles; offshore craft have a cabin/rudder.
  const inRecipe=(g,i,recipe)=>{const p=g.attributes.position;for(let j=i;j<i+3;j++)for(let k=0;k<3;k++)if(Math.abs(p.array[j*3+k]-recipe[k])>recipe[k+3]/2+1e-6)return false;return true;};
  b.add(harborGeometry('craft',far),debug?cyan:null,[0,0,0],(g,i)=>!far&&(g.attributes.aHarborBundleVertex.getX(i)>.5||inRecipe(g,i,HARBOR_ART.sparePole))?-1:0,(g,i)=>g.attributes.aHarborRigVertex.getX(i)<.5);
  if(!far)b.add(harborGeometry('sail'),debug?cyan:null,[0,0,0],1,(g,i)=>inRecipe(g,i,HARBOR_ART.deckhouseBox)||inRecipe(g,i,HARBOR_ART.rudderBox));
  const color=debug?cyan:wood;
  b.box(0,A.mastHeight/2,0,A.mastWidth/W.sailWidth,A.mastHeight,A.mastWidth/W.sailLength,color,[0,0,0],0,1);
  b.box(0,A.yardHeight,0,A.yardWidth/W.sailWidth,A.yardDiameter,A.yardDiameter/W.sailLength,color,[0,0,0],0,1);
  if(far)b.box(0,A.yardHeight+A.furledDiameter/2,0,A.yardWidth/W.sailWidth,A.furledDiameter,A.furledDiameter/W.sailLength,debug?cyan:mat,[0,0,0],0,1);
  else {
    const g=new THREE.CylinderGeometry(A.furledDiameter/2,A.furledDiameter/2,A.yardWidth,A.furledSides,1,true);
    g.rotateZ(Math.PI/2);g.translate(0,A.yardHeight+A.furledDiameter/2,0);g.scale(1/W.sailWidth,1,1/W.sailLength);b.add(g,debug?cyan:mat,[0,0,0],1);
  }
  return b.finish();
}
