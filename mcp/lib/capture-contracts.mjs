// Shared capture-sequence REST/MCP contract. Coordinates are viewport CSS pixels.
const text = {type:'string',minLength:1,maxLength:2048};
const object = (properties, required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const integer = (minimum,maximum,defaultValue) => ({type:'integer',minimum,maximum,...(defaultValue === undefined ? {} : {default:defaultValue})});
export const sequenceOptions = {
  outputDir: {...text,description:'Absolute directory on the service host. Creates it if needed; never overwrites existing assets.'},
  maxCaptures: integer(1,30,30),
  next: {...object({selector:text,frameSelector:text,coordinates:object({x:{type:'number',minimum:0},y:{type:'number',minimum:0}})},[]),oneOf:[{required:['selector']},{required:['coordinates']}],description:'Exactly one selector or viewport CSS coordinate target. frameSelector scopes selectors to one iframe.'},
  capture: {...object({selector:text,frameSelector:text,clip:object({x:{type:'number',minimum:0},y:{type:'number',minimum:0},width:{type:'number',minimum:0.01},height:{type:'number',minimum:0.01}})},[]),oneOf:[{required:['selector']},{required:['clip']}],description:'Omit for the viewport. Element must be entirely visible; clip is viewport CSS geometry.'},
  frameSelector: {...text,description:'Optional iframe for readiness, end and position selectors.'},
  readySelector: {...text,description:'Must be visible before accepting stable pixels. Use a viewer-specific loaded state when available.'},
  endSelector: {...text,description:'Visible end marker stops advancing after capturing the current page.'},
  positionSelector: {...text,description:'Optional page position/progress text, recorded with every image.'},
  stableMs: integer(250,5000,750),
  changeTimeoutMs: integer(1000,60000,15000),
  budgetMs: integer(1000,600000,120000),
};
export const sequenceInput = {tabId:text,options:object(sequenceOptions,['outputDir','next']),sequenceId:{type:'string',pattern:'^[a-f0-9-]{36}$',description:'Resume a prior sequence in the same session/tab. Omit options when resuming; stored options and original capture bound are retained.'}};
const dimensions = {width:{type:'number'},height:{type:'number'}};
const rect = object({x:{type:'number'},y:{type:'number'},...dimensions});
const raster = object({left:{type:'integer'},top:{type:'integer'},width:{type:'integer'},height:{type:'integer'}});
const asset = object({
  index:integer(1,30),path:text,sha256:text,width:integer(1,100000),height:integer(1,100000),
  position:{type:['string','null']},url:{type:'string'},capturedAt:{type:'integer'},
  geometry:object({revision:{type:'integer'},url:{type:'string'},...dimensions,x:{type:'number'},y:{type:'number'},scale:{type:'number'},clip:rect,raster,viewportRaster:object(dimensions)}),
});
export const sequenceSummary = object({
  schemaVersion:{type:'integer',enum:[1]},sequenceId:text,sessionId:text,tabId:text,operationId:text,outputDir:text,manifestPath:text,
  state:{type:'string',enum:['running','stopped','interrupted','failed']},phase:{type:'string',enum:['capturing','saving','captured','advancing','awaiting_change']},reason:{type:['string','null']},
  captured:integer(0,30),skipped:integer(0,10000),failed:integer(0,10000),
  maxCaptures:integer(1,30),updated:{type:'integer'},
  assets:{type:'array',maxItems:30,items:asset},
  events:{type:'array',items:object({at:{type:'integer'},phase:{type:'string'},outcome:{type:'string',enum:['stopped','skipped','failed','recovered']},reason:{type:'string'}})},
  checkpoint:{...object({last:asset,pending:asset},[]),description:'Durable phase and pending capture/advance evidence. Never authorizes automatic replay of an uncertain click.'},
});

// Validate from the same descriptor at both the REST and MCP boundary.
export function validateCaptureValue(value,schema,label='options') {
  if(schema.oneOf && schema.oneOf.filter(s=>s.required.every(k=>value && Object.hasOwn(value,k))).length!==1)throw Error(`${label}: supply exactly one target`);
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  if(!types.some(t=>t==='integer'?Number.isInteger(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):typeof value===t))throw Error(`Invalid ${label}`);
  if(typeof value==='number'&&(!Number.isFinite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)||(schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum)))throw Error(`Invalid ${label}`);
  if(typeof value==='string'&&(!value.trim()||value.length>(schema.maxLength??Infinity)||(schema.pattern&&!new RegExp(schema.pattern).test(value))))throw Error(`Invalid ${label}`);
  if(schema.type==='object'){
    for(const k of schema.required||[])if(value[k]===undefined)throw Error(`${label}.${k} required`);
    for(const [k,v]of Object.entries(value)){if(!schema.properties[k])throw Error(`Unknown ${label}.${k}`);validateCaptureValue(v,schema.properties[k],`${label}.${k}`);}
    if(value.frameSelector&&!value.selector&&['options.next','options.capture'].includes(label))throw Error(`${label}.frameSelector requires selector`);
  }
}
export function captureOptions(options){
  validateCaptureValue(options,{type:'object',properties:sequenceOptions,required:['outputDir','next']});
  return {...Object.fromEntries(Object.entries(sequenceOptions).filter(([,s])=>s.default!==undefined).map(([k,s])=>[k,s.default])),...options};
}
