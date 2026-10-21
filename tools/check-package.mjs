import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const required=['FILES_SHA256.json','reports/HANDOFF_VALIDATION_JA.md','README_START_HERE.md','AGENTS.md','CLAUDE.md','PROMPT_FOR_CLAUDE_CODE_OR_CODEX.md','docs/01_DEVELOPMENT_BRIEF_JA.md','docs/02_ARCHITECTURE_JA.md','docs/03_ACCEPTANCE_CHECKLIST_JA.md','docs/04_BASELINE_AND_LIMITS_JA.md','docs/05_ASSETS_AND_LICENSES_JA.md','dist/index.html','dist/app.js','dist/ui.js','dist/collision.js','dist/style.css','dist/assets/scene.glb','dist/assets/collision.json','dist/vendor/three.module.min.js','dist/vendor/three.core.min.js','dist/vendor/loaders/GLTFLoader.js','dist/vendor/utils/BufferGeometryUtils.js','licenses/THREE-LICENSE.txt'];
for(const f of required)assert(fs.statSync(path.join(root,f)).size>0,`Missing ${f}`);
for(const f of ['dist/app.js','dist/ui.js','dist/collision.js','tools/serve.mjs','tools/smoke.mjs']){const r=spawnSync(process.execPath,['--check',path.join(root,f)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
const b=fs.readFileSync(path.join(root,'dist/assets/scene.glb'));assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
const g=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));assert(g.meshes.length>0);assert(g.images.every(x=>x.bufferView!==undefined&&!x.uri),'GLB must embed images');
console.log(`Package check passed: ${required.length} required files, JS syntax, embedded GLB images.`);
