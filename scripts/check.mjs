import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for(const entry of await readdir('.',{withFileTypes:true})) if(entry.isFile() && entry.name.endsWith('.js')) execFileSync(process.execPath,['--check',entry.name],{stdio:'inherit'});
console.log('Runtime JavaScript syntax: passed');
