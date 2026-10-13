import { AssetFileType, AssetType, AssetVisibility, ImmichWorker, JobName, JobStatus } from 'src/enum';
import { buildCues, parseWebVtt, SubtitleService, toTranscriptLines, toWebVtt } from 'src/services/subtitle.service';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

describe('toWebVtt', () => {
  it('produces a header-only file when nothing was said', () => {
    expect(toWebVtt([])).toBe('WEBVTT\n');
  });

  it('numbers cues and formats hours, minutes, seconds and milliseconds', () => {
    expect(toWebVtt([{ start: 1.5, end: 3725.004, text: 'Hello there' }])).toBe(
      'WEBVTT\n\n1\n00:00:01.500 --> 01:02:05.004\nHello there\n',
    );
  });

  it('separates consecutive cues with a blank line', () => {
    expect(
      toWebVtt([
        { start: 0, end: 1, text: 'one' },
        { start: 1, end: 2, text: 'two' },
      ]),
    ).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\none\n\n2\n00:00:01.000 --> 00:00:02.000\ntwo\n');
  });

  it('stops cue text from ending the cue early or faking a timing line', () => {
    expect(toWebVtt([{ start: 0, end: 1, text: 'one\n\ntwo --> three' }])).toBe(
      'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\none two -> three\n',
    );
  });
});

const words = (items: Array<[number, number, string]>) => items.map(([start, end, word]) => ({ start, end, word }));

describe('buildCues', () => {
  it('ends a cue when its last word ends, not when the segment does', () => {
    const cues = buildCues([
      {
        start: 0,
        end: 15,
        text: 'Hello there.',
        words: words([
          [0, 0.5, ' Hello'],
          [0.6, 1.2, ' there.'],
        ]),
      },
    ]);
    expect(cues).toEqual([{ start: 0, end: 1.5, text: 'Hello there.' }]);
  });

  it('starts a new cue after a sentence ends', () => {
    const cues = buildCues([
      {
        start: 0,
        end: 4,
        text: 'Yes. What else?',
        words: words([
          [0, 0.4, ' Yes.'],
          [1, 1.4, ' What'],
          [1.5, 2, ' else?'],
        ]),
      },
    ]);
    expect(cues.map((cue) => cue.text)).toEqual(['Yes.', 'What else?']);
  });

  it('starts a new cue after a long pause', () => {
    const cues = buildCues([
      {
        start: 0,
        end: 10,
        text: 'one two',
        words: words([
          [0, 0.5, ' one'],
          [5, 5.5, ' two'],
        ]),
      },
    ]);
    expect(cues.map((cue) => cue.text)).toEqual(['one', 'two']);
  });

  it('keeps every cue short enough to read, without losing any words', () => {
    const many = Array.from({ length: 40 }, (_, i): [number, number, string] => [i * 0.2, i * 0.2 + 0.15, ' word']);
    const text = Array.from({ length: 40 }, () => 'word').join(' ');
    const cues = buildCues([{ start: 0, end: 8, text, words: words(many) }]);
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(84);
      expect(cue.end - cue.start).toBeLessThanOrEqual(7);
    }
    expect(cues.map((cue) => cue.text).join(' ')).toBe(text);
  });

  it('never lets one cue run into the next', () => {
    const cues = buildCues([
      { start: 0, end: 2, text: 'First.', words: words([[0, 1.9, ' First.']]) },
      { start: 2, end: 4, text: 'Second.', words: words([[2, 3, ' Second.']]) },
    ]);
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start);
  });

  it('holds a very short cue for at least a second when there is room', () => {
    expect(buildCues([{ start: 0, end: 5, text: 'Hi.', words: words([[0, 0.2, ' Hi.']]) }])[0].end).toBe(1);
  });

  it('splits a segment that has no word timings instead of showing it as one long block', () => {
    const text =
      'This is a long sentence without any word timings, which Whisper sometimes produces for a whole window of audio';
    const cues = buildCues([{ start: 0, end: 22, text }]);
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(84);
      expect(cue.end - cue.start).toBeLessThanOrEqual(7);
    }
    expect(cues.map((cue) => cue.text).join(' ')).toBe(text);
  });
});

describe('parseWebVtt', () => {
  it('reads back exactly what toWebVtt writes', () => {
    const cues = [
      { start: 0, end: 1.5, text: 'Hello there.' },
      { start: 3725.004, end: 3727.25, text: 'An hour in, -> still talking' },
    ];
    expect(parseWebVtt(toWebVtt(cues))).toEqual(cues);
  });

  it('finds nothing in a file with no cues', () => {
    expect(parseWebVtt('WEBVTT\n')).toEqual([]);
  });

  it('accepts the usual variations of the format', () => {
    const file = [
      'WEBVTT',
      '',
      'NOTE written by something else',
      '',
      '00:01.000 --> 00:02,500 align:start position:10%',
      'first line',
      'second line',
      '',
      'cue-id',
      '00:00:03.000 --> 00:00:04.000',
      'next',
    ].join('\r\n');
    expect(parseWebVtt(file)).toEqual([
      { start: 1, end: 2.5, text: 'first line second line' },
      { start: 3, end: 4, text: 'next' },
    ]);
  });
});

describe('toTranscriptLines', () => {
  it('stores times as whole milliseconds and drops empty lines', () => {
    expect(
      toTranscriptLines([
        { start: 1.2344, end: 2.0006, text: ' Hi. ' },
        { start: 3, end: 4, text: ' '.repeat(3) },
      ]),
    ).toEqual([{ startMs: 1234, endMs: 2001, text: 'Hi.' }]);
  });
});

