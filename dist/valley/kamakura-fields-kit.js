// Procedural plant meshes in normalized metres; raw buffers keep shape tests renderer-free.
export const FIELD_HEIGHTS = Object.freeze([1.7, .65, .95, 1.25, .1]);
export const FIELD_WIDTHS = Object.freeze([.65, .19, .28, .42, .32]);
// One card stands for a clump (a tussock with its plumes, a few flower stems, a mat on the sand), so it is wider than one stem.
export const FIELD_CARD_WIDTHS = Object.freeze([1.25, .55, .6, .55, .8]);
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export const FIELD_LEAF = Object.freeze([.39,.48,.23].map(linear));
export const FIELD_BLOOMS = Object.freeze([[.86,.83,.74],[.40,.29,.71],[.88,.73,.17],[.91,.87,.72],[.82,.51,.62]].map(c=>Object.freeze(c.map(linear))));
export function fieldPlantKit(kind,far=false) {
  const positions=[],colors=[],clusters=[],petals=[];
  const h=FIELD_HEIGHTS[kind],w=FIELD_WIDTHS[kind],leaf=FIELD_LEAF,bloom=FIELD_BLOOMS[kind];
  const tri=(a,b,c,color,cluster=0,petal=0)=>{positions.push(...a,...b,...c);for(let i=0;i<3;i++){colors.push(...color);clusters.push(cluster);petals.push(petal);}};
  const quad=(a,b,c,d,color,cluster=0,petal=0)=>{tri(a,b,c,color,cluster,petal);tri(a,c,d,color,cluster,petal);};
  const ribbon=(angle,height,width,reach,color,cluster=0,petal=0)=>{
    const dx=Math.cos(angle),dz=Math.sin(angle),sx=-dz*width,sz=dx*width;
    for(let i=0;i<3;i++) {
      const t=i/3,u=(i+1)/3,r0=reach*t*t,r1=reach*u*u;
      quad([dx*r0-sx*(1-t*.75),height*t, dz*r0-sz*(1-t*.75)],
        [dx*r0+sx*(1-t*.75),height*t,dz*r0+sz*(1-t*.75)],
        [dx*r1+sx*(1-u*.75),height*u,dz*r1+sz*(1-u*.75)],
        [dx*r1-sx*(1-u*.75),height*u,dz*r1-sz*(1-u*.75)],color,cluster,petal);
    }
  };
  if(!far) {
    if(kind===0) {
      for(let i=0;i<4;i++)ribbon(i*2.4,h*.7,.022,w*.6,leaf);
      for(let i=0;i<6;i++) {
        const x=(i-2.5)*.045,top=h*(.87+.13*(i%3)/2),base=top-.4;
        // Narrow stem plus two feather silhouettes: visible from every side.
        tri([x-.009,0,0],[x+.009,0,0],[x,base,0],leaf,i+1);
        for(let k=0;k<2;k++) {
          const dx=Math.cos(k*Math.PI/2)*.065,dz=Math.sin(k*Math.PI/2)*.065;
          quad([x,base,0],[x+dx,base+.17,dz],[x+.04,top,0],[x-dx,base+.23,-dz],bloom,i+1,1);
        }
      }
    } else if(kind===4) {
      for(let i=0;i<5;i++) {
        const a=i*2.1,x=Math.cos(a)*w*.5,z=Math.sin(a)*w*.5;
        quad([0,0,0],[x-w*.18,.035,z],[x,.055,z+w*.23],[x+w*.18,.035,z],leaf);
      }
      // Six lobes form a shallow funnel; its axis is vertical rather than a flat card.
      for(let j=0;j<6;j++) {
        const a=j*Math.PI/3,b=(j+1)*Math.PI/3;
        tri([0,.035,0],[Math.cos(a)*.085,h,Math.sin(a)*.085],[Math.cos(b)*.085,h,Math.sin(b)*.085],bloom,1,1);
      }
      for(let j=0;j<2;j++) {
        const dx=j===0?.08:0,dz=j===1?.08:0;
        quad([-dx,.045,-dz],[dx,.045,dz],[dx,h,dz],[-dx,h,-dz],bloom,1,1);
      }
    } else {
      ribbon(0,h*.91,.008,.035,leaf);
      for(let j=0;j<2;j++)ribbon(j*Math.PI,h*.55,.025,w*.5,leaf);
      const count=kind===3?4:3;
      for(let i=0;i<count;i++) {
        const x=(i-(count-1)/2)*w*.45,y=h*(i===0?1:.84),z=(i%2)*.035;
        if(kind===3) {
          // Six white recurved petals, with a yellow inner stripe.
          for(let j=0;j<6;j++) {
            const a=j*Math.PI/3,b=a+.32;
            tri([x,y-.04,z],[x+Math.cos(a)*.15,y-.11,z+Math.sin(a)*.15],[x+Math.cos(b)*.12,y,z+Math.sin(b)*.12],bloom,i+1,1);
          }
          tri([x-.012,y-.04,z],[x+.012,y-.04,z],[x,y-.13,z+.06],FIELD_BLOOMS[2],i+1,1);
        } else if(kind===1) {
          // Two perpendicular five-point stars, rather than a disappearing single plane.
          for(let k=0;k<2;k++)for(let j=0;j<5;j++) {
            const a=j*Math.PI*2/5,b=a+.43,dx=Math.cos(a)*.075,dy=Math.sin(a)*.075;
            const ex=Math.cos(b)*.03,ey=Math.sin(b)*.03;
            tri([x,y-.075,z], [x+(k?0:dx),y-.075+dy,z+(k?dx:0)],[x+(k?0:ex),y-.075+ey,z+(k?ex:0)],bloom,i+1,1);
          }
        } else {
          // Small, flat umbels with a little volume and a crossed edge silhouette.
          for(let j=0;j<4;j++) {
            const a=j*Math.PI/2,b=(j+1)*Math.PI/2;
            tri([x,y-.025,z],[x+Math.cos(a)*.11,y-.04,z+Math.sin(a)*.11],[x+Math.cos(b)*.11,y-.04,z+Math.sin(b)*.11],bloom,i+1,1);
          }
          quad([x-.1,y-.06,z],[x+.1,y-.06,z],[x+.07,y,z],[x-.07,y,z],bloom,i+1,1);
        }
      }
    }
  } else {
    const near=fieldPlantKit(kind),mean=near.meanColor;
    for(let k=0;k<2;k++) {
      const dx=Math.cos(k*Math.PI/2)*w*.5,dz=Math.sin(k*Math.PI/2)*w*.5;
      quad([-dx,0,-dz],[dx,0,dz],[dx,h,dz],[-dx,h,-dz],mean,0,1);
    }
  }
  const normals=[],meanColor=[0,0,0];let areaSum=0;
  for(let i=0;i<positions.length;i+=9) {
    const ax=positions[i+3]-positions[i],ay=positions[i+4]-positions[i+1],az=positions[i+5]-positions[i+2];
    const bx=positions[i+6]-positions[i],by=positions[i+7]-positions[i+1],bz=positions[i+8]-positions[i+2];
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,len=Math.hypot(nx,ny,nz)||1;
    for(let j=0;j<3;j++)normals.push(nx/len,ny/len,nz/len);
    // Surface area, rather than tessellation density, determines the far pigment.
    areaSum+=len;for(let j=0;j<3;j++)meanColor[j]+=colors[i+j]*len;
  }
  for(let j=0;j<3;j++)meanColor[j]/=areaSum||1;
  return {positions:new Float32Array(positions),normals:new Float32Array(normals),colors:new Float32Array(colors),clusters:new Float32Array(clusters),petals:new Float32Array(petals),meanColor,height:h,triangles:positions.length/9};
}
