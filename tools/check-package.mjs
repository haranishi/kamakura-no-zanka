import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const required=['FILES_SHA256.json','reports/HANDOFF_VALIDATION_JA.md','README_START_HERE.md','AGENTS.md','CLAUDE.md','PROMPT_FOR_CLAUDE_CODE_OR_CODEX.md','docs/01_DEVELOPMENT_BRIEF_JA.md','docs/02_ARCHITECTURE_JA.md','docs/03_ACCEPTANCE_CHECKLIST_JA.md','docs/04_BASELINE_AND_LIMITS_JA.md','docs/05_ASSETS_AND_LICENSES_JA.md','dist/index.html','dist/app.js','dist/ui.js','dist/collision.js','dist/gameplay.js','dist/interactions.js','dist/save.js','dist/audio.js','dist/quest-view.js','dist/environment.js','dist/style.css','dist/assets/scene.glb','dist/assets/collision.json','dist/vendor/three.module.min.js','dist/vendor/three.core.min.js','dist/vendor/loaders/GLTFLoader.js','dist/vendor/utils/BufferGeometryUtils.js','licenses/THREE-LICENSE.txt'];
for(const f of required)assert(fs.statSync(path.join(root,f)).size>0,`Missing ${f}`);
function scriptsIn(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const p=path.join(dir,entry.name);return entry.isDirectory()?scriptsIn(p):/\.(m?js)$/.test(entry.name)?[p]:[];});}
const scripts=['dist','tools','tests'].flatMap(dir=>scriptsIn(path.join(root,dir)));
for(const f of scripts){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
const b=fs.readFileSync(path.join(root,'dist/assets/scene.glb'));assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
const g=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));assert(g.meshes.length>0);assert(g.images.every(x=>x.bufferView!==undefined&&!x.uri),'GLB must embed images');
for(const [file,expected] of [['dist/assets/scene.glb','4fbeeec599166e4da9eedb2f814d40be932cd62302a7275e76e4b0a03af6b43a'],['dist/assets/collision.json','f7cc177f0921d1a984b6fefee5a033354aad75f58c4618c6a4dd96135b2d882f']])assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),expected,`Original asset changed: ${file}`);
console.log(`Package check passed: ${required.length} required files, ${scripts.length} JS syntax checks, embedded GLB images.`);
