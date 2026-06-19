import path from 'path';

const ROOT = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT || 3000),

  databaseUrl: process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/video',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 1),

  // Disk locations
  uploadDir: path.join(ROOT, 'uploads'), // raw uploads (temporary)
  storageDir: path.join(ROOT, 'storage'), // processed HLS output (served publicly)

  maxUploadBytes: 500 * 1024 * 1024, // 500 MB

  hlsSegmentSeconds: 6,

  // The BullMQ queue name shared by the API (producer) and worker (consumer)
  queueName: 'transcode',

  // Quality ladder for adaptive streaming. We never upscale: renditions taller
  // than the source are skipped (but the smallest is always kept).
  renditions: [
    { name: '360p', height: 360, vbitrateKbps: 800, abitrateKbps: 96 },
    { name: '480p', height: 480, vbitrateKbps: 1400, abitrateKbps: 128 },
    { name: '720p', height: 720, vbitrateKbps: 2800, abitrateKbps: 128 },
  ],
};

export type Rendition = (typeof config.renditions)[number];
