import { calculateAbsenceAverageCents, sortDebtors } from '@/domain/ledger'
import { SCHOCK_RULE_PROFILE } from '@/domain/rules'
import type {
  AbsencePenaltyMode,
  Actor,
  AppSettingsRecord,
  CashboxSummary,
  DashboardSnapshot,
  HistoryEntry,
  HistoryFilters,
  Player,
  PlayerDebtSummary,
  SessionDetail,
  SessionOverview,
  ThemeId,
  ViewMode,
} from '@/domain/types'
import { nowIso, slugify } from '@/domain/utils'
import { ensureDatabaseReady } from '@/db/bootstrap'
import { sqliteAll, sqliteGet, sqliteRun } from '@/db/client'
import { createId } from '@/services/id'

type RawPlayerDebtRow = {
  player_id: string
  player_name: string
  is_core: number
  is_archived: number
  loss_cents: number
  absence_cents: number
  correction_cents: number
  payment_cents: number
  open_debt_cents: number
}

type RawSessionOverviewRow = {
  id: string
  title: string
  status: 'open' | 'closed'
  stake_cents: number
  started_at: string
  closed_at: string | null
  notes?: string | null
  present_count: number
  loss_count: number
  total_loss_cents: number
  total_absence_cents: number
}

type RawCashboxRow = {
  total_payments_cents: number
  total_outstanding_cents: number
}

function mapPlayerDebtRow(row: RawPlayerDebtRow): PlayerDebtSummary {
  return {
    playerId: row.player_id,
    playerName: row.player_name,
    isCore: Boolean(row.is_core),
    isArchived: Boolean(row.is_archived),
    lossCents: row.loss_cents,
    absenceCents: row.absence_cents,
    correctionCents: row.correction_cents,
    paymentCents: row.payment_cents,
    openDebtCents: row.open_debt_cents,
  }
}

function mapSessionOverviewRow(row: RawSessionOverviewRow): SessionOverview {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    stakeCents: row.stake_cents,
    startedAt: row.started_at,
    closedAt: row.closed_at,
    presentCount: row.present_count,
    lossCount: row.loss_count,
    totalLossCents: row.total_loss_cents,
    totalAbsenceCents: row.total_absence_cents,
  }
}

function getAbsenceChargeNote(input: {
  mode: AbsencePenaltyMode
  presentCoreCount: number
  absentCoreCount: number
}) {
  if (input.mode === 'split_absent') {
    return `Abwesenheitsdurchschnitt aus ${input.presentCoreCount} anwesenden Stammspielern, auf ${input.absentCoreCount} Abwesende verteilt.`
  }

  return `Jeder abwesende Stammspieler erhält den vollen Durchschnitt aus ${input.presentCoreCount} anwesenden Stammspielern.`
}

export function createAuditEvent(input: {
  actorAccountId?: string | null
  eventType: string
  entityType: string
  entityId: string
  sessionId?: string | null
  payload: Record<string, unknown>
}) {
  ensureDatabaseReady()

  sqliteRun(
    `
      INSERT INTO audit_events (
        id,
        actor_account_id,
        event_type,
        entity_type,
        entity_id,
        session_id,
        payload_json,
        created_at
      )
      VALUES ($id, $actorAccountId, $eventType, $entityType, $entityId, $sessionId, $payloadJson, $createdAt)
    `,
    {
      $id: createId('audit'),
      $actorAccountId: input.actorAccountId ?? null,
      $eventType: input.eventType,
      $entityType: input.entityType,
      $entityId: input.entityId,
      $sessionId: input.sessionId ?? null,
      $payloadJson: JSON.stringify(input.payload),
      $createdAt: nowIso(),
    }
  )
}

export function getAppSettings(): AppSettingsRecord {
  ensureDatabaseReady()

  const row = sqliteGet<{
    default_stake_cents: number
    currency: string
    cashbox_label: string
    rule_profile_json: string
    view_mode: string
    theme_id: string
    absence_penalty_mode: string
  }>(
    "SELECT default_stake_cents, currency, cashbox_label, rule_profile_json, view_mode, theme_id, absence_penalty_mode FROM app_settings WHERE id = 'app'"
  )

  if (!row) {
    return {
      defaultStakeCents: 100,
      currency: 'EUR',
      cashboxLabel: 'Getränkekasse',
      ruleProfile: SCHOCK_RULE_PROFILE,
      viewMode: 'basic',
      themeId: 'original',
      absencePenaltyMode: 'full_average',
    }
  }

  return {
    defaultStakeCents: row.default_stake_cents,
    currency: row.currency as 'EUR',
    cashboxLabel: row.cashbox_label,
    ruleProfile: JSON.parse(row.rule_profile_json),
    viewMode: (row.view_mode as ViewMode) ?? 'basic',
    themeId: (row.theme_id as ThemeId) ?? 'original',
    absencePenaltyMode: (row.absence_penalty_mode as AbsencePenaltyMode) ?? 'full_average',
  }
}

