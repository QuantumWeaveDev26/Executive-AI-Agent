import { loadLocalApiEnvironment } from './local-environment.js';
import { loadConfig } from '@thaara/config';
import { Logger } from '@thaara/observability';
import { buildApp } from './app.js';
import { createLiveGoogleIntegrationFromEnv } from './services/google-live.js';

async function main() {
  loadLocalApiEnvironment();
  const config = loadConfig();
  const logger = new Logger(config.LOG_LEVEL);
  const liveGoogle = createLiveGoogleIntegrationFromEnv(process.env);
  const app = await buildApp({ config, logger, ...liveGoogle });

  try {
    const address = await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(`[API Server] Running at ${address}`);
    logger.info(`[API Server] OpenAPI documentation available at ${address}/docs`);
  } catch (err) {
    logger.error('[API Server] Startup failure', {
      error: {
        name: (err as Error).name,
        message: (err as Error).message
      }
    });
    process.exit(1);
  }
}

main();
