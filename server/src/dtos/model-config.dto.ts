import { createZodDto } from 'nestjs-zod';
import { VideoFaceSamplingMethodSchema, VideoFaceScanModeSchema } from 'src/enum';
import z from 'zod';

const TaskConfigSchema = z
  .object({
    enabled: z.boolean().describe('Whether the task is enabled'),
  })
  .meta({ id: 'TaskConfig' });

const ModelConfigSchema = TaskConfigSchema.extend({
  modelName: z.string().describe('Name of the model to use'),
});

export const CLIPConfigSchema = ModelConfigSchema.meta({ id: 'CLIPConfig' });

export const DuplicateDetectionConfigSchema = TaskConfigSchema.extend({
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0.001)
    .max(0.1)
    .describe('Maximum distance threshold for duplicate detection'),
}).meta({ id: 'DuplicateDetectionConfig' });

export const VideoFacialRecognitionConfigSchema = z
  .object({
    scanMode: VideoFaceScanModeSchema,
    samplingMethod: VideoFaceSamplingMethodSchema,
    maxFrames: z
      .int()
      .min(1)
      .max(10_000)
      .describe(
        'Maximum number of frames to sample per video. Used directly as the frame count in "frameCount" ' +
          'mode, or as a hard safety cap in "interval" mode. A hard ceiling to prevent a single long video ' +
          'from generating an unbounded number of face thumbnails.',
      ),
    intervalSeconds: z
      .number()
      .meta({ format: 'double' })
      .min(0.1)
      .max(60)
      .describe('Seconds between captured frames when samplingMethod is "interval". Supports sub-second precision.'),
  })
  .meta({ id: 'VideoFacialRecognitionConfig' });

export const FacialRecognitionConfigSchema = ModelConfigSchema.extend({
  minScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for face detection'),
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(2)
    .describe('Maximum distance threshold for face recognition'),
  minFaces: z.int().min(1).describe('Minimum number of faces required for recognition'),
  video: VideoFacialRecognitionConfigSchema,
}).meta({ id: 'FacialRecognitionConfig' });

export const OcrConfigSchema = ModelConfigSchema.extend({
  maxResolution: z.int().min(1).describe('Maximum resolution for OCR processing'),
  minDetectionScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for text detection'),
  minRecognitionScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for text recognition'),
}).meta({ id: 'OcrConfig' });

export class CLIPConfig extends createZodDto(CLIPConfigSchema) {}
