# This fork: Video Face Detection

This is a personal fork of [immich-app/immich](https://github.com/immich-app/immich),
based on `main` as of commit `d8ed7d7bb` (2026-07-16), adding **face detection and
recognition throughout videos** — not just on the first frame.

## Why

Immich's stock face detection only runs on a video's generated preview thumbnail
(the first frame). If a person doesn't appear in that exact frame, they're never
recognized anywhere in that video. This fork samples frames throughout the full
video, detects faces in each, deduplicates repeated appearances of the same
person, and surfaces those appearances in the UI so you can jump straight to the
moment someone appears.

## What's new

### Server

- **Schema**: `asset_face.timestampMs` (milliseconds from video start; `null` for
  photos), `asset_job_status.videoFacesRecognizedAt`.
- **Config** (`machineLearning.facialRecognition`): `videoFrameRate` — frames per
  second to sample (default `0.5`, i.e. one frame every 2 seconds; range
  0.1–60), and `videoMaxFrames` — cap per video (default `50`, range 1–10,000).
- **Job pipeline**: after existing first-frame detection, video assets are queued
  through a new `AssetVideoDetectFacesQueueAll → AssetVideoDetectFaces →
  AssetVideoClusterFaces` chain. Frames are extracted via ffmpeg
  (`MediaRepository.extractVideoFrames`), each run through the *existing*
  single-image ML face-detection endpoint (no ML-service/Python changes needed),
  then near-duplicate detections of the same appearance are removed by cosine
  distance on their embeddings before the survivors are fed into the existing
  recognition/clustering job — so a person visible for 30 seconds contributes one
  face record, not dozens.
- **API**: `GET /people/:id/video-occurrences` — returns, for each video a person
  appears in, every distinct timestamp (ms) they were detected at.
- A manual "Video face detection" job trigger (Administration → Jobs).

### Web

- Two new admin settings (Machine Learning → Facial Recognition): frame rate and
  max frames.
- Person page: an "Appears in videos" panel listing every video a person is in,
  with clickable timestamp chips that open the video at that exact moment.
  Hovering a chip shows a frame thumbnail plus a short preview clip (4s
  before/after that timestamp).
- Video asset viewer: clicking a person in the People sidebar no longer
  navigates away — for videos, it now shows an inline list of that person's
  appearance timestamps *in the video you're currently watching*, and clicking
  one seeks the player in place.
- Updated the "Face detection" job description on the admin Job Queues page to
  describe the new video behavior.

## Known issues

- **Person thumbnails for video-only faces can show the wrong crop.** The
  existing person-thumbnail generation path crops a face's bounding box from the
  asset's single static preview image — for a face detected on a *later*
  sampled frame, that bounding box doesn't correspond to the preview image's
  content, so the generated thumbnail can show an unrelated part of the scene
  even though the underlying detection (and the timestamp it links to) is
  correct. Not yet fixed.

## Configuration reference

See [`docs/docs/features/facial-recognition.md`](docs/docs/features/facial-recognition.md#video-face-detection),
[`docs/docs/administration/system-settings.md`](docs/docs/administration/system-settings.md),
and [`docs/docs/install/config-file.md`](docs/docs/install/config-file.md) for
the updated settings reference.
