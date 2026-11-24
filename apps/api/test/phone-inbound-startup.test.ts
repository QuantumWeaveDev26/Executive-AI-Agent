import {it,expect} from 'vitest';
import {buildApp} from '../src/app.js';
import type {Config} from '@thaara/config';
it('does not admit a test report reader into production startup',async()=>{
 await expect(buildApp({config:{NODE_ENV:'production'} as Config,phoneInboundReports:async()=>[]})).rejects.toThrow('test-only pending durable admission');
});
