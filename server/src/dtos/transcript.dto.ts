import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const AssetTranscriptLineResponseSchema = z
  .object({
    startMs: z.int().min(0).describe('When the line starts, in milliseconds from the start of the video'),
    endMs: z.int().min(0).describe('When the line ends, in milliseconds from the start of the video'),
    text: z.string().describe('What was said, translated to English'),
  })
  .meta({ id: 'AssetTranscriptLineResponseDto' });

export class AssetTranscriptLineResponseDto extends createZodDto(AssetTranscriptLineResponseSchema) {}
