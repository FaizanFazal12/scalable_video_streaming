import IORedis from 'ioredis';
import { config } from './config';

// Real-time progress travels worker -> Redis Pub/Sub -> API -> browser (SSE).
// The worker process PUBLISHES; the API process SUBSCRIBES and relays over SSE.
// We use one channel per job: `job:<id>`.

export interface JobEvent {
  id: string;
  state: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  progress: number;
  error?: string | null;
  masterUrl?: string | null;
}

const channel = (jobId: string) => `job:${jobId}`;

// Dedicated publisher connection (used by the worker).
let publisher: IORedis | null = null;
function getPublisher(): IORedis {
  if (!publisher) publisher = new IORedis(config.redisUrl);
  return publisher;
}

export async function publishJobEvent(event: JobEvent): Promise<void> {
  await getPublisher().publish(channel(event.id), JSON.stringify(event));
}

// Subscriber side (used by the API). A single connection pattern-subscribes to
// `job:*` and dispatches each message to a callback. The API maps jobId -> SSE
// clients on top of this.
export function createJobEventSubscriber(
  onEvent: (jobId: string, event: JobEvent) => void
): IORedis {
  const sub = new IORedis(config.redisUrl);
  sub.psubscribe('job:*');
  sub.on('pmessage', (_pattern, chan, message) => {
    const jobId = chan.slice('job:'.length);
    try {
      onEvent(jobId, JSON.parse(message) as JobEvent);
    } catch {
      // ignore malformed messages
    }
  });
  return sub;
}
