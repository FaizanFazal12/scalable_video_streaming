import fs from 'fs';
import path from 'path';
import ffmpeg from './ffmpeg'; // fluent-ffmpeg pre-configured with static binaries
import { config, Rendition } from './config';

export interface ProbeResult {
  duration: number; // seconds
  width: number;
  height: number;
}

export interface TranscodeOutput {
  outputDir: string; // absolute path on disk
  masterPlaylist: string; // public URL path, e.g. /stream/<id>/master.m3u8
  renditions: { name: string; height: number; playlist: string }[];
}

// Read source media info. We need the duration to compute progress %, and the
// dimensions to (a) skip upscaling and (b) write correct RESOLUTION in the master.
export function probe(input: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) return reject(err);
      const stream = data.streams.find((s) => s.codec_type === 'video');
      if (!stream) return reject(new Error('No video stream found'));
      resolve({
        duration: Number(data.format.duration || 0),
        width: stream.width || 0,
        height: stream.height || 0,
      });
    });
  });
}

const even = (n: number) => (n % 2 === 0 ? n : n - 1);

// Transcode one rendition into its own folder as an HLS playlist + segments.
// onPercent reports 0-100 for THIS rendition.
function transcodeRendition(
  input: string,
  outDir: string,
  rendition: Rendition,
  sourceWidth: number,
  sourceHeight: number,
  onPercent: (p: number) => void
): Promise<{ width: number; height: number }> {
  fs.mkdirSync(outDir, { recursive: true });

  const targetHeight = even(rendition.height);
  const targetWidth = even(Math.round((sourceWidth * targetHeight) / sourceHeight));

  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset veryfast',
        '-profile:v main',
        '-sc_threshold 0', // consistent GOPs so segments align cleanly
        `-vf scale=${targetWidth}:${targetHeight}`,
        `-b:v ${rendition.vbitrateKbps}k`,
        `-maxrate ${Math.round(rendition.vbitrateKbps * 1.07)}k`,
        `-bufsize ${rendition.vbitrateKbps * 2}k`,
        `-b:a ${rendition.abitrateKbps}k`,
        `-hls_time ${config.hlsSegmentSeconds}`,
        '-hls_playlist_type vod',
        `-hls_segment_filename ${path.join(outDir, 'seg_%03d.ts')}`,
      ])
      .output(path.join(outDir, 'index.m3u8'))
      .on('progress', (p) => {
        if (typeof p.percent === 'number') {
          onPercent(Math.max(0, Math.min(100, p.percent)));
        }
      })
      .on('end', () => resolve({ width: targetWidth, height: targetHeight }))
      .on('error', (err) => reject(err))
      .run();
  });
}

// Full pipeline for one video: probe -> transcode each rendition -> write master.
// onOverallProgress reports combined 0-100 across all renditions.
export async function transcodeToHLS(
  input: string,
  jobId: string,
  probed: ProbeResult,
  onOverallProgress: (percent: number) => void
): Promise<TranscodeOutput> {
  const outputDir = path.join(config.storageDir, jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Skip renditions that would upscale; always keep at least the smallest.
  let ladder = config.renditions.filter((r) => r.height <= probed.height);
  if (ladder.length === 0) ladder = [config.renditions[0]];

  const total = ladder.length;
  const produced: { rendition: Rendition; width: number; height: number }[] = [];

  for (let i = 0; i < ladder.length; i++) {
    const rendition = ladder[i];
    const dims = await transcodeRendition(
      input,
      path.join(outputDir, rendition.name),
      rendition,
      probed.width,
      probed.height,
      (p) => {
        // Combine: finished renditions contribute 100%, current contributes p.
        const overall = ((i + p / 100) / total) * 100;
        onOverallProgress(Math.round(overall));
      }
    );
    produced.push({ rendition, ...dims });
  }

  // Build the master playlist that lists every rendition for the player.
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const p of produced) {
    const bandwidth = (p.rendition.vbitrateKbps + p.rendition.abitrateKbps) * 1000;
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${p.width}x${p.height}`
    );
    lines.push(`${p.rendition.name}/index.m3u8`);
  }
  fs.writeFileSync(path.join(outputDir, 'master.m3u8'), lines.join('\n') + '\n');

  onOverallProgress(100);

  return {
    outputDir,
    masterPlaylist: `/stream/${jobId}/master.m3u8`,
    renditions: produced.map((p) => ({
      name: p.rendition.name,
      height: p.height,
      playlist: `/stream/${jobId}/${p.rendition.name}/index.m3u8`,
    })),
  };
}
