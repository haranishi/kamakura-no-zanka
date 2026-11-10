// Flight-only shadow policy. Metres unless a name says otherwise; no camera/world ownership.
import { shadowTexel, snapShadowCenter } from './shadow-snap.js';
export const FLIGHT_SHADOW = Object.freeze({
  minSize: 92, // m: unchanged walking span, also the smallest flight box.
  maxSize: 3600, // m: largest flight box.
  distanceScale: .95, // span / camera-to-ground distance.
  sizeRatio: 1.25, // successive discrete span levels.
  hysteresis: .08, // fractional dead band around each level boundary.
  maxDistance: 6000, // m: ray search limit and fallback.
  raySteps: 24, // terrain brackets across the search interval.
  refineSteps: 12, // bisections within the first terrain bracket.
  relief: 450, // m: terrain above/below the target plane.
  minSunY: .08, // sine floor for a near-horizontal sun.
  near: 1, // m: near clipping distance.
  softLimit: 150, // m: contact filter is valid only below this span.
  biasTexels: .75, // depth offset in world texels, converted to normalized shadow depth.
  normalTexels: .6, // normal offset in world texels.
});
const clampSize = size => Math.max(FLIGHT_SHADOW.minSize, Math.min(FLIGHT_SHADOW.maxSize, size));
export function flightShadowEnabled(search = '') { return new URLSearchParams(search).get('flyshadow') !== '0'; }
export function flightShadowSize(distance, previous = 0) {
  const c = FLIGHT_SHADOW, desired = clampSize(c.distanceScale * distance);
  if (previous > 0 && desired >= previous / c.sizeRatio * (1-c.hysteresis) && desired <= previous * (1+c.hysteresis)) return previous;
  const level = Math.ceil(Math.log(desired/c.minSize)/Math.log(c.sizeRatio));
  return clampSize(c.minSize * c.sizeRatio ** level);
}
export function createFlightShadowState() {
  return { size: 0, texel: 0, centerDistance: 0, soft: false, bias: 0, normalBias: 0, near: 0, far: 0, sunDistance: 0,
    center: [0,0,0], snapped: [0,0,0] };
}
// direction is the normalized camera forward vector; out is reused for every frame.
export function flightShadowBox(position, direction, terrain, sunDir, mapSize, out) {
  const c = FLIGHT_SHADOW;
  let distance = c.maxDistance;
  if (direction.y < 0) {
    let low = 0, high = 0;
    for (let i=1;i<=c.raySteps;i++) {
      high = c.maxDistance*i/c.raySteps;
      if (position.y + direction.y*high <= terrain.heightAt(position.x+direction.x*high, position.z+direction.z*high)) {
        for (let j=0;j<c.refineSteps;j++) {
          const mid=(low+high)/2;
          if (position.y+direction.y*mid > terrain.heightAt(position.x+direction.x*mid,position.z+direction.z*mid)) low=mid;
          else high=mid;
        }
        distance=(low+high)/2; break;
      }
      low=high;
    }
    out.center[0]=position.x+direction.x*distance; out.center[2]=position.z+direction.z*distance;
  } else {
    const horizontal=Math.hypot(direction.x,direction.z) || 1;
    const reach=c.maxSize/2;
    out.center[0]=position.x+direction.x/horizontal*reach; out.center[2]=position.z+direction.z/horizontal*reach;
  }
  out.center[1]=terrain.heightAt(out.center[0],out.center[2]);
  out.centerDistance=Math.hypot(out.center[0]-position.x,out.center[1]-position.y,out.center[2]-position.z);
  out.size=flightShadowSize(out.centerDistance,out.size);
  out.texel=shadowTexel(out.size,mapSize);
  snapShadowCenter(out.center[0],out.center[1],out.center[2],sunDir,out.texel,out.snapped);
  // A low sun needs a long upstream reach. Both +/- relief and the horizontal
  // box diagonal fit between near and far; the square footprint stays constant.
  const horizontalReach=out.size/2*(Math.abs(sunDir[0])+Math.abs(sunDir[2]));
  out.sunDistance=(horizontalReach+c.relief)/Math.max(c.minSunY,sunDir[1])+c.near;
  out.near=c.near; out.far=2*out.sunDistance+c.relief;
  out.bias=-c.biasTexels*out.texel/(out.far-out.near);
  out.normalBias=c.normalTexels*out.texel;
  out.soft=out.size<=c.softLimit;
  return out;
}
