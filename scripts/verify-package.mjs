import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync,strFromU8 } from '../vendor/fflate.js';
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
const files=unzipSync(new Uint8Array(await readFile(`dist/spark-planner-${manifest.version}.zip`)));
for(const file of Object.keys(files))assert.ok(!/(?:^|\/)(?:node_modules|test-results|data|chats|worlds|characters|secrets\.json|settings\.json)(?:\/|$)/.test(file),file);
for(const entry of await readdir('.',{withFileTypes:true}))if(entry.isFile() && /\.(?:js|css)$/.test(entry.name))assert.ok(files['spark-planner/'+entry.name],`Missing runtime: ${entry.name}`);
for(const [file,bytes] of Object.entries(files)){
    if(!/\.(?:js|css)$/.test(file))continue;
    const text=strFromU8(bytes),references=[...text.matchAll(/(?:from\s*|import\s*\(\s*|@import\s+url\(\s*)['"](\.[^'"]+)['"]/g)];
    for(const [,ref] of references){
        const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),ref));
        if(!target.startsWith('spark-planner/')){assert.ok(['../../../textgen-settings.js','../../../nai-settings.js'].includes(ref),`Unexpected host dependency: ${ref}`);continue;}
        assert.ok(files[target],`${file} -> ${ref}`);
    }
}
assert.equal(JSON.parse(strFromU8(files['spark-planner/manifest.json'])).version,'0.8.0');
console.log(`Verified ${Object.keys(files).length} package entries; runtime imports/CSS complete; personal/runtime data excluded.`);
