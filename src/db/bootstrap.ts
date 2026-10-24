import { SCHOCK_RULE_PROFILE } from '@/domain/rules'
import { nowIso } from '@/domain/utils'
import { getSqlite, openScratchDatabase, sqliteGet, sqliteRun } from '@/db/client'

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        is_core INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id TEXT PRIMARY KEY,
        default_stake_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        cashbox_label TEXT NOT NULL,
        rule_profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        stake_cents INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        closed_at TEXT,
        created_by_account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_attendance (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        present INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (session_id, player_id)
      );

      CREATE TABLE IF NOT EXISTS loss_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        amount_cents INTEGER NOT NULL,
        note TEXT,
        created_by_account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS absence_charges (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        amount_cents INTEGER NOT NULL,
        average_base_loss_cents INTEGER NOT NULL,
        average_present_core_count INTEGER NOT NULL,
        note TEXT,
        created_by_account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        amount_cents INTEGER NOT NULL,
        note TEXT,
        created_by_account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS corrections (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        amount_cents INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_by_account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_account_id TEXT REFERENCES auth_accounts(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      DROP VIEW IF EXISTS v_player_debts;
      CREATE VIEW v_player_debts AS
      SELECT
        p.id AS player_id,
        p.name AS player_name,
        p.is_core AS is_core,
        p.is_archived AS is_archived,
        COALESCE(loss_totals.total_loss_cents, 0) AS loss_cents,
        COALESCE(absence_totals.total_absence_cents, 0) AS absence_cents,
        COALESCE(correction_totals.total_correction_cents, 0) AS correction_cents,
        COALESCE(payment_totals.total_payment_cents, 0) AS payment_cents,
        (
          COALESCE(loss_totals.total_loss_cents, 0)
          + COALESCE(absence_totals.total_absence_cents, 0)
          + COALESCE(correction_totals.total_correction_cents, 0)
          - COALESCE(payment_totals.total_payment_cents, 0)
        ) AS open_debt_cents
      FROM players p
      LEFT JOIN (
        SELECT player_id, SUM(amount_cents) AS total_loss_cents
        FROM loss_entries
        GROUP BY player_id
      ) AS loss_totals ON loss_totals.player_id = p.id
      LEFT JOIN (
        SELECT player_id, SUM(amount_cents) AS total_absence_cents
        FROM absence_charges
        GROUP BY player_id
      ) AS absence_totals ON absence_totals.player_id = p.id
      LEFT JOIN (
        SELECT player_id, SUM(amount_cents) AS total_correction_cents
        FROM corrections
        GROUP BY player_id
      ) AS correction_totals ON correction_totals.player_id = p.id
      LEFT JOIN (
        SELECT player_id, SUM(amount_cents) AS total_payment_cents
        FROM payments
        GROUP BY player_id
      ) AS payment_totals ON payment_totals.player_id = p.id;

      DROP VIEW IF EXISTS v_session_totals;
      CREATE VIEW v_session_totals AS
      SELECT
        s.id,
        s.title,
        s.status,
        s.stake_cents,
        s.started_at,
        s.closed_at,
        s.notes,
        COUNT(DISTINCT CASE WHEN sa.present = 1 THEN sa.player_id END) AS present_count,
        COALESCE(le.loss_count, 0) AS loss_count,
        COALESCE(le.total_loss_cents, 0) AS total_loss_cents,
        COALESCE(ac.total_absence_cents, 0) AS total_absence_cents
      FROM sessions s
      LEFT JOIN session_attendance sa ON sa.session_id = s.id
      LEFT JOIN (
        SELECT session_id, COUNT(*) AS loss_count, SUM(amount_cents) AS total_loss_cents
        FROM loss_entries
        GROUP BY session_id
      ) AS le ON le.session_id = s.id
      LEFT JOIN (
        SELECT session_id, SUM(amount_cents) AS total_absence_cents
        FROM absence_charges
        GROUP BY session_id
      ) AS ac ON ac.session_id = s.id
      GROUP BY s.id;

      DROP VIEW IF EXISTS v_cashbox;
      CREATE VIEW v_cashbox AS
      SELECT
        COALESCE((SELECT SUM(amount_cents) FROM payments), 0) AS total_payments_cents,
        COALESCE((SELECT SUM(open_debt_cents) FROM v_player_debts), 0) AS total_outstanding_cents;
    `,
  },
  {
    version: 2,
    name: 'view_mode_and_player_deletion',
    sql: `
      ALTER TABLE app_settings ADD COLUMN view_mode TEXT NOT NULL DEFAULT 'basic';
    `,
  },
  {
    version: 3,
    name: 'theme_support',
    sql: `
      ALTER TABLE app_settings ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'original';
    `,
  },
  {
    version: 4,
    name: 'absence_penalty_mode',
    sql: `
      ALTER TABLE app_settings ADD COLUMN absence_penalty_mode TEXT NOT NULL DEFAULT 'full_average';
    `,
  },
  {
    version: 5,
    name: 'beer_round_flag',
    sql: `
      ALTER TABLE loss_entries ADD COLUMN is_beer_round INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    name: 'normalize_voided_loss_corrections',
    sql: `
      -- Older versions deleted the original loss AND inserted a negative
      -- correction, inadvertently subtracting the amount twice. Only fix
      -- corrections identified by their matching deletion audit event;
      -- genuine manual corrections must be preserved unchanged.
      CREATE TEMP TABLE v6_voided AS
      SELECT c.id, c.player_id, c.session_id, c.amount_cents
      FROM corrections c
      WHERE c.amount_cents < 0
        AND c.id IN (
          SELECT CASE WHEN json_valid(payload_json)
            THEN json_extract(payload_json, '$.correctionId')
            ELSE NULL END
          FROM audit_events
          WHERE event_type IN ('loss.deleted', 'beerround.deleted')
        );

      -- Leave a visible audit trail per neutralized row, so a group that had
      -- already compensated the double deduction manually can spot and
      -- reverse it in the log.
      INSERT INTO audit_events (id, actor_account_id, event_type, entity_type, entity_id, session_id, payload_json, created_at)
      SELECT 'audit_v6_' || id, NULL, 'migration.correction_neutralized', 'correction', id, session_id,
        json_object('playerId', player_id, 'previousAmountCents', amount_cents, 'migration', 6),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM v6_voided;

      UPDATE corrections SET amount_cents = 0 WHERE id IN (SELECT id FROM v6_voided);

      DROP TABLE v6_voided;
    `,
  },
  {
    version: 7,
    name: 'remote_inbox',
    sql: `
      -- Commands queued in the web admin and applied on this device. The
      -- primary key makes applying a command idempotent; 'reported' tracks
      -- whether the server has acknowledged the result yet.
      CREATE TABLE IF NOT EXISTS remote_inbox (
        command_id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
        error TEXT,
        applied_at TEXT NOT NULL,
        reported INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

let bootstrapped = false

function ensureMigrationTable() {
  getSqlite().execSync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
}

function applyMigrations() {
  ensureMigrationTable()
  const row = sqliteGet<{ version: number }>(
    'SELECT MAX(version) AS version FROM schema_migrations'
  )
  const currentVersion = row?.version ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue
    }

    getSqlite().withTransactionSync(() => {
      try {
        getSqlite().execSync(migration.sql)
      } catch (error) {
        // Early builds already created some of these columns under other
        // migration numbers; repairSchema() covers anything still missing.
        if (!/duplicate column name/i.test(error instanceof Error ? error.message : String(error))) throw error
      }
      sqliteRun(
        `
          INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
          VALUES ($version, $name, $appliedAt)
        `,
        {
          $version: migration.version,
          $name: migration.name,
          $appliedAt: nowIso(),
        }
      )
    })
  }
}

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
type SchemaObject = { type: 'table' | 'view' | 'index'; name: string; sql: string | null }

/**
 * Brings the live database up to the reference schema, whatever its
 * migration history claims. Early builds (e.g. 1.0.0 from March 2026)
 * numbered migrations differently, so their schema_migrations says
 * "done" while columns such as app_settings.view_mode are missing.
 *
 * The reference is built by running every migration on an empty in-memory
 * database; missing tables, columns and indexes are added, views recreated.
 * Existing rows are never touched. Returns the list of repairs.
 */
export function repairSchema(): string[] {
  const reference = openScratchDatabase()
  const repairs: string[] = []

  try {
    for (const migration of MIGRATIONS) reference.execSync(migration.sql)

    const db = getSqlite()
    const wanted = reference.getAllSync<SchemaObject>(
      "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'view', 'index') AND name NOT LIKE 'sqlite_%'"
    )
    const present = new Set(
      db.getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'index')").map((row) => row.name)
    )

    db.withTransactionSync(() => {
      for (const table of wanted.filter((object) => object.type === 'table' && object.sql)) {
        if (!present.has(table.name)) {
          db.execSync(table.sql!)
          repairs.push(`table ${table.name}`)
          continue
        }
        const have = new Set(db.getAllSync<ColumnInfo>(`PRAGMA table_info("${table.name}")`).map((column) => column.name))
        for (const column of reference.getAllSync<ColumnInfo>(`PRAGMA table_info("${table.name}")`)) {
          if (have.has(column.name) || column.pk > 0) continue
          // SQLite needs a default to add a NOT NULL column to existing rows.
          const fallback = /INT|REAL|NUM/i.test(column.type) ? '0' : "''"
          const defaultValue = column.dflt_value ?? (column.notnull ? fallback : null)
          db.execSync(
            `ALTER TABLE "${table.name}" ADD COLUMN "${column.name}" ${column.type}` +
              (column.notnull && defaultValue !== null ? ' NOT NULL' : '') +
              (defaultValue !== null ? ` DEFAULT ${defaultValue}` : '')
          )
          repairs.push(`column ${table.name}.${column.name}`)
        }
      }

      for (const index of wanted.filter((object) => object.type === 'index' && object.sql)) {
        if (present.has(index.name)) continue
        db.execSync(index.sql!.replace(/^CREATE (UNIQUE )?INDEX /i, (match) => `${match}IF NOT EXISTS `))
        repairs.push(`index ${index.name}`)
      }

      // Views select specific columns: rebuild them after any repair.
      for (const view of wanted.filter((object) => object.type === 'view' && object.sql)) {
        if (repairs.length === 0 && present.has(view.name)) continue
        db.execSync(`DROP VIEW IF EXISTS "${view.name}"`)
        db.execSync(view.sql!)
        if (!present.has(view.name)) repairs.push(`view ${view.name}`)
      }

      if (repairs.length > 0) {
        sqliteRun(
          `INSERT INTO audit_events (id, actor_account_id, event_type, entity_type, entity_id, session_id, payload_json, created_at)
           VALUES ($id, NULL, 'schema.repaired', 'database', 'schema', NULL, $payload, $createdAt)`,
          { $id: `audit_repair_${Date.now()}`, $payload: JSON.stringify({ repairs }), $createdAt: nowIso() }
        )
      }
    })
  } finally {
    reference.closeSync()
  }

  if (repairs.length > 0) console.warn('[Schockboard] Schema repariert:', repairs.join(', '))
  return repairs
}

function ensureSettings() {
  const existing = sqliteGet<{ id: string }>("SELECT id FROM app_settings WHERE id = 'app' LIMIT 1")

  if (existing) {
    return
  }

  const now = nowIso()

  sqliteRun(
    `
      INSERT INTO app_settings (
        id,
        default_stake_cents,
        currency,
        cashbox_label,
        rule_profile_json,
        view_mode,
        theme_id,
        absence_penalty_mode,
        created_at,
        updated_at
      )
      VALUES ('app', $defaultStakeCents, 'EUR', $cashboxLabel, $ruleProfileJson, 'basic', 'bvb09', 'full_average', $createdAt, $updatedAt)
    `,
    {
      $defaultStakeCents: 100,
      $cashboxLabel: 'Getränkekasse',
      $ruleProfileJson: JSON.stringify(SCHOCK_RULE_PROFILE),
      $createdAt: now,
      $updatedAt: now,
    }
  )
}

export function ensureDatabaseReady() {
  if (bootstrapped) {
    return
  }

  applyMigrations()
  repairSchema()
  ensureSettings()
  bootstrapped = true
}

export function resetBootstrapFlag() {
  bootstrapped = false
}