export function updateAppSettings(input: {
  actor: Actor
  defaultStakeCents: number
  cashboxLabel: string
  absencePenaltyMode: AbsencePenaltyMode
  viewMode?: ViewMode
}) {
  const sets = [
    'default_stake_cents = $defaultStakeCents',
    'cashbox_label = $cashboxLabel',
    'absence_penalty_mode = $absencePenaltyMode',
    'updated_at = $updatedAt',
  ]
  const params: Record<string, unknown> = {
    $defaultStakeCents: input.defaultStakeCents,
    $cashboxLabel: input.cashboxLabel,
    $absencePenaltyMode: input.absencePenaltyMode,
    $updatedAt: nowIso(),
  }

  if (input.viewMode) {
    sets.push('view_mode = $viewMode')
    params.$viewMode = input.viewMode
  }

  sqliteRun(`UPDATE app_settings SET ${sets.join(', ')} WHERE id = 'app'`, params)

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'settings',
    entityId: 'app',
    eventType: 'settings.updated',
    payload: {
      defaultStakeCents: input.defaultStakeCents,
      cashboxLabel: input.cashboxLabel,
      absencePenaltyMode: input.absencePenaltyMode,
      viewMode: input.viewMode,
    },
  })
}

export function updateViewMode(input: { actor: Actor; viewMode: ViewMode }) {
  sqliteRun(
    `UPDATE app_settings SET view_mode = $viewMode, updated_at = $updatedAt WHERE id = 'app'`,
    {
      $viewMode: input.viewMode,
      $updatedAt: nowIso(),
    }
  )
}

export function updateTheme(input: { actor: Actor; themeId: ThemeId }) {
  sqliteRun(
    `UPDATE app_settings SET theme_id = $themeId, updated_at = $updatedAt WHERE id = 'app'`,
    {
      $themeId: input.themeId,
      $updatedAt: nowIso(),
    }
  )
}

function ensureUniquePlayerSlug(baseName: string) {
  const baseSlug = slugify(baseName) || 'spieler'
  let slug = baseSlug
  let attempt = 1

  while (
    sqliteGet<{ id: string }>('SELECT id FROM players WHERE slug = $slug LIMIT 1', {
      $slug: slug,
    })
  ) {
    attempt += 1
    slug = `${baseSlug}-${attempt}`
  }

  return slug
}

export function createPlayer(input: { name: string; isCore: boolean; actor: Actor }) {
  ensureDatabaseReady()

  const playerId = createId('player')
  const now = nowIso()

  sqliteRun(
    `
      INSERT INTO players (id, name, slug, is_core, is_archived, created_at, updated_at)
      VALUES ($id, $name, $slug, $isCore, 0, $createdAt, $updatedAt)
    `,
    {
      $id: playerId,
      $name: input.name,
      $slug: ensureUniquePlayerSlug(input.name),
      $isCore: input.isCore ? 1 : 0,
      $createdAt: now,
      $updatedAt: now,
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'player',
    entityId: playerId,
    eventType: input.isCore ? 'player.core_created' : 'player.guest_created',
    payload: {
      name: input.name,
      isCore: input.isCore,
    },
  })

  return playerId
}

export function updatePlayerFlags(input: {
  actor: Actor
  playerId: string
  isCore?: boolean
  isArchived?: boolean
}) {
  const existing = sqliteGet<{
    is_core: number
    is_archived: number
  }>('SELECT is_core, is_archived FROM players WHERE id = $playerId LIMIT 1', {
    $playerId: input.playerId,
  })

  if (!existing) {
    throw new Error('Spieler nicht gefunden.')
  }

  const next = {
    isCore: input.isCore ?? Boolean(existing.is_core),
    isArchived: input.isArchived ?? Boolean(existing.is_archived),
  }

  sqliteRun(
    `
      UPDATE players
      SET is_core = $isCore,
          is_archived = $isArchived,
          updated_at = $updatedAt
      WHERE id = $playerId
    `,
    {
      $playerId: input.playerId,
      $isCore: next.isCore ? 1 : 0,
      $isArchived: next.isArchived ? 1 : 0,
      $updatedAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'player',
    entityId: input.playerId,
    eventType: 'player.updated',
    payload: next,
  })
}

export function deletePlayer(input: { actor: Actor; playerId: string }) {
  const existing = sqliteGet<{ name: string }>(
    'SELECT name FROM players WHERE id = $playerId LIMIT 1',
    { $playerId: input.playerId }
  )

  if (!existing) {
    throw new Error('Spieler nicht gefunden.')
  }

  const openAttendance = sqliteGet<{ cnt: number }>(
    `
      SELECT COUNT(*) AS cnt
      FROM session_attendance sa
      INNER JOIN sessions s ON s.id = sa.session_id
      WHERE sa.player_id = $playerId AND s.status = 'open'
    `,
    { $playerId: input.playerId }
  )

  if (openAttendance && openAttendance.cnt > 0) {
    throw new Error(
      'Der Spieler ist einem offenen Spielabend zugeordnet und kann nicht gelöscht werden.'
    )
  }

  sqliteRun('DELETE FROM loss_entries WHERE player_id = $playerId', { $playerId: input.playerId })
  sqliteRun('DELETE FROM absence_charges WHERE player_id = $playerId', {
    $playerId: input.playerId,
  })
  sqliteRun('DELETE FROM payments WHERE player_id = $playerId', { $playerId: input.playerId })
  sqliteRun('DELETE FROM corrections WHERE player_id = $playerId', { $playerId: input.playerId })
  sqliteRun('DELETE FROM session_attendance WHERE player_id = $playerId', {
    $playerId: input.playerId,
  })
  sqliteRun('DELETE FROM players WHERE id = $playerId', { $playerId: input.playerId })

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'player',
    entityId: input.playerId,
    eventType: 'player.deleted',
    payload: {
      name: existing.name,
    },
  })
}

