import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from '../dist/vendor/three.module.min.js';
import { FIRE, FIRE_SMOKE_GLSL, fireEnabled, fireDayGain, validateFires, selectFireHouses, prepareFires, fireCounts, smokeProfile, emberOrigin, poolOcclusion, fireHouseLayout, flameTongue, smokeLight, FIRE_SMOKE_LIGHT_GLSL } from '../dist/valley/kamakura-fire.js';
import { createKamakuraFire, FIRE_VERTEX, FIRE_FRAGMENT, FIRE_POOL_VERTEX, FIRE_POOL_FRAGMENT } from '../dist/valley/kamakura-fire-view.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
const source=name=>fs.readFileSync(new URL('../dist/valley/'+name,import.meta.url),'utf8');
const meta={grid:{width:301,height:301,cell_m:2}};
const fire=(x=0,y=0,strength=1)=>({x,y,radius_m:30,strength});
const boxes=Array.from({length:12},(_,i)=>({id:'house-'+i,x:(i%4)*5-7,z:Math.floor(i/4)*6-6,w:4,d:5,height:5,rotY:.2}));
function fixture(options={}){
  const {search='?debug=1&time=evening',quality='standard',houses=boxes}=options, fires=Object.hasOwn(options,'fires')?options.fires:[fire()];
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(-250,65,-220);scene.fog=new THREE.FogExp2('#8a9ab0',.001);
  const context={scene,camera,search,quality,data:{meta:{...meta,fires}},terrain:{heightAt:(x,z)=>2+x*.02+z*.01},houses:{boxes:houses},
    wind:{uWind:{value:1},uWindDir:{value:new THREE.Vector2(.8,.2)}}};
  const layer=createKamakuraFire(context),frame={dt:1/60,camera,pos:{x:0,y:2,z:0},flying:false};
  return {context,layer,frame};
}

test('metadata accepts absent/empty and edge values; rejects malformed, out-of-map and out-of-range entries',()=>{
  for(const fires of [undefined,[],[fire()],[{x:-300,y:300,radius_m:4,strength:.2}]])validateFires(fires,meta);
  const bad=[null,{},'fires',Array.from({length:9},()=>fire()),[null],[{}],[{...fire(),x:301}],[{...fire(),y:-301}],
    ...['x','y','radius_m','strength'].flatMap(key=>[NaN,Infinity,'1',null,undefined].map(value=>[{...fire(),[key]:value}])),
    [{...fire(),radius_m:3.99}],[{...fire(),radius_m:30.01}],[{...fire(),strength:.199}],[{...fire(),strength:1.001}]];
  for(const input of bad)assert.throws(()=>validateFires(input,meta),/火元/);
  assert.throws(()=>validateFires([fire()],{}));
  // Follow the real loader's call chain, not only the standalone validator.
  assert(source('kamakura-data.js').includes('validateFires(m.fires, m);'));
  const valid={schema:'kz-world-web/0.1',grid:{...meta.grid,row0:'north',col0:'west',sample_position:'cell_center',x_axis:'east',y_axis:'north',z_axis:'up'},
    height:{encoding:'uint16-le',min_m:0,max_m:10,file:'height_u16.bin'},walk:{file:'walk_u8.bin',polygon_m:[[-10,-10],[10,-10],[10,10],[-10,10]]},
    spawn:{x:0,y:0,z:0,yaw_deg_clockwise_from_north:0},places:[],fires:[fire()]};
  assert.equal(validateMeta(valid),valid);assert.throws(()=>validateMeta({...valid,fires:[{...fire(),strength:2}]}),/火元/);
});

test('zero sources and fire=0 create no scene objects or debug hook',()=>{
  for(const opts of [{fires:undefined},{fires:[]},{search:'?fire=0'},{search:'?fire=0',fires:[{bad:true}]}]){
    const f=fixture(opts);assert.equal(f.layer,null);assert.equal(f.context.scene.children.length,0);
  }
  assert(fireEnabled(''));assert(!fireEnabled('?fire=0'));
});

test('house selection is deterministic, radius bounded and strength monotone; no house gives ground fire',()=>{
  const outside={...boxes[0],id:'outside',x:31,z:0};
  const high=selectFireHouses(fire(),[...boxes,outside]),low=selectFireHouses(fire(0,0,.2),boxes);
  assert.equal(high.length,6);assert.equal(low.length,2);assert(low.every(b=>high.includes(b)));
  assert.deepEqual(high,selectFireHouses(fire(),[...boxes,outside].reverse()));
  assert(high.every(b=>Math.hypot(b.x,b.z)<=30));
  const f=fixture({houses:[]}),p=prepareFires(f.context);assert(p.sources[0].houses[0].ground);assert.equal(p.sources[0].houses[0].x,0);f.layer.dispose();
  const g=fixture();g.context.data.houses={instances:[{id:high[0].id.slice(6),grounded:Array.from({length:16},(_,i)=>i===13?7:0)}]};
  const p2=prepareFires(g.context);assert.equal(p2.sources[0].houses[0].y,7);g.layer.dispose();
});

