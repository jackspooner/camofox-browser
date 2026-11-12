import sharp from 'sharp';
import {problem} from './store.js';
const MAX_BYTES=25000000;
const fail=(detail)=>problem('invalid_target',detail,400);

export async function readImageBody(response,signal){
 if(!response.ok||!response.body)throw fail('Selected image could not be retrieved');
 if(Number(response.headers.get('content-length'))>MAX_BYTES)throw fail('Selected image exceeds 25 MB');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){signal.throwIfAborted();const{done,value}=await reader.read();if(done)return Buffer.concat(chunks,size);size+=value.length;if(size>MAX_BYTES)throw fail('Selected image exceeds 25 MB');chunks.push(Buffer.from(value));}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

async function originalBytes(handle,url,context,validateUrl){
 if(url.startsWith('data:')){
  const match=/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if(!match||match[2].length>4*Math.ceil(MAX_BYTES/3))throw fail('Unsupported or oversized image data URL');
  return Buffer.from(match[2],'base64');
 }
 if(url.startsWith('blob:')){
  const encoded=await handle.evaluate(async(element,{url,maxBytes})=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch(url,{signal:controller.signal}),blob=await response.blob();
    if(blob.size>maxBytes)throw Error('Image too large');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Blob image read failed'));reader.readAsDataURL(blob);});
    return data.slice(data.indexOf(',')+1);
   }finally{clearTimeout(timer);}
  },{url,maxBytes:MAX_BYTES});
  return Buffer.from(encoded,'base64');
 }
 const signal=AbortSignal.timeout(15000);
 for(let redirects=0;redirects<=5;redirects++){
  if(validateUrl(url))throw fail('Selected image URL scheme is not permitted');
  const parsed=new URL(url);if(parsed.username||parsed.password)throw fail('Image URL credentials are not permitted');
  // The worker shares the session network namespace. Resolve cookies anew for
  // every redirect so credentials never follow a cross-origin redirect blindly.
  const cookies=await context.cookies(url);
  const response=await fetch(url,{redirect:'manual',signal,headers:{Accept:'image/png,image/jpeg,image/webp,image/gif',...(cookies.length?{Cookie:cookies.map(c=>`${c.name}=${c.value}`).join('; ')}:{})}});
  if(response.status>=300&&response.status<400){await response.body?.cancel();const location=response.headers.get('location');if(!location)throw fail('Image redirect has no destination');url=new URL(location,url).href;continue;}
  return readImageBody(response,signal);
 }
 throw fail('Selected image exceeded the redirect limit');
}

export async function acquireImage({page,source,geometry,refs,refToLocator,validateUrl}){
 let locator;
 if(source.ref)locator=refToLocator(page,source.ref,refs);
 else if(source.selector){
  let scope=page;
  if(source.frameSelector){const frames=page.locator(`css=${source.frameSelector}`);if(await frames.count()!==1)throw fail('Select exactly one iframe');scope=page.frameLocator(`css=${source.frameSelector}`);}
  locator=scope.locator(`css=${source.selector}`);
 }
 if(locator&&await locator.count()!==1)throw problem('ambiguous_target','Select exactly one image element');
 const before=await geometry(page);
 let fallback=false;
 if(source.type==='original'){
  const handle=await locator.elementHandle({timeout:2000});
  if(!handle)throw fail('Selected image is unavailable');
  let url;
  try{
   url=await handle.evaluate(element=>element.currentSrc||element.src||null);
   if(typeof url!=='string'||!url)throw fail('Selected element has no original image source');
   if(source.url&&source.url!==url)throw fail('Supplied image URL does not match the selected element');
   let bytes;
   try{bytes=await originalBytes(handle,url,page.context(),validateUrl);}
   catch{throw fail('Original image retrieval failed; use explicit screenshot fallback if appropriate');}
   if(page.url()!==before.url||!await handle.evaluate((element,url)=>element.isConnected&&(element.currentSrc||element.src)===url,url))throw problem('target_changed','Selected image changed during retrieval');
   return {bytes,sourceKind:'original',fallback:false};
  }catch(error){
   if(!source.screenshotFallback||source.url&&source.url!==url||error.code==='target_changed')throw error;
   fallback=true;
  }finally{await handle.dispose();}
 }
 let clip=source.clip;
 if(locator){if(!await locator.isVisible())throw fail('Screenshot target must be visible');clip=await locator.boundingBox({timeout:2000});}
 clip||={x:0,y:0,width:before.width,height:before.height};
 if(!clip||clip.x<0||clip.y<0||clip.width<=0||clip.height<=0||clip.x+clip.width>before.width||clip.y+clip.height>before.height)throw fail('Screenshot region must fit inside the viewport');
 const bytes=await page.screenshot({fullPage:false,animations:'disabled',timeout:2000});
 const after=await geometry(page);
 if(JSON.stringify(before)!==JSON.stringify(after)||locator&&JSON.stringify(clip)!==JSON.stringify(await locator.boundingBox({timeout:2000})))throw problem('target_changed','Page changed during image capture');
 const meta=await sharp(bytes).metadata();
 const left=Math.floor(clip.x*meta.width/before.width),top=Math.floor(clip.y*meta.height/before.height);
 const width=Math.ceil((clip.x+clip.width)*meta.width/before.width)-left,height=Math.ceil((clip.y+clip.height)*meta.height/before.height)-top;
 return {bytes:await sharp(bytes).extract({left,top,width,height}).png().toBuffer(),sourceKind:fallback?'element':source.type,fallback};
}
