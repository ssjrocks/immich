import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_transcript" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "assetId" uuid NOT NULL,
  "startMs" integer NOT NULL,
  "endMs" integer NOT NULL,
  "text" text NOT NULL,
  CONSTRAINT "asset_transcript_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_transcript_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "asset_transcript_assetId_idx" ON "asset_transcript" ("assetId");`.execute(db);
  await sql`CREATE TABLE "transcript_search" (
  "assetId" uuid NOT NULL,
  "text" text NOT NULL,
  CONSTRAINT "transcript_search_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "transcript_search_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE INDEX "idx_transcript_search_text" ON "transcript_search" USING gin (f_unaccent("text") gin_trgm_ops);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_transcript_search_text', '{"type":"index","name":"idx_transcript_search_text","sql":"CREATE INDEX \\"idx_transcript_search_text\\" ON \\"transcript_search\\" USING gin (f_unaccent(\\"text\\") gin_trgm_ops);"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "asset_transcript";`.execute(db);
  await sql`DROP TABLE "transcript_search";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_transcript_search_text';`.execute(db);
}