test('all counts fit 900 boards; light and adaptation reduce costs without losing any source',t=>{
  const f=fixture({fires:Array.from({length:8},()=>fire())}),p=prepareFires(f.context),measure=[];
  for(const quality of ['standard','light']){
    let previous=Infinity;
    for(let step=0;step<=3;step++){
      const count=fireCounts(p,quality,step);assert(count.boards<=900);assert(count.boards<=previous);previous=count.boards;
      assert(count.sources.every(s=>s.flames>=3&&s.glows>=2&&s.smoke>=4&&s.embers>0));
      if(quality==='standard'&&step===0)assert(count.sources.every(s=>s.embers>=20&&s.embers<=60&&s.smoke>=24&&s.smoke<=40));
      measure.push({quality,step,boards:count.boards});
    }
  }
  t.diagnostic(JSON.stringify(measure));f.layer.dispose();
});

test('mixed source sizes keep every cross, roof, opening and smoke column within the complete board budget',t=>{
  let maximum=0,cases=0;
  for(let size=1;size<=8;size++)for(let full=1;full<=6;full++)for(const strength of [.2,.45,.8,1]){
    const sources=Array.from({length:size},(_,i)=>({houses:Array.from({length:Math.max(1,full-i%3)},()=>({ground:full===1})),strength:i%2?strength:1}));
    for(const quality of ['standard','light']){
      let previous=Infinity;
      for(let step=0;step<=3;step++){
        const count=fireCounts({sources},quality,step);cases++;maximum=Math.max(maximum,count.boards);
        assert(count.boards<=900&&count.boards<=previous);previous=count.boards;
        assert.equal(count.boards,count.sources.reduce((sum,s)=>sum+s.flames+s.coals+s.openings+s.glows+s.smoke+s.pools+s.embers,0));
        count.sources.forEach((s,i)=>{
          assert(s.tongues>=3&&s.planes>=2&&s.planes<=3);
          assert.equal(s.flames,s.houses*s.tongues*s.planes);
          assert.equal(s.coals,sources[i].houses[0].ground?0:s.houses*2);
          assert.equal(s.openings,sources[i].houses[0].ground?0:s.houses);
          if(quality==='standard'&&step===0)assert(s.smoke>=24&&s.smoke<=40&&s.embers>=20);
        });
      }
    }
  }
  t.diagnostic(JSON.stringify({cases,maximum}));
});

test('every tongue has crossed fixed planes on both ridge and openings, with varied heights and buried roots',()=>{
  for(const quality of ['standard','light'])for(const rotY of [0,.73,Math.PI/2]){
    const house={id:'house-roof',x:0,z:0,y:2,w:10,d:6,height:7,rotY},f=fixture({houses:[house],quality});
    const prepared=prepareFires(f.context),s=prepared.sources[0],h=s.houses[0];
    for(let step=0;step<=3;step++){
      f.layer.setAdapt(step);
      const g=f.context.scene.children[0].geometry,n=fireCounts(prepared,quality,step).sources[0];
      let roof=0,opening=0;const heights=new Set();
      for(let k=0;k<n.tongues;k++){
        const tongue=flameTongue(s,h,k,n.tongues),a=g.attributes.fireAnchor,r=g.attributes.fireRight;
        assert.deepEqual(tongue,flameTongue(s,h,k,n.tongues));heights.add(tongue.height);
        if(tongue.opening)opening++;else roof++;
        const localY=tongue.y-h.y+tongue.height*FIRE.roofEmbed;
        assert(tongue.y<localY+h.y,'flame base must lie inside its roof/opening');
        if(!tongue.opening)assert(Math.abs(localY-h.height)<1e-9);
        for(let p=0;p<n.planes;p++){
          const i=k*n.planes+p;
          assert(Math.abs(a.getX(i)-tongue.x)<1e-5&&Math.abs(a.getY(i)-tongue.y)<1e-5&&Math.abs(a.getZ(i)-tongue.z)<1e-5);
          assert.equal(g.attributes.fireSize.getZ(i),0);assert.equal(g.attributes.fireSize.getW(i),tongue.opening?1:0);
          if(p){const prev=i-1,dot=r.getX(i)*r.getX(prev)+r.getZ(i)*r.getZ(prev);assert(Math.abs(dot-Math.cos(FIRE.flameCrossRad/n.planes))<1e-6);}
        }
        for(let bearing=0;bearing<Math.PI*2;bearing+=.1){
          let visibleWidth=0;
          for(let p=0;p<n.planes;p++){const i=k*n.planes+p;visibleWidth=Math.max(visibleWidth,Math.abs(r.getX(i)*Math.cos(bearing)+r.getZ(i)*Math.sin(bearing)));}
          assert(visibleWidth>=.7,'a horizontal view must always see a broad plane');
        }
      }
      assert(roof>=2&&opening>=1);assert(heights.size>=2);
      const anchors=Array.from(g.attributes.fireAnchor.array.slice(0,g.instanceCount*4));
      f.context.camera.position.set(300,60,150);f.layer.update(f.frame);
      assert.deepEqual(Array.from(g.attributes.fireAnchor.array.slice(0,g.instanceCount*4)),anchors);
    }
    f.layer.dispose();
  }
  assert(FIRE_VERTEX.includes('right=fireRight;up=fireUp;'));
});

