import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Both src/ and dist/ are three levels below the repository root.
// Called only by the API entrypoint, never by browser or shared configuration code.
export function loadLocalApiEnvironment(
  env: Record<string, string | undefined> = process.env,
  load: (path: string) => void = loadEnvFile
): void {
  if ((env.NODE_ENV ?? 'development') !== 'development') return;
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  try {
    // Node preserves inherited environment variables. No values are logged or returned.
    load(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw new Error('Local API environment could not be loaded.');
  }
}