export function listPlayers(): Player[] {
  ensureDatabaseReady()

  return sqliteAll<
    Array<{
      id: string
      name: string
      slug: string
      is_core: number
      is_archived: number
      created_at: string
      updated_at: string
    }>[number]
  >(
    `
      SELECT id, name, slug, is_core, is_archived, created_at, updated_at
      FROM players
      ORDER BY is_archived ASC, is_core DESC, name ASC
    `
  ).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    isCore: Boolean(row.is_core),
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function getDebtSummaries() {
  ensureDatabaseReady()
  const settings = getAppSettings()

  const rows = sqliteAll<RawPlayerDebtRow>(
    `
      WITH loss_totals AS (
        SELECT player_id, SUM(amount_cents) AS total_loss_cents
        FROM loss_entries
        GROUP BY player_id
      ),
      actual_absence_totals AS (
        SELECT player_id, SUM(amount_cents) AS total_absence_cents
        FROM absence_charges
        GROUP BY player_id
      ),
      present_core_counts AS (
        SELECT sa2.session_id, COUNT(*) AS present_core_count
        FROM session_attendance sa2
        INNER JOIN players p2 ON p2.id = sa2.player_id
        INNER JOIN sessions s2 ON s2.id = sa2.session_id
        WHERE sa2.present = 1 AND p2.is_core = 1 AND s2.status = 'open'
        GROUP BY sa2.session_id
      ),
      absent_core_counts AS (
        SELECT sa4.session_id, COUNT(*) AS absent_core_count
        FROM session_attendance sa4
        INNER JOIN players p4 ON p4.id = sa4.player_id
        INNER JOIN sessions s4 ON s4.id = sa4.session_id
        WHERE sa4.present = 0 AND p4.is_core = 1 AND s4.status = 'open'
        GROUP BY sa4.session_id
      ),
      present_core_loss_totals AS (
        SELECT le.session_id, SUM(le.amount_cents) AS total_present_core_loss_cents
        FROM loss_entries le
        INNER JOIN session_attendance sa3 ON sa3.session_id = le.session_id AND sa3.player_id = le.player_id
        INNER JOIN players p3 ON p3.id = le.player_id
        INNER JOIN sessions s3 ON s3.id = le.session_id
        WHERE sa3.present = 1 AND p3.is_core = 1 AND s3.status = 'open' AND le.is_beer_round = 0
        GROUP BY le.session_id
      ),
      pending_absence_totals AS (
        SELECT pending.player_id, SUM(pending.amount_cents) AS total_absence_cents
        FROM (
          SELECT
            sa.player_id,
            CASE
              WHEN $absencePenaltyMode = 'none' THEN 0
              WHEN $absencePenaltyMode = 'split_absent'
                THEN CAST(ROUND(1.0 * COALESCE(pl.total_present_core_loss_cents, 0) / pc.present_core_count / ac.absent_core_count) AS INTEGER)
              ELSE CAST(ROUND(1.0 * COALESCE(pl.total_present_core_loss_cents, 0) / pc.present_core_count) AS INTEGER)
            END AS amount_cents
          FROM session_attendance sa
          INNER JOIN sessions s ON s.id = sa.session_id
          INNER JOIN players absent_player ON absent_player.id = sa.player_id
          INNER JOIN present_core_counts pc ON pc.session_id = sa.session_id
          INNER JOIN absent_core_counts ac ON ac.session_id = sa.session_id
          LEFT JOIN present_core_loss_totals pl ON pl.session_id = sa.session_id
          WHERE s.status = 'open'
            AND sa.present = 0
            AND absent_player.is_core = 1
            AND pc.present_core_count > 0
            AND ac.absent_core_count > 0
            AND COALESCE(pl.total_present_core_loss_cents, 0) > 0
        ) AS pending
        WHERE pending.amount_cents > 0
        GROUP BY pending.player_id
      ),
      correction_totals AS (
        SELECT player_id, SUM(amount_cents) AS total_correction_cents
        FROM corrections
        GROUP BY player_id
      ),
      payment_totals AS (
        SELECT player_id, SUM(amount_cents) AS total_payment_cents
        FROM payments
        GROUP BY player_id
      )
      SELECT
        p.id AS player_id,
        p.name AS player_name,
        p.is_core AS is_core,
        p.is_archived AS is_archived,
        COALESCE(loss_totals.total_loss_cents, 0) AS loss_cents,
        COALESCE(actual_absence_totals.total_absence_cents, 0) + COALESCE(pending_absence_totals.total_absence_cents, 0) AS absence_cents,
        COALESCE(correction_totals.total_correction_cents, 0) AS correction_cents,
        COALESCE(payment_totals.total_payment_cents, 0) AS payment_cents,
        (
          COALESCE(loss_totals.total_loss_cents, 0)
          + COALESCE(actual_absence_totals.total_absence_cents, 0)
          + COALESCE(pending_absence_totals.total_absence_cents, 0)
          + COALESCE(correction_totals.total_correction_cents, 0)
          - COALESCE(payment_totals.total_payment_cents, 0)
        ) AS open_debt_cents
      FROM players p
      LEFT JOIN loss_totals ON loss_totals.player_id = p.id
      LEFT JOIN actual_absence_totals ON actual_absence_totals.player_id = p.id
      LEFT JOIN pending_absence_totals ON pending_absence_totals.player_id = p.id
      LEFT JOIN correction_totals ON correction_totals.player_id = p.id
      LEFT JOIN payment_totals ON payment_totals.player_id = p.id
      ORDER BY open_debt_cents DESC, player_name ASC
    `,
    {
      $absencePenaltyMode: settings.absencePenaltyMode,
    }
  )

  return sortDebtors(rows.map(mapPlayerDebtRow))
}

export function getCashboxSummary(): CashboxSummary {
  const row = sqliteGet<{ total_payments_cents: number }>(
    'SELECT COALESCE(SUM(amount_cents), 0) AS total_payments_cents FROM payments'
  )
  const totalOutstandingCents = getDebtSummaries().reduce(
    (sum, debtor) => sum + debtor.openDebtCents,
    0
  )

  return {
    totalPaymentsCents: row?.total_payments_cents ?? 0,
    totalOutstandingCents,
  }
}

export function getOpenSessionOverview() {
  const row = sqliteGet<RawSessionOverviewRow>(
    "SELECT * FROM v_session_totals WHERE status = 'open' ORDER BY started_at DESC LIMIT 1"
  )

  return row ? mapSessionOverviewRow(row) : null
}

export function listSessionOverviews() {
  const rows = sqliteAll<RawSessionOverviewRow>(
    "SELECT * FROM v_session_totals ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, started_at DESC"
  )

  return rows.map(mapSessionOverviewRow)
}

export function getHistoryEntries(filters: HistoryFilters & { sessionId?: string } = {}) {
  const params: Record<string, unknown> = {}
  const clauses: string[] = []

  if (filters.playerId) {
    params.$playerId = filters.playerId
    clauses.push('player_id = $playerId')
  }

  if (filters.sessionId) {
    params.$sessionId = filters.sessionId
    clauses.push('session_id = $sessionId')
  }

  if (filters.kind === 'audit') {
    clauses.push("kind = 'audit'")
  } else if (filters.kind && filters.kind !== 'all') {
    params.$kind = filters.kind
    clauses.push('kind = $kind')
  } else if (!filters.includeAudit) {
    clauses.push("kind != 'audit'")
  }

  const wrappedWhere = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

  const rows = sqliteAll<
    Array<{
      id: string
      kind: HistoryEntry['kind']
      created_at: string
      player_id: string | null
      player_name: string | null
      amount_cents: number | null
      message: string
      session_id: string | null
      session_title: string | null
      actor_username: string | null
    }>[number]
  >(
    `
      SELECT *
      FROM (
        SELECT
          le.id,
          CASE WHEN le.is_beer_round = 1 THEN 'beerround' ELSE 'loss' END AS kind,
          le.created_at,
          le.player_id,
          p.name AS player_name,
          le.amount_cents,
          CASE WHEN le.is_beer_round = 1 THEN COALESCE(le.note, 'Bierrunde') ELSE COALESCE(le.note, 'Verlust geloggt') END AS message,
          s.id AS session_id,
          s.title AS session_title,
          a.username AS actor_username
        FROM loss_entries le
        INNER JOIN players p ON p.id = le.player_id
        INNER JOIN sessions s ON s.id = le.session_id
        INNER JOIN auth_accounts a ON a.id = le.created_by_account_id

        UNION ALL

        SELECT
          ac.id,
          'absence' AS kind,
          ac.created_at,
          ac.player_id,
          p.name AS player_name,
          ac.amount_cents,
          COALESCE(ac.note, printf('Abwesenheitsdurchschnitt aus %d Stammspielern', ac.average_present_core_count)) AS message,
          s.id AS session_id,
          s.title AS session_title,
          a.username AS actor_username
        FROM absence_charges ac
        INNER JOIN players p ON p.id = ac.player_id
        INNER JOIN sessions s ON s.id = ac.session_id
        INNER JOIN auth_accounts a ON a.id = ac.created_by_account_id

        UNION ALL

        SELECT
          pmt.id,
          'payment' AS kind,
          pmt.created_at,
          pmt.player_id,
          p.name AS player_name,
          pmt.amount_cents,
          COALESCE(pmt.note, 'Zahlung in die Kasse') AS message,
          s.id AS session_id,
          s.title AS session_title,
          a.username AS actor_username
        FROM payments pmt
        INNER JOIN players p ON p.id = pmt.player_id
        LEFT JOIN sessions s ON s.id = pmt.session_id
        INNER JOIN auth_accounts a ON a.id = pmt.created_by_account_id

        UNION ALL

        SELECT
          c.id,
          'correction' AS kind,
          c.created_at,
          c.player_id,
          p.name AS player_name,
          c.amount_cents,
          c.reason AS message,
          s.id AS session_id,
          s.title AS session_title,
          a.username AS actor_username
        FROM corrections c
        INNER JOIN players p ON p.id = c.player_id
        LEFT JOIN sessions s ON s.id = c.session_id
        INNER JOIN auth_accounts a ON a.id = c.created_by_account_id

        UNION ALL

        SELECT
          ae.id,
          'audit' AS kind,
          ae.created_at,
          NULL AS player_id,
          NULL AS player_name,
          NULL AS amount_cents,
          ae.event_type AS message,
          s.id AS session_id,
          s.title AS session_title,
          a.username AS actor_username
        FROM audit_events ae
        LEFT JOIN sessions s ON s.id = ae.session_id
        LEFT JOIN auth_accounts a ON a.id = ae.actor_account_id
      ) AS history
      ${wrappedWhere}
      ORDER BY created_at DESC
      LIMIT 200
    `,
    params
  )

  return rows.map(
    (row): HistoryEntry => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      playerId: row.player_id,
      playerName: row.player_name,
      amountCents: row.amount_cents,
      message: row.message,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      actorUsername: row.actor_username,
    })
  )
}

