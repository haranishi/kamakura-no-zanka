import { buildColliders, moveActor } from '../../dist/valley/collision.js';
import { houseBox, houseIntersects } from '../../dist/valley/kamakura-houses.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { bridgeSites, withBridgeDecks, bridgeRailBoxes } from '../../dist/valley/kamakura-bridges.js';
import { prepareVeg, vegCircles } from '../../dist/valley/kamakura-veg.js';
import { kamakuraPaths } from '../../dist/valley/kamakura-roads.js';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { northOffset, gameZ } from './designed-terrain.mjs';
import { facilityBoxes } from './designed-placement.mjs';
// Directed physical edges: moveActor must arrive and must be able to return. No teleport or relaxed slope/step rule.
export function designedMovement(data,beforeCount,{step=2,includeTrees=true}={}) {
  const base=createKamakuraTerrain(data),sites=bridgeSites(data,base),terrain=withBridgeDecks(base,sites),houses=data.houses.instances.map(p=>houseBox(data.houses.kinds.get(p.kind),p.matrix));
  const facilities=facilityBoxes(data.facilities.nodes.filter(n=>['hall','buddha'].includes(n.part))),rails=bridgeRailBoxes(sites,terrain);
  const trees=includeTrees?vegCircles(prepareVeg(data.veg,terrain,{boxes:[...houses,...facilities],paths:kamakuraPaths(data),spawn:{x:data.meta.spawn.x,z:-data.meta.spawn.y}}),sp=>[20,12,13,8,3,1.2][sp]):[];
  const col=buildColliders({bounds:terrain.bounds,extraBoxes:[...houses,...facilities,...rails],extraCircles:trees}),old=buildColliders({bounds:terrain.bounds,extraBoxes:[...houses.slice(0,beforeCount),...facilities,...rails],extraCircles:trees});
  const minX=-340,maxX=370,minY=-24,maxY=744,w=Math.floor((maxX-minX)/step)+1,h=Math.floor((maxY-minY)/step)+1,n=w*h;
  const x=k=>minX+(k%w)*step,z=k=>gameZ(minY+Math.floor(k/w)*step),heights=new Float32Array(n),open=new Uint8Array(n),oldOpen=new Uint8Array(n),edges=new Uint8Array(n),oldEdges=new Uint8Array(n);
  let source=-1,distance=Infinity,moves=0;
  const occupied=(c,x,z)=>{for(let i=Math.floor((x-.3)/8);i<=Math.floor((x+.3)/8);i++)for(let j=Math.floor((z-.3)/8);j<=Math.floor((z+.3)/8);j++)for(const b of c.grid.get(i+','+j)||[]){if(b.type==='box'?houseIntersects(b,{x,z},undefined,.3):Math.hypot(x-b.x,z-b.z)<b.r+.3)return true;}return false;};
  for(let k=0;k<n;k++){const px=x(k),pz=z(k);heights[k]=terrain.heightAt(px,pz);if(!terrain.walkable(px,pz)||terrain.waterAt(px,pz)>.45||occupied(old,px,pz))continue;oldOpen[k]=1;if(!occupied(col,px,pz))open[k]=1;const d=Math.hypot(px-data.meta.spawn.x,pz+data.meta.spawn.y);if(open[k]&&d<distance){distance=d;source=k;}}
  const dx=[1,-1,0,0],dy=[0,0,1,-1],opposite=[1,0,3,2];
  for(let k=0;k<n;k++)if(oldOpen[k])for(let dir=0;dir<4;dir++){
    const i=k%w+dx[dir],j=Math.floor(k/w)+dy[dir],q=j*w+i;if(i<0||i>=w||j<0||j>=h||!oldOpen[q])continue;
    const a={x:x(k),y:heights[k],z:z(k)},move=c=>{moves++;const p=moveActor(c,terrain,a,dx[dir]*step,-dy[dir]*step);return Math.hypot(p.x-x(q),p.z-z(q))<.05;};
    if(move(old))oldEdges[k]|=1<<dir;
    if(open[k]&&open[q]&&move(col))edges[k]|=1<<dir;
  }
  const connections=new Map(),oldConnections=new Map(),routeChecks=[];
  const closest=(px,py,mask)=>{let k=-1,d=Infinity;for(let j=0;j<n;j++)if(mask[j]){const q=Math.hypot(x(j)-px,northOffset-z(j)-py);if(q<d){d=q;k=j;}}return k;};
  function trace(c,points) {
    let pos={x:points[0][0],z:gameZ(points[0][1]),y:terrain.heightAt(points[0][0],gameZ(points[0][1]))};
    for(let i=1;i<points.length;i++) {const p=points[i],dx=p[0]-pos.x,dz=gameZ(p[1])-pos.z,length=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(length/.5));
      for(let j=0;j<steps;j++){moves++;const q=moveActor(c,terrain,pos,dx/steps,dz/steps);pos=q;}
      if(Math.hypot(pos.x-p[0],pos.z-gameZ(p[1]))>.05)return {ok:false,segment:i,why:pos.blocked};
    }return {ok:true};
  }
  // A 3m diagonal trail can fall between 2m lattice nodes. Verify its actual centreline in both directions,
  // then add that physical connection rather than interpreting undersampling as an impassable trail.
  for(const road of P.roads.filter(p=>p.kind==='trail'||p.id==='west')) {
    for(const [c,mask,map,label] of [[col,open,connections,'after'],[old,oldOpen,oldConnections,'before']]) {
      const first=road.points[0],last=road.points.at(-1),a=closest(...first,mask),b=closest(...last,mask);
      if(a<0||b<0)continue;const points=[[x(a),northOffset-z(a)],...road.points,[x(b),northOffset-z(b)]],forward=trace(c,points),back=trace(c,[...points].reverse());
      routeChecks.push({road:road.id,phase:label,forward,back});
      if(forward.ok&&back.ok){if(!map.has(a))map.set(a,[]);if(!map.has(b))map.set(b,[]);map.get(a).push(b);map.get(b).push(a);}
    }
  }
  function reach(graph,reverse=false) {const seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;if(source>=0){seen[source]=1;queue[tail++]=source;}while(head<tail){const k=queue[head++];for(const q of (graph===edges?connections:oldConnections).get(k)||[])if(!seen[q]){seen[q]=1;queue[tail++]=q;}for(let dir=0;dir<4;dir++){const i=k%w+dx[dir],j=Math.floor(k/w)+dy[dir],q=j*w+i;if(i<0||i>=w||j<0||j>=h||seen[q])continue;if(reverse?graph[q]&(1<<opposite[dir]):graph[k]&(1<<dir)){seen[q]=1;queue[tail++]=q;}}}return seen;}
  const forward=reach(edges),back=reach(edges,true),oldForward=reach(oldEdges),oldBack=reach(oldEdges,true);let newTraps=0,enclosed=0,reached=0;
  for(let k=0;k<n;k++){if(forward[k])reached++;if(forward[k]&&!back[k]&&!(oldForward[k]&&!oldBack[k]))newTraps++;if(oldForward[k]&&oldBack[k]&&open[k]&&!forward[k])enclosed++;}
  const destinations=[['社殿の上の段',24,700],['大仏の前',-235,120],['港の岸',(P.harbor.quay[0]+P.harbor.quay[1])/2,(P.harbor.quay[2]+P.harbor.quay[3])/2],['浜の西端',-250,40],['浜の東端',110,40],['建長寺の段',-198,630],['浄智寺の段',-270,460]];
  for(const [i,s] of sites.entries())for(const [side,u] of [['西岸',s.start-2],['東岸',s.end+2]])destinations.push([`橋${i+1}${side}`,s.x+s.ux*u,northOffset-s.z-s.uz*u]);
  const goals=destinations.map(([name,px,py])=>{let best=-1,d=Infinity;for(let k=0;k<n;k++)if(open[k]){const q=Math.hypot(x(k)-px,northOffset-z(k)-py);if(q<d){d=q;best=k;}}return {name,distance:d,forward:best>=0&&!!forward[best],back:best>=0&&!!back[best]};});
  return {cells:n,reached,moves,newTraps,enclosed,goals,routeChecks};
}
