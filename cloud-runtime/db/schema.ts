import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,primaryKey,check,index} from 'drizzle-orm/sqlite-core';
export const cloudLibraries=sqliteTable('cloud_libraries',{
 ownerId:text('owner_id').primaryKey().notNull(),revision:integer('revision').notNull(),stateJson:text('state_json').notNull(),manifestJson:text('manifest_json').notNull(),updatedAt:text('updated_at').notNull()
},table=>[check('library_revision_positive',sql`${table.revision} >= 1`)]);
export const cloudAssets=sqliteTable('cloud_assets',{
 ownerId:text('owner_id').notNull(),assetId:text('asset_id').notNull(),kind:text('kind').notNull(),mimeType:text('mime_type').notNull(),byteSize:integer('byte_size').notNull(),sha256:text('sha256').notNull(),objectKey:text('object_key').notNull(),createdAt:text('created_at').notNull()
},table=>[primaryKey({columns:[table.ownerId,table.assetId]}),check('asset_kind',sql`${table.kind} IN ('image','audio')`),check('asset_size',sql`${table.byteSize} > 0 AND ${table.byteSize} <= 41943040`),check('asset_digest',sql`length(${table.sha256}) = 64`)]);
export const autoJobControls=sqliteTable('auto_job_controls',{
 ownerId:text('owner_id').notNull(),jobId:text('job_id').notNull(),stopNonce:text('stop_nonce').notNull(),requestedAt:text('requested_at').notNull()
},table=>[primaryKey({columns:[table.ownerId,table.jobId]})]);
// Family ID/password accounts (migration 0002). Only SHA-256 digests of session tokens,
// recovery codes and throttle scopes are stored; passwords never reach the server.
export const familyAccounts=sqliteTable('family_accounts',{
 id:text('id').primaryKey().notNull(),ownerId:text('owner_id').notNull().unique(),username:text('username').notNull().unique(),displayName:text('display_name').notNull().default(''),passwordHash:text('password_hash').notNull(),recoveryHash:text('recovery_hash').notNull(),passwordChangedAt:text('password_changed_at').notNull(),createdAt:text('created_at').notNull()
},table=>[check('family_owner_prefix',sql`substr(${table.ownerId},1,7) = 'family:'`),check('family_username_length',sql`length(${table.username}) BETWEEN 4 AND 20`),check('family_display_name_length',sql`length(${table.displayName}) <= 20`),check('family_recovery_digest',sql`length(${table.recoveryHash}) = 64`)]);
export const familySessions=sqliteTable('family_sessions',{
 tokenHash:text('token_hash').primaryKey().notNull(),accountId:text('account_id').notNull(),ownerId:text('owner_id').notNull(),createdAt:text('created_at').notNull(),lastSeenAt:text('last_seen_at').notNull(),idleExpiresAt:text('idle_expires_at').notNull(),absoluteExpiresAt:text('absolute_expires_at').notNull()
},table=>[index('family_sessions_account_idx').on(table.accountId),check('family_session_digest',sql`length(${table.tokenHash}) = 64`)]);
export const authThrottle=sqliteTable('auth_throttle',{
 bucket:text('bucket').notNull(),windowStart:integer('window_start').notNull(),count:integer('count').notNull()
},table=>[primaryKey({columns:[table.bucket,table.windowStart]}),check('auth_throttle_bucket_digest',sql`length(${table.bucket}) = 64`),check('auth_throttle_count_positive',sql`${table.count} >= 1`)]);
