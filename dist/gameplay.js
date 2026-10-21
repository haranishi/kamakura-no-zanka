// Progress is independent of scene objects, player position, input and storage.
const steps={
 bucket:{action:'pickup',next:'empty',objective:'庭の桶を拾いましょう',inventory:'なし',notice:'空の桶を拾いました'},
 empty:{action:'fill',next:'full',objective:'井戸で水をくみましょう',inventory:'空の桶',notice:'井戸で水をくみました'},
 full:{action:'deliver',next:'delivered',objective:'庭へ水を届けましょう',inventory:'水入りの桶',notice:'庭へ水を届けました'},
 delivered:{objective:'水を届けました。谷の散策をお楽しみください',inventory:'なし'}
};
export function initialState(){return{stage:'bucket'};}
export function isProgressState(state){
 return state!==null&&typeof state==='object'&&!Array.isArray(state)&&
  Object.hasOwn(state,'stage')&&typeof state.stage==='string'&&Object.hasOwn(steps,state.stage);
}
export function transition(state,action){
 if(!isProgressState(state))return{changed:false,state:initialState(),notice:'進行を初期状態に戻しました'};
 const current=steps[state.stage];
 if(typeof action!=='string'||!current.action||action!==current.action)
  return{changed:false,state:{stage:state.stage},notice:''};
 return{changed:true,state:{stage:current.next},notice:current.notice};
}
export function objectiveFor(state){return steps[isProgressState(state)?state.stage:'bucket'].objective;}
export function inventoryFor(state){return steps[isProgressState(state)?state.stage:'bucket'].inventory;}
