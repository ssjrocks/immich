import { Column, ForeignKeyColumn, Generated, PrimaryGeneratedColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

/** One line of a video's generated subtitles: what was said, and when. */
@Table('asset_transcript')
export class AssetTranscriptTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  assetId!: string;

  @Column({ type: 'integer' })
  startMs!: number;

  @Column({ type: 'integer' })
  endMs!: number;

  @Column({ type: 'text' })
  text!: string;
}