test('coal faces follow both pitched roof slopes; facade light uses existing front door/window positions',()=>{
  for(const [w,d] of [[10,6],[4,9]])for(const rotY of [0,.73]){
    const house={id:'roof',x:0,y:2,z:0,w,d,height:7,rotY,ground:false},layout=fireHouseLayout(house);
    assert.equal(layout.roofs.length,2);assert.equal(layout.openings[0].kind,'door');
    assert.equal(layout.openings.filter(o=>o.kind==='window').length,w>=FIRE.twoWindowsM?2:1);
    for(const face of layout.roofs)for(const u of [-.5,.5])for(const v of [-.5,.5]){
      const x=face.x+face.right[0]*u*face.w+face.up[0]*v*face.h-house.x,z=face.z+face.right[2]*u*face.w+face.up[2]*v*face.h-house.z;
      const dx=Math.cos(rotY)*x-Math.sin(rotY)*z,dz=Math.sin(rotY)*x+Math.cos(rotY)*z;
      const cross=layout.alongX?dz:dx,y=face.y+face.up[1]*v*face.h;
      assert(Math.abs(y-(house.y+house.height-FIRE.roofSlope*Math.abs(cross)+FIRE.surfaceLiftM))<1e-9);
    }
    for(const o of layout.openings){
      const front=Math.sin(rotY)*(o.x-house.x)+Math.cos(rotY)*(o.z-house.z);
      assert(Math.abs(front-d/2)<1e-9);assert(o.y-o.h/2>=house.y);
    }
    const f=fixture({houses:[house]}),g=f.context.scene.children[0].geometry;
    const kinds=Array.from({length:g.instanceCount},(_,i)=>g.attributes.fireSize.getZ(i));
    assert.equal(kinds.filter(k=>k===4).length,2);assert.equal(kinds.filter(k=>k===5).length,1);
    for(const [kind,faces] of [[4,layout.roofs],[5,[layout.facade]]]){
      const slots=kinds.flatMap((k,i)=>k===kind?[i]:[]);
      faces.forEach((face,j)=>{
        const i=slots[j],a=g.attributes.fireAnchor,r=g.attributes.fireRight,u=g.attributes.fireUp;
        assert(Math.abs(a.getX(i)-face.x)<1e-5&&Math.abs(a.getY(i)-face.y)<1e-5&&Math.abs(a.getZ(i)-face.z)<1e-5);
        for(let k=0;k<3;k++){assert(Math.abs(r.array[i*3+k]-face.right[k])<1e-6);assert(Math.abs(u.array[i*3+k]-face.up[k])<1e-6);}
      });
    }
    assert(FIRE_FRAGMENT.includes('amount=max(door,windowLight)'),'wall between the door and windows stays unlit');
    assert(FIRE.coalHz<=1.2&&FIRE.coalPulse<1);f.layer.dispose();
  }
});

test('strength .45 gives roughly half-width and .6 height, with a broad flattened tail and continuous disappearance',t=>{
  const low=fixture({fires:[fire(0,0,.45)]}),high=fixture(),a=prepareFires(low.context).sources[0],b=prepareFires(high.context).sources[0];
  const heightRatio=a.smokeHeight/b.smokeHeight;
  for(const seed of [0,.2,.5,1])for(const h of [0,.25,.5,.85,1]){
    const weak=smokeProfile(h,a.smokeHeight,1,0,{},seed,0,.45),strong=smokeProfile(h,b.smokeHeight,1,0,{},seed,0,1);
    assert(weak.radius/strong.radius>=.45&&weak.radius/strong.radius<=.55);
  }
  assert(heightRatio>=.55&&heightRatio<=.65);
  const mid=smokeProfile(.6,b.smokeHeight,1,0),tail=smokeProfile(.95,b.smokeHeight,1,0);
  assert(tail.radius>mid.radius);assert(FIRE.smokeTopAspect<FIRE.smokeAspect/2);
  for(const dt of [.01,.001,.0001]){
    const v=smokeProfile(1-dt,b.smokeHeight,1,0).opacity;
    assert(v>0&&v<20*dt*dt,'upper envelope must approach zero continuously with zero end slope');
  }
  assert.equal(smokeProfile(1,b.smokeHeight).opacity,0);
  t.diagnostic(JSON.stringify({widthRatio:smokeProfile(.5,1,1,0,{},0,0,.45).radius/smokeProfile(.5,1).radius,heightRatio}));
  low.layer.dispose();high.layer.dispose();
});

