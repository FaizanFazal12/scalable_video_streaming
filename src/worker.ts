import { Worker } from 'bullmq';
import fs from 'fs';
import { config } from './config';
import { connectDb, Job } from './db';
import { bullConnection, TranscodeJobData } from './queue';
import { publishJobEvent } from './events';
import { probe, transcodeToHLS } from './transcoder';

async function main() {
  await connectDb();

  const worker = new Worker<TranscodeJobData>(
    config.queueName,
    async (bullJob) => {
      const { jobId } = bullJob.data;
      const job = await Job.findById(jobId);
      if (!job) throw new Error(`Job ${jobId} not found in DB`);

      // --- mark processing ---
      job.state = 'PROCESSING';
      job.progress = 0;
      await job.save();
      await publishJobEvent({ id: jobId, state: 'PROCESSING', progress: 0 });

      try {
        // 1. Inspect the source (duration needed for progress %, dims to size renditions)
        const probed = await probe(job.storedPath);
        job.duration = probed.duration;
        job.width = probed.width;
        job.height = probed.height;
        await job.save();

        // 2. Transcode to HLS, streaming progress out as it goes.
        let lastPersisted = -1;
        const output = await transcodeToHLS(
          job.storedPath,
          jobId,
          probed,
          (percent) => {
            // Publish every tick for a smooth bar; throttle DB writes to every ~2%.
            void publishJobEvent({ id: jobId, state: 'PROCESSING', progress: percent });
            if (percent - lastPersisted >= 2) {
              lastPersisted = percent;
              Job.updateOne({ _id: jobId }, { progress: percent }).catch(() => {});
            }
          }
        );

        // 3. Mark ready with the output locations.
        job.state = 'READY';
        job.progress = 100;
        job.outputDir = output.outputDir;
        job.masterPlaylist = output.masterPlaylist;
        job.renditions = output.renditions;
        await job.save();

        await publishJobEvent({
          id: jobId,
          state: 'READY',
          progress: 100,
          masterUrl: output.masterPlaylist,
        });

        // 4. Clean up the raw upload — we only serve the HLS output now.
        fs.promises.unlink(job.storedPath).catch(() => {});

        console.log(`[worker] job ${jobId} READY`);
      } catch (err: any) {
        const message = err?.message || String(err);
        job.state = 'FAILED';
        job.error = message;
        await job.save();
        await publishJobEvent({ id: jobId, state: 'FAILED', progress: job.progress, error: message });
        console.error(`[worker] job ${jobId} FAILED:`, message);
        throw err; // let BullMQ record the failure / retry
      }
    },
    { connection: bullConnection, concurrency: config.workerConcurrency }
  );

  worker.on('ready', () => console.log('[worker] listening for transcode jobs'));
  worker.on('error', (e) => console.error('[worker] error', e));
}

main().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});
