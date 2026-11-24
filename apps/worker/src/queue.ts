import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { TransactionalDbClient, RoleAwarePool } from '@thaara/db';
import { Logger, defaultLogger } from '@thaara/observability';
import { JobData, JobProcessor } from './processor.js';
import { defaultActionAdapters } from '@thaara/policy';

export const QUEUE_NAME = 'thaara-jobs';

export class DistributedJobQueue {
  private queue: Queue<JobData>;
  private worker?: Worker<JobData>;
  private redisConnection: Redis;
  private workerConnection?: Redis;
  private processor: JobProcessor;

  constructor(
    private redisUrl: string,
    db: TransactionalDbClient,
    private logger: Logger = defaultLogger,
    workerPool?: RoleAwarePool
  ) {
    this.redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<JobData>(QUEUE_NAME, {
      connection: this.redisConnection as any,
      defaultJobOptions: {
        removeOnComplete: { age: 86400, count: 10000 },
        removeOnFail: { age: 86400 * 7, count: 10000 }
      }
    });
    this.processor = new JobProcessor(
      db,
      logger,
      (data) => this.enqueue(data),
      defaultActionAdapters,
      workerPool
    );
  }

  async enqueue(data: JobData): Promise<void> {
    const safeJobId = data.jobRunId ? data.jobRunId.replace(/:/g, '-') : undefined;
    await this.queue.add(data.jobName, data, {
      jobId: safeJobId,
      attempts: data.maxRetries ?? 3,
      backoff: {
        type: 'exponential',
        delay: 500
      }
    });
  }

  startWorker(): void {
    if (this.worker) {
      return;
    }
    this.workerConnection = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<JobData>(
      QUEUE_NAME,
      async (job: Job<JobData>) => {
        return await this.processor.process(job.data, job.attemptsMade + 1);
      },
      {
        connection: this.workerConnection as any,
        concurrency: 5
      }
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`[BullMQ Worker] Job ${job?.id} failed`, {
        context: { error: err.message }
      });
    });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = undefined;
    }
    if (this.workerConnection) {
      try {
        if (this.workerConnection.status !== 'end') {
          await this.workerConnection.quit();
        }
      } catch {
        // Ignore if connection is already closed
      }
      this.workerConnection = undefined;
    }
    try {
      await this.queue.close();
    } catch {
      // Ignore if queue is already closed
    }
    if (this.redisConnection) {
      try {
        if (this.redisConnection.status !== 'end') {
          await this.redisConnection.quit();
        }
      } catch {
        // Ignore if connection is already closed
      }
    }
  }
}

// In-Memory Queue for test runners / environments without Redis
export class InMemoryJobQueue {
  private processor: JobProcessor;

  constructor(
    db: TransactionalDbClient,
    logger: Logger = defaultLogger,
    workerPool?: RoleAwarePool
  ) {
    this.processor = new JobProcessor(
      db,
      logger,
      (data) => this.enqueue(data),
      defaultActionAdapters,
      workerPool
    );
  }

  async enqueue(data: JobData): Promise<void> {
    // Process asynchronously in background
    queueMicrotask(async () => {
      let attempts = 1;
      const maxRetries = data.maxRetries ?? 3;
      while (attempts <= maxRetries) {
        try {
          await this.processor.process(data, attempts);
          break;
        } catch {
          attempts++;
        }
      }
    });
  }
}