test('lower smoke takes the warm fire colour in dusk/evening; CPU and emitted shader share the light falloff',()=>{
  const body=FIRE_SMOKE_LIGHT_GLSL.match(/\{([\s\S]*)\}/)[1].replace(/float /g,'let ');
  const run=new Function('t','day','clamp',body),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  assert(FIRE_FRAGMENT.includes(FIRE_SMOKE_LIGHT_GLSL));
  assert(FIRE_FRAGMENT.includes('fireSmokeLight(vPlume,uDay)*inside'));
  for(const time of ['dusk','evening','noon']){
    const f=fixture({search:'?time='+time}),u=f.context.scene.children[0].material.uniforms,day=u.uDay.value;
    const soot=u.uSmoke.value,fireColor=u.uSmokeLit.value;
    for(const h of [0,.05,.125,.2,.25,.5,1]){
      const weight=smokeLight(h,day);assert(Math.abs(weight-run(h,day,clamp))<1e-8);
      const color=soot.clone().lerp(fireColor,weight);
      if(h<FIRE.smokeLitEnd){assert(color.r>soot.r);assert(color.r/color.b>soot.r/soot.b);}
      else assert.equal(weight,0);
    }
    if(time!=='noon')assert(smokeLight(.125,day)>=.3);
    f.layer.dispose();
  }
});

test('smoke broadens 3–5 times, leans downwind 0.3–0.6 heights and agrees with executable GLSL',()=>{
  const body=FIRE_SMOKE_GLSL.match(/\{([\s\S]*)\}/)[1].replace(/float /g,'let ')
    .replace('return vec4(', 'return [').replace(/\);\s*$/,'];');
  const run=new Function('t','height','wind','seed','time','strength','clamp','max','length','sin','pow',body);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  for(const height of [90,160])for(const wx of [-1,0,1])for(const wz of [-.3,0,.5])for(const seed of [0,.38,1])for(const time of [0,7,51])for(const strength of [.2,.6,1]){
    let last=0;
    for(const t of [0,.1,.5,.8,1]){
      const cpu=smokeProfile(t,height,wx,wz,{},seed,time,strength);
      const gpu=run(t,height,{x:wx,y:wz},seed,time,strength,clamp,Math.max,v=>Math.hypot(v.x,v.y),Math.sin,Math.pow);
      for(const [i,key] of ['radius','x','z','opacity'].entries())assert(Math.abs(cpu[key]-gpu[i])<1e-5,key);
      assert(cpu.radius>=last);last=cpu.radius;
      assert(cpu.opacity>=0&&cpu.opacity<=1);
      const windLength=Math.hypot(wx,wz);
      if(t===1){
        assert.equal(cpu.opacity,0);
        if(windLength){const lean=(cpu.x*wx+cpu.z*wz)/windLength/height;assert(lean>=.3&&lean<=.6);}
      }
    }
    const base=smokeProfile(0,height,wx,wz,{},seed,time,strength),top=smokeProfile(1,height,wx,wz,{},seed,time,strength);
    assert(top.radius/base.radius>=3&&top.radius/base.radius<=5);
  }
  assert(FIRE_VERTEX.includes(FIRE_SMOKE_GLSL));assert(FIRE_FRAGMENT.includes(FIRE_SMOKE_GLSL));
  // Fade the entire moving puff as well as clipping its world-height envelope.
  // Otherwise the still-dark lower half pops out when its centre recycles at the top.
  const lifeFade=FIRE_VERTEX.match(/vData.w=plume.w\/([^;]+);/)[1];
  const fade=new Function('plume','return plume.w/'+lifeFade);
  assert(FIRE_FRAGMENT.includes('alpha*=vData.w*'));
  assert.equal(fade({w:smokeProfile(1,160).opacity}),0);
  assert.equal(fade({w:smokeProfile(0,160).opacity}),0);
  // The column is whole up to the height where it begins to thin; that height stays between a quarter and three fifths of the way up.
  assert(FIRE.smokeFadeStart>=.25&&FIRE.smokeFadeStart<=.6);assert.equal(fade({w:smokeProfile(FIRE.smokeFadeStart,160).opacity}),1);assert(fade({w:smokeProfile((1+FIRE.smokeFadeStart)/2,160).opacity})<1);
  assert(FIRE_VERTEX.indexOf('vec3 toward=uCam-origin')>FIRE_VERTEX.indexOf('origin.y+=rise'),'all sprites face the eye at their animated position');
});

