// Dependency-free development server. Localhost only; not a production host.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
export function createServer(){return http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  const raw=decodeURIComponent((req.url||'/').split('?')[0]);
  if(raw.includes('\0')||raw.includes('\\')||raw.split('/').includes('..')){res.writeHead(403);res.end();return;}
  let file=path.resolve(root,'.'+(raw==='/'?'/index.html':raw));
  if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html')){res.writeHead(403);res.end();return;}
  let stat=await fs.stat(file);
  // /valley/ で index.html を返す。末尾の / が無ければ付けて飛ばす（//valley のような二重の / でも、行き先は解決した相対パスから作り、外のホストへ飛ばさない）。一覧は出さない。
  if(stat.isDirectory()){
   if(!raw.endsWith('/')){res.writeHead(301,{Location:'/'+path.relative(root,file).split(path.sep).map(encodeURIComponent).join('/')+'/'});res.end();return;}
   file=path.join(file,'index.html');stat=await fs.stat(file);
  }
  if(!stat.isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:await fs.readFile(file));
 }catch(error){res.writeHead(error instanceof URIError?400:404);res.end('Not found');}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const flag=process.argv.indexOf('--port');const port=Number(flag>=0?process.argv[flag+1]:process.env.PORT||8080);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Port must be an integer from 1 to 65535.');
 const server=createServer();server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is busy. Try: npm start -- --port 8081`:e.message);process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`Kamakura: http://127.0.0.1:${port}  (v18 garden)\n          http://127.0.0.1:${port}/valley/index.html  (v19 hidden-valley slice)\nStop with Ctrl+C. No install/build step required.`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
