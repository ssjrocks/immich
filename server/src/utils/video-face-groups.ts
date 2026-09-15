export type GroupableVideoFace = {
  id: string;
  timestampMs: number | null;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  imageWidth: number;
  imageHeight: number;
  embedding: string;
};

export type GroupedVideoFace<T extends GroupableVideoFace> = T & { area: number; vector: number[] };

// Frames within this many milliseconds of each other are compared directly. Someone's face changes gradually
// from frame to frame, so neighbouring detections are what link a turned head back to a frontal one.
const TIME_WINDOW_MS = 10_000;
// Caps the comparisons per face so a crowded, densely sampled video stays fast.
const MAX_WINDOW_COMPARISONS = 200;
// The clearest faces of each group, compared across groups to rejoin a person who leaves the shot and comes back.
const REPRESENTATIVES_PER_GROUP = 3;

// Cosine distance (1 − cosine similarity): 0 = identical direction, 1 = orthogonal. Zero-magnitude vectors are
// treated as maximally distant to avoid division by zero.
export const cosineDistance = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 1 : 1 - dot / denom;
};

const parseVector = (embedding: string): number[] => JSON.parse(embedding) as number[];

/**
 * Groups one video's face detections into the people they show, keeping every detection.
 *
 * Detections are linked when they're within `maxDistance` (the facial recognition threshold) of a nearby
 * frame's detection, so a group follows a person through gradual changes of angle and expression. Groups are
 * then merged when their clearest faces match, which rejoins someone who appears again after a cut. The result
 * is sorted largest group first, and each group's faces largest (usually clearest) first.
 */
export const groupVideoFaces = <T extends GroupableVideoFace>(
  faces: T[],
  maxDistance: number,
): GroupedVideoFace<T>[][] => {
  const prepared: GroupedVideoFace<T>[] = faces
    .map((face) => ({
      ...face,
      area:
        ((face.boundingBoxX2 - face.boundingBoxX1) * (face.boundingBoxY2 - face.boundingBoxY1)) /
        (face.imageWidth * face.imageHeight || 1),
      vector: parseVector(face.embedding),
    }))
    .sort((a, b) => (a.timestampMs ?? -1) - (b.timestampMs ?? -1));

  const parent = prepared.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
  };
  const isMatch = (a: number, b: number) => cosineDistance(prepared[a].vector, prepared[b].vector) <= maxDistance;

  for (let i = 0; i < prepared.length; i++) {
    const timestamp = prepared[i].timestampMs;
    if (timestamp === null) {
      // The un-timestamped preview-frame face has no position in the video, so compare it with everything.
      for (let j = 0; j < prepared.length; j++) {
        if (j !== i && isMatch(i, j)) {
          union(i, j);
        }
      }
      continue;
    }

    let comparisons = 0;
    for (let j = i - 1; j >= 0 && comparisons < MAX_WINDOW_COMPARISONS; j--) {
      const other = prepared[j].timestampMs;
      if (other === null) {
        continue;
      }
      if (timestamp - other > TIME_WINDOW_MS) {
        break;
      }
      comparisons++;
      if (isMatch(i, j)) {
        union(i, j);
      }
    }
  }

  const collect = () => {
    const byRoot = new Map<number, number[]>();
    for (let index = 0; index < prepared.length; index++) {
      const root = find(index);
      const members = byRoot.get(root) ?? [];
      members.push(index);
      byRoot.set(root, members);
    }
    return [...byRoot.values()].map((members) => members.sort((a, b) => prepared[b].area - prepared[a].area));
  };

  let merged = true;
  while (merged) {
    merged = false;
    const groups = collect();
    for (let a = 0; a < groups.length && !merged; a++) {
      for (let b = a + 1; b < groups.length && !merged; b++) {
        const representativesA = groups[a].slice(0, REPRESENTATIVES_PER_GROUP);
        const representativesB = groups[b].slice(0, REPRESENTATIVES_PER_GROUP);
        if (representativesA.some((i) => representativesB.some((j) => isMatch(i, j)))) {
          union(groups[a][0], groups[b][0]);
          merged = true;
        }
      }
    }
  }

  return collect()
    .map((members) => members.map((index) => prepared[index]))
    .sort((a, b) => b.length - a.length);
};