test('source size and phase vary deterministically; stronger fires are broader and taller',()=>{
  const f=fixture({fires:[fire(),fire(80),fire(-80)]}),a=prepareFires(f.context),b=prepareFires(f.context);
  assert.deepEqual(a,b);assert.equal(new Set(a.sources.map(s=>s.seed)).size,3);
  assert.equal(new Set(a.sources.map(s=>s.smokeHeight)).size,3);
  for(const s of a.sources){
    assert(s.smokeHeight>=FIRE.smokeMinM*(1-FIRE.smokeHeightVariation)&&s.smokeHeight<=160);
    const radius=smokeProfile(.5,s.smokeHeight,1,0,{},s.seed).radius;
    const widthPx=radius*2*941/(2*300*Math.tan(50*Math.PI/360));assert(widthPx>=25);
    const start=smokeProfile(.5,s.smokeHeight,1,0,{},s.seed,0),moved=smokeProfile(.5,s.smokeHeight,1,0,{},s.seed,4);
    assert.notEqual(start.z,moved.z);
  }
  const low=fixture({fires:[fire(0,0,.2)]}),lp=prepareFires(low.context).sources[0];
  assert(lp.smokeHeight<a.sources[0].smokeHeight);
  assert(smokeProfile(.5,lp.smokeHeight,1,0,{},lp.seed,0,.2).radius<smokeProfile(.5,a.sources[0].smokeHeight,1,0,{},a.sources[0].seed,0,1).radius);
  low.layer.dispose();f.layer.dispose();
});

test('smoke noise only erodes inward, so all four board borders stay transparent',()=>{
  const expr=FIRE_FRAGMENT.match(/float edge=([^;]+);/)[1];
  const edge=new Function('q','n','length','return '+expr),length=q=>Math.hypot(...q);
  for(const n of [0,.25,.5,.75,1])for(let t=-1;t<=1;t+=.1)for(const q of [[-1,t],[1,t],[t,-1],[t,1]])assert(edge(q,n,length)<=0);
  assert(edge([0,0],.5,length)>FIRE.smokeEdgeSoft,'the interior must retain dense soot');
});

test('crossed flame planes fade to zero at tips and sides, preserving a bright interior',()=>{
  const expression=FIRE_FRAGMENT.match(/float border=([^;]+);/)[1];
  const border=new Function('x','y','smoothstep','abs','return '+expression);
  const smoothstep=(a,b,x)=>{const u=Math.max(0,Math.min(1,(x-a)/(b-a)));return u*u*(3-2*u);};
  for(let t=0;t<=1;t+=.01){
    assert.equal(border(-1,t,smoothstep,Math.abs),0);assert.equal(border(1,t,smoothstep,Math.abs),0);
    assert.equal(border(t*2-1,1,smoothstep,Math.abs),0);
  }
  assert.equal(border(0,.5,smoothstep,Math.abs),1);assert(FIRE_FRAGMENT.includes('amount*=border;'));
});

test('embers scatter across a rotated synthetic roof without collinear triples and reproduce their anchors',()=>{
  const roof={id:'roof',x:13,y:3,z:-8,w:10,d:6,height:7,rotY:.7,ground:false};
  const s={index:2,houses:[roof]},points=Array.from({length:60},(_,i)=>emberOrigin(s,i));
  assert.deepEqual(points,Array.from({length:60},(_,i)=>emberOrigin(s,i)));
  assert.equal(new Set(points.map(p=>p.phase)).size,60);assert.equal(new Set(points.map(p=>p.variation)).size,60);
  for(const p of points){
    const x=p.x-roof.x,z=p.z-roof.z,dx=Math.cos(roof.rotY)*x-Math.sin(roof.rotY)*z,dz=Math.sin(roof.rotY)*x+Math.cos(roof.rotY)*z;
    assert(Math.abs(dx)<=roof.w*FIRE.emberRoofInset&&Math.abs(dz)<=roof.d*FIRE.emberRoofInset);
    assert(Math.abs(p.y-(roof.y+roof.height-FIRE.emberRoofSlope*Math.abs(dz)+FIRE.emberRoofLiftM))<1e-10);
  }
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)for(let k=j+1;k<points.length;k++){
    const a=points[i],b=points[j],c=points[k],area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
    assert(Math.abs(area)>1e-7,'three roof anchors must not form a line');
  }
  const f=fixture(),prepared=prepareFires(f.context),g=f.context.scene.children.find(m=>m.name==='kamakura-fire-ember').geometry;
  for(let i=0;i<g.instanceCount;i++){
    const p=emberOrigin(prepared.sources[0],i),a=g.attributes.fireAnchor;
    assert(Math.abs(a.getX(i)-p.x)<1e-5&&Math.abs(a.getY(i)-p.y)<1e-5&&Math.abs(a.getZ(i)-p.z)<1e-5);
    assert(Math.abs(g.attributes.fireSeed.getX(i)-p.phase)<1e-7);
  }
  assert(FIRE_VERTEX.includes('fireSize.w'));assert(FIRE_FRAGMENT.includes('sin(uTime*'+(FIRE.emberTwinkleHz*2*Math.PI).toFixed(8)));
  f.layer.dispose();
});

