import {initialState,isProgressState} from './gameplay.js';
export const PROGRESS_KEY='kamakura-progress-v1';
export const SCHEMA_VERSION=2;
const legacyStages=new Set(['bucket','empty','full','delivered']);
const fresh=notice=>({state:initialState(),hasSave:false,notice});
const invalidNotice='保存データを読み取れなかったため、最初から始めます';

export function loadProgress(storage){
 let raw;
 try{
  if(!storage||typeof storage.getItem!=='function')return fresh('この環境では進行を読み込めません。最初から始めます');
  raw=storage.getItem(PROGRESS_KEY);
 }catch{return fresh('この環境では進行を読み込めません。最初から始めます');}
 if(raw===null)return fresh('');
 if(typeof raw!=='string')return fresh(invalidNotice);
 let data;
 try{data=JSON.parse(raw);}catch{return fresh(invalidNotice);}
 if(!data||typeof data!=='object'||Array.isArray(data))return fresh(invalidNotice);
 if(!Object.hasOwn(data,'schemaVersion')||(data.schemaVersion!==SCHEMA_VERSION&&data.schemaVersion!==1))
  return fresh('保存データの版に対応していないため、最初から始めます');
 if(!isProgressState(data)||(data.schemaVersion===1&&!legacyStages.has(data.stage)))return fresh(invalidNotice);
 // Read-only migration: do not overwrite old data until the next successful action.
 return{state:{stage:data.stage},hasSave:true,notice:data.schemaVersion===1&&data.stage==='delivered'?'水運びの続きから再開できます。次は水路を整えましょう':''};
}
export function saveProgress(storage,state){
 try{
  if(!isProgressState(state))return{ok:false,notice:'進行が不正なため保存できません'};
  if(!storage||typeof storage.setItem!=='function')return{ok:false,notice:'この環境では進行を保存できません。遊びは続けられます'};
  storage.setItem(PROGRESS_KEY,JSON.stringify({schemaVersion:SCHEMA_VERSION,stage:state.stage}));
  return{ok:true,notice:''};
 }catch(error){
  return{ok:false,notice:error?.name==='QuotaExceededError'||error?.name==='NS_ERROR_DOM_QUOTA_REACHED'
   ?'保存容量が足りません。この画面では続けて遊べます'
   :'この環境では進行を保存できません。遊びは続けられます'};
 }
}
