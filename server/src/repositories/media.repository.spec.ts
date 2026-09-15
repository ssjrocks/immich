import ffmpeg from 'fluent-ffmpeg';
import { mkdtempDisposableSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AssetEditAction, MirrorAxis } from 'src/dtos/editing.dto';
import { Colorspace, ImageFormat, VideoFaceSamplingMethod } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { automock } from 'test/utils';
import type { Mock } from 'vitest';

vi.mock('fluent-ffmpeg', () => {
  const mockFn = vi.fn();
  (mockFn as any).ffprobe = vi.fn();
  return { default: mockFn };
});

const getPixelColor = async (buffer: Buffer, x: number, y: number) => {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width!;
  const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * width + x) * 4;
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
  };
};

const buildTestQuadImage = async () => {
  // build a 4 quadrant image for testing mirroring
  const base = sharp({
    create: { width: 1000, height: 1000, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png();

  const tl = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

  const tr = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 0, g: 255, b: 0 } },
  })
    .png()
    .toBuffer();

  const bl = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();

  const br = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 255, g: 255, b: 0 } },
  })
    .png()
    .toBuffer();

  const image = base.composite([
    { input: tl, left: 0, top: 0 }, // top-left
    { input: tr, left: 500, top: 0 }, // top-right
    { input: bl, left: 0, top: 500 }, // bottom-left
    { input: br, left: 500, top: 500 }, // bottom-right
  ]);

  return image.png().toBuffer();
};