test('ground glow fades smoothly and loses light behind rotated houses with independent slow phases',()=>{
  const block={x:.3,z:0,w:.08,d:.08,cos:1,sin:0};
  assert(Math.abs(poolOcclusion(.8,0,[block])-FIRE.poolShadowKeep)<1e-12);
  assert.equal(poolOcclusion(.1,0,[block]),1);assert.equal(poolOcclusion(0,.8,[block]),1);
  assert.equal(poolOcclusion(-.8,0,[block]),1);assert.equal(poolOcclusion(.8,0,[{...block,x:0}]),1);
  const a=.7,c=Math.cos(a),s=Math.sin(a),rotated={...block,x:c*block.x,z:-s*block.x,cos:c,sin:s};
  assert(Math.abs(poolOcclusion(c*.8,-s*.8,[rotated])-FIRE.poolShadowKeep)<1e-12);
  for(let v=-1;v<=1;v+=.01)assert(Math.abs(poolOcclusion(.8,v,[block])-poolOcclusion(.8,v+1e-6,[block]))<.001);
  assert(FIRE.poolFlickerHz<=1.2&&FIRE.flickerHz<=1.2);
  const f=fixture({fires:[fire(),fire(80)]}),p=f.context.scene.children.find(m=>m.name==='kamakura-fire-pool'),u=p.material.uniforms;
  assert.notEqual(u.uPoolPhases.value[0],u.uPoolPhases.value[1]);
  const d=r=>Math.exp(-r*r*FIRE.poolFalloff)*(1-((x)=>x*x*(3-2*x))(Math.max(0,Math.min(1,(r-FIRE.poolEdgeStart)/(1-FIRE.poolEdgeStart)))));
  assert.equal(d(0),1);assert.equal(d(1),0);assert(d(.99)<.001);assert(d(.4)>d(.8));
  assert(FIRE_POOL_FRAGMENT.includes(FIRE.poolFalloff.toFixed(8)));assert(FIRE_POOL_FRAGMENT.includes('uPoolBlocks[slot]'));
  assert(u.uPoolBlocks.value.some(b=>b.z>0));f.layer.dispose();
});

test('real scene batches, ground conformity, flame placement and quality counts agree with reported geometry',t=>{
  const f=fixture({fires:[fire(),fire(80,-50,.2),fire(-80,50,.6)]}),snap=globalThis.__kzFire;
  assert.equal(f.context.scene.children.filter(o=>o.isMesh).length,4);
  assert.equal(f.context.scene.children.filter(o=>o.isPointLight).length,1);
  const meshes=f.context.scene.children.filter(o=>o.isMesh),pool=meshes.find(m=>m.name.endsWith('pool'));
  for(let i=0;i<pool.geometry.attributes.position.count;i++){
    const p=pool.geometry.attributes.position;assert(Math.abs(p.getY(i)-f.context.terrain.heightAt(p.getX(i),p.getZ(i))-FIRE.poolLiftM)<1e-5);
  }
  for(const m of meshes){assert(!m.castShadow);assert(!m.frustumCulled);assert(!m.material.depthWrite);assert(m.material.forceSinglePass);}
  for(let step=0;step<=3;step++){
    f.layer.setAdapt(step);f.layer.update(f.frame);const s=snap();
    const sprites=meshes.filter(m=>m!==pool).reduce((n,m)=>n+m.geometry.instanceCount,0);
    assert.equal(s.triangles,sprites*2+pool.geometry.index.count/3);assert.equal(s.boards,sprites+3*FIRE.poolSegments**2);assert.equal(s.draws,4);
    const tongues=meshes[0].geometry.attributes.fireSize;
    for(let i=0;i<meshes[0].geometry.instanceCount;i++)if(tongues.getZ(i)===0)assert(tongues.getY(i)>=4&&tongues.getY(i)<=9);
    assert(s.nearest.distance>200);t.diagnostic(JSON.stringify(s));
  }
  f.layer.dispose();
});

