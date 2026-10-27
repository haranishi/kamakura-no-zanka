// view層。矢・柱・粒で最大3描画。大きなbufferは初期化時に一度だけ確保する。
import * as THREE from 'three';
import { guideVisibility } from './guide-view.js';
export class GuideRenderer {
  constructor(scene, terrain) {
    this.terrain = terrain;
    const outline = [[0,-.65],[.5,-.05],[.19,-.05],[.19,.6],[-.19,.6],[-.19,-.05],[-.5,-.05]];
    const faces = THREE.ShapeUtils.triangulateShape(outline.map(([x,z]) => new THREE.Vector2(x,z)), []);
    this.arrowLocal = []; const colors = [];
    for (const [scale,color,y] of [[1,0x1b1510,0],[.78,0xe9d8a4,.003]]) for (const face of faces) for (const i of face) {
      this.arrowLocal.push(outline[i][0]*scale,y,outline[i][1]*scale);
      const c = new THREE.Color(color); colors.push(c.r,c.g,c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(this.arrowLocal.length),3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.foot = new THREE.Mesh(g,new THREE.MeshBasicMaterial({forceSinglePass:true,vertexColors:true,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false,fog:false}));
    this.foot.frustumCulled = false; this.foot.renderOrder = 6;
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(.12,.24,20,6,1,true),new THREE.MeshBasicMaterial({forceSinglePass:true,color:0xe9d8a4,transparent:true,opacity:.15,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false}));
    this.pillar.renderOrder = 5;
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position',new THREE.BufferAttribute(new Float32Array(120*3),3).setUsage(THREE.DynamicDrawUsage)); pg.setDrawRange(0,0);
    this.particles = new THREE.Points(pg,new THREE.PointsMaterial({color:0xe9d8a4,size:.085,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));
    this.particles.frustumCulled = false; this.particles.renderOrder = 5;
    scene.add(this.foot,this.pillar,this.particles);
    this.edge = document.getElementById('guide-edge'); this.edgeArrow = this.edge.querySelector('i'); this.edgeText = this.edge.querySelector('span');
    this.help = document.getElementById('guide-help');
    this.v = new THREE.Vector3(); this.cameraPoint = new THREE.Vector3();
    this.samples = []; this.particleN = 0; this.snapshot = {};
    this.hide();
  }
  hide() { this.foot.visible = this.pillar.visible = this.particles.visible = false; this.edge.hidden = true; this.help.hidden = true; this.snapshot = {enabled:false,foot:{visible:false},edge:{visible:false},pillar:{visible:false},particles:{count:0,remaining:0}}; }
  startParticles(samples) { this.samples = samples; this.particleN = samples.length; this.particles.geometry.setDrawRange(0,samples.length); }
  update({pos, direction, target, ahead, remaining, level, mode, emphasized, reached, reduced, hidden, t, wind, camera}) {
    if (hidden || !target || !ahead) { this.hide(); return; }
    const distance = Math.hypot(target.x-pos.x,target.z-pos.z), guiding = wind.guideElapsed !== null;
    camera.updateMatrixWorld();
    this.v.set(ahead.x,this.terrain.heightAt(ahead.x,ahead.z)+.5,ahead.z);
    this.cameraPoint.copy(this.v).applyMatrix4(camera.matrixWorldInverse); this.v.project(camera);
    const outside = this.cameraPoint.z >= 0 || this.v.z < -1 || this.v.z > 1 || Math.abs(this.v.x) > .9 || Math.abs(this.v.y) > .9;
    const flags = guideVisibility(level,{mode,emphasized,guiding,outside,distance,reached,reduced});
    this.help.hidden = !(flags.enabled && emphasized && mode==='free');
    const x = pos.x+direction.x*1.6, z = pos.z+direction.z*1.6, yaw = Math.atan2(-direction.x,-direction.z);
    const scale = (flags.subtle ? .72 : 1)*(flags.pulse ? 1+.05*Math.sin(t*Math.PI*2/1.1) : 1);
    const a = this.foot.geometry.attributes.position;
    for (let i=0;i<a.count;i++) {
      const lx=this.arrowLocal[i*3]*scale,lz=this.arrowLocal[i*3+2]*scale;
      const wx=x+lx*Math.cos(yaw)+lz*Math.sin(yaw), wz=z-lx*Math.sin(yaw)+lz*Math.cos(yaw);
      a.setXYZ(i,wx,this.terrain.heightAt(wx,wz)+.06+this.arrowLocal[i*3+1],wz);
    }
    a.needsUpdate=true; this.foot.visible=flags.foot; this.foot.material.opacity=flags.subtle?.3:.65;
    this.pillar.position.set(target.x,this.terrain.heightAt(target.x,target.z)+10,target.z);
    this.pillar.visible=flags.pillar; this.pillar.material.opacity=.18*Math.min(1,Math.max(0,(distance-30)/30));
    let sx=this.cameraPoint.x, sy=this.cameraPoint.y;
    // 前後を反転するprojectの除算を使わず、カメラ空間の向きで縁を決める。
    if (this.cameraPoint.z>=0) sy=-Math.max(.2,Math.abs(sy));
    const angle=Math.atan2(sx,sy), dx=Math.sin(angle), dy=-Math.cos(angle);
    const w=innerWidth/2-64,h=innerHeight/2-90,k=Math.min(w/Math.max(.001,Math.abs(dx)),h/Math.max(.001,Math.abs(dy)));
    this.edge.hidden=!flags.edge; this.edge.style.left=`${innerWidth/2+dx*k}px`; this.edge.style.top=`${innerHeight/2+dy*k}px`;
    this.edgeArrow.style.transform=`rotate(${angle}rad)`; this.edgeText.textContent=`${Math.round(remaining)} m`;
    this.particles.visible=guiding && !reached && (mode==='free'||mode==='combat') && this.samples.length>0;
    const n=this.samples.length, pa=this.particles.geometry.attributes.position;
    if (this.particles.visible) {
      const elapsed=wind.guideElapsed;
      for(let i=0;i<n;i++) {
        const f=((i/(n||1)+elapsed/5)%1)*(n-1), j=Math.floor(f), q=this.samples[j], r=this.samples[Math.min(j+1,n-1)], u=f-j;
        const px=q.x+(r.x-q.x)*u,pz=q.z+(r.z-q.z)*u;
        pa.setXYZ(i,px,this.terrain.heightAt(px,pz)+.25+.12*Math.sin(i*2.4+wind.t),pz);
      }
      pa.needsUpdate=true; this.particles.material.opacity=.7*Math.min(1,elapsed*4,(5-elapsed)*2);
    }
    this.snapshot={enabled:flags.enabled,foot:{visible:this.foot.visible,position:{x,y:this.terrain.heightAt(x,z)+.06,z},direction:{...direction},yaw},
      edge:{visible:flags.edge,angle,text:this.edgeText.textContent},pillar:{visible:this.pillar.visible,position:{x:target.x,y:this.pillar.position.y,z:target.z}},
      particles:{count:this.particles.visible?n:0,remaining:guiding?5-wind.guideElapsed:0}};
  }
}