describe(MediaRepository.name, () => {
  let sut: MediaRepository;

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new MediaRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }));
  });

  describe('applyEdits (single actions)', () => {
    it('should apply crop edit correctly', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: {
            width: 1000,
            height: 1000,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 0.5 },
          },
        }).png(),
        [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 100,
              y: 200,
              width: 700,
              height: 300,
            },
          },
        ],
      );

      const metadata = await result.toBuffer().then((buf) => sharp(buf).metadata());
      expect(metadata.width).toBe(700);
      expect(metadata.height).toBe(300);
    });
    it('should apply rotate edit correctly', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: {
            width: 500,
            height: 1000,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 0.5 },
          },
        }).png(),
        [
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
        ],
      );

      const metadata = await result.toBuffer().then((buf) => sharp(buf).metadata());
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(500);
    });

    it('should apply mirror edit correctly', async () => {
      const resultHorizontal = sut['applyEdits'](sharp(await buildTestQuadImage()), [
        {
          action: AssetEditAction.Mirror,
          parameters: {
            axis: MirrorAxis.Horizontal,
          },
        },
      ]);

      const bufferHorizontal = await resultHorizontal.toBuffer();
      const metadataHorizontal = await resultHorizontal.metadata();
      expect(metadataHorizontal.width).toBe(1000);
      expect(metadataHorizontal.height).toBe(1000);

      expect(await getPixelColor(bufferHorizontal, 10, 10)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(bufferHorizontal, 990, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(bufferHorizontal, 10, 990)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(bufferHorizontal, 990, 990)).toEqual({ r: 0, g: 0, b: 255 });

      const resultVertical = sut['applyEdits'](sharp(await buildTestQuadImage()), [
        {
          action: AssetEditAction.Mirror,
          parameters: {
            axis: MirrorAxis.Vertical,
          },
        },
      ]);

      const bufferVertical = await resultVertical.toBuffer();
      const metadataVertical = await resultVertical.metadata();
      expect(metadataVertical.width).toBe(1000);
      expect(metadataVertical.height).toBe(1000);

      // top-left should now be bottom-left (blue)
      expect(await getPixelColor(bufferVertical, 10, 10)).toEqual({ r: 0, g: 0, b: 255 });
      // top-right should now be bottom-right (yellow)
      expect(await getPixelColor(bufferVertical, 990, 10)).toEqual({ r: 255, g: 255, b: 0 });
      // bottom-left should now be top-left (red)
      expect(await getPixelColor(bufferVertical, 10, 990)).toEqual({ r: 255, g: 0, b: 0 });
      // bottom-right should now be top-right (blue)
      expect(await getPixelColor(bufferVertical, 990, 990)).toEqual({ r: 0, g: 255, b: 0 });
    });
  });

  describe('applyEdits (multiple sequential edits)', () => {
    it('should apply horizontal mirror then vertical mirror (equivalent to 180° rotation)', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Vertical } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply rotate 90° then horizontal mirror', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 255, g: 255, b: 0 });
    });

    it('should apply 180° rotation', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Rotate, parameters: { angle: 180 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply 270° rotations', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Rotate, parameters: { angle: 270 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('should apply crop then rotate 90°', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 1000, height: 500 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(500);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
    });

    it('should apply rotate 90° then crop', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 500, height: 1000 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(500);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply vertical mirror then horizontal mirror then rotate 90°', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Vertical } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('should apply crop to single quadrant then mirror', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 500, height: 500 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(500);
      expect(metadata.height).toBe(500);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 490, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 10, 490)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 490, 490)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply all operations: crop, rotate, mirror', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 500, height: 1000 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(500);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
    });
  });

  describe('generateThumbnail', () => {
    it('should process random Authentik thumbnail image', async () => {
      const response = await fetch(
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NHB4IiBoZWlnaHQ9IjY0cHgiIHZpZXdCb3g9IjAgMCA2NCA2NCIgdmVyc2lvbj0iMS4xIj48cmVjdCBmaWxsPSIjMzc3YjM3IiBjeD0iMzIiIGN5PSIzMiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByPSIzMiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBzdHlsZT0iY29sb3I6ICNmZmY7IGxpbmUtaGVpZ2h0OiAxOyBmb250LWZhbWlseTogJ1JlZEhhdFRleHQnLCdPdmVycGFzcycsb3ZlcnBhc3MsaGVsdmV0aWNhLGFyaWFsLHNhbnMtc2VyaWY7ICIgZmlsbD0iI2ZmZiIgYWxpZ25tZW50LWJhc2VsaW5lPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtc2l6ZT0iMjgiIGZvbnQtd2VpZ2h0PSI0MDAiIGR5PSIuMWVtIj5BQTwvdGV4dD48L3N2Zz4=',
      );
      const buffer = Buffer.from(await response.arrayBuffer());
      const dir = mkdtempDisposableSync(join(tmpdir(), 'media-repository-'));
      const file = join(dir.path, 'test.webp');
      await sut.generateThumbnail(
        buffer,
        { colorspace: Colorspace.P3, quality: 80, format: ImageFormat.Webp, processInvalidImages: false },
        file,
      );

      expect(statSync(file).blksize).toBeGreaterThan(0);
    });
  });

  describe('extractVideoFrames', () => {
    const buildMockChain = (triggerEvent: 'end' | 'error' = 'end', stderrMsg = '') => {
      const chain = {
        outputOptions: vi.fn(),
        output: vi.fn(),
        on: vi.fn(),
        run: vi.fn(),
      };
      chain.outputOptions.mockReturnValue(chain);
      chain.output.mockReturnValue(chain);
      chain.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === triggerEvent) {
          if (event === 'end') {
            setImmediate(() => cb());
          } else {
            setImmediate(() => cb(new Error('ffmpeg failed'), '', stderrMsg));
          }
        }
        return chain;
      });
      return chain;
    };

    const mockProbe = (duration: number) => {
      // `ffprobe` is declared with four overloads, so vi.mocked() can't narrow it to a mock
      // instance. The vi.mock factory at the top of this file replaces it with a plain vi.fn(),
      // so assert that directly rather than leaving the callback params implicitly `any`.
      (ffmpeg.ffprobe as unknown as Mock).mockImplementation(
        (_path: string, _options: string[], callback: (error: Error | null, data: unknown) => void) =>
          callback(null, { format: { duration }, streams: [] }),
      );
    };

    beforeEach(() => {
      vi.mocked(ffmpeg).mockReturnValue(buildMockChain() as any);
      // Default: short video where naive count (50s * 0.5fps = 25) does not exceed maxFrames (50)
      mockProbe(50);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const interval = (intervalSeconds: number) =>
      ({ method: VideoFaceSamplingMethod.Interval, intervalSeconds }) as const;
    const frameCount = () => ({ method: VideoFaceSamplingMethod.FrameCount }) as const;

    it('should call ffmpeg with correct options', async () => {
      const mockChain = buildMockChain();
      vi.mocked(ffmpeg).mockReturnValue(mockChain as any);
      vi.spyOn(fs, 'readdir').mockResolvedValue(['frame_0001.jpg', 'frame_0002.jpg'] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', interval(2), 50);

      expect(vi.mocked(ffmpeg)).toHaveBeenCalledWith('/video.mp4');
      expect(mockChain.outputOptions).toHaveBeenCalledWith(['-vf fps=0.5', '-frames:v 50', '-q:v 3']);
      expect(mockChain.output).toHaveBeenCalledWith('/tmp/frames/frame_%04d.jpg');
      expect(result.effectiveFrameRate).toBe(0.5);
    });

    it('should return sorted frame paths', async () => {
      vi.spyOn(fs, 'readdir').mockResolvedValue(['frame_0002.jpg', 'frame_0001.jpg'] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', interval(2), 50);

      expect(result.framePaths).toEqual(['/tmp/frames/frame_0001.jpg', '/tmp/frames/frame_0002.jpg']);
    });

    it('should sort numerically, not lexicographically, once frame numbers reach 5 digits', async () => {
      // ffmpeg's %04d pattern only pads to a minimum of 4 digits -- a plain string sort would
      // place frame_10000.jpg between frame_1000.jpg and frame_1001.jpg.
      vi.spyOn(fs, 'readdir').mockResolvedValue([
        'frame_10000.jpg',
        'frame_0002.jpg',
        'frame_1001.jpg',
        'frame_1000.jpg',
      ] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', frameCount(), 10_000);

      expect(result.framePaths).toEqual([
        '/tmp/frames/frame_0002.jpg',
        '/tmp/frames/frame_1000.jpg',
        '/tmp/frames/frame_1001.jpg',
        '/tmp/frames/frame_10000.jpg',
      ]);
    });

    it('should filter out non-frame files', async () => {
      vi.spyOn(fs, 'readdir').mockResolvedValue(['frame_0001.jpg', 'other.jpg', 'frame_0002.png'] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', interval(2), 50);

      expect(result.framePaths).toEqual(['/tmp/frames/frame_0001.jpg']);
    });

    it('should return empty array when no frames extracted', async () => {
      vi.spyOn(fs, 'readdir').mockResolvedValue([] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', interval(2), 50);

      expect(result.framePaths).toEqual([]);
    });

    it('should reject with stderr when ffmpeg errors', async () => {
      vi.mocked(ffmpeg).mockReturnValue(buildMockChain('error', 'invalid video stream') as any);

      await expect(sut.extractVideoFrames('/video.mp4', '/tmp/frames', interval(2), 50)).rejects.toThrow(
        'invalid video stream',
      );
    });

    it('should reduce the frame rate when naive frame count exceeds maxFrames', async () => {
      // 100s video at 1fps (1s interval) = 100 frames > maxFrames 50 → 50/100 = 0.5fps
      mockProbe(100);
      const mockChain = buildMockChain();
      vi.mocked(ffmpeg).mockReturnValue(mockChain as any);
      vi.spyOn(fs, 'readdir').mockResolvedValue([] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', interval(1), 50);

      expect(mockChain.outputOptions).toHaveBeenCalledWith(['-vf fps=0.5', '-frames:v 50', '-q:v 3']);
      expect(result.effectiveFrameRate).toBe(0.5);
    });

    it('should not reduce the frame rate when naive frame count exactly equals maxFrames', async () => {
      // 100s video at 0.5fps (2s interval) = exactly 50 frames, not > maxFrames 50, so no reduction
      mockProbe(100);
      const mockChain = buildMockChain();
      vi.mocked(ffmpeg).mockReturnValue(mockChain as any);
      vi.spyOn(fs, 'readdir').mockResolvedValue([] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', interval(2), 50);

      expect(mockChain.outputOptions).toHaveBeenCalledWith(['-vf fps=0.5', '-frames:v 50', '-q:v 3']);
      expect(result.effectiveFrameRate).toBe(0.5);
    });

    it('should spread maxFrames evenly across the video in frameCount mode', async () => {
      // 100s video, maxFrames 50 → 50/100 = 0.5fps, regardless of any interval setting
      mockProbe(100);
      const mockChain = buildMockChain();
      vi.mocked(ffmpeg).mockReturnValue(mockChain as any);
      vi.spyOn(fs, 'readdir').mockResolvedValue([] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', frameCount(), 50);

      expect(mockChain.outputOptions).toHaveBeenCalledWith(['-vf fps=0.5', '-frames:v 50', '-q:v 3']);
      expect(result.effectiveFrameRate).toBe(0.5);
    });

    it('should fall back to 1fps in frameCount mode when duration is unknown', async () => {
      mockProbe(0);
      const mockChain = buildMockChain();
      vi.mocked(ffmpeg).mockReturnValue(mockChain as any);
      vi.spyOn(fs, 'readdir').mockResolvedValue([] as any);

      const result = await sut.extractVideoFrames('/video.mp4', '/tmp/frames', frameCount(), 50);

      expect(result.effectiveFrameRate).toBe(1);
    });
  });
});
