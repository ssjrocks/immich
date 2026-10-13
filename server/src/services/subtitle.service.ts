import { Injectable } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnEvent, OnJob } from 'src/decorators';
import {
  AssetFileType,
  AssetType,
  AssetVisibility,
  ImmichWorker,
  JobName,
  JobStatus,
  QueueName,
  StorageFolder,
} from 'src/enum';
import { TranscriptionSegment } from 'src/repositories/machine-learning.repository';
import { TranscriptLine } from 'src/repositories/transcript.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { tokenizeForSearch } from 'src/utils/database';
import { isSubtitleGenerationEnabled } from 'src/utils/misc';

@Injectable()
export class SubtitleService extends BaseService {
  // Subtitle files written before transcripts were kept in the database are read in once, so those videos
  // become searchable and show their transcript without being transcribed again. Once that's done this
  // finds nothing, so it costs one query per start.
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    await this.jobRepository.queue({ name: JobName.AssetImportSubtitlesQueueAll, data: {} });
  }

  // Not gated on subtitles being enabled: this only reads files that already exist, which is cheap, and
  // turning the feature off later shouldn't stop what was already transcribed from being searchable.
  @OnJob({ name: JobName.AssetImportSubtitlesQueueAll, queue: QueueName.Subtitles })
  async handleQueueImportSubtitles(): Promise<JobStatus> {
    let jobs: JobItem[] = [];
    for await (const asset of this.assetJobRepository.streamForSubtitleImport()) {
      jobs.push({ name: JobName.AssetImportSubtitles, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetImportSubtitles, queue: QueueName.Subtitles })
  async handleImportSubtitles({ id }: JobOf<JobName.AssetImportSubtitles>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getSubtitlePath(id);
    if (!asset?.subtitlePath) {
      return JobStatus.Skipped;
    }

    const file = await this.storageRepository.readFile(asset.subtitlePath);
    await this.saveTranscript(id, parseWebVtt(file.toString('utf8')));
    return JobStatus.Success;
  }

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

    let segments: TranscriptionSegment[] = [];
    const { audioStreams } = await this.mediaRepository.probe(asset.originalPath);
    if (audioStreams.length > 0) {
      let tempDir: string | undefined;
      try {
        // The whole video in one go. Whisper works through long audio in 30-second windows itself, moving each
        // window on to where the last complete sentence ended and carrying what was said into the next. Cutting
        // the audio up first would split words and sentences at the cuts and lose that context.
        tempDir = await this.storageRepository.createTempDir('immich-subtitles-');
        const audioPath = join(tempDir, 'audio.flac');
        await this.mediaRepository.extractAudio(asset.originalPath, audioPath);
        ({ segments } = await this.machineLearningRepository.transcribe(audioPath, machineLearning.subtitles));
      } finally {
        if (tempDir) {
          await this.storageRepository.unlinkDir(tempDir, { recursive: true, force: true });
        }
      }
    }

    // Written even when nothing was said: an empty file marks the video as done, so "Missing" doesn't
    // keep queueing it, and the player just has no captions to show.
    const cues = buildCues(segments);
    const path = StorageCore.getNestedPath(StorageFolder.EncodedVideo, asset.ownerId, `${asset.id}.subtitles.vtt`);
    this.storageRepository.mkdirSync(dirname(path));
    await this.storageRepository.createOrOverwriteFile(path, Buffer.from(toWebVtt(cues)));
    await this.assetRepository.upsertFile({ assetId: asset.id, path, type: AssetFileType.Subtitle });
    await this.saveTranscript(asset.id, cues);

    this.logger.debug(`Generated ${cues.length} subtitle cue(s) for video ${id}`);
    return JobStatus.Success;
  }

  private async saveTranscript(assetId: string, cues: SubtitleCue[]) {
    const lines = toTranscriptLines(cues);
    const searchText = tokenizeForSearch(lines.map((line) => line.text).join(' ')).join(' ');
    await this.transcriptRepository.replace(assetId, lines, searchText);
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

export const toTranscriptLines = (cues: SubtitleCue[]): TranscriptLine[] =>
  cues
    .map(({ start, end, text }) => ({
      startMs: Math.max(0, Math.round(start * 1000)),
      endMs: Math.max(0, Math.round(end * 1000)),
      text: text.trim(),
    }))
    .filter((line) => line.text);

const TIMING_LINE = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s+-->\s+(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

const toSeconds = (hours: string | undefined, minutes: string, seconds: string, millis: string) =>
  Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;

/**
 * Reads cues back out of a WebVTT file, for subtitle files written before transcripts were stored in the
 * database. Handles what toWebVtt writes and the usual variations: no cue numbers, hours left out, a comma
 * before the milliseconds, cue settings after the timing, and text over several lines.
 */
export const parseWebVtt = (content: string): SubtitleCue[] => {
  const cues: SubtitleCue[] = [];
  for (const block of content.replaceAll('\r\n', '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING_LINE.test(line));
    if (timingIndex === -1) {
      continue;
    }

    const match = TIMING_LINE.exec(lines[timingIndex])!;
    const text = lines
      .slice(timingIndex + 1)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
    if (text) {
      cues.push({
        start: toSeconds(match[1], match[2], match[3], match[4]),
        end: toSeconds(match[5], match[6], match[7], match[8]),
        text,
      });
    }
  }
  return cues;
};
