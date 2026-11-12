import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {problem} from './store.js';

export class ImageCaptures {
 constructor({now=Date.now,maxBytes=128*1024*1024,maxCount=32,ttlMs=300000}={}){this.items=new Map();this.now=now;this.maxBytes=maxBytes;this.maxCount=maxCount;this.ttlMs=ttlMs;}
 prune(){for(const[id,item]of this.items)if(item.expiresAt<=this.now()&&!item.pins)this.items.delete(id);}
 async add(sessionId,tabId,bytes,sourceKind,{fallback=false}={}){
  if(bytes.length>25000000)throw problem('invalid_request','Image exceeds 25 MB',400);
  let meta;
  try{const image=sharp(bytes,{limitInputPixels:64000000});meta=await image.metadata();await image.stats();}
  catch{throw problem('invalid_request','Image must decode as PNG/JPEG/WebP/GIF within 64 megapixels',400);}
  const mimeType={png:'image/png',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[meta.format];
  if(!mimeType||!meta.width||!meta.height)throw problem('invalid_request','Unsupported image format',400);
  this.prune();
  const total=()=>[...this.items.values()].reduce((n,x)=>n+x.bytes.length,0);
  while(this.items.size>=this.maxCount||total()+bytes.length>this.maxBytes){const old=[...this.items].find(([,x])=>!x.pins);if(!old)throw problem('operation_limit','Image capture storage is busy',429);this.items.delete(old[0]);}
  const capturedAt=this.now(),captureId=randomUUID();
  const item={sessionId,tabId,bytes:Buffer.from(bytes),mimeType,pins:0,expiresAt:capturedAt+this.ttlMs,provenance:{captureId,sourceKind,width:meta.width,height:meta.height,sha256:createHash('sha256').update(bytes).digest('hex'),byteSize:bytes.length,capturedAt,expiresAt:capturedAt+this.ttlMs,fallback}};
  this.items.set(captureId,item);return item;
 }
 pin(id,sessionId,tabId){this.prune();const item=this.items.get(id);if(!item||item.expiresAt<=this.now()||item.sessionId!==sessionId||item.tabId!==tabId)throw problem('capture_not_found','Capture expired or does not belong to this session and tab',404);item.pins++;return item;}
 release(item){item.pins--;this.prune();}
}
