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

## Credit

The video-face detection and deduplication approach in this fork is directly
based on [Tom Holland](https://github.com/0thomasholland)'s
[`feature/video-face-phase-5`](https://github.com/0thomasholland/immich/tree/feature/video-face-phase-5)
branch — several pieces here (notably the video-faces query and the
greedy cosine-distance clustering job) are adapted closely from his
implementation, not written independently from scratch as earlier notes here
implied. Thank you, Tom, for the original design.

Several real bugs in that shared lineage — timestamp drift on capped videos,
missing `videoFacesRecognizedAt` persistence, wrong person thumbnails, and (most
seriously) a stale-face sweep that could silently delete every detected video
face on a routine Face Detection re-run — were identified by
[IAfanasov](https://github.com/IAfanasov), who rebased Tom's branch onto current
`main`, fixed them, and wrote them up on the original
[GitHub discussion](https://github.com/immich-app/immich/discussions/5936) (see
also [their fork](https://github.com/IAfanasov/immich/tree/feat/video-face-recognition)).
This fork was built independently and didn't share code with IAfanasov's, but
their write-up caught two bugs present here too (see **Fixed**, below) — thank
you for the thorough review.

## What's new

### Server

- **Schema**: `asset_face.timestampMs` (milliseconds from video start; `null` for
  photos), `asset_job_status.videoFacesRecognizedAt`.
- **Config** (`machineLearning.facialRecognition.video`): `scanMode` — a
  `VideoFaceScanMode` enum: `thumbnailOnly` (stock behavior, the default —
  installing this fork never silently reprocesses an existing library),
  `disabled` (videos skipped by facial recognition entirely), or `fullScan`
  (samples frames throughout the video). `samplingMethod` — a
  `VideoFaceSamplingMethod` enum: `frameCount` (spread a fixed number of frames
  evenly across the video) or `interval` (one frame every `intervalSeconds`,
  sub-second precision, default `2`). `maxFrames` — hard safety cap per video
  (default `50`, max `10,000`).
- **Job pipeline**: when `scanMode` is `fullScan`, video assets are queued
  through a new `AssetVideoDetectFacesQueueAll → AssetVideoDetectFaces →
  AssetVideoClusterFaces` chain (its own `VideoFaceDetection` queue, separate
  from stock Face Detection). Frames are extracted via ffmpeg
  (`MediaRepository.extractVideoFrames`), each run through the *existing*
  single-image ML face-detection endpoint (no ML-service/Python changes needed),
  then near-duplicate detections of the same appearance are removed by cosine
  distance on their embeddings before the survivors are fed into the existing
  recognition/clustering job — so a person visible for 30 seconds contributes one
  face record, not dozens.
- **API**: `GET /people/:id/video-occurrences` — returns, for each video a person
  appears in, every distinct timestamp (ms) they were detected at, sorted by
  appearance count. `PUT /people/:id/reassign` — moves one or more specific faces
  to a different existing person without merging the two people's other assets
  (backs the "Wrong person" picker). `unassignFace`/reset-faces path used by
  "Delete person and reset faces" — deletes the person but unassigns (doesn't
  delete) their faces so the next non-force Facial Recognition run reconsiders
  them. Per-asset "scan video for faces" reuses the existing `AssetJobName`
  single-asset job runner rather than adding a new endpoint.
- A dedicated `VideoFaceDetection` queue with its own row on the admin Job
  Queues page (All/Missing, concurrency setting) — not a one-off manual job.
- People-ranking query switched from counting raw `asset_face` rows to counting
  distinct assets, so a person with many timestamped appearances in one scanned
  video doesn't outrank someone tagged across many more distinct photos in the
  unnamed-people sort order.

### Web

- Admin settings (Machine Learning → Facial Recognition): scan-mode dropdown,
  frame-count/interval sampling toggle with mode-aware descriptions, max-frames
  field, and a disk-space guidance callout (sampled frames are written to
  temporary disk storage while a video is processed).
- Person page: "Appears in videos" rebuilt as a two-pane, file-explorer-style
  master/detail view — a scrollable video list on the left (thumbnail,
  appearance count, sorted by count descending) and a pane on the right showing
  a real per-timestamp frame thumbnail for the selected video, hover-swappable
  to a short clip preview.
- Video asset viewer: clicking a person in the People sidebar no longer
  navigates away. It floats a `position:fixed` popover (so the sidebar's own
  scroll clipping doesn't cut it off) with that person's appearance timestamps
  *in the video you're currently watching* — clicking one seeks the player in
  place — plus a "View person" link to their page.
- People sidebar in-place edit mode: inline rename and "not a face" mini-buttons
  on hover, a "Merge people" picker, and a "Wrong person" action
  (`ReassignFaceModal`) listing candidate people ranked by face-embedding
  similarity to the specific misidentified face.
- A "Scan video for faces" button next to the People section on any video asset
  — admin only, shown only when `scanMode` is `fullScan` — to (re-)scan a single
  file on demand.
- Person page menu: "Delete person and reset faces".
- Updated the "Face detection" job description on the admin Job Queues page to
  describe the new video behavior.

### Mobile

- Ported the web feature to the Flutter app: an "Appears in videos" section on
  the person page with a per-timestamp thumbnail grid (tapping a timestamp opens
  the asset viewer seeked to that exact moment), seek-to-timestamp support in
  the asset viewer, and an edit mode on the people section with timestamp-chip
  pickers for multi-appearance videos and the same per-person actions as web
  (wrong person, rename, not-a-face).

## Fixed

- **Person thumbnails for video-only faces showed the wrong crop.** The
  existing person-thumbnail generation path always cropped a face's bounding
  box from the asset's single static preview (first-frame) image — for a face
  detected on a *later* sampled frame, that bounding box didn't correspond to
  the preview image's content, so the generated thumbnail could show an
  unrelated part of the scene even though the underlying detection (and the
  timestamp it links to) was correct. Fixed by extracting the actual frame at
  that face's timestamp (`MediaRepository.extractVideoFrameAt`) instead of
  reusing the first-frame preview whenever a face has a `timestampMs`.
- **A routine Face Detection re-run could silently delete every video face.**
  `handleDetectFaces`'s stale-face sweep collected *every* machine-learning
  face on the asset, including ones detected on other video frames, and
  deleted any that didn't spatially match the freshly re-detected preview
  frame — which timestamped video faces never do, since they're a different
  frame's coordinates entirely. Clicking "Refresh"/"Reset" on the regular
  Face Detection queue for a video would wipe its video faces. Fixed by
  scoping that sweep (and the scale/IOU matching it depends on) to the
  asset's preview-frame face only.
- **The preview-frame face was never deduplicated against video faces.**
  Video face clustering excluded the un-timestamped preview-derived face, so
  a person visible in both the preview frame and a nearby sampled frame ended
  up with two near-identical face rows instead of one. Fixed by including
  that face in the clustering pass.
- **Renaming a face to an existing person's name silently merged whole
  identities.** A rename meant to correct one misidentified face (e.g. one
  video frame tagged as the wrong person) would pull every other photo and
  video of the renamed person over too. Replaced with a dedicated "Wrong
  person" picker (`ReassignFaceModal`, `PUT /people/:id/reassign`) that
  reassigns just the specific misidentified face, leaving both people's other
  assets untouched. The separate "Merge people" button is unchanged for when a
  full merge really is intended.
- **Video letterbox offset threw off the confirmed-face bounding box** — a
  click meant to confirm/correct a face's position on a letterboxed video
  wasn't accounting for the video element's own letterbox offset, so the
  bounding box saved didn't match where the user actually clicked. Fixed by
  correcting for that offset before mapping the click back to frame
  coordinates.
- **A seek race in the video confirmation-box flow** could show the
  confirmation box positioned for the wrong frame if the player was still
  seeking when it rendered. Fixed the ordering so the box waits for the seek
  to actually complete.
- **Face reassignment could affect more than the intended occurrence** —
  scoped reassignment to the single video occurrence being edited, plus a
  fork-wide bug sweep (commit `cb29de22d`) for related edge cases turned up
  during that pass.

## Configuration reference

See [`docs/docs/features/facial-recognition.md`](docs/docs/features/facial-recognition.md#video-face-detection),
[`docs/docs/administration/system-settings.md`](docs/docs/administration/system-settings.md),
and [`docs/docs/install/config-file.md`](docs/docs/install/config-file.md) for
the updated settings reference.
