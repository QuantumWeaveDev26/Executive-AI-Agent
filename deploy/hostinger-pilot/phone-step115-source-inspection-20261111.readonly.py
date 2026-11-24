"""Six fixed application modules only, owner-approved inspection; no runtime mutation."""
import json,subprocess
IMAGE="sha256:3985893e8cef0ac5117af145e4785c5ae60bb95e3c997a74532b164860bd1cf9"
CONTAINER="266e7ea1f430fdbc433d5e3dae449068f41628411c3f57644a2a71fe1eae3d60"
EXPECTED={"/app/apps/api/dist/app.js":"e8e0f474870e7e50297649efd1ccf0b081cc38e1099c208147ccb2010e929412","/app/apps/api/pilot-start.mjs":"cbffaddee7dae4918420a2942ea2bcaab5f64a6136b20e13c97ee9c52fa2528d","/app/apps/api/dist/services/phone-pilot-startup.js":"7273fc04178102049eae487793dc2b90176987adb4abada521faad73998a5430","/app/apps/api/node_modules/@thaara/contracts/dist/index.js":"4d753a3dd847ab2f4a0ebfadbb096f748766c41835580d01e29b0309449f986a","/app/apps/api/dist/services/phone-calling.js":"863b64db4063ff04504cafa71bcd146aa126ff283a0fb9b9d6705177310207a9","/app/apps/api/dist/routes/phone-sarvam-webhook.js":"baadbb157191b078e1d7a8b1180b46961737d1f9236d5f20ed6d7f15266a2b68"}
PROBE="const fs=require('node:fs'),crypto=require('node:crypto');\nconst expected={\"/app/apps/api/dist/app.js\":\"e8e0f474870e7e50297649efd1ccf0b081cc38e1099c208147ccb2010e929412\",\"/app/apps/api/pilot-start.mjs\":\"cbffaddee7dae4918420a2942ea2bcaab5f64a6136b20e13c97ee9c52fa2528d\",\"/app/apps/api/dist/services/phone-pilot-startup.js\":\"7273fc04178102049eae487793dc2b90176987adb4abada521faad73998a5430\",\"/app/apps/api/node_modules/@thaara/contracts/dist/index.js\":\"4d753a3dd847ab2f4a0ebfadbb096f748766c41835580d01e29b0309449f986a\",\"/app/apps/api/dist/services/phone-calling.js\":\"863b64db4063ff04504cafa71bcd146aa126ff283a0fb9b9d6705177310207a9\",\"/app/apps/api/dist/routes/phone-sarvam-webhook.js\":\"baadbb157191b078e1d7a8b1180b46961737d1f9236d5f20ed6d7f15266a2b68\"},files={};let total=0;\nfor(const [path,hash] of Object.entries(expected)){\n const resolved=fs.realpathSync(path);\n if(path.endsWith('/@thaara/contracts/dist/index.js')){if(!resolved.startsWith('/app/apps/api/node_modules/')||!resolved.endsWith('/dist/index.js'))throw Error('path');}\n else if(resolved!==path)throw Error('path');\n const fd=fs.openSync(resolved,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);\n try{\n  const before=fs.fstatSync(fd);if(!before.isFile()||before.size<1||before.size>700000||(total+=before.size)>600000)throw Error('size');\n  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);\n  if(['ino','dev','size','ctimeMs','mtimeMs'].some(key=>before[key]!==after[key])||crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('drift');\n  const text=bytes.toString('utf8');\n  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\\bre_[A-Za-z0-9_-]{24,}|\\bAKIA[A-Z0-9]{16}|\\beyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{15,}/.test(text))throw Error('sensitive_literal');\n  if(/(?:password|api_?key|secret|access_?token)\\s*[:=]\\s*['\"][A-Za-z0-9_+/=-]{20,}['\"]/i.test(text))throw Error('sensitive_literal');\n  if(/postgres(?:ql)?:\\/\\/[A-Za-z0-9_%.-]+:[^\\s'\"\\x24{}]+@/i.test(text))throw Error('sensitive_literal');\n  files[path]={sha256:hash,contentBase64:bytes.toString('base64')};\n }finally{fs.closeSync(fd);}\n}\nconsole.log(JSON.stringify(files));"
def docker(*args):
    result=subprocess.run(['docker',*args],capture_output=True,timeout=20)
    if result.returncode or len(result.stdout)>900000: raise RuntimeError('inspection_refused')
    return result.stdout.decode()
def main():
    args=('inspect','--format','{{.Id}}|{{.Image}}|{{.State.Health.Status}}','thaara-v2-pilot-api-1')
    initial=docker(*args).strip()
    if initial!=CONTAINER+'|'+IMAGE+'|healthy': raise RuntimeError('target_drift')
    files=json.loads(docker('exec',CONTAINER,'node','-e',PROBE))
    if set(files)!=set(EXPECTED) or any(files[p]['sha256']!=EXPECTED[p] for p in EXPECTED): raise RuntimeError('source_drift')
    if docker(*args).strip()!=initial: raise RuntimeError('target_drift')
    print(json.dumps({'status':'verified','imageId':IMAGE,'containerId':CONTAINER,'files':files}))
if __name__=='__main__':
    try: main()
    except Exception: print(json.dumps({'status':'stopped','category':'source_inspection_refused_no_retry'}))
