declare module '*step74-runtime-guard.mjs' {
 export function getIsolatedRuntimeConfig(env:Record<string,string|undefined>):Readonly<{appUrl:string;migrationUrl:string;bootstrapUrl:string;workerUrl:string;redisUrl:string}>;
}