export function getDashboardSnapshot(): DashboardSnapshot {
  const openSession = getOpenSessionOverview()
  const debtors = getDebtSummaries()
  const cashbox = getCashboxSummary()
  const recentHistory = getHistoryEntries()
  const settings = getAppSettings()

  return {
    openSession,
    debtors: debtors.filter((row) => !row.isArchived || row.openDebtCents !== 0),
    cashbox,
    recentHistory: recentHistory.slice(0, 8),
    settings,
  }
}

export function createSession(input: {
  actor: Actor
  title: string
  notes: string | null
  stakeCents: number
}) {
  const openSession = getOpenSessionOverview()

  if (openSession) {
    throw new Error('Es ist bereits ein offener Spielabend aktiv.')
  }

  const corePlayers = sqliteAll<Array<{ id: string }>[number]>(
    `
      SELECT id
      FROM players
      WHERE is_core = 1 AND is_archived = 0
      ORDER BY name ASC
    `
  )

  const now = nowIso()
  const sessionId = createId('session')

  sqliteRun(
    `
      INSERT INTO sessions (
        id,
        title,
        notes,
        stake_cents,
        status,
        started_at,
        closed_at,
        created_by_account_id,
        created_at,
        updated_at
      )
      VALUES ($id, $title, $notes, $stakeCents, 'open', $startedAt, NULL, $createdByAccountId, $createdAt, $updatedAt)
    `,
    {
      $id: sessionId,
      $title: input.title,
      $notes: input.notes,
      $stakeCents: input.stakeCents,
      $startedAt: now,
      $createdByAccountId: input.actor.accountId,
      $createdAt: now,
      $updatedAt: now,
    }
  )

  for (const player of corePlayers) {
    sqliteRun(
      `
        INSERT INTO session_attendance (id, session_id, player_id, present, created_at, updated_at)
        VALUES ($id, $sessionId, $playerId, 1, $createdAt, $updatedAt)
      `,
      {
        $id: createId('attendance'),
        $sessionId: sessionId,
        $playerId: player.id,
        $createdAt: now,
        $updatedAt: now,
      }
    )
  }

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'session',
    entityId: sessionId,
    sessionId,
    eventType: 'session.created',
    payload: {
      title: input.title,
      stakeCents: input.stakeCents,
      corePlayerCount: corePlayers.length,
    },
  })

  return sessionId
}

