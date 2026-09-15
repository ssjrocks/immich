# This fork: what it adds

This is a personal fork of [immich-app/immich](https://github.com/immich-app/immich), currently based on
upstream **v3.2.1** (merged 2026-09-15). On top of stock Immich it adds:

- **Face detection and recognition throughout videos**, not just on the first frame
- a **Browse page**: a flat grid with one-click filtering and sorting
- **Video subtitles**: English subtitles for videos in any spoken language, generated in the background

The README has the user-facing overview; this file is the technical changelog (schema, config, API, jobs).

## Why

Immich's stock face detection only runs on a video's generated preview thumbnail
(the first frame). If a person doesn't appear in that exact frame, they're never
recognized anywhere in that video. This fork samples frames throughout the full
video, detects faces in each, groups a video's detections into the people they
show, and surfaces those appearances in the UI so you can jump straight to the
moment someone appears.

The timeline is the only way stock Immich shows a whole library, always newest first.
The Browse page answers questions the timeline can't, like "what are my longest
videos?" or "which files have the highest resolution?".

Stock Immich has no subtitles. A library of home videos and downloaded clips in
other languages is much more usable when every video can be followed in English.

## Credit

The video-face detection approach in this fork is directly based on
[Tom Holland](https://github.com/0thomasholland)'s
[`feature/video-face-phase-5`](https://github.com/0thomasholland/immich/tree/feature/video-face-phase-5)
branch — several pieces here (notably the video-faces query and the original
cosine-distance clustering job) are adapted closely from his implementation, not
written independently from scratch as earlier notes here implied. Thank you, Tom,
for the original design. (The clustering step itself was later replaced — see
**Video faces are grouped, not de-duplicated** below.)

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

### Server: video face detection

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
  through an `AssetVideoDetectFacesQueueAll → AssetVideoDetectFaces →
  AssetVideoClusterFaces` chain (its own `videoFaceDetection` queue, separate
  from stock Face Detection). Frames are extracted via ffmpeg
  (`MediaRepository.extractVideoFrames`) and each is run through the _existing_
  single-image ML face-detection endpoint. `AssetVideoClusterFaces` then groups
  the video's detections into people (`utils/video-face-groups.ts`) and recognises
  each group once; see **Video faces are grouped, not de-duplicated**, below.
- **Video faces are grouped, not de-duplicated.** Every detection is kept.
  Detections within a few seconds of each other are linked when they're within the
  recognition distance (`maxDistance`), so a group follows one person through
  gradual changes of angle and expression; groups are then merged when their
  clearest faces match, which rejoins someone who reappears after a cut. The
  un-timestamped preview-frame face is included, so a person it was already
  recognised as carries over. Each group is recognised once: it takes the person
  already on one of its faces, else the closest matching person anywhere in the
  library (`searchFaces` with `hasPerson`, trying the group's three clearest
  faces), else one new person — created only when the group has at least
  `minFaces` detections, the same core-point rule photo recognition uses. The job
  waits for the Facial Recognition queue to drain first, so a video joins the
  people photo recognition creates instead of racing it. Photo recognition
  (`handleRecognizeFaces`) skips timestamped faces, and a forced recognition reset
  re-queues `AssetVideoClusterFaces` for every video.
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
- **Per-user override** (`preferences.people.videoAppearanceGapSeconds`, in
  Account Settings → Features → People): the admin value is only a default, and
  a user who sets their own overrides it. Follows the shape upstream uses for
  `minimumFaces`, with one deliberate difference — it defaults to `null` rather
  than a number, so "unset" genuinely means "follow the admin", and changing the
  server setting still moves every user who hasn't chosen their own. (Upstream's
  `minimumFaces` hard-defaults to `3`, which makes the web's
  `?? serverConfig.minFaces` fallback unreachable.) `null` and not `undefined`
  because `getKeysDeep` skips undefined values, which would drop the key in
  `getPreferencesPartial` and silently discard whatever the user picked; `0`
  survives too, since it is a meaningful value rather than "empty".
  **Tuning note**: the useful value tracks how densely a person is _detected_,
  not the sampling interval. Faces are routinely missed in individual frames
  (turned away, motion blur, too small), so consecutive detections sit seconds
  apart even at sub-second sampling. On one real library the default halved the
  appearance count for typical videos. Videos where someone is on screen almost
  throughout but detected only sparsely — one case averaged a detection every 27
  seconds across 47 minutes — barely collapse at any modest gap, and shouldn't be
  used to pick the setting: a gap wide enough to merge those would swallow
  genuinely separate appearances everywhere else.
- **API**:
  - `GET /people/:id/video-occurrences` — returns, for each video a person
    appears in, the detections they were seen at, grouped into appearances and
    sorted by appearance count. `appearances` gives each run's `startMs`, `endMs`
    and `detections` count; `timestampsMs` is kept as one entry per appearance
    (its start), so existing clients need no changes to benefit from grouping.
    Only videos the requesting user can see are listed (their own, or in albums
    shared with them), since a person group can be shared across users.
  - `PUT /people/:id/reassign` — moves one or more specific faces to a different
    existing person without merging the two people's other assets (backs the
    "Wrong person" picker).
  - `PUT /people/:id/unassign-from-asset` — detaches a person from every face
    they're tagged in within one asset (backs "This person is not in this
    video"). Faces are unassigned, not deleted, so recognition can still
    re-cluster them; the person's feature photo is regenerated if it was one of
    the detached faces. Because Immich has no notion of a negative example, a
    later recognition run can re-tag the same faces to the same person.
  - `unassignFace`/reset-faces path used by "Delete person and reset faces" —
    deletes the person but unassigns (doesn't delete) their faces so the next
    non-force Facial Recognition run reconsiders them.
  - Per-asset "Scan video for faces" reuses the existing `AssetJobName`
    single-asset job runner (`scan-video-faces`) rather than adding a new endpoint.
- A dedicated `videoFaceDetection` queue with its own row on the admin Job
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

### Server: Browse page

- `POST /search/browse` (`BrowseSearchDto`: optional `type`, `order`, `page`, `size` 1–1000, `withExif`) —
  a paginated flat listing that shows exactly what the timeline does: timeline visibility only, nothing in
  the trash, and partners' assets when they're shared into the timeline. "Both" means images and videos,
  not every asset type.
- `SearchOrderField` gains `resolution` (`exifImageWidth × exifImageHeight`), `duration` and
  `originalFileName` (case-insensitive), alongside upstream's fields; nullable fields sort last.

### Server: video subtitles

- **Config**: `machineLearning.subtitles` (`enabled`, default `false` — transcribing a library's worth of
  video is heavy CPU work, so upgrading must not silently start doing it; `modelName`, default
  `faster-whisper-medium`). Job concurrency `job.subtitles` (default `1`).
- **Jobs**: a `subtitles` queue with `AssetGenerateSubtitlesQueueAll` / `AssetGenerateSubtitles`, a row on
  the admin Job Queues page, and a per-asset `generate-subtitles` action. New videos are queued after
  thumbnail generation, alongside video transcoding.
- **Pipeline**: the audio is extracted with ffmpeg into 60-second mono 16 kHz chunks (a single request for
  a long video would outlast Node's default 300-second response-headers timeout), each chunk is sent to the
  ML service's new `transcription` task with the `translate` option, and segment and word times are offset
  back into place. Output is always English.
- **Cues** (`buildCues`): built from word timings rather than Whisper's segments, whose end times often
  run on through the silence after them. A cue ends 0.3 s after its last word, splits at sentence ends,
  pauses over 0.8 s, 84 characters or 7 seconds, is held at least 1 s when there's room, and never overlaps
  the next. Segments that come back without word timings are spread by word length and split the same way.
- **Storage**: WebVTT written as `<encoded-video>/<owner>/…/<id>.subtitles.vtt` and recorded as a new
  `subtitle` asset file type (a text column, so no migration), served by `GET /assets/:id/subtitles`
  (shared links allowed). Deleting the asset deletes its subtitles.

### Machine learning

- A `transcription` task (`immich_ml/models/transcription/whisper.py`) using
  [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2): language detected per chunk,
  `translate` to English, VAD filtering to skip silence and music (which Whisper otherwise fills with
  invented text), and word timestamps.
- Two models, int8 builds pinned to exact revisions: `faster-whisper-medium` and `faster-whisper-large-v3`.
  Only multilingual, translate-capable builds are offered: the "turbo" variants were distilled for
  transcription alone and silently output the source language when asked to translate.
- `faster-whisper` is in the `cpu` extra only (it conflicts with `onnxruntime-gpu`) and is imported lazily.

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
- Account Settings → Features → People: a "Seconds between separate appearances"
  field beside the existing minimum-faces one, seeded from the server default and
  cleared back to it by emptying the box.
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
- A **"This person is not in this video"** button on a video's people, wired to
  `unassign-from-asset`. Video-only: on a still there's one face per person, which
  the existing per-face remove already covers.
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
  old swap-direction button is gone. On v3.2.1 this calls upstream's ordered
  `POST /people/merge` with the target first.
- A "Scan video for faces" button next to the People section on any video asset
  — admin only, shown only when `scanMode` is `fullScan` — to (re-)scan a single
  file on demand.
- Person page menu: "Delete person and reset faces".
- Updated the "Face detection" job description on the admin Job Queues page to
  describe the new video behavior.
- **Browse page** (`/browse`, in the sidebar under Photos): one-click **All / Photos / Videos** and
  one-click sorting by **date taken, file size, resolution, duration or filename**, with an
  ascending/descending toggle; choices are remembered per browser. Supports the usual selection and bulk
  actions. `GalleryViewer` gained an optional `scrollElement` so its sliding window follows the page's own
  scroll container.
- **Subtitles in the video player**: a subtitle track labelled "English (translated)" and a captions
  button, added only when the video actually has subtitles (media-chrome shows a captions button for any
  `<track>`, even a missing file). Before switching to another video, the old text tracks are disabled, so
  a cue isn't left painted on a paused player.
- **Generate subtitles** in the asset menu and in bulk actions, an admin **Video subtitles** settings
  section (enable, model: Medium or Large-v3), and a **Video subtitles** row on the Job Queues page.

### Mobile

Nothing — this fork is web and server only.

An earlier version ported the feature to the Flutter app, but it was dropped: it
had fallen behind the web featureset, wasn't being used, and `mobile/` accounted
for most of the merge conflicts when pulling in upstream releases. `mobile/` is
now byte-identical to upstream, so it merges cleanly and the stock app works
against this server exactly as it does against an unmodified one. The history is
still there if it's ever wanted back — see the commits before `2fba27818`.

## Upstream v3.2.1 merge notes

- Upstream moved people to **person groups** (`person` is keyed by `ownerId` + `personGroupId`, and
  `asset_face.personId` became `personGroupId`) so recognised people can be shared across a cluster group
  of users. All of the fork's people and video-face code was ported to it; the API still identifies a
  person by the same id, since each existing person's group id is its old id. The upgrade's migrations
  were checked on a copy of a real library: people, names, face counts, video faces, feature photos and
  subtitles all came through identical.
- Upstream replaced `config.ts`, `system-config.dto.ts` and `model-config.dto.ts` with a single
  `dtos/config.dto.ts`; the fork's `facialRecognition.video`, `subtitles` and job settings now live there.
- The fork's routes reachable through shared links (`GET /assets/:id/subtitles`,
  `GET /assets/:id/video/frame`) are added to upstream's pinned shared-link route list.
- **If you upgrade an existing install**, back up the database first: upstream's migrations can't be
  undone. After upgrading, re-run **Video face detection → All** to regroup existing videos with the new
  grouping.

## Fixed

- **One person in a video became dozens of separate one-face "people".** Video face clean-up used to
  delete every face within the recognition distance of a larger one. What survived was, by construction,
  too far apart to match itself, so recognition could never group it: each leftover face became its own
  person (or, with a minimum of 3 faces, nobody), and none of them showed in the People list. On one test
  library 611 of 639 people had a single face. Replaced by grouping (see **Video faces are grouped, not
  de-duplicated**): a 3½-minute podcast video went from 23 one-face people to its two speakers, with 399
  and 359 faces. Existing videos need a re-scan (**Video face detection → All**) to benefit.
- **Subtitles stayed on screen too long, and could follow you to the next video.** Cues used Whisper's
  segment times, which ran on through silence (one lasted 22 seconds and held 307 characters); they're now
  built from word timings. The player is reused between videos, and the browser could leave the previous
  video's last cue painted on screen until a refresh; old text tracks are now disabled before switching.
- **The merge screen's candidate lists looked cramped.** The unnamed-people list — the one you actually
  work through — collapsed to about one row when a search returned few candidates, while the one-off
  targets list above it took space it didn't need. Targets are capped to about one scrolling row and the
  unnamed list keeps a 400px floor.
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
- **The preview-frame face was never considered alongside video faces.**
  Video face clustering excluded the un-timestamped preview-derived face, so
  a person visible in both the preview frame and a nearby sampled frame ended
  up with two near-identical face rows instead of one. Fixed by including
  that face in the clustering pass (it's now part of the grouping step).
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
