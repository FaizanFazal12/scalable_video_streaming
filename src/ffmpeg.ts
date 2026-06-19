import ffmpeg from 'fluent-ffmpeg';

// Point fluent-ffmpeg at bundled static binaries so no system FFmpeg install is
// required. This makes the worker run identically whether started locally
// (`npm run worker`) or inside Docker — fixing "Cannot find ffprobe".
// These packages ship no type declarations, so we require() + cast.
const ffmpegPath = require('ffmpeg-static') as string | null;
const ffprobePath = (require('ffprobe-static') as { path: string }).path;

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

export default ffmpeg;
