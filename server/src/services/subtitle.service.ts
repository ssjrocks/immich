import { Injectable } from '@nestjs/common';
import { dirname } from 'node:path';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import { AssetFileType, AssetType, AssetVisibility, JobName, JobStatus, QueueName, StorageFolder } from 'src/enum';
import { TranscriptionSegment } from 'src/repositories/machine-learning.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { isSubtitleGenerationEnabled } from 'src/utils/misc';

// Audio goes to the ML service one chunk per request. Node's fetch abandons a request whose response
// hasn't started within 300 seconds, and nothing here configures that, so a chunk has to transcribe
// comfortably inside it even with the slower model on a modest CPU. The cost is that a word falling
// exactly on a chunk boundary can be clipped.
const AUDIO_CHUNK_SECONDS = 60;

@Injectable()
export class SubtitleService extends BaseService {
  @OnJob({ name: JobName.AssetGenerateSubtitlesQueueAll, queue: QueueName.Subtitles })
  async handleQueueGenerateSubtitles({ force }: JobOf<JobName.AssetGenerateSubtitlesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSubtitleGenerationEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    for await (const asset of this.assetJobRepository.streamForSubtitlesJob(force)) {
      jobs.push({ name: JobName.AssetGenerateSubtitles, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetGenerateSubtitles, queue: QueueName.Subtitles })
  async handleGenerateSubtitles({ id }: JobOf<JobName.AssetGenerateSubtitles>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSubtitleGenerationEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForSubtitlesJob(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    if (asset.type !== AssetType.Video || asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const segments: TranscriptionSegment[] = [];
    const { audioStreams } = await this.mediaRepository.probe(asset.originalPath);
    if (audioStreams.length > 0) {
      let tempDir: string | undefined;
      try {
        tempDir = await this.storageRepository.createTempDir('immich-subtitles-');
        const chunks = await this.mediaRepository.extractAudioChunks(asset.originalPath, tempDir, AUDIO_CHUNK_SECONDS);

        for (const [index, chunk] of chunks.entries()) {
          const offset = index * AUDIO_CHUNK_SECONDS;
          const transcription = await this.machineLearningRepository.transcribe(chunk, machineLearning.subtitles);
          for (const segment of transcription.segments) {
            segments.push({
              start: segment.start + offset,
              end: segment.end + offset,
              text: segment.text,
              words: segment.words?.map((word) => ({ ...word, start: word.start + offset, end: word.end + offset })),
            });
          }
        }
      } finally {
        if (tempDir) {
          await this.storageRepository.unlinkDir(tempDir, { recursive: true, force: true });
        }
      }
    }

    // Written even when nothing was said: an empty file marks the video as done, so "Missing" doesn't
    // keep queueing it, and the player just has no captions to show.
    const path = StorageCore.getNestedPath(StorageFolder.EncodedVideo, asset.ownerId, `${asset.id}.subtitles.vtt`);
    this.storageRepository.mkdirSync(dirname(path));
    await this.storageRepository.createOrOverwriteFile(path, Buffer.from(toWebVtt(buildCues(segments))));
    await this.assetRepository.upsertFile({ assetId: asset.id, path, type: AssetFileType.Subtitle });

    this.logger.debug(`Generated ${segments.length} subtitle cue(s) for video ${id}`);
    return JobStatus.Success;
  }
}

export type SubtitleCue = { start: number; end: number; text: string };

// Readability limits for one on-screen subtitle.
const MAX_CUE_CHARS = 84; // about two lines
const MAX_CUE_SECONDS = 7;
const MIN_CUE_SECONDS = 1; // a very short cue is held this long, when the next one leaves room
const PAUSE_SECONDS = 0.8; // a gap this long between words starts a new cue
const LINGER_SECONDS = 0.3; // how long a line stays up after its last word

type TimedText = { start: number; end: number; text: string };

// For a segment that came back without word timings: spread its words across the segment in proportion to
// their length, so it can still be split into readable cues instead of one long block.
const spreadOverSegment = ({ start, end, text }: TranscriptionSegment): TimedText[] => {
  const tokens = text.split(/\s+/).filter(Boolean);
  const totalChars = tokens.reduce((sum, token) => sum + token.length + 1, 0);
  const secondsPerChar = totalChars > 0 ? (end - start) / totalChars : 0;
  let cursor = start;
  return tokens.map((token) => {
    const tokenStart = cursor;
    cursor += (token.length + 1) * secondsPerChar;
    return { start: tokenStart, end: cursor, text: token };
  });
};

/**
 * Turns Whisper's segments into subtitle cues. Whisper's own segments make poor subtitles: a segment's end
 * time often runs on through the silence after it, and one segment can hold several long sentences. Cues are
 * built from word timings instead -- ending when their last word does, split at sentence ends, pauses and
 * readable lengths -- and never overlap.
 */
export const buildCues = (segments: TranscriptionSegment[]): SubtitleCue[] => {
  const units = segments.flatMap((segment): TimedText[] => {
    const words = (segment.words ?? []).filter((word) => word.word.trim());
    if (words.length === 0) {
      return spreadOverSegment(segment);
    }
    // Word times in a translation are only approximately aligned, so keep them within their segment.
    const clamp = (time: number) => Math.min(Math.max(time, segment.start), segment.end);
    return words.map((word) => ({ start: clamp(word.start), end: clamp(word.end), text: word.word.trim() }));
  });

  const groups: TimedText[] = [];
  for (const unit of units) {
    const current = groups[groups.length - 1];
    const joined = current ? `${current.text} ${unit.text}` : unit.text;
    if (
      current &&
      !/[.!?]["')\]]?$/.test(current.text) &&
      unit.start - current.end <= PAUSE_SECONDS &&
      joined.length <= MAX_CUE_CHARS &&
      unit.end - current.start <= MAX_CUE_SECONDS
    ) {
      current.text = joined;
      current.end = unit.end;
    } else {
      groups.push({ ...unit });
    }
  }

  return groups.map((group, index) => {
    const nextStart = groups[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    const wanted = Math.max(group.end + LINGER_SECONDS, group.start + MIN_CUE_SECONDS);
    const end = Math.min(wanted, nextStart, group.start + MAX_CUE_SECONDS);
    return { start: group.start, end: Math.max(group.start, end), text: group.text };
  });
};

const formatTimestamp = (seconds: number) => {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(totalMs % 1000, 3)}`;
};

export const toWebVtt = (cues: SubtitleCue[]) => {
  const blocks = cues.map(({ start, end, text }, index) => {
    // A cue ends at the first blank line, and "-->" is reserved for the timing line.
    const safeText = text.replaceAll('-->', '->').replaceAll(/\s*\n\s*/g, ' ');
    return `${index + 1}\n${formatTimestamp(start)} --> ${formatTimestamp(end)}\n${safeText}`;
  });
  return ['WEBVTT', ...blocks].join('\n\n') + '\n';
};
