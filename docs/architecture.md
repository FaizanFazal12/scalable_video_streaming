# Architecture

## Overview

The system is split into **two Node processes** backed by **two datastores**.
Transcoding is slow and CPU-bound, so it is deliberately decoupled from the HTTP
request: the API accepts work and returns immediately, while a separate worker
does the heavy lifting.

```
                         ┌──────────────────────────────┐
                         │          Browser             │
                         │  upload + SSE + hls.js player │
                         └──────────────┬───────────────┘
                       upload │         │ SSE (live %)      ▲ HLS segments
                              ▼         ▼                   │
            ┌─────────────────────────────────────────────────────────┐
            │                    API process (Express)                 │
            │  • POST /api/videos  (Multer saves file, creates Job)    │
            │  • enqueues a BullMQ job                                 │
            │  • GET /api/videos/:id/events (SSE)                      │
            │  • serves /stream/** (HLS output)                        │
            └───────┬───────────────────────┬─────────────────────────┘
        write Job   │                        │ subscribe job:* (Pub/Sub)
                    ▼                        ▲
            ┌──────────────┐         enqueue │ publish progress
            │   MongoDB    │                 │
            │ (Job docs)   │         ┌────────────────┐
            └──────▲───────┘         │     Redis      │
                   │ update Job      │ BullMQ + Pub/Sub│
                   │                 └────────┬────────┘
                   │                   pull job│
            ┌──────┴──────────────────────────▼───────────────────────┐
            │                  Worker process (BullMQ)                 │
            │  • ffprobe (duration, dimensions)                       │
            │  • FFmpeg → HLS renditions (360p/480p/720p) + master    │
            │  • updates Job in Mongo, publishes progress to Redis    │
            └──────────────────────────────────────────────────────────┘
```

## Processes

### API (`src/server.ts`)

- Accepts uploads (Multer → disk), creates the `Job` document, and enqueues a
  BullMQ job.
- Serves the demo UI (`public/`) and the HLS output (`/stream/**`).
- Holds open **SSE** connections and relays live progress to the right browser.
- It is a **producer** for the queue and a **subscriber** for Redis Pub/Sub.

### Worker (`src/worker.ts`)

- A BullMQ **consumer**. Pulls one job at a time (configurable concurrency).
- Runs `ffprobe`, then FFmpeg per rendition, writing HLS playlists + segments.
- Updates the `Job` in MongoDB and **publishes** progress to Redis.
- Can be scaled to multiple replicas to process more videos in parallel.

## Datastores

### MongoDB (source of truth)

Holds one `Job` document per upload — its state, progress, source info, and
output location. Survives restarts; used for listing, polling, and reload.
See [Data Model](./data-model.md).

### Redis (two roles)

1. **BullMQ queue** — durable list of pending/active transcode jobs, with
   retries and backoff.
2. **Pub/Sub** — carries live progress from the worker to the API. The worker
   publishes to `job:<id>`; the API pattern-subscribes to `job:*` and forwards
   to SSE clients.

## Why this shape?

| Decision | Reason |
| --- | --- |
| Separate worker process | Transcoding pins a CPU core for minutes; it must not block HTTP requests |
| Queue between API & worker | Decouples accept-rate from process-rate; gives retries and horizontal scaling |
| Pub/Sub for progress | The worker and the open SSE connection live in different processes — they need a bus to communicate |
| State also persisted in Mongo | Live events give immediacy; the DB gives a reliable current value for reload/poll |
| HLS output as plain files | Served over normal HTTP; can sit behind a CDN to scale to many viewers |

## File map

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Env, paths, rendition ladder, queue name |
| `src/db.ts` | Mongoose connection + `Job` model |
| `src/queue.ts` | BullMQ queue (producer) + Redis connection |
| `src/events.ts` | Redis Pub/Sub publish/subscribe helpers |
| `src/ffmpeg.ts` | fluent-ffmpeg wired to static binaries |
| `src/transcoder.ts` | ffprobe + FFmpeg → HLS renditions + master playlist |
| `src/server.ts` | Express API, SSE hub, static serving |
| `src/worker.ts` | BullMQ worker: orchestrates one job end-to-end |
| `public/index.html` | Demo UI: upload, live progress, hls.js player + quality menu |
