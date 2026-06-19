# Documentation

Documentation for the **Video Processing Server** — a Node.js/TypeScript service
that accepts video uploads, transcodes them to adaptive-bitrate HLS in a
background worker, streams live progress to the browser, and tracks every job
in MongoDB.

## Contents

| Doc | What it covers |
| --- | --- |
| [Architecture](./architecture.md) | The big picture: processes, services, and how data flows between them |
| [Setup & Run](./setup-and-run.md) | Running with Docker, running locally, configuration |
| [API Reference](./api-reference.md) | Every HTTP endpoint, with requests/responses |
| [Data Model](./data-model.md) | The `Job` document, its fields and state machine |
| [Processing Pipeline](./pipeline.md) | Upload → FFmpeg → HLS, and the live-progress (SSE) path |
| [Troubleshooting](./troubleshooting.md) | Common errors and fixes |

## Quick start

```bash
docker compose up --build
# open http://localhost:3000
```

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript (run with `tsx`) |
| API framework | Express |
| Uploads | Multer |
| Video processing | FFmpeg via `fluent-ffmpeg` (+ `ffmpeg-static`/`ffprobe-static`) |
| Job queue | BullMQ + Redis |
| Live progress | Redis Pub/Sub → Server-Sent Events |
| Database | MongoDB + Mongoose |
| Playback | HLS via hls.js (with a manual quality selector) |
| Orchestration | Docker Compose |
