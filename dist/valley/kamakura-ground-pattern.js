// W2c-9b: deterministic, periodic ground detail; no renderer or private data here.
export const grassAmount = code => [0.08,0,1,0.45,0.15,0,0,0.7][code] ?? 0;
export const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
export const slopeAmount = y => smooth(.45,.85,y);
export const detailAmplitude = d => smooth(18,55,d)*(1-smooth(700,2500,d));
export const boundaryWarp = (x,z) => [Math.sin(x*.13+Math.sin(z*.09))*.85,Math.sin(z*.11+Math.sin(x*.07))*.85];
export function groundPattern(seed=19391,size=256) {
  let state=seed>>>0;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const waves=Array.from({length:24},(_,i)=>({x:1+Math.floor(rand()*(i<8?4:50)),z:Math.floor(rand()*(i<8?4:8)),p:rand()*Math.PI*2,a:i<8?.07:.018}));
  const data=new Uint8Array(size*size*4); let mean=0;
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const x=i%(size-1),z=j%(size-1);
    let v=.5;for(const w of waves)v+=w.a*Math.sin(2*Math.PI*(w.x*x+w.z*z)/(size-1)+w.p);
    const k=(j*size+i)*4, dry=.5+.25*Math.sin(2*Math.PI*(2*x+3*z)/(size-1));
    data[k]=Math.round(Math.max(0,Math.min(1,v))*255);data[k+1]=data[k];data[k+2]=Math.round(dry*255);data[k+3]=255;mean+=data[k]/255;
  }
  return {data,size,mean:mean/(size*size)};
}
