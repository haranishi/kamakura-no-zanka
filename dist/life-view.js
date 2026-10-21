import * as THREE from 'three';
import {progressFor} from './gameplay.js';
import {PLACES} from './places.js';

/** Visual consequences only. Progress is owned by the pure gameplay rules. */
export function createLifeView({scene,model,groundAt}){
 const root=new THREE.Group();root.name='Life returning to the valley';scene.add(root);
 let wood;
 model.traverse(o=>{
  if(wood||!o.isMesh)return;
  const m=(Array.isArray(o.material)?o.material:[o.material]).find(m=>m.map&&/wood|timber|plank/i.test(m.name)&&!/water/i.test(m.name));
  if(m)wood=m.clone();
 });
 wood ||= new THREE.MeshStandardMaterial({color:'#65543c',roughness:.94});
 wood.name='Garden work timber';wood.roughness=.94;
 const soil=new THREE.MeshStandardMaterial({color:'#6d5740',roughness:1});
 const leafMaterial=new THREE.MeshStandardMaterial({color:'#8b8d51',roughness:.84});
 const stemMaterial=new THREE.MeshStandardMaterial({color:'#6d7441',roughness:.91});
 const dummy=new THREE.Object3D();
 function box(parent,w,h,d,x,y,z,material=wood){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
 }
 const bed=new THREE.Group();bed.name='Porch seedbed';bed.position.copy(PLACES.seedbed);root.add(bed);
 box(bed,1.24,.105,.43,0,0,0,soil);
 box(bed,1.32,.14,.036,0,.025,.228);box(bed,1.32,.14,.036,0,.025,-.228);
 box(bed,.035,.14,.43,-.66,.025,0);box(bed,.035,.14,.43,.66,.025,0);
 for(const x of [-.54,.54])box(bed,.055,.32,.055,x,-.19,0);
 const stems=new THREE.InstancedMesh(new THREE.CylinderGeometry(.006,.011,.22,5),stemMaterial,12);
 const leaves=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,5),leafMaterial,48);
 stems.castShadow=leaves.castShadow=true;stems.receiveShadow=leaves.receiveShadow=true;bed.add(stems,leaves);
 function setPlants(watered){
  soil.color.set(watered?'#382c20':'#6d5740');soil.roughness=watered?.72:1;
  leafMaterial.color.set(watered?'#719444':'#92906a');
  for(let i=0;i<12;i++){
   const x=-.5+(i%6)*.2,z=i<6?-.105:.105,stretch=watered?1:.74;
   dummy.position.set(x,.14*stretch,z);dummy.rotation.set(0,i*2.4,0);dummy.scale.set(1,stretch,1);dummy.updateMatrix();stems.setMatrixAt(i,dummy.matrix);
   for(let side=0;side<4;side++){
    const angle=side*Math.PI/2+i*.8,reach=watered?.10:.13;
    dummy.position.set(x+Math.cos(angle)*reach,watered?.23+side*.016:.12+side*.009,z+Math.sin(angle)*reach);
    dummy.rotation.set(watered?-.38:1.0,angle,watered?.32:1.0);
    dummy.scale.set(.058,.017,watered?.155:.125);dummy.updateMatrix();leaves.setMatrixAt(i*4+side,dummy.matrix);
   }
  }
  stems.instanceMatrix.needsUpdate=leaves.instanceMatrix.needsUpdate=true;stems.computeBoundingSphere();leaves.computeBoundingSphere();
 }

 const sluice=new THREE.Group();sluice.name='Small canal sluice';sluice.position.copy(PLACES.sluiceCenter);sluice.rotation.y=.66;root.add(sluice);
 box(sluice,.055,1.39,.08,-1.06,.65,0);box(sluice,.055,1.39,.08,1.06,.65,0);box(sluice,2.23,.075,.09,0,1.32,0);
 const gate=box(sluice,2.04,.20,.048,0,.175,0);
 const handle=box(sluice,.33,.055,.065,-1.06,1.22,.04);
 box(sluice,.048,.93,.048,0,.77,0);
 const debris=new THREE.Group();debris.name='Fallen branches blocking water';sluice.add(debris);
 const branchMaterial=new THREE.MeshStandardMaterial({color:'#514535',roughness:1});
 const branches=new THREE.InstancedMesh(new THREE.CylinderGeometry(.012,.025,1,5),branchMaterial,11);
 for(let i=0;i<11;i++){
  dummy.position.set(Math.sin(i*2.3)*.43,.18+(i%3)*.026,Math.cos(i*1.7)*.18);
  dummy.rotation.set(Math.PI/2,.2+i*.43,.85+i*.68);dummy.scale.set(1,.35+(i%4)*.19,1);dummy.updateMatrix();branches.setMatrixAt(i,dummy.matrix);
 }
 branches.castShadow=true;branches.computeBoundingSphere();debris.add(branches);
 const flowMaterial=new THREE.MeshStandardMaterial({color:'#8fae99',roughness:.23,metalness:.03,transparent:true,opacity:.24,depthWrite:false});
 const flow=new THREE.Mesh(new THREE.PlaneGeometry(1.37,.95),flowMaterial);flow.rotation.x=-Math.PI/2;flow.position.set(0,.074,-.51);flow.name='Restored flow';sluice.add(flow);

 const lamp=new THREE.Group();lamp.name='Porch lantern';lamp.position.copy(PLACES.lantern);root.add(lamp);
 const ground=groundAt(PLACES.lantern.x,-.88)??.18;
 box(root,.065,1.68,.065,PLACES.lantern.x,ground+.84,-.88);
 box(root,.065,.065,.34,PLACES.lantern.x,ground+1.65,-.75);
 const hangerTop=ground+1.6175,hangerBottom=PLACES.lantern.y+.2075;
 box(root,.014,Math.max(.03,hangerTop-hangerBottom),.014,PLACES.lantern.x,(hangerTop+hangerBottom)/2,-.65);
 const paperMaterial=new THREE.MeshStandardMaterial({color:'#b5ad8c',emissive:'#ffb85b',emissiveIntensity:0,roughness:.88,side:THREE.DoubleSide});
 const paper=new THREE.Mesh(new THREE.CylinderGeometry(.145,.145,.31,8,1,true),paperMaterial);paper.name='Lantern paper';lamp.add(paper);
 const cap=new THREE.CylinderGeometry(.183,.183,.045,8);
 for(const y of [-.185,.185]){const m=new THREE.Mesh(cap,wood);m.position.y=y;m.castShadow=true;lamp.add(m);}
 const rails=new THREE.InstancedMesh(new THREE.CylinderGeometry(.008,.008,.35,5),wood,8);
 for(let i=0;i<8;i++){const a=i*Math.PI/4;dummy.position.set(Math.cos(a)*.15,0,Math.sin(a)*.15);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);dummy.updateMatrix();rails.setMatrixAt(i,dummy.matrix);}
 rails.castShadow=true;rails.computeBoundingSphere();lamp.add(rails);
 const flame=new THREE.Mesh(new THREE.SphereGeometry(.047,8,8),new THREE.MeshBasicMaterial({color:'#ffe3a0'}));flame.scale.set(.55,1.65,.55);flame.position.y=-.04;lamp.add(flame);
 const glow=new THREE.PointLight('#ffb35b',0,3.4,2);glow.position.set(0,.04,.12);lamp.add(glow);
 // Brief droplets make the delivered water visible without a blocking cutscene.
 const droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(.009,4,3),new THREE.MeshBasicMaterial({color:'#bcd8d2',transparent:true,opacity:.8}),24);
 droplets.visible=false;root.add(droplets);
 let current={watered:false,flowing:false,lit:false},pulse=0,stage='bucket';
 function sync(state,action){
  stage=state.stage;current=progressFor(state);setPlants(current.watered);
  debris.visible=!current.flowing;gate.position.y=current.flowing?.53:.175;handle.rotation.z=current.flowing?Math.PI/2:0;
  flow.visible=current.flowing;flame.visible=current.lit;
  paperMaterial.color.set(current.lit?'#f6d9a0':'#b5ad8c');paperMaterial.emissiveIntensity=current.lit?.85:0;
  glow.intensity=current.lit?2.1:0;pulse=action==='deliver'?.8:0;droplets.visible=false;
 }
 function update(dt,elapsed,reducedMotion){
  if(current.flowing)flowMaterial.opacity=.24+(reducedMotion?0:Math.sin(elapsed*2.7)*.025);
  if(current.lit){const flicker=reducedMotion?1:1+Math.sin(elapsed*7.3)*.025+Math.sin(elapsed*11.9)*.015;glow.intensity=2.1*flicker;paperMaterial.emissiveIntensity=.85*flicker;flame.scale.y=1.65*flicker;}
  pulse=Math.max(0,pulse-dt);droplets.visible=pulse>0&&!reducedMotion;
  if(droplets.visible){
   const t=.8-pulse;
   for(let i=0;i<24;i++){const q=(t+i*.027)%.8;dummy.position.set(PLACES.seedbed.x+Math.sin(i*2.4)*.48,PLACES.seedbed.y+.62-q*.6,PLACES.seedbed.z+Math.cos(i*1.7)*.15);dummy.rotation.set(0,0,0);dummy.scale.set(1,1.7,1);dummy.updateMatrix();droplets.setMatrixAt(i,dummy.matrix);}
   droplets.instanceMatrix.needsUpdate=true;droplets.computeBoundingSphere();
  }
 }
 return{sync,update,get state(){return{stage,watered:current.watered,flowing:current.flowing,lit:current.lit,branchesVisible:debris.visible,gateHeight:gate.position.y,lightIntensity:glow.intensity,dropletsVisible:droplets.visible};}};
}
