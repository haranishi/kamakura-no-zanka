// Use the material's alpha-test threshold, four-neighbour connected components.
export function tileStats(map) {
  const {data:a,width:w,height:h}=map.image,mask=Uint8Array.from({length:w*h},(_,i)=>a[i*4+3]>=77?1:0),seen=new Uint8Array(w*h);
  let covered=0,largest=0;
  for(let i=0;i<mask.length;i++){
    covered+=mask[i];if(!mask[i]||seen[i])continue;
    const queue=[i];seen[i]=1;
    for(let q=0;q<queue.length;q++){
      const j=queue[q],x=j%w,y=Math.floor(j/w);
      for(const n of [x?j-1:-1,x<w-1?j+1:-1,y?j-w:-1,y<h-1?j+w:-1])if(n>=0&&mask[n]&&!seen[n]){seen[n]=1;queue.push(n);}
    }
    largest=Math.max(largest,queue.length);
  }
  let l=0,r=0,t=0,b=0;
  for(let y=0;y<h;y++){l+=mask[y*w];r+=mask[y*w+w-1];}
  for(let x=0;x<w;x++){t+=mask[x];b+=mask[(h-1)*w+x];}
  return {holes:1-covered/(w*h),largest:largest/(w*h),seamX:Math.abs(l-r)/h,seamY:Math.abs(t-b)/w};
}
