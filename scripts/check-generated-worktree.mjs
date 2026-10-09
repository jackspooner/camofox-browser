// Verify generated owners without advancing committed artifacts.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const files=['package.json','package-lock.json','mcp/package-lock.json','openapi.json','agent-openapi.json','lib/platform/routes.js','openclaw.plugin.json'];
const hashes=()=>files.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex'));
const before=hashes();
const result=spawnSync('npm',['run','generate-openapi'],{stdio:'inherit'});
if(result.error||result.status!==0)throw Error('Native contract generation failed.');
if(hashes().some((hash,i)=>hash!==before[i]))throw Error('Generated contracts or locks were stale; review generated changes and rerun.');
