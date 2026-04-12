import { SCHOCK_RULE_PROFILE } from '@/domain/rules'
import { nowIso } from '@/domain/utils'
import { getSqlite, sqliteGet, sqliteRun } from '@/db/client'

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
]

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

    getSqlite().execSync(migration.sql)
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
  }
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
      VALUES ('app', $defaultStakeCents, 'EUR', $cashboxLabel, $ruleProfileJson, 'basic', 'original', 'full_average', $createdAt, $updatedAt)
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
  ensureSettings()
  bootstrapped = true
}

export function resetBootstrapFlag() {
  bootstrapped = false
}
