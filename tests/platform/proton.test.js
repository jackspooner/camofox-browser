import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtonProvider} from '../../lib/platform/proton-launcher.js';
test('concurrent routes respect account limits, invalid countries fail, renewal keeps the selected server',async()=>{
 const vpn=new ProtonProvider({});const calls=[];
 vpn.provider=async(action)=>{
  calls.push(action);
  if(action==='countries')return {countries:[{code:'GB',name:'United Kingdom'}]};
  if(action==='renew')return {agentKey:'new',certificate:'new',validFor:3600};
  return {maxConnections:1,validFor:3600,server:'GB-1',domain:'original.proton.example',bouncing:'1',endpoint:'203.0.113.1'};
 };
 vpn.helper=async()=>({});vpn.startAgent=async(route,credentials)=>{route.ready=true;route.credentialsForTest=credentials;};
 assert.equal(await vpn.resolveCountry('united kingdom'),'GB');
 await assert.rejects(()=>vpn.resolveCountry('missing-country'),e=>e.code==='country_unavailable');
 const results=await Promise.allSettled([vpn.connect('GB','one'),vpn.connect('GB','two')]);
 try{
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'vpn_connection_limit');
  const route=results.find(r=>r.status==='fulfilled').value;
  await vpn.renew(route);assert.equal(route.credentialsForTest.domain,'original.proton.example');assert.equal(route.credentialsForTest.certificate,'new');assert.equal(calls.at(-1),'renew');
 }finally{for(const route of [...vpn.routes.values()])await vpn.disconnect(route);}
});
