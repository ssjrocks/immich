import { cosineDistance, groupVideoFaces } from 'src/utils/video-face-groups';
import { describe, expect, it } from 'vitest';

const face = (id: string, timestampMs: number | null, vector: number[], size = 20) => ({
  id,
  timestampMs,
  boundingBoxX1: 0,
  boundingBoxY1: 0,
  boundingBoxX2: size,
  boundingBoxY2: size,
  imageWidth: 100,
  imageHeight: 100,
  embedding: JSON.stringify(vector),
});

const ids = (groups: { id: string }[][]) => groups.map((group) => group.map(({ id }) => id).sort());

describe('cosineDistance', () => {
  it('is 0 for the same direction and 1 for orthogonal vectors', () => {
    expect(cosineDistance([1, 0], [2, 0])).toBeCloseTo(0);
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });

  it('treats a zero vector as maximally distant', () => {
    expect(cosineDistance([0, 0], [1, 0])).toBe(1);
  });
});

describe('groupVideoFaces', () => {
  it('returns no groups for no faces', () => {
    expect(groupVideoFaces([], 0.5)).toEqual([]);
  });

  it('keeps every detection', () => {
    const faces = [face('a', 0, [1, 0, 0]), face('b', 500, [0.99, 0.01, 0]), face('c', 1000, [0, 1, 0])];
    expect(groupVideoFaces(faces, 0.5).flat()).toHaveLength(3);
  });

  it('keeps two different people apart', () => {
    const faces = [
      face('a1', 0, [1, 0, 0]),
      face('b1', 0, [0, 1, 0]),
      face('a2', 500, [0.99, 0.01, 0]),
      face('b2', 500, [0.01, 0.99, 0]),
    ];
    expect(ids(groupVideoFaces(faces, 0.5))).toEqual(expect.arrayContaining([['a1', 'a2'], ['b1', 'b2']]));
  });

  it('follows one person through a gradual change, even when the first and last frames do not match', () => {
    // Each frame is 0.2 from the previous one, but the first and last are 0.72 apart: the old clean-up kept
    // those two as separate, unmatchable faces and split one person into two.
    const faces = [face('f1', 0, [1, 0, 0]), face('f2', 500, [0.8, 0.6, 0]), face('f3', 1000, [0.28, 0.96, 0])];
    expect(cosineDistance([1, 0, 0], [0.28, 0.96, 0])).toBeGreaterThan(0.5);
    expect(ids(groupVideoFaces(faces, 0.5))).toEqual([['f1', 'f2', 'f3']]);
  });

  it('rejoins a person who reappears long after they were last seen', () => {
    const faces = [face('early', 0, [1, 0, 0]), face('other', 30_000, [0, 1, 0]), face('late', 90_000, [0.97, 0.03, 0])];
    expect(ids(groupVideoFaces(faces, 0.5))).toEqual(expect.arrayContaining([['early', 'late'], ['other']]));
  });

  it('links the un-timestamped preview face with matching video frames', () => {
    const faces = [face('preview', null, [1, 0, 0]), face('frame', 60_000, [0.98, 0.02, 0])];
    expect(ids(groupVideoFaces(faces, 0.5))).toEqual([['frame', 'preview']]);
  });

  it('puts the largest group first, and the largest face first within a group', () => {
    const faces = [
      face('b1', 0, [0, 1, 0], 10),
      face('a-small', 0, [1, 0, 0], 10),
      face('a-large', 500, [0.99, 0.01, 0], 40),
      face('a-mid', 1000, [0.98, 0.02, 0], 20),
    ];
    const groups = groupVideoFaces(faces, 0.5);
    expect(groups.map((group) => group.map(({ id }) => id))).toEqual([['a-large', 'a-mid', 'a-small'], ['b1']]);
  });
});