export function getSessionDetail(sessionId: string): SessionDetail | null {
  const session = sqliteGet<RawSessionOverviewRow>(
    'SELECT * FROM v_session_totals WHERE id = $sessionId LIMIT 1',
    { $sessionId: sessionId }
  )

  if (!session) {
    return null
  }

  const base = sqliteGet<{ notes: string | null }>(
    'SELECT notes FROM sessions WHERE id = $sessionId',
    {
      $sessionId: sessionId,
    }
  )

  const attendance = sqliteAll<SessionDetail['attendance'][number]>(
    `
      SELECT
        sa.id AS id,
        sa.session_id AS sessionId,
        sa.player_id AS playerId,
        p.name AS playerName,
        p.is_core AS isCore,
        p.is_archived AS isArchived,
        sa.present AS present
      FROM session_attendance sa
      INNER JOIN players p ON p.id = sa.player_id
      WHERE sa.session_id = $sessionId
      ORDER BY p.is_core DESC, p.name ASC
    `,
    { $sessionId: sessionId }
  )

  const lossesRows = sqliteAll<
    Array<{
      id: string
      session_id: string
      player_id: string
      player_name: string
      amount_cents: number
      note: string | null
      is_beer_round: number
      created_at: string
    }>[number]
  >(
    `
      SELECT
        le.id,
        le.session_id,
        le.player_id,
        p.name AS player_name,
        le.amount_cents,
        le.note,
        le.is_beer_round,
        le.created_at
      FROM loss_entries le
      INNER JOIN players p ON p.id = le.player_id
      WHERE le.session_id = $sessionId
      ORDER BY le.created_at DESC
    `,
    { $sessionId: sessionId }
  )

  const absencesRows = sqliteAll<
    Array<{
      id: string
      session_id: string
      player_id: string
      player_name: string
      amount_cents: number
      average_base_loss_cents: number
      average_present_core_count: number
      note: string | null
      created_at: string
    }>[number]
  >(
    `
      SELECT
        ac.id,
        ac.session_id,
        ac.player_id,
        p.name AS player_name,
        ac.amount_cents,
        ac.average_base_loss_cents,
        ac.average_present_core_count,
        ac.note,
        ac.created_at
      FROM absence_charges ac
      INNER JOIN players p ON p.id = ac.player_id
      WHERE ac.session_id = $sessionId
      ORDER BY ac.created_at DESC
    `,
    { $sessionId: sessionId }
  )

  return {
    session: {
      ...mapSessionOverviewRow(session),
      notes: base?.notes ?? null,
    },
    attendance: attendance.map((row) => ({
      ...row,
      isCore: Boolean(row.isCore),
      isArchived: Boolean(row.isArchived),
      present: Boolean(row.present),
    })),
    availablePresentPlayers: attendance
      .filter((row) => Boolean(row.present) && !Boolean(row.isArchived))
      .map((row) => ({
        id: row.playerId,
        name: row.playerName,
        isCore: Boolean(row.isCore),
      })),
    losses: lossesRows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      playerId: row.player_id,
      playerName: row.player_name,
      amountCents: row.amount_cents,
      note: row.note,
      isBeerRound: Boolean(row.is_beer_round),
      createdAt: row.created_at,
    })),
    absences: absencesRows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      playerId: row.player_id,
      playerName: row.player_name,
      amountCents: row.amount_cents,
      averageBaseLossCents: row.average_base_loss_cents,
      averagePresentCoreCount: row.average_present_core_count,
      note: row.note,
      createdAt: row.created_at,
    })),
    timeline: getHistoryEntries({ sessionId }),
  }
}

