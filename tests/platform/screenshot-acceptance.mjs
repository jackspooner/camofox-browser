import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import sharp from 'sharp';
import {workerJson} from '../../lib/platform/worker-launcher.js';

export const screenshotPage = `<!doctype html><style>
  * {box-sizing:border-box} body {margin:0; height:3200px; background:#fff}
  button {position:absolute; left:12px; top:2800px; width:123px; height:67px;
    padding:0; border:0; appearance:none; background:#0c7e34}
</style><button id="card" aria-label="Card"></button><i></i><i></i>`;

export async function checkScreenshots(fixture) {
  const client = new Client({name:'screenshot-fixture',version:'1'});
  const transport = new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('../../mcp/server.mjs',import.meta.url))],
    env:{CAMOFOX_BASE_URL:fixture.base,CAMOFOX_USER_ID:'fixture'}});
  try {
    await client.connect(transport);
    await verifyScreenshots(client, fixture);
  } finally { await client.close(); }
}

async function verifyScreenshots(client, {base, fixtureUrl, call, settled, session, supervisor, receivedHash}) {
  const {tabId} = await settled(await call('/tabs', {sessionId:session.id, url:fixtureUrl}));
  assert(tabId);
  const path = '/tabs/' + tabId;
  const capture = async options => {
    const result = await client.callTool({name:'camofox_screenshot',arguments:{tabId,...options}});
    assert(!result.isError, result.content[0]?.text);
    const [text,image] = result.content;
    const meta = JSON.parse(text.text).capture;
    assert.equal(image.mimeType, 'image/png');
    const bytes = Buffer.from(image.data,'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.sha256);
    assert.equal(meta.byteSize, bytes.length);
    assert.equal(meta.sourceKind, options.mode ?? 'viewport');
    const decoded = await sharp(bytes).metadata();
    assert.equal(decoded.format, 'png');
    assert.deepEqual([decoded.width,decoded.height],[meta.width,meta.height]);
    return {meta,bytes};
  };
  const pixel = async (bytes,x,y) => [...await sharp(bytes).extract({left:x,top:y,width:1,height:1}).removeAlpha().raw().toBuffer()];
  const evaluate = async expression => {
    const result = await settled(await call(path+'/evaluate',{expression}));
    assert(!result.error,JSON.stringify(result));
    return result.result;
  };
  const implicit = await capture({}), explicit = await capture({mode:'viewport'});
  assert.deepEqual(implicit.bytes, explicit.bytes);
  assert(implicit.meta.height < 2800);
  assert.deepEqual(await pixel(implicit.bytes,18,18),[255,255,255]);
  const snapshot = await call(path+'/snapshot');
  const ref = snapshot.snapshot.match(/button "Card" \[(e\d+)\]/)?.[1];
  assert(ref);
  const worker = supervisor.workers.get(session.id);
  worker.humanControl = true;
  await workerJson(worker.socket,supervisor.config.workerKey,'POST','/internal/viewer-mode',{humanControl:true});
  let element,full;
  try {
    element = await capture({mode:'element',selector:'#card'});
    assert.deepEqual([element.meta.width,element.meta.height],[123,67]);
    assert.deepEqual(await pixel(element.bytes,20,20),[12,126,52]);
    assert.deepEqual((await capture({mode:'element',ref})).bytes,element.bytes);
    full = await capture({mode:'fullPage'});
    assert.equal(full.meta.height,3200);
    assert.deepEqual(await pixel(full.bytes,32,2820),[12,126,52]);
    assert.deepEqual((await capture({})).bytes,implicit.bytes);
  } finally {
    worker.humanControl = false;
    await workerJson(worker.socket,supervisor.config.workerKey,'POST','/internal/viewer-mode',{humanControl:false});
  }
  for (const [query,code,status] of [
    ['mode=element&selector=i','ambiguous_target',409],['mode=element&selector=%5B','invalid_selector',400],
    ['mode=element&ref=e99999','stale_refs',422],['mode=element&selector=.missing','invalid_target',400],
    ['mode=element','invalid_request',400],['mode=fullPage&selector=i','invalid_request',400],
    ['mode=element&ref=e1&selector=i','invalid_request',400],
  ]) {
    const result = await call(path+'/screenshot?'+query);
    assert.deepEqual([result.code,result.httpStatus],[code,status]);
  }
  const wrongOwner = await fetch(base+path+'/screenshot?userId=other&mode=fullPage');
  assert(wrongOwner.status >= 400);
  assert(!wrongOwner.headers.has('x-camofox-capture'));
  await evaluate("document.body.style.height='9000px'; document.querySelector('button').remove(); true");
  const oversize = await call(path+'/screenshot?mode=fullPage');
  assert.deepEqual([oversize.code,oversize.httpStatus],['invalid_target',400]);
  assert.equal((await call(path+'/screenshot?mode=element&ref='+ref)).code,'stale_refs');
  await evaluate("Object.assign(document.body.style,{width:'5000px',height:'4000px'}); true");
  assert.equal((await call(path+'/screenshot?mode=fullPage')).code,'invalid_target');
  for (const {meta} of [element,full]) {
    const result = await settled(await call(path+'/analyse-image',{
      source:{type:'capture',captureId:meta.captureId},prompt:'Inspect the saved image',
    }));
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.deepEqual(result.image,meta);
    assert.equal(receivedHash(),meta.sha256);
  }
  console.log('PASS screenshot viewport parity, element/ref PNG dimensions and colours, below-fold full page, human control, bounds, stale/ambiguous targets, ownership and exact retained bytes');
}
