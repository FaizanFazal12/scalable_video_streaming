# Setup & Run

## Prerequisites

- **Docker + Docker Compose** (the recommended path — everything is containerized).
- For local (non-Docker) runs: **Node.js 20+**, plus a reachable **MongoDB** and
  **Redis**. FFmpeg is **not** required on the host — the app uses the bundled
  `ffmpeg-static` / `ffprobe-static` binaries.

## Option A — Docker (recommended)

Builds the app image (Node + FFmpeg), and starts MongoDB, Redis, the API, and
the worker together.

```bash
docker compose up --build
```

Open <http://localhost:3000>, choose a video, and watch it process live.

```bash
docker compose logs -f worker   # follow transcoding output
docker compose logs -f api      # follow API output
docker compose down             # stop
docker compose down -v          # stop AND wipe volumes (db, uploads, output)
```

Services started by `docker-compose.yml`:

| Service | Image / build | Purpose |
| --- | --- | --- |
| `mongo` | `mongo:7` | Job tracking |
| `redis` | `redis:7-alpine` | Queue + Pub/Sub |
| `api` | local `Dockerfile` | HTTP API, SSE, serves HLS |
| `worker` | local `Dockerfile` | FFmpeg transcoding |

## Option B — Local (no Docker for the app)

You still need MongoDB and Redis running somewhere. The quickest way is to start
just those two in Docker and run the Node processes on the host:

```bash
docker compose up -d mongo redis

npm install

# point the app at the containers exposed on localhost
export DATABASE_URL="mongodb://127.0.0.1:27017/video"
export REDIS_URL="redis://127.0.0.1:6379"

# two terminals:
npm run worker    # terminal 1 — transcoder
npm run api       # terminal 2 — HTTP API
```

Dev mode with auto-reload on file changes:

```bash
npm run worker:dev
npm run api:dev
```

> **Note:** the API and worker are separate processes — you must run **both**.
> Uploading with no worker running leaves jobs stuck in `QUEUED`.

## Configuration

Set via environment / `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | API HTTP port |
| `DATABASE_URL` | `mongodb://mongo:27017/video` | MongoDB connection string |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `WORKER_CONCURRENCY` | `1` | Transcode jobs per worker (CPU-bound — keep low) |

Tuned in code (`src/config.ts`):

| Setting | Default | Meaning |
| --- | --- | --- |
| `renditions` | 360p / 480p / 720p | The quality ladder produced per video |
| `hlsSegmentSeconds` | `6` | HLS segment length |
| `maxUploadBytes` | 500 MB | Upload size cap |

## Scaling the worker

```bash
docker compose up --scale worker=3
```

BullMQ distributes jobs across worker replicas; progress Pub/Sub still reaches
the API regardless of which worker handled the job.
