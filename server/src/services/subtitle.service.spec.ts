import { buildCues, toWebVtt } from 'src/services/subtitle.service';

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
      { start: 0, end: 15, text: 'Hello there.', words: words([[0, 0.5, ' Hello'], [0.6, 1.2, ' there.']]) },
    ]);
    expect(cues).toEqual([{ start: 0, end: 1.5, text: 'Hello there.' }]);
  });

  it('starts a new cue after a sentence ends', () => {
    const cues = buildCues([
      { start: 0, end: 4, text: 'Yes. What else?', words: words([[0, 0.4, ' Yes.'], [1, 1.4, ' What'], [1.5, 2, ' else?']]) },
    ]);
    expect(cues.map((cue) => cue.text)).toEqual(['Yes.', 'What else?']);
  });

  it('starts a new cue after a long pause', () => {
    const cues = buildCues([{ start: 0, end: 10, text: 'one two', words: words([[0, 0.5, ' one'], [5, 5.5, ' two']]) }]);
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
