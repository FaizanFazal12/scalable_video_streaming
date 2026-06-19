# Troubleshooting

## `Cannot find ffprobe` / `Cannot find ffmpeg`

**Cause:** fluent-ffmpeg couldn't locate the binaries. This happened when running
locally before the static binaries were wired in.

**Fix:** the project uses `ffmpeg-static` + `ffprobe-static`, configured in
`src/ffmpeg.ts`, and the transcoder imports from there (not directly from
`fluent-ffmpeg`). If you still see this:

```bash
npm install            # ensure the static packages are installed
# verify the binaries resolve and run:
node -e "console.log(require('ffmpeg-static')); console.log(require('ffprobe-static').path)"
```

Then **restart the worker** (a running worker won't pick up the change).

## Jobs stay stuck in `QUEUED`

**Cause:** no worker is running, or the worker can't reach Redis.

**Fix:** start the worker (`npm run worker`, or `docker compose up worker`).
Remember the API and worker are **separate processes** — both must run. Check
the worker logs for a Redis connection error and confirm `REDIS_URL`.

## Upload returns `400`

- The field name must be `video`.
- The file's MIME type must start with `video/`.
- The file must be ≤ 500 MB (`maxUploadBytes` in `src/config.ts`).

## Progress bar doesn't move (but the job completes)

**Cause:** the SSE connection or Redis Pub/Sub isn't delivering events; the job
still finishes because the worker runs independently.

**Checks:**

- Browser devtools → Network → the `/events` request should be open and
  streaming.
- Confirm the API process can reach Redis (same `REDIS_URL` as the worker).
- As a fallback, `GET /api/videos/:id` always returns the latest persisted state.

## Player shows nothing / `master.m3u8` 404

- Confirm the job reached `READY` (`GET /api/videos/:id`).
- The API serves output from the `storage/` volume at `/stream/**`. In Docker,
  the `api` and `worker` must share the **same** `storage` volume (they do in
  `docker-compose.yml`). If you changed volumes, the API may not see the files
  the worker wrote.

## Only lower qualities appear in the menu

**Expected.** The worker never upscales — renditions taller than the source are
skipped. A 480p source will only offer up to 480p.

## `MongoServerError` / connection refused

- Ensure MongoDB is running and `DATABASE_URL` is correct.
- In Docker the host is `mongo`; running locally against the compose DB it's
  `127.0.0.1`.
- Mongoose needs **no** replica set (unlike Prisma), so a standalone MongoDB is
  fine.

## Reset everything

```bash
docker compose down -v   # removes DB, uploads, and HLS output volumes
docker compose up --build
```
