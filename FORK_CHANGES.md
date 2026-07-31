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
  (`MediaRepository.extractVideoFrames`), each run through the _existing_
  single-image ML face-detection endpoint (no ML-service/Python changes needed),
  then near-duplicate detections of the same appearance are removed by cosine
  distance on their embeddings before the survivors are fed into the existing
  recognition/clustering job — so a person visible for 30 seconds contributes one
  face record, not dozens.
- **Appearance grouping** (`machineLearning.facialRecognition.video.appearanceGapSeconds`,
  default `5`, range `0`–`900`): how long a person must go undetected before
  their next detection counts as a _separate_ appearance. Someone on screen
  continuously is detected in many sampled frames — a 47-minute video produced
  104 detections for one person — which is accurate but unusable as a list.
  Grouping happens on read, not at detection: every `asset_face` row is still
  stored, so changing the setting re-groups existing scans instantly with no
  rescan, and merging two people later regroups their combined detections
  correctly rather than inheriting whatever grouping was frozen in at scan time.
  `0` lists every detection individually. Also published on `ServerConfigDto` as
  `videoAppearanceGapSeconds`, since the asset viewer groups client-side.
  **Tuning note**: the useful value tracks how densely a person is _detected_,
  not the sampling interval. Faces are routinely missed in individual frames
  (turned away, motion blur, too small), so consecutive detections sit seconds
  apart even at sub-second sampling. On one real library the default halved the
  appearance count for typical videos. Videos where someone is on screen almost
  throughout but detected only sparsely — one case averaged a detection every 27
  seconds across 47 minutes — barely collapse at any modest gap, and shouldn't be
  used to pick the setting: a gap wide enough to merge those would swallow
  genuinely separate appearances everywhere else.
- **API**: `GET /people/:id/video-occurrences` — returns, for each video a person
  appears in, the detections they were seen at, grouped into appearances and
  sorted by appearance count. `appearances` gives each run's `startMs`, `endMs`
  and `detections` count; `timestampsMs` is kept as one entry per appearance
  (its start), so existing clients need no changes to benefit from grouping. `PUT /people/:id/reassign` — moves one or more specific faces
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
- `GET /people` now returns `faceCount` (visible faces assigned to that person)
  and, when the request asked for a similarity ranking, `similarity` — the same
  cosine value the ordering is computed from, expressed as 0–1. Previously the
  ranking was invisible to the client: candidates arrived in a meaningful order
  with nothing to say _how_ close any of them actually were.

### Web

- Admin settings (Machine Learning → Facial Recognition): scan-mode dropdown,
  frame-count/interval sampling toggle with mode-aware descriptions, max-frames
  field, a disk-space guidance callout (sampled frames are written to temporary
  disk storage while a video is processed), and the appearance-gap field. The gap
  sits outside the full-scan block on purpose — it regroups whatever has already
  been scanned, so it stays adjustable after scanning is switched back off.
- Person page appearances show each run as a span (`1:04 – 3:22`) with the number
  of detections it groups, rather than one tile per detection. A lone detection
  still shows as a bare timestamp instead of a zero-length range.
- Person page: "Appears in videos" rebuilt as a two-pane, file-explorer-style
  master/detail view — a scrollable video list on the left (thumbnail,
  appearance count, sorted by count descending) and a pane on the right showing
  a real per-timestamp frame thumbnail for the selected video, hover-swappable
  to a short clip preview.
