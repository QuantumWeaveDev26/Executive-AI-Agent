import { loadConfig } from '@thaara/config';
import { PostgresDatabase, RoleAwarePool } from '@thaara/db';
import { Logger } from '@thaara/observability';
import { DistributedJobQueue } from './queue.js';
import { AssistantStreamSweeper, ApprovalSweeper } from './sweeper.js';
import { OutboxDispatchSweeper } from './outbox-sweeper.js';
import { PrivacyPurgeContinuationSweeper } from './continuation-sweeper.js';

export function resolveWorkerConnectionString(
  databaseUrl: string,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (env.WORKER_DATABASE_URL) {
    return env.WORKER_DATABASE_URL;
  }
  const workerPassword = env.THAARA_DB_WORKER_PASSWORD;
  if (workerPassword && databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      parsed.username = 'thaara_worker_user';
      parsed.password = workerPassword;
      return parsed.toString();
    } catch {
      return null;
    }
  }
  return null;
}

export async function createWorkerService(options?: {
  config?: ReturnType<typeof loadConfig>;
  db?: PostgresDatabase;
  workerPool?: RoleAwarePool;
}) {
  const config = options?.config ?? loadConfig();
  const logger = new Logger(config.LOG_LEVEL);
  logger.info('[Worker Process] Initializing worker service...');

  const db = options?.db ?? new PostgresDatabase(config.DATABASE_URL);

  // Configure RoleAwarePool for thaara_worker
  const workerConnStr = resolveWorkerConnectionString(config.DATABASE_URL);
  let workerPool: RoleAwarePool | null = options?.workerPool ?? null;
  let assistantStreamSweeper: AssistantStreamSweeper | null = null;
  let outboxDispatchSweeper: OutboxDispatchSweeper | null = null;
  let continuationSweeper: PrivacyPurgeContinuationSweeper | null = null;

  if (!workerPool && workerConnStr) {
    workerPool = new RoleAwarePool({
      connectionString: workerConnStr,
      targetRole: 'thaara_worker',
      expectedLoginUser: 'thaara_worker_user'
    });
  }

  if (workerPool) {
    if (workerPool.targetRole !== 'thaara_worker') {
      throw new Error(
        `[Worker Process] Fatal: Expected worker pool targetRole "thaara_worker", got "${workerPool.targetRole}".`
      );
    }
    // Validate credentials, login identity (thaara_worker_user), and effective role (thaara_worker) before worker starts processing jobs
    logger.info('[Worker Process] Validating worker database credentials and role checkout...');
    const verificationClient = await workerPool.checkout();
    try {
      const { rows } = await verificationClient.query<{ session_user: string; current_user: string }>(
        'SELECT session_user, current_user;'
      );
      const identity = rows[0];
      if (!identity || identity.session_user !== 'thaara_worker_user' || identity.current_user !== 'thaara_worker') {
        throw new Error(
          `[Worker Process] Fatal: Worker role checkout identity mismatch: expected session_user "thaara_worker_user" and current_user "thaara_worker", got "${identity?.session_user}" / "${identity?.current_user}".`
        );
      }
    } finally {
      await verificationClient.release();
    }
    logger.info('[Worker Process] Worker role thaara_worker validated successfully.');
  } else if (config.NODE_ENV !== 'test') {
    throw new Error(
      '[Worker Process] Fatal: Worker database credentials (WORKER_DATABASE_URL or THAARA_DB_WORKER_PASSWORD) must be configured for thaara_worker in all non-test environments.'
    );
  }

  const activePoolOrDb = workerPool ?? db;
  const queue = new DistributedJobQueue(config.REDIS_URL, db, logger, workerPool ?? undefined);

  assistantStreamSweeper = new AssistantStreamSweeper(activePoolOrDb, logger);
  outboxDispatchSweeper = new OutboxDispatchSweeper(activePoolOrDb, queue, logger);
  continuationSweeper = new PrivacyPurgeContinuationSweeper(activePoolOrDb, queue, logger);

  const approvalSweeper = new ApprovalSweeper(db, logger, (data) => queue.enqueue(data));

  const start = () => {
    queue.startWorker();
    logger.info('[Worker Process] Worker running and listening for jobs on Redis queue.');

    approvalSweeper.start();
    void approvalSweeper.sweepOrphanedPlanSteps().catch((err) => {
      logger.error('[Worker Process] Initial orphaned plan step recovery failed', {
        error: { name: (err as Error).name, message: (err as Error).message }
      });
    });
    logger.info('[Worker Process] ApprovalSweeper started.');

    if (assistantStreamSweeper) {
      assistantStreamSweeper.start();
      logger.info('[Worker Process] AssistantStreamSweeper started with thaara_worker pool.');
    }

    if (outboxDispatchSweeper) {
      outboxDispatchSweeper.start();
      logger.info('[Worker Process] OutboxDispatchSweeper started with thaara_worker pool.');
    }

    if (continuationSweeper) {
      continuationSweeper.start();
      logger.info('[Worker Process] PrivacyPurgeContinuationSweeper started with thaara_worker pool.');
    }
  };

  const stop = async () => {
    logger.info('[Worker Process] Shutting down worker...');
    approvalSweeper.stop();
    if (assistantStreamSweeper) {
      assistantStreamSweeper.stop();
      logger.info('[Worker Process] AssistantStreamSweeper stopped.');
    }
    if (outboxDispatchSweeper) {
      outboxDispatchSweeper.stop();
      logger.info('[Worker Process] OutboxDispatchSweeper stopped.');
    }
    if (continuationSweeper) {
      continuationSweeper.stop();
      logger.info('[Worker Process] PrivacyPurgeContinuationSweeper stopped.');
    }
    await queue.close();
    if (workerPool && !options?.workerPool) {
      await workerPool.close();
    }
    if (!options?.db) {
      await db.close();
    }
  };

  return {
    config,
    logger,
    db,
    queue,
    workerPool,
    assistantStreamSweeper,
    outboxDispatchSweeper,
    continuationSweeper,
    approvalSweeper,
    start,
    stop
  };
}

async function main() {
  const service = await createWorkerService();
  service.start();

  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (
  process.argv[1]?.endsWith('worker.ts') ||
  process.argv[1]?.endsWith('worker.js')
) {
  main().catch((err) => {
    console.error('[Worker Process] Fatal error:', err);
    process.exit(1);
  });
}
