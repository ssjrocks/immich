import { groupIntoAppearances } from 'src/utils/video-appearance';
import { describe, expect, it } from 'vitest';

const FIVE_SECONDS = 5000;

describe('groupIntoAppearances', () => {
  it('returns nothing for no detections', () => {
    expect(groupIntoAppearances([], FIVE_SECONDS)).toEqual([]);
  });

  it('groups a run of closely-spaced detections into one appearance', () => {
    // A continuous scene sampled every 2s.
    expect(groupIntoAppearances([0, 2000, 4000, 6000, 8000], FIVE_SECONDS)).toEqual([
      { startMs: 0, endMs: 8000, detections: 5 },
    ]);
  });

  it('starts a new appearance after a gap longer than the threshold', () => {
    expect(groupIntoAppearances([0, 2000, 30_000, 32_000], FIVE_SECONDS)).toEqual([
      { startMs: 0, endMs: 2000, detections: 2 },
      { startMs: 30_000, endMs: 32_000, detections: 2 },
    ]);
  });

  it('treats a gap exactly equal to the threshold as the same appearance', () => {
    // Only once *more* than the gap has elapsed has the person been unseen for the full duration.
    expect(groupIntoAppearances([0, FIVE_SECONDS], FIVE_SECONDS)).toEqual([{ startMs: 0, endMs: 5000, detections: 2 }]);
  });

  it('splits one millisecond past the threshold', () => {
    expect(groupIntoAppearances([0, FIVE_SECONDS + 1], FIVE_SECONDS)).toEqual([
      { startMs: 0, endMs: 0, detections: 1 },
      { startMs: 5001, endMs: 5001, detections: 1 },
    ]);
  });

  it('returns every detection separately when grouping is disabled', () => {
    expect(groupIntoAppearances([0, 100, 200], 0)).toEqual([
      { startMs: 0, endMs: 0, detections: 1 },
      { startMs: 100, endMs: 100, detections: 1 },
      { startMs: 200, endMs: 200, detections: 1 },
    ]);
  });

  it('sorts and de-duplicates before grouping', () => {
    // Merging two people can hand us the same timestamp twice, out of order.
    expect(groupIntoAppearances([4000, 0, 2000, 2000], FIVE_SECONDS)).toEqual([
      { startMs: 0, endMs: 4000, detections: 3 },
    ]);
  });

  it('keeps a single detection as its own appearance', () => {
    expect(groupIntoAppearances([7000], FIVE_SECONDS)).toEqual([{ startMs: 7000, endMs: 7000, detections: 1 }]);
  });

  it('does not mutate its input', () => {
    const input = [4000, 0, 2000];
    groupIntoAppearances(input, FIVE_SECONDS);
    expect(input).toEqual([4000, 0, 2000]);
  });

  it('collapses a long continuous scene into one appearance', () => {
    // 300 detections, one every 2s -- the case that motivated this: 10 minutes on screen.
    const everyTwoSeconds = Array.from({ length: 300 }, (_, i) => i * 2000);
    expect(groupIntoAppearances(everyTwoSeconds, FIVE_SECONDS)).toEqual([
      { startMs: 0, endMs: 598_000, detections: 300 },
    ]);
  });
});
