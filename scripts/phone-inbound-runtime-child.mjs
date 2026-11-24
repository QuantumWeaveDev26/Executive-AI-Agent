/** Bounds only the runner-owned child. Unverified termination MUST block fixture deletion. */
export function collectInboundRuntimeChild(child,{signal,timeoutMs=180000,killGraceMs=5000,maxBytes=5000000}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000||!Number.isSafeInteger(killGraceMs)||killGraceMs<1||killGraceMs>5000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>5000000)throw Error('INBOUND_CHILD_BOUNDS_INVALID');
 return new Promise((resolve,reject)=>{
  let output='',bytes=0,stopping=false,done=false,grace;
  const tidy=()=>{clearTimeout(timer);clearTimeout(grace);signal?.removeEventListener('abort',abort);child.stdout.removeListener('data',data);child.stderr.removeListener('data',discard);child.removeListener('close',closed);child.removeListener('error',error);};
  const fail=settled=>{if(done)return;done=true;tidy();reject(Object.assign(Error('INBOUND_CHILD_STOPPED'),{settled}));};
  const stop=()=>{if(done||stopping)return;stopping=true;clearTimeout(timer);grace=setTimeout(()=>{child.stdout.destroy?.();child.stderr.destroy?.();child.unref?.();fail(false);},killGraceMs);try{child.kill('SIGKILL');}catch{/* Wait for close, otherwise refuse cleanup. */}};
  const data=chunk=>{if(done||stopping)return;bytes+=Buffer.byteLength(chunk);if(bytes>maxBytes)return stop();output+=chunk;};
  const discard=()=>{};
  const closed=code=>{if(done)return;if(stopping)return fail(true);done=true;tidy();resolve({code,output});};
  const error=()=>stop(),abort=()=>stop(),timer=setTimeout(stop,timeoutMs);
  child.stdout.on('data',data);child.stderr.on('data',discard);child.once('close',closed);child.once('error',error);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
 });
}
