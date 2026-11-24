// Local packaging only. Produces a review-only candidate; does not use Docker, SSH or credentials.
import fs from 'node:fs';
import path from 'node:path';
import {reconcileOwnerCalendar,collectOwnerCalendarModules} from './phone-owner-calendar-overlay.mjs';
import {sha} from './phone-chat-overlay.mjs';

const root='output/THAARA_PHONE_OWNER_CALENDAR_BUILD_ONLY_V3_2026-11-07';
const web='node_modules/.cache/phone-web-current-baseline-20261107/phone-only-as-built-candidate-dist';
const webPins={
 'index.html':'4934d8abf5718763c4b02462d94dad8c05abf68e1da2d65b84fcbffb949ed3fb',
 'assets/index-Co2o2hIb.css':'ed715f21be63f91a95091267354402101c750b39666ff5f6a8b52d853ff63309',
 'assets/index-D7sXcLxw.js':'1f3dfa9b2e0a3dd73ee7a5231d509725a7db87d5347a020348e4fca10328e228'
};
const api=reconcileOwnerCalendar(JSON.parse(fs.readFileSync('node_modules/.cache/phone-release-source-20261107.result.json','utf8')));
const closure=collectOwnerCalendarModules(p=>fs.readFileSync(p));
const files=new Map(),installed={};
function stage(target,body){
 const prefix='/app/apps/api/node_modules/@thaara/contracts/dist/';
 const relative=target.startsWith(prefix)?'overlay/contracts/'+target.slice(prefix.length):target.replace('/app/apps/api/','overlay/api/');
 files.set(relative,body);installed[target]=sha(Buffer.from(body));
}
for(const [name,target]of Object.entries(api.targets))stage(target,api.files[name]);
for(const entry of closure.files)stage(entry.target,entry.bytes);
for(const[name,pin]of Object.entries(webPins)){
 const body=fs.readFileSync(path.join(web,name));if(sha(body)!==pin)throw Error('phone_web_candidate_hash_mismatch');
 files.set('overlay/web/'+name,body);installed['/app/apps/web/dist/'+name]=pin;
}
files.set('validate.mjs',`import fs from 'node:fs';import{createHash}from'node:crypto';
const expected=${JSON.stringify(installed)};
try{
 if(process.getuid()!==1000||process.getgid()!==1000||process.env.THAARA_PHONE_OWNER_CALENDAR_REVIEW!==undefined)throw Error();
 for(const [name,hash]of Object.entries(expected))if(createHash('sha256').update(fs.readFileSync(name)).digest('hex')!==hash)throw Error();
 for(const [name,exports]of Object.entries(${JSON.stringify(closure.existingRuntimeExports)})){const m=await import(name.startsWith('./services/')?name.replace('./services/','./dist/services/'):name);if(exports.some(e=>!(e in m)))throw Error();}
 const app=await import('./dist/app.js'), startup=await import('./dist/services/phone-pilot-startup.js');
 const off=await startup.createPhoneStartup({});
 if(typeof app.buildApp!=='function'||off.status!=='off'||off.phoneOwnerCalendarReview!==undefined||off.phoneCalling!==undefined)throw Error();
 console.log(JSON.stringify({status:'passed',filesVerified:Object.keys(expected).length,importsVerified:true,featureOff:true}));
}catch{console.log(JSON.stringify({status:'failed',category:'candidate_import_or_hash_check_failed'}));process.exitCode=2;}
`);
const before=Object.fromEntries(Object.entries(api.targets).map(([n,p])=>[p,api.beforeHashes[n]]));
before['/app/apps/web/dist/assets/index-BuFC9B_6.js']='3ba8764bda73e4837b10f0d2659bedc4c729729d236c7934936b9048f627bd06';
before['/app/apps/web/dist/assets/index-Co2o2hIb.css']=webPins['assets/index-Co2o2hIb.css'];
files.set('manifest.json',JSON.stringify({reviewOnly:true,executionAuthorized:false,buildOnly:true,assembly:'exact-local-stopped-container',baseImage:api.baseImage,baseContainer:api.baseContainer,baselineFiles:before,installedFiles:installed,packageFiles:Object.fromEntries([...files].map(([n,b])=>[n,sha(Buffer.from(b))]))},null,2)+'\n');
if(fs.existsSync(root))throw Error('phone_candidate_directory_already_exists');
fs.mkdirSync(root);
for(const[name,body]of files){const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body,{flag:'wx'});}
console.log(JSON.stringify({folder:root,files:files.size,executionAuthorized:false}));
