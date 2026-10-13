import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';

export type TranscriptLine = { startMs: number; endMs: number; text: string };

// Keeps each insert well under Postgres's limit of 65535 bind parameters, even for a very long video.
const INSERT_BATCH_SIZE = 1000;

@Injectable()
export class TranscriptRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getByAssetId(assetId: string): Promise<TranscriptLine[]> {
    return this.db
      .selectFrom('asset_transcript')
      .select(['asset_transcript.startMs', 'asset_transcript.endMs', 'asset_transcript.text'])
      .where('asset_transcript.assetId', '=', assetId)
      .orderBy('asset_transcript.startMs', 'asc')
      .execute();
  }

  /** Replaces a video's transcript. The search row is written even when there are no lines, to mark it done. */
  async replace(assetId: string, lines: TranscriptLine[], searchText: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('asset_transcript').where('assetId', '=', assetId).execute();
      for (let i = 0; i < lines.length; i += INSERT_BATCH_SIZE) {
        await trx
          .insertInto('asset_transcript')
          .values(lines.slice(i, i + INSERT_BATCH_SIZE).map((line) => ({ assetId, ...line })))
          .execute();
      }
      await trx
        .insertInto('transcript_search')
        .values({ assetId, text: searchText })
        .onConflict((oc) => oc.column('assetId').doUpdateSet((eb) => ({ text: eb.ref('excluded.text') })))
        .execute();
    });
  }
}
