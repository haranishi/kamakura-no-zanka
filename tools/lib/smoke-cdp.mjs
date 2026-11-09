// Minimal CDP transport using Node 22's built-in WebSocket. No browser dependency.
export async function connectCdp(url,onEvent) {
  const socket=new WebSocket(url), pending=new Map();let sequence=0;
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('CDP connection failed')),{once:true});});
  const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP disconnected'));}pending.clear();};
  socket.addEventListener('close',fail);socket.addEventListener('error',fail);
  socket.addEventListener('message',e=>{
    const msg=JSON.parse(e.data);
    if(msg.id){const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);clearTimeout(p.timer);if(msg.error)p.reject(Error(msg.error.message));else p.resolve(msg.result);}
    else onEvent(msg.method,msg.params);
  });
  return {send(method,params={},timeoutMs=15000){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},timeoutMs);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();fail();}};
}
