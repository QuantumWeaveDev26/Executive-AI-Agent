// Execute before any approved Node migration/provisioning child imports its entry point.
import { getIsolatedRuntimeConfig } from './step74-runtime-guard.mjs';
getIsolatedRuntimeConfig(process.env);
if(process.argv.some(arg=>arg.includes('provision-task004-fresh')))
  throw new Error('[Step 74 isolation] Destructive fresh-database recreation is outside this approval');