export function toggleAttendance(input: { actor: Actor; sessionId: string; playerId: string }) {
  const row = sqliteGet<{ id: string; present: number }>(
    `
      SELECT id, present
      FROM session_attendance
      WHERE session_id = $sessionId AND player_id = $playerId
      LIMIT 1
    `,
    {
      $sessionId: input.sessionId,
      $playerId: input.playerId,
    }
  )

  if (!row) {
    throw new Error('Anwesenheitseintrag nicht gefunden.')
  }

  const session = sqliteGet<{ status: string }>(
    'SELECT status FROM sessions WHERE id = $sessionId',
    {
      $sessionId: input.sessionId,
    }
  )

  if (!session || session.status === 'closed') {
    throw new Error('Geschlossene Spielabende können nicht geändert werden.')
  }

  const nextValue = row.present ? 0 : 1

  sqliteRun(
    `
      UPDATE session_attendance
      SET present = $present,
          updated_at = $updatedAt
      WHERE id = $id
    `,
    {
      $id: row.id,
      $present: nextValue,
      $updatedAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'attendance',
    entityId: row.id,
    sessionId: input.sessionId,
    eventType: 'attendance.toggled',
    payload: {
      playerId: input.playerId,
      present: Boolean(nextValue),
    },
  })
}

export function addGuestToSession(input: { actor: Actor; sessionId: string; name: string }) {
  const session = sqliteGet<{ status: string }>(
    'SELECT status FROM sessions WHERE id = $sessionId',
    {
      $sessionId: input.sessionId,
    }
  )

  if (!session || session.status === 'closed') {
    throw new Error('Gäste können nur in offene Spielabende aufgenommen werden.')
  }

  const playerId = createPlayer({
    name: input.name,
    isCore: false,
    actor: input.actor,
  })

  const now = nowIso()
  sqliteRun(
    `
      INSERT INTO session_attendance (id, session_id, player_id, present, created_at, updated_at)
      VALUES ($id, $sessionId, $playerId, 1, $createdAt, $updatedAt)
    `,
    {
      $id: createId('attendance'),
      $sessionId: input.sessionId,
      $playerId: playerId,
      $createdAt: now,
      $updatedAt: now,
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'session',
    entityId: input.sessionId,
    sessionId: input.sessionId,
    eventType: 'session.guest_added',
    payload: {
      playerId,
      name: input.name,
    },
  })
}

export function updateSessionStake(input: { actor: Actor; sessionId: string; stakeCents: number }) {
  const session = sqliteGet<{ status: string }>(
    'SELECT status FROM sessions WHERE id = $sessionId',
    {
      $sessionId: input.sessionId,
    }
  )

  if (!session || session.status === 'closed') {
    throw new Error('Nur offene Spielabende können angepasst werden.')
  }

  sqliteRun(
    `
      UPDATE sessions
      SET stake_cents = $stakeCents,
          updated_at = $updatedAt
      WHERE id = $sessionId
    `,
    {
      $sessionId: input.sessionId,
      $stakeCents: input.stakeCents,
      $updatedAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'session',
    entityId: input.sessionId,
    sessionId: input.sessionId,
    eventType: 'session.stake_updated',
    payload: {
      stakeCents: input.stakeCents,
    },
  })
}

export function addLossEntry(input: {
  actor: Actor
  sessionId: string
  playerId: string
  note: string | null
}) {
  const session = sqliteGet<{ status: string; stake_cents: number }>(
    'SELECT status, stake_cents FROM sessions WHERE id = $sessionId',
    {
      $sessionId: input.sessionId,
    }
  )

  if (!session || session.status === 'closed') {
    throw new Error('Nur offene Spielabende können Verluste aufnehmen.')
  }

  const attendanceRow = sqliteGet<{ present: number }>(
    `
      SELECT present
      FROM session_attendance
      WHERE session_id = $sessionId AND player_id = $playerId
    `,
    {
      $sessionId: input.sessionId,
      $playerId: input.playerId,
    }
  )

  if (!attendanceRow?.present) {
    throw new Error('Verluste können nur für anwesende Spieler geloggt werden.')
  }

  const entryId = createId('loss')

  sqliteRun(
    `
      INSERT INTO loss_entries (id, session_id, player_id, amount_cents, note, created_by_account_id, created_at)
      VALUES ($id, $sessionId, $playerId, $amountCents, $note, $createdByAccountId, $createdAt)
    `,
    {
      $id: entryId,
      $sessionId: input.sessionId,
      $playerId: input.playerId,
      $amountCents: session.stake_cents,
      $note: input.note,
      $createdByAccountId: input.actor.accountId,
      $createdAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'loss',
    entityId: entryId,
    sessionId: input.sessionId,
    eventType: 'loss.logged',
    payload: {
      playerId: input.playerId,
      amountCents: session.stake_cents,
      note: input.note,
    },
  })
}

