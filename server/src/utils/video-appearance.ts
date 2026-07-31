export interface VideoAppearance {
  startMs: number;
  endMs: number;
  detections: number;
}

/**
 * Collapse a video's raw face detections into appearances.
 *
 * A person on screen for a long stretch is detected once per sampled frame, so a single scene can
 * produce hundreds of timestamps. Consecutive detections closer together than `gapMs` are treated
 * as the same appearance; a gap of at least `gapMs` with no detection starts a new one.
 *
 * This is display grouping only -- the underlying `asset_face` rows are never touched -- so the
 * result recomputes freely as the gap setting changes or as people are merged.
 *
 * `gapMs <= 0` disables grouping and returns every detection as its own appearance.
 */
export const groupIntoAppearances = (timestampsMs: number[], gapMs: number): VideoAppearance[] => {
  // The query already sorts and de-duplicates, but this is cheap and makes the function safe to
  // call on any timestamp list -- an unsorted input would otherwise silently mis-group.
  const sorted = [...new Set(timestampsMs)].sort((a, b) => a - b);

  const appearances: VideoAppearance[] = [];
  for (const timestampMs of sorted) {
    const current = appearances.at(-1);

    // `>` not `>=`: with a 5s gap, a detection exactly 5s after the last one is the first to have
    // gone a full 5 seconds unseen, so it opens a new appearance.
    if (current === undefined || gapMs <= 0 || timestampMs - current.endMs > gapMs) {
      appearances.push({ startMs: timestampMs, endMs: timestampMs, detections: 1 });
      continue;
    }

    current.endMs = timestampMs;
    current.detections++;
  }

  return appearances;
};