test('moving smoke puffs overlap from roofs to the fading top in every quality, with normal alpha and no depth holes',()=>{
  for(const strength of [.2,.6,1]){
    const f=fixture({fires:[fire(0,0,strength)]});
    for(let step=0;step<=3;step++){
      f.layer.setAdapt(step);const m=f.context.scene.children.find(o=>o.name==='kamakura-fire-smoke'),g=m.geometry;
      assert.equal(m.material.blending,THREE.NormalBlending);assert.equal(m.material.depthWrite,false);
      for(const time of [0,2,8,17,34,53]){
        const spans=[];let height;
        for(let i=0;i<g.instanceCount;i++){
          const phase=g.attributes.fireSize.getW(i),t=phase<0?-phase:(phase+time*FIRE.smokeRise)%1;
          height=g.attributes.fireAnchor.getW(i);
          const p=smokeProfile(t,height,1,0,{},g.attributes.fireSize.getX(i),time,strength);
          const width=p.radius*2*(1+FIRE.smokePuffVariation*Math.sin(g.attributes.fireSeed.getX(i)*31.7));
          const top=Math.max(0,Math.min(1,(t-FIRE.smokeTopSpreadStart)/(1-FIRE.smokeTopSpreadStart)));
          const aspect=FIRE.smokeAspect+(FIRE.smokeTopAspect-FIRE.smokeAspect)*top*top*(3-2*top);
          const half=Math.max(width*aspect,g.attributes.fireSize.getY(i))/2;
          spans.push([t*height-half,t*height+half]);
        }
        spans.sort((a,b)=>a[0]-b[0]);let lastTop=0;
        for(const [bottom,top]of spans){assert(bottom<=lastTop+1e-5);lastTop=Math.max(lastTop,top);}
        assert(lastTop>=height-1e-5,`top coverage ${lastTop} / ${height}`);
      }
    }f.layer.dispose();
  }
});

test('point light selects only the nearest walking fire inside 80m; flight and distant views never add lights',()=>{
  const f=fixture({fires:[fire(),fire(70,0)]}),snap=globalThis.__kzFire;
  f.layer.update(f.frame);assert.equal(snap().lightSource,0);
  f.frame.pos.x=60;f.layer.update(f.frame);assert.equal(snap().lightSource,1);
  f.frame.pos.x=300;f.layer.update(f.frame);assert.equal(snap().light,0);
  f.frame.pos.x=0;f.frame.flying=true;f.layer.update(f.frame);assert.equal(snap().light,0);
  f.frame.flying=false;f.frame.pos.y=100;f.layer.update(f.frame);assert.equal(snap().light,0);
  const light=f.context.scene.children.find(o=>o.isPointLight);assert(!light.castShadow);f.layer.dispose();
});

test('frame updates reuse buffers, do not repack or resample terrain; pause and unchanged adaptation do no work',()=>{
  const f=fixture(),snap=globalThis.__kzFire,initial=snap().work;
  f.context.terrain.heightAt=()=>assert.fail('terrain queries belong only to construction');
  const buffers=f.context.scene.children.filter(o=>o.isMesh).map(m=>m.geometry.attributes.position.array);
  for(let i=0;i<200;i++)f.layer.update(f.frame);
  let s=snap();assert.equal(s.work.uploadedInstances,initial.uploadedInstances);assert.equal(s.work.terrainSamples,initial.terrainSamples);assert.equal(s.work.perFrameBoardUpdates,0);
  f.layer.setAdapt(0);assert.equal(snap().work.uploadedInstances,initial.uploadedInstances);
  f.layer.setPaused(true);const time=s.time;f.layer.update(f.frame);assert.equal(snap().time,time);
  assert.deepEqual(f.context.scene.children.filter(o=>o.isMesh).map(m=>m.geometry.attributes.position.array),buffers);
  f.layer.dispose();
});

test('daytime weakens additive light; distant glow retains a floor; debug colours cover all categories',()=>{
  assert.equal(fireDayGain('evening'),1);assert.equal(fireDayGain('dusk'),1);assert.equal(fireDayGain('noon'),.4);
  assert(FIRE.fogKeep>0);assert(FIRE_FRAGMENT.includes('max('+FIRE.fogKeep.toFixed(8)+',fog)'));
  for(const search of ['?time=evening','?time=noon','?firedebug=1&debug=1']){
    const f=fixture({search}),u=f.context.scene.children[0].material.uniforms;
    assert.equal(u.uDay.value,search.includes('evening')?1:.4);assert.equal(u.uPaint.value,search.includes('firedebug')?1:0);f.layer.dispose();
  }
});

test('source halos respect the authored radius multiplier even for small fires and distant cameras',()=>{
  for(const radius_m of [4,18,30])for(const strength of [.2,.8,1]){
    const f=fixture({fires:[{...fire(),radius_m,strength}],houses:[]}),g=f.context.scene.children[0].geometry;
    const diameter=g.attributes.fireSize.getX(g.instanceCount-1);
    assert(diameter>=radius_m*FIRE.glowRadiusMin*2-1e-5&&diameter<=radius_m*FIRE.glowRadiusMax*2+1e-5);
    f.context.camera.position.set(-450,60,0);f.layer.update(f.frame);assert.equal(g.attributes.fireSize.getX(g.instanceCount-1),diameter);f.layer.dispose();
  }
});

