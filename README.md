<p align="center"> 
  <br/>
  <a href="https://opensource.org/license/agpl-v3"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?color=3F51B5&style=for-the-badge&label=License&logoColor=000000&labelColor=ececec" alt="License: AGPLv3"></a>
  <a href="https://discord.immich.app">
    <img src="https://img.shields.io/discord/979116623879368755.svg?label=Discord&logo=Discord&style=for-the-badge&logoColor=000000&labelColor=ececec" alt="Discord"/>
  </a>
  <br/>
  <br/>
</p>

# 🍴 This fork

This is a personal fork of [immich-app/immich](https://github.com/immich-app/immich), kept in sync with
upstream `main`, with two extra capabilities layered on top of a stock install. See
[FORK_CHANGES.md](FORK_CHANGES.md) for the full technical changelog (schema, config, API).

****************************************************************************************************************************************************************************************
Warning, probably buggy and unstable, changes made with claude code and should not be trusted with any library your not comfortable restoring from scratch if this fork breaks something
****************************************************************************************************************************************************************************************



## Facial recognition throughout videos

Stock Immich only runs face detection on a video's first-frame thumbnail — if someone isn't in that
exact frame, they're never recognized anywhere in that video. This fork adds a second, **opt-in**
pass that samples frames throughout the full video at a configurable rate, runs each through
Immich's existing face-detection model, dedupes repeated detections of the same appearance, and
surfaces every distinct moment a person shows up.

The detection/clustering approach here is adapted closely from
[Tom Holland](https://github.com/0thomasholland)'s
[`feature/video-face-phase-5`](https://github.com/0thomasholland/immich/tree/feature/video-face-phase-5)
branch — thank you, Tom, for the original design. Several real bugs shared with that lineage were
caught by [IAfanasov](https://github.com/IAfanasov)'s independent review on the original
[GitHub discussion](https://github.com/immich-app/immich/discussions/5936); see
[FORK_CHANGES.md](FORK_CHANGES.md#credit) for the full credit and bug list.

- **Opt-in, configurable scanning** (Admin → Machine Learning → Facial Recognition): a three-way
  mode — off, classic first-frame-only (stock behavior), or full video scan — so installing this
  fork never silently starts reprocessing an existing library. Full-scan users pick an evenly-spread
  frame count or a seconds-between-frames interval (sub-second precision), capped at 10,000 frames
  per video, with disk-space guidance in the settings UI.
- **Manual per-video scan**: a "Scan video for faces" button next to the People section on any video
  (admin only, shown only when video scanning is enabled) — (re-)scan a single file without waiting
  for or re-running the library-wide job.
- **A person's page** lists every video they appear in as a two-pane, file-explorer-style view: a
  scrollable video list on the left — thumbnail plus appearance count, sorted so the video most
  worth checking is always on top — and a larger pane on the right showing a real frame thumbnail
  per timestamp in the selected video, hover-swappable to a short clip preview.
- **While watching a video**, clicking a person in the sidebar floats a popover with that person's
  appearance timestamps *in this video* — seeking the player in place when you pick one — plus a
  "View person" link straight to their page.
- **An in-place edit mode** on the People sidebar: inline rename and "not a face" buttons on hover,
  a "Merge people" picker, and a dedicated "Wrong person" action that opens a picker of candidate
  people ranked by face-embedding similarity, so you reassign just the one misidentified face
  without merging the two people's other photos and videos together.
- **Person page menu**: "Delete person and reset faces" for people that turned into a mess of
  misgrouped faces after repeated scans — unassigns (doesn't delete) their faces so the next
  Facial Recognition run reconsiders them from scratch.

> [!NOTE]
> **Enabling on an existing library:** video face scanning is off by default — turn it on under
> Admin → Machine Learning → Facial Recognition first. Once enabled, the regular Face Detection
> queue's "Missing" button on the admin Jobs page won't pick up already-processed videos for a
> video-wide scan — it only tracks the first-frame job. Video face detection has its own row on the
> **Admin → Job Queues** page with its own **All**/**Missing** buttons — use **All** once to backfill
> your existing library, or use the per-video "Scan video for faces" button to backfill one file at
> a time.

<p align="center">
  <img src="design/fork/video-face-detection-person-page.gif" width="700" alt="Appears in videos: two-pane master/detail view with per-timestamp frame thumbnails and hover clip preview"><br/>
  <sub>A person's page: every video they appear in, master/detail style, with a hover clip preview per timestamp.</sub>
</p>
<p align="center">
  <img src="design/fork/video-face-detection-viewer.gif" width="700" alt="Browsing people and appearances in the info sidebar while watching a video"><br/>
  <sub>Watching a video: browsing people and their appearance timestamps from the info sidebar.</sub>
</p>
<p align="center">
  <img src="design/fork/video-face-detection-view-person-link.gif" width="700" alt="The View person link jumping from a video appearance to that person's page"><br/>
  <sub>The "View person" link: jump from an appearance timestamp straight to that person's page.</sub>
</p>
<p align="center">
  <img src="design/fork/video-face-detection-edit-mode.gif" width="700" alt="Edit-mode tool buttons on the People sidebar: rename, not-a-face, merge, and wrong-person actions"><br/>
  <sub>Edit mode on the People sidebar: rename, not-a-face, merge, and "Wrong person" reassignment buttons.</sub>
</p>
<p align="center">
  <img src="design/fork/video-face-detection-scan-mode.png" width="500" alt="Admin Facial Recognition settings: the Video face scanning mode dropdown"><br/>
  <sub>Admin settings: the opt-in scan-mode dropdown — Classic, Off, or full video scan.</sub>
</p>
<p align="center">
  <img src="design/fork/video-face-detection-scan-frame-count.png" width="500" alt="Frame count sampling settings for full video scanning">
  <img src="design/fork/video-face-detection-scan-interval.png" width="500" alt="Interval sampling settings for full video scanning"><br/>
  <sub>Full-scan sampling options: an evenly-spread frame count, or a seconds-between-frames interval.</sub>
</p>

## AI-generated photo descriptions via Immich Analyze

Credit for this one goes entirely to **Timofey Klester** ([@timasoft](https://github.com/timasoft)) —
his [immich-analyze](https://github.com/timasoft/immich-analyze) project runs alongside Immich as a
companion container. It analyzes photos with a vision-capable model (via Ollama or a llama.cpp
server) and writes a generated description back into each asset, making the library's existing
metadata search far more useful — you can search for what's actually *in* a photo, not just its
filename, date, or tags. It's not part of this fork's codebase; it's a separate open-source project
I run in front of the same library, and it's genuinely great work — go star it.

<p align="center">
  <img src="design/fork/immich-analyze-description.png" width="700" alt="Immich asset detail panel showing an AI-generated description"><br/>
  <sub>An AI-generated description written into a photo's metadata by immich-analyze.</sub>
</p>

---

<p align="center">
<img src="design/immich-logo-stacked-light.svg" width="300" title="Login With Custom URL">
</p>
<h3 align="center">High performance self-hosted photo and video management solution</h3>
<br/>
<a href="https://immich.app">
<img src="design/immich-screenshots.png" title="Main Screenshot">
</a>
<br/>

<p align="center">
  <a href="readme_i18n/README_ca_ES.md">Català</a>
  <a href="readme_i18n/README_es_ES.md">Español</a>
  <a href="readme_i18n/README_fr_FR.md">Français</a>
  <a href="readme_i18n/README_it_IT.md">Italiano</a>
  <a href="readme_i18n/README_ja_JP.md">日本語</a>
  <a href="readme_i18n/README_ko_KR.md">한국어</a>
  <a href="readme_i18n/README_de_DE.md">Deutsch</a>
  <a href="readme_i18n/README_nl_NL.md">Nederlands</a>
  <a href="readme_i18n/README_tr_TR.md">Türkçe</a>
  <a href="readme_i18n/README_zh_CN.md">简体中文</a>
  <a href="readme_i18n/README_zh_TW.md">正體中文</a>
  <a href="readme_i18n/README_uk_UA.md">Українська</a>
  <a href="readme_i18n/README_ru_RU.md">Русский</a>
  <a href="readme_i18n/README_bg_BG.md">Български</a>
  <a href="readme_i18n/README_pt_BR.md">Português Brasileiro</a>
  <a href="readme_i18n/README_sv_SE.md">Svenska</a>
  <a href="readme_i18n/README_ar_JO.md">العربية</a>
  <a href="readme_i18n/README_vi_VN.md">Tiếng Việt</a>
  <a href="readme_i18n/README_th_TH.md">ภาษาไทย</a>
  <a href="readme_i18n/README_ml_IN.md">മലയാളം</a>
</p>


> [!WARNING]
> ⚠️ Always follow [3-2-1](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/) backup plan for your precious photos and videos!
> 
 

> [!NOTE]
> You can find the main documentation, including installation guides, at https://immich.app/.

## Links

- [Documentation](https://docs.immich.app/)
- [About](https://docs.immich.app/overview/introduction)
- [Installation](https://docs.immich.app/install/requirements)
- [Roadmap](https://immich.app/roadmap)
- [Demo](#demo)
- [Features](#features)
- [Translations](https://docs.immich.app/developer/translations)
- [Contributing](https://docs.immich.app/overview/support-the-project)

## Demo

Access the demo [here](https://demo.immich.app). For the mobile app, you can use `https://demo.immich.app` for the `Server Endpoint URL`.

### Login credentials

| Email           | Password |
| --------------- | -------- |
| demo@immich.app | demo     |

## Features

| Features                                     | Mobile | Web |
| :------------------------------------------- | ------ | --- |
| Upload and view videos and photos            | Yes    | Yes |
| Auto backup when the app is opened           | Yes    | N/A |
| Prevent duplication of assets                | Yes    | Yes |
| Selective album(s) for backup                | Yes    | N/A |
| Download photos and videos to local device   | Yes    | Yes |
| Multi-user support                           | Yes    | Yes |
| Album and Shared albums                      | Yes    | Yes |
| Scrubbable/draggable scrollbar               | Yes    | Yes |
| Support raw formats                          | Yes    | Yes |
| Metadata view (EXIF, map)                    | Yes    | Yes |
| Search by metadata, objects, faces, and CLIP | Yes    | Yes |
| Administrative functions (user management)   | No     | Yes |
| Background backup                            | Yes    | N/A |
| Virtual scroll                               | Yes    | Yes |
| OAuth support                                | Yes    | Yes |
| API Keys                                     | N/A    | Yes |
| LivePhoto/MotionPhoto backup and playback    | Yes    | Yes |
| Support 360 degree image display             | No     | Yes |
| User-defined storage structure               | Yes    | Yes |
| Public Sharing                               | Yes    | Yes |
| Archive and Favorites                        | Yes    | Yes |
| Global Map                                   | Yes    | Yes |
| Partner Sharing                              | Yes    | Yes |
| Facial recognition and clustering            | Yes    | Yes |
| Memories (x years ago)                       | Yes    | Yes |
| Offline support                              | Yes    | No  |
| Read-only gallery                            | Yes    | Yes |
| Stacked Photos                               | Yes    | Yes |
| Tags                                         | No     | Yes |
| Folder View                                  | Yes    | Yes |

## Translations

Read more about translations [here](https://docs.immich.app/developer/translations).

<a href="https://hosted.weblate.org/engage/immich/">
<img src="https://hosted.weblate.org/widget/immich/immich/multi-auto.svg" alt="Translation status" />
</a>

## Repository activity

![Activities](https://repobeats.axiom.co/api/embed/9e86d9dc3ddd137161f2f6d2e758d7863b1789cb.svg "Repobeats analytics image")

## Star history

<a href="https://star-history.com/#immich-app/immich&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=immich-app/immich&type=date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=immich-app/immich&type=date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=immich-app/immich&type=date" width="100%" />
 </picture>
</a>

## Contributors

<a href="https://github.com/immich-app/immich/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=immich-app/immich" width="100%"/>
</a>
