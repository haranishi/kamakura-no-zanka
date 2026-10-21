// The player position is on the ground. Range and facing use X/Z, so a low
// bucket is reachable without aiming the camera down. yaw=0 faces negative Z.
const finitePoint=point=>point!==null&&typeof point==='object'&&
 Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z);

export function selectTarget(player,yaw,targets,isOccluded){
 if(!finitePoint(player)||!Number.isFinite(yaw)||!Array.isArray(targets))return null;
 const forwardX=-Math.sin(yaw),forwardZ=-Math.cos(yaw);
 let chosen=null,nearest=Infinity,bestFacing=-Infinity;
 for(const target of targets){
  if(!target||target.available!==true||typeof target.id!=='string'||!finitePoint(target.anchor))continue;
  const range=target.distance??1.6,minFacing=target.minFacingCos??.45;
  if(!Number.isFinite(range)||range<0||!Number.isFinite(minFacing)||minFacing<-1||minFacing>1)continue;
  const dx=target.anchor.x-player.x,dz=target.anchor.z-player.z,distance=Math.hypot(dx,dz);
  if(distance>range)continue;
  const facing=distance===0?1:(dx*forwardX+dz*forwardZ)/distance;
  if(facing<minFacing)continue;
  if(target.approach!==undefined&&(typeof target.approach!=='function'||!target.approach(player,target)))continue;
  if(typeof isOccluded==='function'&&isOccluded(player,target))continue;
  if(distance<nearest-1e-9||(Math.abs(distance-nearest)<=1e-9&&facing>bestFacing)){
   chosen=target;nearest=distance;bestFacing=facing;
  }
 }
 return chosen;
}

// Collision boxes contain floor-height Y ranges, not complete walls. Treat
// their X/Z footprints as solid for sight; ignore only the target's own ID.
export function segmentBlocked(player,target,boxes,ignoreId){
 const anchor=target?.anchor??target;
 if(!finitePoint(player)||!finitePoint(anchor)||!Array.isArray(boxes))return true;
 for(const box of boxes){
  if(!box||(ignoreId!==undefined&&box.id===ignoreId))continue;
  if(![box.minX,box.maxX,box.minZ,box.maxZ].every(Number.isFinite)||box.minX>box.maxX||box.minZ>box.maxZ)continue;
  let enter=0,exit=1,hit=true;
  for(const [axis,min,max] of [['x',box.minX,box.maxX],['z',box.minZ,box.maxZ]]){
   const origin=player[axis],direction=anchor[axis]-origin;
   if(Math.abs(direction)<1e-12){if(origin<min||origin>max){hit=false;break;}continue;}
   const a=(min-origin)/direction,b=(max-origin)/direction;
   enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
   if(enter>exit){hit=false;break;}
  }
  if(hit)return true;
 }
 return false;
}
