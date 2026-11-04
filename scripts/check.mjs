import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root = fileURLToPath(new URL('../',import.meta.url));
async function check(folder) {
  for (const item of await readdir(folder,{withFileTypes:true})) {
    const path = join(folder,item.name);
    if (item.isDirectory()) await check(path);
    else if (/\.(?:js|mjs)$/.test(item.name)) execFileSync(process.execPath,['--check',path],{stdio:'inherit'});
  }
}
await check(join(root,'extension'));
await check(join(root,'scripts'));
const manifest = JSON.parse(await readFile(join(root,'extension/manifest.json'),'utf8'));
const pkg = JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if (manifest.version !== pkg.version) throw new Error('Extension and package versions differ');
for (const path of [manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(s=>s.js),'settings.html','converter.html']) await readFile(join(root,'extension',path));
console.log('JavaScript syntax, manifest entry files and version consistency checked.');
