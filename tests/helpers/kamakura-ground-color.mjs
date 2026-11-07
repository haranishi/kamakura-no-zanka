import { groundPattern, smooth } from '../../dist/valley/kamakura-ground-pattern.js';

const pattern=groundPattern();
// Repeat/Linear sampling of the shipped texture's level zero, before lighting.
export function groundTexture(x,z,channel=0){
  const n=pattern.size,u=(x-Math.floor(x))*n-.5,v=(z-Math.floor(z))*n-.5,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
  const at=(i,j)=>pattern.data[(((j+n)%n)*n+(i+n)%n)*4+channel]/255;
  return (1-b)*((1-a)*at(i,j)+a*at(i+1,j))+b*((1-a)*at(i,j+1)+a*at(i+1,j+1));
}
export function groundDetailChannel(x,z,d,amount,k){
  const a=groundTexture(x/1.7,z/1.7),b=groundTexture((.8*x+.6*z)/9,(-.6*x+.8*z)/9);
  const blend=.5+.25*Math.sin(x*.023+Math.sin(z*.031)),grain=(a+(b-a)*blend)*2-1;
  const amp=smooth(18,55,d)*(1-smooth(700,2500,d)),near=1-smooth(8,18,d);
  return 1+amount*(amp*(grain*.42+[.12,.04,-.12][k]*(groundTexture(x/1.7,z/1.7,2)-.5))-near*(.23+grain*.10)*[.85,1,1.15][k]);
}
