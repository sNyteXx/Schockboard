import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  appliedAt: text('applied_at').notNull(),
})

export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    isCore: integer('is_core', { mode: 'boolean' }).notNull(),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex('players_slug_idx').on(table.slug),
  })
)

export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastLoginAt: text('last_login_at'),
  },
  (table) => ({
    usernameIdx: uniqueIndex('auth_accounts_username_idx').on(table.username),
  })
)

export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  defaultStakeCents: integer('default_stake_cents').notNull(),
  currency: text('currency').notNull(),
  cashboxLabel: text('cashbox_label').notNull(),
  ruleProfileJson: text('rule_profile_json').notNull(),
  viewMode: text('view_mode').notNull().default('basic'),
  themeId: text('theme_id').notNull().default('original'),
  absencePenaltyMode: text('absence_penalty_mode').notNull().default('full_average'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  notes: text('notes'),
  stakeCents: integer('stake_cents').notNull(),
  status: text('status').$type<'open' | 'closed'>().notNull(),
  startedAt: text('started_at').notNull(),
  closedAt: text('closed_at'),
  createdByAccountId: text('created_by_account_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const sessionAttendance = sqliteTable(
  'session_attendance',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    playerId: text('player_id').notNull(),
    present: integer('present', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    sessionPlayerIdx: uniqueIndex('session_attendance_session_player_idx').on(
      table.sessionId,
      table.playerId
    ),
  })
)

export const lossEntries = sqliteTable('loss_entries', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  playerId: text('player_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  note: text('note'),
  isBeerRound: integer('is_beer_round', { mode: 'boolean' }).notNull().default(false),
  createdByAccountId: text('created_by_account_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const absenceCharges = sqliteTable('absence_charges', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  playerId: text('player_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  averageBaseLossCents: integer('average_base_loss_cents').notNull(),
  averagePresentCoreCount: integer('average_present_core_count').notNull(),
  note: text('note'),
  createdByAccountId: text('created_by_account_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  sessionId: text('session_id'),
  amountCents: integer('amount_cents').notNull(),
  note: text('note'),
  createdByAccountId: text('created_by_account_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const corrections = sqliteTable('corrections', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  sessionId: text('session_id'),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  createdByAccountId: text('created_by_account_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  actorAccountId: text('actor_account_id'),
  eventType: text('event_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  sessionId: text('session_id'),
  payloadJson: text('payload_json').notNull(),
  createdAt: text('created_at').notNull(),
})
