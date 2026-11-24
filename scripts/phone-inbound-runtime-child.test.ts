import {it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {collectInboundRuntimeChild} from './phone-inbound-runtime-child.mjs';
function child(){return Object.assign(new EventEmitter(),{stdout:Object.assign(new EventEmitter(),{destroy:vi.fn()}),stderr:Object.assign(new EventEmitter(),{destroy:vi.fn()}),kill:vi.fn(),unref:vi.fn()});}
it('retains bounded stdout in memory, ignores stderr and waits for owned child close',async()=>{const c=child(),p=collectInboundRuntimeChild(c);c.stdout.emit('data','{"success":false}');c.stderr.emit('data','PRIVATE');c.emit('close',1);expect(await p).toEqual({code:1,output:'{"success":false}'});});
it('kills on excess output and verifies close before returning failure',async()=>{const c=child(),p=collectInboundRuntimeChild(c,{maxBytes:4}).catch(e=>e);c.stdout.emit('data','too much');expect(c.kill).toHaveBeenCalledWith('SIGKILL');c.emit('close',null);expect((await p).settled).toBe(true);});
it('fails bounded and marks termination unverified when a killed child does not close',async()=>{
 vi.useFakeTimers();try{const c=child(),p=collectInboundRuntimeChild(c,{timeoutMs:10,killGraceMs:10}).catch(e=>e);await vi.advanceTimersByTimeAsync(20);expect((await p).settled).toBe(false);expect(c.kill).toHaveBeenCalledTimes(1);expect(c.unref).toHaveBeenCalled();}finally{vi.useRealTimers();}
});
it('handles already-aborted scope without starting another child or retry',async()=>{const c=child(),controller=new AbortController();controller.abort();const p=collectInboundRuntimeChild(c,{signal:controller.signal}).catch(e=>e);c.emit('close',null);expect((await p).settled).toBe(true);expect(c.kill).toHaveBeenCalledTimes(1);});