export function addBeerRoundEntry(input: {
  actor: Actor
  sessionId: string
  playerId: string
  amountCents: number
  note: string | null
}) {
  const session = sqliteGet<{ status: string }>(
    'SELECT status FROM sessions WHERE id = $sessionId',
    {
      $sessionId: input.sessionId,
    }
  )

  if (!session || session.status === 'closed') {
    throw new Error('Nur offene Spielabende können Bierrunden aufnehmen.')
  }

  const attendanceRow = sqliteGet<{ present: number }>(
    `
      SELECT present
      FROM session_attendance
      WHERE session_id = $sessionId AND player_id = $playerId
    `,
    {
      $sessionId: input.sessionId,
      $playerId: input.playerId,
    }
  )

  if (!attendanceRow?.present) {
    throw new Error('Bierrunden können nur für anwesende Spieler gebucht werden.')
  }

  const entryId = createId('loss')

  sqliteRun(
    `
      INSERT INTO loss_entries (id, session_id, player_id, amount_cents, note, is_beer_round, created_by_account_id, created_at)
      VALUES ($id, $sessionId, $playerId, $amountCents, $note, 1, $createdByAccountId, $createdAt)
    `,
    {
      $id: entryId,
      $sessionId: input.sessionId,
      $playerId: input.playerId,
      $amountCents: input.amountCents,
      $note: input.note ?? 'Bierrunde',
      $createdByAccountId: input.actor.accountId,
      $createdAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'loss',
    entityId: entryId,
    sessionId: input.sessionId,
    eventType: 'beerround.logged',
    payload: {
      playerId: input.playerId,
      amountCents: input.amountCents,
      note: input.note,
      isBeerRound: true,
    },
  })
}

export function deleteLastLoss(input: { actor: Actor; sessionId: string; playerId: string }) {
  const session = sqliteGet<{ status: string }>(
    'SELECT status FROM sessions WHERE id = $sessionId',
    { $sessionId: input.sessionId }
  )

  if (!session || session.status === 'closed') {
    throw new Error('Nur offene Spielabende können korrigiert werden.')
  }

  const lastLoss = sqliteGet<{
    id: string
    amount_cents: number
    note: string | null
    is_beer_round: number
  }>(
    `
      SELECT id, amount_cents, note, is_beer_round
      FROM loss_entries
      WHERE session_id = $sessionId AND player_id = $playerId
      ORDER BY created_at DESC
      LIMIT 1
    `,
    {
      $sessionId: input.sessionId,
      $playerId: input.playerId,
    }
  )

  if (!lastLoss) {
    throw new Error('Kein Verlust zum Löschen vorhanden.')
  }

  const lossType = lastLoss.is_beer_round ? 'Bierrunde' : 'Verlust'

  sqliteRun('DELETE FROM loss_entries WHERE id = $id', { $id: lastLoss.id })

  // Insert a negative correction so it shows in the history log
  const correctionId = createId('correction')
  const playerRow = sqliteGet<{ name: string }>('SELECT name FROM players WHERE id = $id', {
    $id: input.playerId,
  })
  sqliteRun(
    `
      INSERT INTO corrections (id, player_id, session_id, amount_cents, reason, created_by_account_id, created_at)
      VALUES ($id, $playerId, $sessionId, $amountCents, $reason, $createdByAccountId, $createdAt)
    `,
    {
      $id: correctionId,
      $playerId: input.playerId,
      $sessionId: input.sessionId,
      $amountCents: -lastLoss.amount_cents,
      $reason: `Korrektur: ${lossType} von ${playerRow?.name ?? 'Spieler'} gelöscht (−${(lastLoss.amount_cents / 100).toFixed(2).replace('.', ',')} €)`,
      $createdByAccountId: input.actor.accountId,
      $createdAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'loss',
    entityId: lastLoss.id,
    sessionId: input.sessionId,
    eventType: lastLoss.is_beer_round ? 'beerround.deleted' : 'loss.deleted',
    payload: {
      playerId: input.playerId,
      amountCents: lastLoss.amount_cents,
      note: lastLoss.note,
      isBeerRound: Boolean(lastLoss.is_beer_round),
      correctionId,
    },
  })
}

