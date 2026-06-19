import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';

// BullMQ requires this option on the connection it uses for blocking commands.
export const bullConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export interface TranscodeJobData {
  jobId: string; // the Mongo _id of the Job document
}

// The producer side. The API adds jobs here; the worker (worker.ts) consumes them.
export const transcodeQueue = new Queue<TranscodeJobData>(config.queueName, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 2, // retry once on failure
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