- Video asset viewer: clicking a person in the People sidebar no longer
  navigates away. It floats a `position:fixed` popover (so the sidebar's own
  scroll clipping doesn't cut it off) with that person's appearance timestamps
  _in the video you're currently watching_ — clicking one seeks the player in
  place — plus a "View person" link to their page. Its timestamp list is grouped
  by the same appearance gap as the person page, collapsed client-side (it works
  from the asset's raw face rows, which the edit actions need, rather than the
  pre-grouped occurrences endpoint) — the first face of each run is the one an
  edit action then targets.
- People sidebar in-place edit mode: inline rename and "not a face" mini-buttons
  on hover, a "Merge people" picker, and a "Wrong person" action
  (`ReassignFaceModal`) listing candidate people ranked by face-embedding
  similarity to the specific misidentified face.
- "Merge people" rebuilt around an explicit merge direction. The screen now has
  a **Targets** section (named people only, single-select, ranked by similarity
  to the person you're merging) and an **Unnamed people** section (multi-select,
  scrollable, same ranking) — picking a target collapses the Targets section and
  lifts that person into a tray at the top, alongside the source and any unnamed
  people folded in with them. Every bubble in the tray carries its face count
  above and `View` / `Remove` links plus a 0–100% similarity score below; the
  source person can't be removed. Merging always runs source → target, so the
  old swap-direction button is gone.
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
  detected on a _later_ sampled frame, that bounding box didn't correspond to
  the preview image's content, so the generated thumbnail could show an
  unrelated part of the scene even though the underlying detection (and the
  timestamp it links to) was correct. Fixed by extracting the actual frame at
  that face's timestamp (`MediaRepository.extractVideoFrameAt`) instead of
  reusing the first-frame preview whenever a face has a `timestampMs`.
- **A routine Face Detection re-run could silently delete every video face.**
  `handleDetectFaces`'s stale-face sweep collected _every_ machine-learning
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
- **People ranked by similarity scored 0% whenever their feature face was gone.**
  Similarity ranking compared against `person.faceAssetId`, but that column is set
  to null whenever the referenced face is deleted (FK on delete set null) and
  nothing repairs it — so a person with dozens of perfectly good faces compared
  against nothing at all. Worse, the SQL clamped the result with
  `GREATEST(0, 1 - distance)`, and Postgres's `GREATEST` ignores nulls, so
  "nothing to compare" surfaced as a confident `0% match` rather than as unknown.
  Ranking now takes the minimum distance over the faces a person actually still
  has, and the clamp moved into `mapPerson` where null stays null. On a library
  where every named person had lost their feature face, the top candidate went
  from a displayed 0% to its real 45%.
- **Opening "Merge people" from such a person returned 404.** `getAll` treated a
  missing feature face as a missing person, so the merge screen came up empty for
  anyone whose featured face had been deleted. It now falls back to any face they
  still have.
- **`PersonCleanup` could never delete anything, leaving orphaned people behind
  after a face-detection reset.** `getAllWithoutFaces` left-joined `asset_face`
  but put its conditions in a `WHERE` rather than the join: `isVisible is true`
  is false for the null row a non-matching left join produces, so people with no
  faces — the only ones the query exists to find — were filtered out before
  `having count = 0` ever saw them. The job ran on schedule and after every
  forced reset, and silently deleted nobody. Conditions moved into the `ON`
  clause. (On the library this was found on, the corrected query matched 86
  people the old one returned zero of.)
- **The merge target sometimes showed the source person's thumbnail.** Picking a
  named person to merge into could leave the top bubble labelled with the right
  name but showing the wrong face. The merge screen had a fixed direction —
  everything merged into whoever's page you were on — so selecting a named
  target swapped the two people in place and re-navigated to keep that
  invariant. The swap reassigned the component's `person` prop and the selection
  array in the same tick while a route load was already in flight to overwrite
  `person` again, and the bubble's `<img>` was reused across the whole dance.
  Removing the swap fixed it: the direction is now explicit (source → target)
  rather than implied by which page you're on, so nothing reassigns `person`,
  and each tray bubble is keyed by person id so a new selection mounts a fresh
  image element instead of inheriting the previous one's.
- **Face reassignment could affect more than the intended occurrence** —
  scoped reassignment to the single video occurrence being edited, plus a
  fork-wide bug sweep (commit `cb29de22d`) for related edge cases turned up
  during that pass.

## Configuration reference

See [`docs/docs/features/facial-recognition.md`](docs/docs/features/facial-recognition.md#video-face-detection),
[`docs/docs/administration/system-settings.md`](docs/docs/administration/system-settings.md),
and [`docs/docs/install/config-file.md`](docs/docs/install/config-file.md) for
the updated settings reference.