export function closeSession(input: { actor: Actor; sessionId: string }) {
  const settings = getAppSettings()
  const session = sqliteGet<{ status: 'open' | 'closed' }>(
    'SELECT status FROM sessions WHERE id = $sessionId',
    {
      $sessionId: input.sessionId,
    }
  )

  if (!session) {
    throw new Error('Spielabend nicht gefunden.')
  }

  if (session.status === 'closed') {
    createAuditEvent({
      actorAccountId: input.actor.accountId,
      entityType: 'session',
      entityId: input.sessionId,
      sessionId: input.sessionId,
      eventType: 'session.close_attempted_already_closed',
      payload: {
        reason: 'session_already_closed',
      },
    })

    return {
      skippedAbsenceCharges: false,
      absenceChargeCount: 0,
      reason: null as 'disabled' | 'no-present-core' | null,
    }
  }

  const attendanceRows = sqliteAll<
    Array<{
      player_id: string
      present: number
      is_core: number
    }>[number]
  >(
    `
      SELECT sa.player_id, sa.present, p.is_core
      FROM session_attendance sa
      INNER JOIN players p ON p.id = sa.player_id
      WHERE sa.session_id = $sessionId
    `,
    { $sessionId: input.sessionId }
  )

  const presentCoreIds = attendanceRows
    .filter((row) => row.present && row.is_core)
    .map((row) => row.player_id)
  const absentCoreIds = attendanceRows
    .filter((row) => !row.present && row.is_core)
    .map((row) => row.player_id)
  const absenceReason =
    absentCoreIds.length === 0
      ? null
      : settings.absencePenaltyMode === 'none'
        ? ('disabled' as const)
        : presentCoreIds.length === 0
          ? ('no-present-core' as const)
          : null
  const skippedAbsenceCharges = absenceReason !== null

  let totalPresentCoreLossCents = 0
  let absenceChargeCount = 0

  if (presentCoreIds.length > 0) {
    const placeholders = presentCoreIds.map((_, index) => `$player${index}`).join(', ')
    const params = Object.fromEntries(presentCoreIds.map((id, index) => [`$player${index}`, id]))
    const rows = sqliteAll<Array<{ amount_cents: number }>[number]>(
      `
        SELECT amount_cents
        FROM loss_entries
        WHERE session_id = $sessionId AND player_id IN (${placeholders}) AND is_beer_round = 0
      `,
      {
        $sessionId: input.sessionId,
        ...params,
      }
    )

    totalPresentCoreLossCents = rows.reduce((sum, row) => sum + row.amount_cents, 0)
  }

  if (!absenceReason && absentCoreIds.length > 0 && totalPresentCoreLossCents > 0) {
    const averageCents = calculateAbsenceAverageCents(
      totalPresentCoreLossCents,
      presentCoreIds.length
    )
    const amountCents =
      settings.absencePenaltyMode === 'split_absent'
        ? Math.round(averageCents / absentCoreIds.length)
        : averageCents
    const createdAt = nowIso()
    absenceChargeCount = absentCoreIds.length
    const note = getAbsenceChargeNote({
      mode: settings.absencePenaltyMode,
      presentCoreCount: presentCoreIds.length,
      absentCoreCount: absentCoreIds.length,
    })

    for (const playerId of absentCoreIds) {
      sqliteRun(
        `
          INSERT INTO absence_charges (
            id,
            session_id,
            player_id,
            amount_cents,
            average_base_loss_cents,
            average_present_core_count,
            note,
            created_by_account_id,
            created_at
          )
          VALUES (
            $id,
            $sessionId,
            $playerId,
            $amountCents,
            $averageBaseLossCents,
            $averagePresentCoreCount,
            $note,
            $createdByAccountId,
            $createdAt
          )
        `,
        {
          $id: createId('absence'),
          $sessionId: input.sessionId,
          $playerId: playerId,
          $amountCents: amountCents,
          $averageBaseLossCents: totalPresentCoreLossCents,
          $averagePresentCoreCount: presentCoreIds.length,
          $note: note,
          $createdByAccountId: input.actor.accountId,
          $createdAt: createdAt,
        }
      )
    }
  }

  const closedAt = nowIso()

  sqliteRun(
    `
      UPDATE sessions
      SET status = 'closed',
          closed_at = $closedAt,
          updated_at = $updatedAt
      WHERE id = $sessionId
    `,
    {
      $sessionId: input.sessionId,
      $closedAt: closedAt,
      $updatedAt: closedAt,
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'session',
    entityId: input.sessionId,
    sessionId: input.sessionId,
    eventType: 'session.closed',
    payload: {
      totalPresentCoreLossCents,
      presentCoreCount: presentCoreIds.length,
      absentCoreCount: absentCoreIds.length,
      absencePenaltyMode: settings.absencePenaltyMode,
      absenceChargeCount,
      absenceChargesSkipped: skippedAbsenceCharges,
      skipReason: absenceReason,
    },
  })

  return {
    skippedAbsenceCharges,
    absenceChargeCount,
    reason: absenceReason,
  }
}

export function recordPayment(input: {
  actor: Actor
  playerId: string
  amountCents: number
  note: string | null
  sessionId?: string | null
}) {
  const paymentId = createId('payment')

  sqliteRun(
    `
      INSERT INTO payments (id, player_id, session_id, amount_cents, note, created_by_account_id, created_at)
      VALUES ($id, $playerId, $sessionId, $amountCents, $note, $createdByAccountId, $createdAt)
    `,
    {
      $id: paymentId,
      $playerId: input.playerId,
      $sessionId: input.sessionId ?? null,
      $amountCents: input.amountCents,
      $note: input.note,
      $createdByAccountId: input.actor.accountId,
      $createdAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'payment',
    entityId: paymentId,
    sessionId: input.sessionId ?? null,
    eventType: 'payment.recorded',
    payload: {
      playerId: input.playerId,
      amountCents: input.amountCents,
      note: input.note,
    },
  })
}

export function recordCorrection(input: {
  actor: Actor
  playerId: string
  amountCents: number
  reason: string
  sessionId?: string | null
}) {
  const correctionId = createId('correction')

  sqliteRun(
    `
      INSERT INTO corrections (id, player_id, session_id, amount_cents, reason, created_by_account_id, created_at)
      VALUES ($id, $playerId, $sessionId, $amountCents, $reason, $createdByAccountId, $createdAt)
    `,
    {
      $id: correctionId,
      $playerId: input.playerId,
      $sessionId: input.sessionId ?? null,
      $amountCents: input.amountCents,
      $reason: input.reason,
      $createdByAccountId: input.actor.accountId,
      $createdAt: nowIso(),
    }
  )

  createAuditEvent({
    actorAccountId: input.actor.accountId,
    entityType: 'correction',
    entityId: correctionId,
    sessionId: input.sessionId ?? null,
    eventType: 'correction.recorded',
    payload: {
      playerId: input.playerId,
      amountCents: input.amountCents,
      reason: input.reason,
    },
  })
}
