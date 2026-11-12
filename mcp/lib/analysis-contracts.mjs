import {validateCaptureValue} from './capture-contracts.mjs';
const text={type:'string',minLength:1,maxLength:2048};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const rect=object({x:{type:'number',minimum:0},y:{type:'number',minimum:0},width:{type:'number',minimum:0.01},height:{type:'number',minimum:0.01}},['x','y','width','height']);
export const analysisSource=object({
 type:{type:'string',enum:['viewport','element','region','capture','original']},
 ref:text,selector:text,frameSelector:text,clip:rect,captureId:text,url:{...text,maxLength:16384},
 screenshotFallback:{type:'boolean'},
},['type']);
const variant=(kind,fields,required=[])=>object({type:{type:'string',enum:[kind]},...Object.fromEntries(fields.map(key=>[key,analysisSource.properties[key]]))},['type',...required]);
analysisSource.oneOf=[variant('viewport',[]),variant('region',['clip'],['clip']),variant('capture',['captureId'],['captureId']),variant('element',['ref'],['ref']),variant('element',['selector','frameSelector'],['selector']),variant('original',['ref','url','screenshotFallback'],['ref']),variant('original',['selector','frameSelector','url','screenshotFallback'],['selector'])];
export const analysisInference=object({
 mode:{type:'string',enum:['quick','custom']},model:text,provider:text,providerSelection:{type:'string',enum:['auto']},
 upstreamProvider:text,
 routing:object({workload:{type:'string',enum:['general','coding']},sessionId:text,allowPaidFallback:{type:'boolean'},maxEstimatedCostUsd:{type:'number',minimum:0},allowedProviders:{type:'array',items:text,maxItems:64}}),
});
export const analysisOutput=object({type:{type:'string',enum:['text','json_object','json_schema']},name:text,strict:{type:'boolean'},schema:{type:'object',additionalProperties:true}},['type']);
analysisOutput.oneOf=['text','json_object','json_schema'].map(type=>object({type:{type:'string',enum:[type]},...(type==='json_schema'?Object.fromEntries(['name','strict','schema'].map(key=>[key,analysisOutput.properties[key]])):{})},type==='json_schema'?['type','schema']:['type']));
export const analysisInput={tabId:text,prompt:{...text,maxLength:64000},source:analysisSource,inference:analysisInference,output:analysisOutput,maxOutputTokens:{type:'integer',minimum:1}};
export const imageProvenance=object({captureId:text,sourceKind:{type:'string'},width:{type:'integer'},height:{type:'integer'},sha256:text,byteSize:{type:'integer'},capturedAt:{type:'integer'},expiresAt:{type:'integer'},fallback:{type:'boolean'}},['captureId','sourceKind','width','height','sha256','byteSize','capturedAt','expiresAt','fallback']);
export function validateAnalysis(args){
 for(const key of ['tabId','prompt','maxOutputTokens'])if(args[key]!==undefined)validateCaptureValue(args[key],analysisInput[key],key);
 const source=args.source||{type:'viewport'};
 validateCaptureValue(source,analysisSource,'source');
 const fields={viewport:[],element:['ref','selector','frameSelector'],region:['clip'],capture:['captureId'],original:['ref','selector','frameSelector','url','screenshotFallback']}[source.type];
 if(!fields||Object.keys(source).some(k=>k!=='type'&&!fields.includes(k)))throw Error('Invalid image source fields');
 if(['element','original'].includes(source.type)&&!!source.ref===!!source.selector)throw Error('Select exactly one ref or CSS selector');
 if(source.ref&&source.frameSelector)throw Error('A ref already identifies its document');
 if(source.type==='capture'&&!source.captureId)throw Error('captureId required');
 if(source.type==='region'&&!source.clip)throw Error('clip required');
 if(args.inference){
  validateCaptureValue(args.inference,analysisInference,'inference');
  if((args.inference.mode==='custom'||args.inference.providerSelection)&&!args.inference.model)throw Error('Selected inference requires a model');
  if(args.inference.mode==='quick'&&(args.inference.providerSelection||args.inference.upstreamProvider||args.inference.routing))throw Error('Quick mode does not accept hosted routing');
 }
 if(args.output){validateCaptureValue(args.output,analysisOutput,'output');if(args.output.type==='json_schema'&&!args.output.schema)throw Error('JSON schema required');}
 return source;
}