test('dispose releases each owned geometry/material/light once, removes hooks and silences retained methods',()=>{
  const f=fixture(),snap=globalThis.__kzFire,seen=[];
  const light=f.context.scene.children.find(o=>o.isPointLight),disposeLight=light.dispose.bind(light);let lightDisposed=0;
  light.dispose=()=>{lightDisposed++;disposeLight();};
  for(const o of f.context.scene.children){for(const resource of o.isMesh?[o.geometry,o.material]:[o])resource.addEventListener('dispose',()=>seen.push(resource));}
  const old=snap();f.layer.dispose();f.layer.dispose();f.layer.update(f.frame);f.layer.setAdapt(3);
  assert.equal(f.context.scene.children.length,0);assert.equal(seen.length,8);assert.equal(new Set(seen).size,8);assert.equal(lightDisposed,1);assert.equal(globalThis.__kzFire,undefined);assert.equal(f.layer.debugText(),'');assert.equal(snap().time,old.time);
  const g=fixture();globalThis.__kzFire=()=>42;g.layer.dispose();assert.equal(globalThis.__kzFire(),42);delete globalThis.__kzFire;
});

function syntax(code){
  const stripped=code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'');const stack=[];
  for(const c of stripped){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}
  assert.equal(stack.length,0);assert.doesNotMatch(stripped,/--\s*\d|\b(?:float|vec[234]|int)\s+(?:sample|input|output|filter|active|common|resource)\b/);
}
test('all emitted shaders have balanced delimiters, safe identifiers and float arithmetic',()=>{
  for(const shader of [FIRE_VERTEX,FIRE_FRAGMENT,FIRE_POOL_VERTEX,FIRE_POOL_FRAGMENT]){syntax(shader);assert.doesNotMatch(shader.replace(/uniform (?:float|vec[234]) \w+\[\d+\];/g,''),/(?<![\w.])\d+(?![\w.])/);}
  // Standalone shaders have no replacement hooks that could silently fail after a Three.js update.
  assert(![FIRE_VERTEX,FIRE_FRAGMENT,FIRE_POOL_VERTEX,FIRE_POOL_FRAGMENT].some(s=>s.includes('#include')));
  assert.throws(()=>syntax('float sample=1.0;'));assert.throws(()=>syntax('float n=1.--2.0;'));
});
test('GLSL compiler validates every vertex/fragment shader and rejects undeclared names / mixed numeric types',t=>{
  const version=spawnSync('glslc',['--version'],{encoding:'utf8'});if(version.error?.code==='ENOENT')return t.skip('glslc unavailable');assert.equal(version.status,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fire-glsl-'));
  try{
    const shaders=[['fire.vert',FIRE_VERTEX],['fire.frag',FIRE_FRAGMENT],['pool.vert',FIRE_POOL_VERTEX],['pool.frag',FIRE_POOL_FRAGMENT]];
    const compile=(name,shader)=>{
      const vertex=name.endsWith('vert'),prefix='#version 310 es\nprecision highp float;\n#define attribute in\n#define varying '+(vertex?'out':'in')+'\n'+
        (vertex?'in vec3 position;in vec2 uv;uniform mat4 modelViewMatrix,viewMatrix,projectionMatrix;\n':'out vec4 fireOut;\n#define gl_FragColor fireOut\n');
      const file=path.join(dir,name);fs.writeFileSync(file,prefix+shader);
      return spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',path.join(dir,'out.spv')],{encoding:'utf8'});
    };
    for(const [name,shader]of shaders){const result=compile(name,shader);assert.equal(result.status,0,result.stderr);}
    assert.notEqual(compile('bad.vert',FIRE_VERTEX.replace('uCam-origin','missingCamera-origin')).status,0);
    assert.notEqual(compile('bad.frag',FIRE_FRAGMENT.replace('vDepth-uFog.x','vDepth-ivec2(1,2)')).status,0);
    t.diagnostic('4 shader stages compiled; undeclared-name and numeric-type mutations rejected');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('private data only checks acceptance, exceptions and upper bounds without publishing any measurements',async t=>{
  if(!process.env.KZ_WORLD_DIR)return t.skip('KZ_WORLD_DIR未設定');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR);assert.doesNotThrow(()=>validateFires(data.meta.fires,data.meta));
  const f=fixture({fires:[]});f.context.data=data;f.context.terrain=createKamakuraTerrain(data);
  const layer=createKamakuraFire(f.context);
  if(layer){const s=globalThis.__kzFire();assert(s.sources<=FIRE.maxSources);assert(s.boards<=FIRE.maxBoards);assert(s.draws<=5);layer.dispose();}
});
