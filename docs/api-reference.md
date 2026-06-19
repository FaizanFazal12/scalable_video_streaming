# API Reference

Base URL: `http://localhost:3000`

All JSON. Errors return `{ "error": "<message>" }` with an appropriate status.

---

## POST `/api/videos`

Upload a video. Saves the file, creates a `Job` (state `QUEUED`), and enqueues
transcoding.

- **Content-Type:** `multipart/form-data`
- **Field:** `video` — the video file (must be `video/*`, ≤ 500 MB)

### Example

```bash
curl -F "video=@/path/to/clip.mp4" http://localhost:3000/api/videos
```

### Response `201 Created`

```json
{ "id": "6a34f7eae7737c3950699981", "state": "QUEUED" }
```

### Errors

| Status | When |
| --- | --- |
| `400` | No file, non-video MIME type, or file over the size limit |

---

## GET `/api/videos`

List the 50 most recent jobs (newest first).

### Response `200 OK`

```json
[
  {
    "id": "6a34f7eae7737c3950699981",
    "originalName": "clip.mp4",
    "state": "READY",
    "progress": 100,
    "error": null,
    "duration": 12.4,
    "masterUrl": "/stream/6a34f7eae7737c3950699981/master.m3u8",
    "renditions": [
      { "name": "360p", "height": 360, "playlist": "/stream/6a34.../360p/index.m3u8" },
      { "name": "480p", "height": 480, "playlist": "/stream/6a34.../480p/index.m3u8" }
    ],
    "createdAt": "2026-06-19T10:00:00.000Z"
  }
]
```

---

## GET `/api/videos/:id`

Fetch one job's current state. Use this for polling or after a page reload (the
DB always holds the latest persisted state).

### Response `200 OK`

Same object shape as a list item above.

### Errors

| Status | When |
| --- | --- |
| `404` | No job with that id |

---

## GET `/api/videos/:id/events`  (SSE)

Server-Sent Events stream of live state for one job. On connect, the server
immediately sends the current state, then pushes an event on every progress
update until the job reaches `READY` or `FAILED`.

- **Content-Type:** `text/event-stream`

### Event payload

Each `data:` line is a JSON object:

```json
{ "id": "6a34...", "state": "PROCESSING", "progress": 42, "error": null, "masterUrl": null }
```

When ready:

```json
{ "id": "6a34...", "state": "READY", "progress": 100, "masterUrl": "/stream/6a34.../master.m3u8" }
```

### Client example

```js
const es = new EventSource(`/api/videos/${id}/events`);
es.onmessage = (e) => {
  const job = JSON.parse(e.data);
  console.log(job.state, job.progress + "%");
  if (job.state === "READY") { play(job.masterUrl); es.close(); }
  if (job.state === "FAILED") es.close();
};
```

---

## GET `/stream/:id/master.m3u8`  (and segments)

Static HLS output. The master playlist lists every rendition; the player
(hls.js) fetches it, then the per-rendition `index.m3u8` playlists and `.ts`
segments under the same path.

```
/stream/:id/master.m3u8
/stream/:id/360p/index.m3u8
/stream/:id/360p/seg_000.ts ...
/stream/:id/480p/index.m3u8
/stream/:id/480p/seg_000.ts ...
```

Feed `master.m3u8` to any HLS player to get adaptive playback.
