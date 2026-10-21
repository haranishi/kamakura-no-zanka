// Progress is independent of scene objects, player position, input and storage.
const steps={
 bucket:{action:'pickup',next:'empty',objective:'庭の桶を拾いましょう',inventory:'なし',notice:'空の桶を拾いました'},
 empty:{action:'fill',next:'full',objective:'井戸で水をくみましょう',inventory:'空の桶',notice:'井戸で水をくみました'},
 full:{action:'deliver',next:'delivered',objective:'縁側前の苗床へ水を届けましょう',inventory:'水入りの桶',notice:'苗床に水が届きました。次は水路の落枝を除きましょう'},
 delivered:{action:'clear',next:'irrigated',objective:'水路の落枝を取り除きましょう',inventory:'なし',notice:'水路に流れが戻りました。縁側に灯をともそう'},
 irrigated:{action:'light',next:'restored',objective:'縁側の灯をともして、しごとを終えましょう',inventory:'なし',notice:'水と灯が戻りました。今日のしごとは、ここまで'},
 restored:{objective:'水と灯が戻りました。自由に散策できます',inventory:'なし'}
};
const stages=Object.freeze(Object.keys(steps));
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
export function progressFor(state){
 const rank=stages.indexOf(isProgressState(state)?state.stage:'bucket');
 return{step:Math.min(5,rank+1),complete:rank===5,watered:rank>=3,flowing:rank>=4,lit:rank===5,
  label:rank<3?'一杯の水':rank===3?'水路の手入れ':rank===4?'帰る場所の灯':'暮らしに、小さな灯を'};
}
