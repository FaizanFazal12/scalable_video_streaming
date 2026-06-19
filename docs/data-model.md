# Data Model

There is a single collection: **`jobs`** (the Mongoose `Job` model in
`src/db.ts`). One document per uploaded video — this is the "job tracking in the
DB" record.

## `Job` document

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | Used as the job id everywhere (queue, SSE channel, output folder) |
| `originalName` | string | Original filename from the upload |
| `storedPath` | string | Path to the raw uploaded file (deleted after success) |
| `size` | number | Bytes |
| `mimeType` | string | e.g. `video/mp4` |
| `state` | enum | `QUEUED` \| `PROCESSING` \| `READY` \| `FAILED` (indexed) |
| `progress` | number | 0–100, overall transcode progress |
| `error` | string \| null | Populated when `state === FAILED` |
| `duration` | number \| null | Source duration in seconds (from ffprobe) |
| `width` | number \| null | Source width (ffprobe) |
| `height` | number \| null | Source height (ffprobe) |
| `outputDir` | string \| null | Absolute path of the HLS output folder |
| `masterPlaylist` | string \| null | Public URL path to `master.m3u8` |
| `renditions` | array \| null | `[{ name, height, playlist }]` produced |
| `createdAt` | Date | Added by Mongoose timestamps |
| `updatedAt` | Date | Added by Mongoose timestamps |

## State machine

```
            enqueue              ffprobe + ffmpeg ok
  (upload) ─────────► QUEUED ──────► PROCESSING ──────► READY
                                          │
                                          │ ffprobe/ffmpeg error
                                          ▼
                                       FAILED
```

| State | Meaning | Who sets it |
| --- | --- | --- |
| `QUEUED` | Uploaded, waiting for a free worker | API, on upload |
| `PROCESSING` | A worker is transcoding; `progress` rising | Worker, on pickup |
| `READY` | HLS output available at `masterPlaylist` | Worker, on success |
| `FAILED` | Something went wrong; see `error` | Worker, on error |

## Progress updates

While `PROCESSING`, the worker:

- **publishes** an event to Redis (`job:<id>`) on *every* FFmpeg progress tick
  (for a smooth live bar), and
- **persists** `progress` to MongoDB roughly every 2% (to limit DB writes).

This is the "immediacy from events, truth from the DB" split: a browser that
reconnects or polls `GET /api/videos/:id` always gets the last persisted value.

## Why no separate "events" collection?

The job lifecycle here is simple and linear, so the current state lives in one
row that's updated in place (classic CRUD). We do **not** use event sourcing
(storing an append-only log of changes as the source of truth) — it would add
significant complexity for no benefit at this scale. Note this is different from
being *event-driven for messaging*, which we do use (Redis Pub/Sub for progress).
