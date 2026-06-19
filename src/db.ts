import mongoose from 'mongoose';
import { config } from './config';

export type JobState = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface RenditionInfo {
  name: string;
  height: number;
  playlist: string; // public URL path to this rendition's index.m3u8
}

// One document per uploaded video — the "job tracking in the DB" record.
const jobSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    storedPath: { type: String, required: true }, // raw uploaded file
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },

    state: {
      type: String,
      enum: ['QUEUED', 'PROCESSING', 'READY', 'FAILED'],
      default: 'QUEUED',
      index: true,
    },
    progress: { type: Number, default: 0 }, // 0-100
    error: { type: String, default: null },

    // Source info (from ffprobe)
    duration: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },

    // Output (when READY)
    outputDir: { type: String, default: null },
    masterPlaylist: { type: String, default: null }, // public URL path
    renditions: { type: Array, default: [] },
  },
  { timestamps: true } // adds createdAt / updatedAt
);

export const Job = mongoose.model('Job', jobSchema);
export type JobDoc = ReturnType<(typeof Job)['hydrate']>;

let connected = false;

export async function connectDb(): Promise<void> {
  if (connected) return;
  await mongoose.connect(config.databaseUrl);
  connected = true;
  console.log('[db] connected to MongoDB');
}
