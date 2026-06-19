# Video Processing Server

Upload a video → it's transcoded to **adaptive-bitrate HLS** in a background
worker → progress streams back to the browser **live** via Server-Sent Events →
play it back in an adaptive HLS player. Every job is tracked in **MongoDB**.

> 📚 **Full documentation is in [`docs/`](./docs/README.md)** — architecture,
> setup, API reference, data model, processing pipeline, and troubleshooting.

## Stack

| Concern            | Choice                          |
| ------------------ | ------------------------------- |
| Language           | TypeScript (run with `tsx`)     |
| API                | Express                         |
| Uploads            | Multer                          |
| Video processing   | FFmpeg via `fluent-ffmpeg`      |
| Job queue          | BullMQ + Redis                  |
| Live progress      | Redis Pub/Sub → SSE             |
| Database (tracking)| MongoDB + Mongoose              |
| Orchestration      | Docker Compose                  |

## Architecture

```
Browser ──upload──> API (Express) ──enqueue──> Redis (BullMQ)
   ▲                   │ writes job                 │ pulls job
   │ SSE (live %)      ▼                            ▼
   └────────────── MongoDB (job state)  <──update── Worker (FFmpeg → HLS)
                                          ──progress──> Redis Pub/Sub ──> API ──> SSE
```

Two processes:

- **api** — accepts uploads, writes the `Job` document, enqueues the work,
  serves the HLS output, and relays live progress over SSE.
- **worker** — pulls jobs from the queue, runs FFmpeg to produce the HLS
  renditions, updates the job in Mongo, and publishes progress to Redis.

## Run it

Everything (including FFmpeg, Redis, MongoDB) runs in Docker — nothing to
install on the host except Docker itself.

```bash
docker compose up --build
```

Then open <http://localhost:3000>, pick a video, and watch it process live.

### Useful commands

```bash
docker compose logs -f worker   # watch transcoding
docker compose logs -f api      # watch the API
docker compose down             # stop
docker compose down -v          # stop + wipe DB/uploads/output volumes
```

## How it works (the flow)

1. **Upload** — `POST /api/videos` (multipart `video` field). Multer saves the
   raw file; a `Job` document is created with state `QUEUED`; a BullMQ job is
   enqueued. Responds with `{ id }`.
2. **Live updates** — the browser opens `GET /api/videos/:id/events` (SSE) and
   listens. It immediately receives the current state, then every progress tick.
3. **Transcode** — the worker runs `ffprobe` (duration/dimensions), then FFmpeg
   per rendition (360p/480p/720p, skipping anything larger than the source),
   producing `index.m3u8` + `.ts` segments, plus a `master.m3u8`. Progress is
   parsed from FFmpeg and published to Redis.
4. **Ready** — state becomes `READY` with `masterUrl`; the raw upload is deleted.
5. **Playback** — the UI loads `/stream/:id/master.m3u8` in hls.js; the player
   switches renditions based on bandwidth.

## State machine

```
QUEUED ──> PROCESSING ──> READY
                  └──────> FAILED
```

## API

| Method | Path                      | Purpose                          |
| ------ | ------------------------- | -------------------------------- |
| POST   | `/api/videos`             | Upload a video, enqueue job      |
| GET    | `/api/videos`             | List recent jobs                 |
| GET    | `/api/videos/:id`         | Get one job's state (polling)    |
| GET    | `/api/videos/:id/events`  | SSE stream of live state         |
| GET    | `/stream/:id/master.m3u8` | The HLS master playlist          |

## Configuration

See `.env` — ports, `DATABASE_URL`, `REDIS_URL`, worker concurrency. The quality
ladder (renditions) and HLS segment length live in `src/config.ts`.

## Notes / next steps

- **Scaling:** run more `worker` replicas (`docker compose up --scale worker=3`).
  The queue distributes jobs; Pub/Sub still delivers progress to any API node.
- **Storage:** output goes to a Docker volume. For production, push segments to
  S3/MinIO and serve via a CDN.
- **Security:** file type is checked by MIME + would ideally be re-validated with
  `ffprobe`; never interpolate user input into FFmpeg arguments.