describe(SubtitleService.name, () => {
  let sut: SubtitleService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SubtitleService));
    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
  });

  describe('onBootstrap', () => {
    it('queues the import of subtitle files written before transcripts were stored', async () => {
      await sut.onBootstrap();
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.AssetImportSubtitlesQueueAll, data: {} });
    });
  });

  describe('handleQueueImportSubtitles', () => {
    it('queues an import for every video with a subtitle file but no stored transcript', async () => {
      mocks.assetJob.streamForSubtitleImport.mockReturnValue(makeStream([{ id: 'video-1' }, { id: 'video-2' }]));

      await expect(sut.handleQueueImportSubtitles()).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetImportSubtitles, data: { id: 'video-1' } },
        { name: JobName.AssetImportSubtitles, data: { id: 'video-2' } },
      ]);
    });
  });

  describe('handleImportSubtitles', () => {
    it('stores the lines of the subtitle file and its words for searching', async () => {
      mocks.assetJob.getSubtitlePath.mockResolvedValue({ subtitlePath: '/data/video.subtitles.vtt' });
      mocks.storage.readFile.mockResolvedValue(
        Buffer.from(
          toWebVtt([
            { start: 0, end: 1, text: 'Hello there.' },
            { start: 2, end: 3, text: 'General  Kenobi!' },
          ]),
        ),
      );

      await expect(sut.handleImportSubtitles({ id: 'video-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.storage.readFile).toHaveBeenCalledWith('/data/video.subtitles.vtt');
      expect(mocks.transcript.replace).toHaveBeenCalledWith(
        'video-1',
        [
          { startMs: 0, endMs: 1000, text: 'Hello there.' },
          { startMs: 2000, endMs: 3000, text: 'General  Kenobi!' },
        ],
        'Hello there. General Kenobi!',
      );
    });

    it('marks a video with no speech as done, with no lines', async () => {
      mocks.assetJob.getSubtitlePath.mockResolvedValue({ subtitlePath: '/data/video.subtitles.vtt' });
      mocks.storage.readFile.mockResolvedValue(Buffer.from('WEBVTT\n'));

      await sut.handleImportSubtitles({ id: 'video-1' });

      expect(mocks.transcript.replace).toHaveBeenCalledWith('video-1', [], '');
    });

    it('skips a video whose subtitle file is gone', async () => {
      mocks.assetJob.getSubtitlePath.mockResolvedValue({ subtitlePath: null });

      await expect(sut.handleImportSubtitles({ id: 'video-1' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.storage.readFile).not.toHaveBeenCalled();
      expect(mocks.transcript.replace).not.toHaveBeenCalled();
    });
  });

  describe('handleGenerateSubtitles', () => {
    it('transcribes the whole video in one request and stores the transcript alongside the subtitle file', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { subtitles: { enabled: true } } });
      mocks.assetJob.getForSubtitlesJob.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        originalPath: '/data/video.mp4',
        visibility: AssetVisibility.Timeline,
        type: AssetType.Video,
      });
      mocks.media.probe.mockResolvedValue({ audioStreams: [{}] } as never);
      mocks.storage.createTempDir.mockResolvedValue('/tmp/immich-subtitles-x');
      mocks.machineLearning.transcribe.mockResolvedValue({
        language: 'en',
        languageProbability: 0.99,
        segments: [
          { start: 1, end: 2, text: 'Hello.' },
          { start: 60.5, end: 61.5, text: 'A minute in.' },
        ],
      });

      await expect(sut.handleGenerateSubtitles({ id: 'video-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.media.extractAudio).toHaveBeenCalledWith('/data/video.mp4', '/tmp/immich-subtitles-x/audio.flac');
      expect(mocks.machineLearning.transcribe).toHaveBeenCalledTimes(1);
      expect(mocks.machineLearning.transcribe).toHaveBeenCalledWith(
        '/tmp/immich-subtitles-x/audio.flac',
        expect.objectContaining({ enabled: true }),
      );
      expect(mocks.asset.upsertFile).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: 'video-1', type: AssetFileType.Subtitle }),
      );
      // each line stays up a moment after it's said, exactly as in the subtitle file
      expect(mocks.transcript.replace).toHaveBeenCalledWith(
        'video-1',
        [
          { startMs: 1000, endMs: 2300, text: 'Hello.' },
          { startMs: 60_500, endMs: 61_800, text: 'A minute in.' },
        ],
        'Hello. A minute in.',
      );
      expect(mocks.storage.unlinkDir).toHaveBeenCalledWith('/tmp/immich-subtitles-x', { recursive: true, force: true });
    });

    it('writes an empty subtitle file for a video with no audio, without transcribing', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { subtitles: { enabled: true } } });
      mocks.assetJob.getForSubtitlesJob.mockResolvedValue({
        id: 'video-1',
        ownerId: 'user-1',
        originalPath: '/data/video.mp4',
        visibility: AssetVisibility.Timeline,
        type: AssetType.Video,
      });
      mocks.media.probe.mockResolvedValue({ audioStreams: [] } as never);

      await expect(sut.handleGenerateSubtitles({ id: 'video-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.machineLearning.transcribe).not.toHaveBeenCalled();
      expect(mocks.storage.createOrOverwriteFile).toHaveBeenCalledWith(expect.any(String), Buffer.from('WEBVTT\n'));
      expect(mocks.transcript.replace).toHaveBeenCalledWith('video-1', [], '');
    });
  });
});
