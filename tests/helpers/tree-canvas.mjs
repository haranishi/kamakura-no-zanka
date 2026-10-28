// Minimal CPU canvas for the shipped leaf paths, gradients and round strokes.
// Coverage is sampled on a 2x grid; this is not a browser/GLSL verification.
export function installTreeCanvas() {
  let last = [];
  globalThis.document = { createElement(tag) {
    if (tag !== 'canvas') throw Error('unexpected DOM element');
    const c = { width: 0, height: 0 }, ops = []; last = ops;
    let data, paths = [], path, matrix = [1,0,0,1,0,0], stack = [];
    const scale = 2;
    const buffer = () => data ??= new Uint8ClampedArray(c.width*c.height*scale*scale*4);
    const point = (x,y) => [matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
    const colors = new Map();
    const rgb = style => {
      if(!colors.has(style))colors.set(style,style.startsWith('#') ? style.slice(1).match(/../g).map(v=>parseInt(v,16)) : style.match(/[\d.]+/g).map(Number));
      return colors.get(style);
    };
    const paint = (x,y,style) => {
      if(x<0||y<0||x>=c.width*scale||y>=c.height*scale)return;
      const i=(y*c.width*scale+x)*4, b=buffer(); let color;
      if(ctx.globalCompositeOperation==='destination-out'){b[i]=b[i+1]=b[i+2]=b[i+3]=0;return;}
      if(typeof style==='string')color=rgb(style);
      else {
        const dx=style.b[0]-style.a[0],dy=style.b[1]-style.a[1];
        const t=Math.max(0,Math.min(1,((x/scale-style.a[0])*dx+(y/scale-style.a[1])*dy)/(dx*dx+dy*dy)));
        let lo=style.stops[0],hi=style.stops.at(-1);
        for(let k=1;k<style.stops.length;k++)if(t<=style.stops[k][0]){lo=style.stops[k-1];hi=style.stops[k];break;}
        const f=Math.max(0,Math.min(1,(t-lo[0])/(hi[0]-lo[0]||1)));
        color=lo[1].map((v,k)=>v+(hi[1][k]-v)*f);
      }
      b[i]=color[0];b[i+1]=color[1];b[i+2]=color[2];b[i+3]=255;
    };
    const ctx = {
      fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1,globalCompositeOperation:'source-over',
      save(){stack.push([matrix.slice(),this.fillStyle,this.strokeStyle,this.lineWidth,this.globalCompositeOperation]);},
      restore(){[matrix,this.fillStyle,this.strokeStyle,this.lineWidth,this.globalCompositeOperation]=stack.pop();},
      translate(x,y){const p=point(x,y);matrix[4]=p[0];matrix[5]=p[1];},
      rotate(a){const [a0,b,c0,d]=matrix,co=Math.cos(a),si=Math.sin(a);matrix[0]=a0*co+c0*si;matrix[1]=b*co+d*si;matrix[2]=c0*co-a0*si;matrix[3]=d*co-b*si;},
      beginPath(){paths=[];path=null;},
      moveTo(x,y){path=[point(x,y)];paths.push(path);ops.push(['move',x,y]);},
      lineTo(x,y){path.push(point(x,y));},
      closePath(){path.push(path[0]);},
      createLinearGradient(x,y,xx,yy){return {a:point(x,y),b:point(xx,yy),stops:[],addColorStop(t,c){this.stops.push([t,rgb(c)]);}};},
      fill(){
        const points=paths.flat();
        ops.push(['fill',Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))]);
        for(const polygon of paths){
          const ys=polygon.map(p=>p[1]*scale);
          for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<Math.min(c.height*scale,Math.ceil(Math.max(...ys)));y++){
            const scan=(y+.5)/scale,xs=[];
            for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
              const a=polygon[i],b=polygon[j];if((a[1]>scan)!==(b[1]>scan))xs.push((a[0]+(scan-a[1])*(b[0]-a[0])/(b[1]-a[1]))*scale);
            }
            xs.sort((a,b)=>a-b);
            for(let k=0;k+1<xs.length;k+=2)for(let x=Math.max(0,Math.ceil(xs[k]-.5));x<Math.min(c.width*scale,xs[k+1]-.5);x++)paint(x,y,this.fillStyle);
          }
        }
      },
      stroke(){
        ops.push(['stroke',this.strokeStyle,this.lineWidth,this.globalCompositeOperation]);
        for(const polygon of paths)for(let k=1;k<polygon.length;k++){
          const a=polygon[k-1].map(v=>v*scale),b=polygon[k].map(v=>v*scale),r=this.lineWidth*scale/2,dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
          for(let y=Math.max(0,Math.floor(Math.min(a[1],b[1])-r));y<Math.min(c.height*scale,Math.ceil(Math.max(a[1],b[1])+r));y++)for(let x=Math.max(0,Math.floor(Math.min(a[0],b[0])-r));x<Math.min(c.width*scale,Math.ceil(Math.max(a[0],b[0])+r));x++){
            const t=Math.max(0,Math.min(1,((x+.5-a[0])*dx+(y+.5-a[1])*dy)/(len||1)));
            if((x+.5-a[0]-t*dx)**2+(y+.5-a[1]-t*dy)**2<=r*r)paint(x,y,this.strokeStyle);
          }
        }
      },
      fillRect(x,y,w,h){this.beginPath();this.moveTo(x,y);this.lineTo(x+w,y);this.lineTo(x+w,y+h);this.lineTo(x,y+h);this.closePath();this.fill();},
      getImageData(){
        const b=buffer(),out=new Uint8ClampedArray(c.width*c.height*4);
        for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
          const sum=[0,0,0,0];for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){
            const i=((y*scale+yy)*c.width*scale+x*scale+xx)*4;
            for(let k=0;k<3;k++)sum[k]+=b[i+k]*b[i+3]/255;sum[3]+=b[i+3];
          }
          const i=(y*c.width+x)*4;for(let k=0;k<3;k++)out[i+k]=sum[3]?sum[k]*255/sum[3]:0;out[i+3]=sum[3]/(scale*scale);
        }
        return {data:out};
      },
    };
    c.getContext=()=>ctx;return c;
  } };
  return { drawing:()=>last };
}
