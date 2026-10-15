import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,primaryKey,check} from 'drizzle-orm/sqlite-core';
export const cloudLibraries=sqliteTable('cloud_libraries',{
 ownerId:text('owner_id').primaryKey().notNull(),revision:integer('revision').notNull(),stateJson:text('state_json').notNull(),manifestJson:text('manifest_json').notNull(),updatedAt:text('updated_at').notNull()
},table=>[check('library_revision_positive',sql`${table.revision} >= 1`)]);
export const cloudAssets=sqliteTable('cloud_assets',{
 ownerId:text('owner_id').notNull(),assetId:text('asset_id').notNull(),kind:text('kind').notNull(),mimeType:text('mime_type').notNull(),byteSize:integer('byte_size').notNull(),sha256:text('sha256').notNull(),objectKey:text('object_key').notNull(),createdAt:text('created_at').notNull()
},table=>[primaryKey({columns:[table.ownerId,table.assetId]}),check('asset_kind',sql`${table.kind} IN ('image','audio')`),check('asset_size',sql`${table.byteSize} > 0 AND ${table.byteSize} <= 41943040`),check('asset_digest',sql`length(${table.sha256}) = 64`)]);
