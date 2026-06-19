# Processing Pipeline

End-to-end: what happens from the moment a user picks a file to adaptive
playback, and how live progress flows back to the browser.

## The full flow

```
1. UPLOAD     Browser POSTs file → Multer saves to /uploads → Job created (QUEUED)
                                                            → BullMQ job enqueued
                                                            → responds { id }
2. SUBSCRIBE  Browser opens SSE GET /api/videos/:id/events  (gets current state)
3. PICKUP     Worker pulls job → state PROCESSING, progress 0  (published)
4. PROBE      ffprobe reads duration + width/height           (saved to Job)
5. TRANSCODE  For each rendition (≤ source height):
                FFmpeg → <id>/<name>/index.m3u8 + seg_*.ts
                progress published every tick, persisted every ~2%
6. MASTER     Write <id>/master.m3u8 listing all renditions
7. READY      state READY + masterUrl (published); raw upload deleted
8. PLAY       Browser loads /stream/:id/master.m3u8 in hls.js (adaptive)
```

## Step detail

### Upload (API)

`POST /api/videos` with a `multipart/form-data` `video` field. Multer streams it
to `uploads/`. A `Job` is created (`QUEUED`) and a BullMQ job carrying
`{ jobId }` is enqueued. The response returns instantly — no transcoding happens
on the request.

### Probe (Worker)

`ffprobe` extracts the **duration** (needed to compute progress %) and the
**dimensions** (needed to skip upscaling and to write correct `RESOLUTION` tags).

### Transcode to HLS (Worker)

For each rendition in the ladder whose height ≤ the source height, FFmpeg
produces an HLS playlist + segments:

```
ffmpeg -i input
  -c:v libx264 -preset veryfast -profile:v main -sc_threshold 0
  -vf scale=<w>:<h>
  -b:v <vbitrate> -maxrate ... -bufsize ...
  -c:a aac -b:a <abitrate>
  -hls_time 6 -hls_playlist_type vod
  -hls_segment_filename <dir>/seg_%03d.ts
  <dir>/index.m3u8
```

Key flags:

| Flag | Why |
| --- | --- |
| `-vf scale=w:h` | Resize to the rendition's resolution (even numbers, aspect-preserved) |
| `-sc_threshold 0` | Disable scene-cut keyframes → consistent GOPs → clean segment boundaries |
| `-hls_time 6` | ~6-second segments |
| `-hls_playlist_type vod` | A complete, seekable on-demand playlist |
| `-b:v / -maxrate / -bufsize` | Cap bitrate per rendition for predictable bandwidth |

### Master playlist

After all renditions are done, a `master.m3u8` is written listing each one with
its `BANDWIDTH` and `RESOLUTION`. This is the file the player loads first:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=640x360
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1528000,RESOLUTION=854x480
480p/index.m3u8
```

### Playback

hls.js loads `master.m3u8`, then automatically requests segments from the
rendition matching the viewer's bandwidth, switching on the fly. The UI also
exposes a manual **Auto / 360p / 480p / 720p** selector (`hls.currentLevel`).

## Live progress path (how the bar moves)

The worker and the open SSE connection live in **different processes**, so
progress travels over Redis Pub/Sub:

```
FFmpeg stderr "time=..."        (how far into the video)
      │  fluent-ffmpeg parses → percent
      ▼
Worker computes overall %  ──publish──►  Redis channel  job:<id>
                                              │
API pattern-subscribes job:*  ◄──────────────┘
      │  finds SSE clients for that id
      ▼
res.write("data: {...}\n\n")  ──►  Browser EventSource  ──►  progress bar
```

Overall percent across N renditions:

```
overall = ((finishedRenditions + currentRenditionPercent / 100) / N) * 100
```

So a 3-rendition job shows 0–33% during the first rendition, 33–66% during the
second, and so on — one smooth 0→100 bar for the whole job.

## Failure handling

If `ffprobe` or FFmpeg errors, the worker sets the job to `FAILED` with the
message, publishes a `FAILED` event (the UI shows the error and stops), and
rethrows so BullMQ records the failure. The queue is configured for `attempts: 2`
with exponential backoff, so transient failures get one retry.
