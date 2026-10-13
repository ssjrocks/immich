import { Column, ForeignKeyColumn, Index, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

/**
 * A video's whole transcript as one text, for searching: a phrase can span two subtitle lines. Every video
 * whose subtitles have been stored has a row, with empty text when nothing was said, so the row also marks
 * the video as done.
 */
@Table('transcript_search')
@Index({
  name: 'idx_transcript_search_text',
  using: 'gin',
  expression: 'f_unaccent("text") gin_trgm_ops',
})
export class TranscriptSearchTable {
  @ForeignKeyColumn(() => AssetTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    primary: true,
  })
  assetId!: string;

  @Column({ type: 'text' })
  text!: string;
}
