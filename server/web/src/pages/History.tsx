import { useEffect, useMemo, useState } from 'react'

import { formatDate, formatDateTime } from '@/domain/format'

import type { HistoryRow, Player } from '../api'
import { Avatar, Badge, Button, Card, Chips, EmptyState, ErrorView, Field, IconButton, Notice, Page, Segmented, SkeletonRows } from '../components'
import { ConfirmDialog } from '../dialog'
import { KIND_ICONS, KIND_LABELS, KIND_TONES, presentHistory } from '../history-format'
import { Icon } from '../icons'
import { BookingRow, OverrideNotice, useQueue } from '../overrides'
import { Link, pendingAuditRemoval, replaceUrl, useApi, usePendingOverrides, useSearch } from '../state'

export type AuditSelection = { selected: Set<string>; toggle: (id: string) => void }

/** Day headers ("Heute", "Gestern", date) for long lists. */
function dayLabel(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Heute'
  if (date.toDateString() === yesterday.toDateString()) return 'Gestern'
  return formatDate(iso)
}

function HistoryItem({ entry, hideSessionTitle, editable, selection, highlighted }: { entry: HistoryRow; hideSessionTitle: boolean; editable: boolean; selection?: AuditSelection; highlighted?: boolean }) {
  const overrides = usePendingOverrides()
  const isAudit = entry.kind === 'audit'
  const auditRemoval = isAudit ? pendingAuditRemoval(overrides, entry) : undefined
  const [confirmAudit, setConfirmAudit] = useState(false)
  const view = presentHistory(entry)
  const booking =
    editable && entry.entryKind && entry.amountCents !== null
      ? {
          kind: entry.entryKind,
          id: entry.id,
          amountCents: entry.amountCents,
          note: entry.note ?? null,
          description: `${KIND_LABELS[entry.kind]}${entry.playerName ? ` von ${entry.playerName}` : ''}`,
        }
      : null
  return (
    <>
      <BookingRow
        id={`eintrag-${entry.id}`}
        highlighted={highlighted}
        booking={booking}
        struck={Boolean(auditRemoval)}
        before={
          isAudit && editable && selection ? (
            <input
              type="checkbox"
              className="row-check"
              aria-label={`Protokolleintrag „${view.title}“ auswählen`}
              disabled={Boolean(auditRemoval)}
              checked={selection.selected.has(entry.id)}
              onChange={() => selection.toggle(entry.id)}
            />
          ) : null
        }
        lead={
          entry.playerId && entry.playerName ? (
            <Avatar id={entry.playerId} name={entry.playerName} size={30} />
          ) : (
            <span className={`kind-icon tone-${KIND_TONES[entry.kind]}`}>
              <Icon name={KIND_ICONS[entry.kind]} size={15} />
            </span>
          )
        }
        title={
          <>
            {view.title}{' '}
            <Badge tone={KIND_TONES[entry.kind]} icon={KIND_ICONS[entry.kind]}>
              {KIND_LABELS[entry.kind]}
            </Badge>
          </>
        }
        meta={
          <>
            {isAudit ? (view.detail ? `${view.detail} · ` : '') : view.detail.split(' · ').slice(1).join(' · ') ? `${view.detail.split(' · ').slice(1).join(' · ')} · ` : ''}
            <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
            {!hideSessionTitle && entry.sessionTitle && entry.sessionId ? (
              <>
                {' · '}
                <Link to={`/abende/${encodeURIComponent(entry.sessionId)}`}>{entry.sessionTitle}</Link>
              </>
            ) : null}
          </>
        }
        badges={
          auditRemoval ? (
            <div className="pending-note">
              <Badge tone="pending" icon="time">
                wird aus dem App-Protokoll entfernt
              </Badge>
            </div>
          ) : null
        }
        amount={<span className={`amount ${view.amountClass}`}>{view.amount}</span>}
        after={
          isAudit && editable ? (
            <IconButton icon="trash" tone="danger" label="Protokolleintrag löschen" disabled={Boolean(auditRemoval)} onClick={() => setConfirmAudit(true)} />
          ) : null
        }
      />
      {confirmAudit ? <DeleteAuditDialog ids={[entry.id]} onClose={() => setConfirmAudit(false)} /> : null}
    </>
  )
}

export function HistoryList({
  entries,
  hideSessionTitle = false,
  editable = false,
  selection,
  grouped = false,
  highlight,
}: {
  entries: HistoryRow[]
  hideSessionTitle?: boolean
  /** Inline edit/delete (silent override) on booking rows and delete on app-log rows. */
  editable?: boolean
  selection?: AuditSelection
  grouped?: boolean
  highlight?: string | null
}) {
  if (entries.length === 0) return <EmptyState compact icon="time" title="Keine Einträge" text="Für diese Auswahl gibt es keine Buchungen." />
  if (!grouped) {
    return (
      <ul className="list">
        {entries.map((entry) => (
          <HistoryItem key={`${entry.kind}-${entry.id}`} entry={entry} hideSessionTitle={hideSessionTitle} editable={editable} selection={selection} highlighted={entry.id === highlight} />
        ))}
      </ul>
    )
  }
  const groups: Array<{ label: string; entries: HistoryRow[] }> = []
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return (
    <div className="day-groups">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="day-label">{group.label}</h3>
          <ul className="list">
            {group.entries.map((entry) => (
              <HistoryItem key={`${entry.kind}-${entry.id}`} entry={entry} hideSessionTitle={hideSessionTitle} editable={editable} selection={selection} highlighted={entry.id === highlight} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const AUDIT_COPY =
  'Entfernt die Einträge still beim nächsten Hintergrund-Sync aus dem Protokoll der App. Buchungen und Kontostände bleiben unverändert.'

function DeleteAuditDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone?: () => void }) {
  const { run, busy } = useQueue()
  return (
    <ConfirmDialog
      title={ids.length === 1 ? 'Protokolleintrag löschen?' : `${ids.length} Protokolleinträge löschen?`}
      tone="danger"
      confirmLabel="Löschen beauftragen"
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        if (await run('audit.delete', { auditIds: ids }, 'Löschung im App-Protokoll beauftragt.')) {
          onDone?.()
          onClose()
        }
      }}
    >
      <p>{AUDIT_COPY}</p>
    </ConfirmDialog>
  )
}

function PurgeAuditDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useQueue()
  const [mode, setMode] = useState<'all' | 'before'>('all')
  const [date, setDate] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const valid = confirmText.trim().toUpperCase() === 'LEEREN' && (mode === 'all' || Boolean(date))
  return (
    <ConfirmDialog
      title="App-Protokoll leeren?"
      tone="danger"
      confirmLabel="Protokoll leeren"
      busy={busy}
      disabled={!valid}
      onClose={onClose}
      onConfirm={async () => {
        if (!valid) return
        const payload = mode === 'before' ? { before: new Date(`${date}T00:00:00`).toISOString() } : {}
        if (await run('audit.purge', payload, 'Leeren des App-Protokolls beauftragt.')) onClose()
      }}
    >
      <div className="form">
        <Segmented
          label="Umfang"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'Alles' },
            { value: 'before', label: 'Nur vor einem Datum' },
          ]}
        />
        {mode === 'before' ? (
          <Field label="Einträge vor dem">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </Field>
        ) : null}
        <Notice tone="danger">
          {mode === 'all' ? 'Das gesamte Protokoll der App' : 'Alle Protokolleinträge vor diesem Datum'} wird endgültig gelöscht. {AUDIT_COPY}
        </Notice>
        <Field label="Zur Bestätigung „LEEREN“ eingeben">
          <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" data-autofocus />
        </Field>
      </div>
    </ConfirmDialog>
  )
}

const KIND_FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'loss', label: 'Verluste', icon: 'dice' },
  { value: 'beerround', label: 'Bierrunden', icon: 'beer' },
  { value: 'absence', label: 'Abwesenheit', icon: 'person' },
  { value: 'payment', label: 'Zahlungen', icon: 'cash-in' },
  { value: 'correction', label: 'Korrekturen', icon: 'swap-vertical' },
  { value: 'withdrawal', label: 'Entnahmen', icon: 'cash-out' },
] as const

type KindFilter = (typeof KIND_FILTERS)[number]['value']

export function HistoryPage() {
  const search = useSearch()
  const params = new URLSearchParams(search)
  const highlight = params.get('eintrag')
  const [view, setView] = useState<'bookings' | 'audit'>('bookings')
  const [playerId, setPlayerId] = useState(() => params.get('spieler') ?? '')
  const [kind, setKind] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<'delete' | 'purge' | null>(null)
  const players = useApi<Player[]>('/players')
  const apiQuery = new URLSearchParams({ kind: view === 'audit' ? 'audit' : kind, limit: '500' })
  if (playerId && view === 'bookings') apiQuery.set('playerId', playerId)
  const history = useApi<HistoryRow[]>(`/history?${apiQuery.toString()}`)

  useEffect(() => {
    if (!highlight || !history.data) return
    const element = document.getElementById(`eintrag-${highlight}`)
    element?.scrollIntoView({ block: 'center' })
    const timer = setTimeout(() => replaceUrl('/historie'), 4000)
    return () => clearTimeout(timer)
  }, [highlight, history.data])

  const entries = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('de')
    const list = history.data ?? []
    if (!q) return list
    return list.filter((entry) =>
      [entry.playerName, entry.message, entry.note, entry.sessionTitle, KIND_LABELS[entry.kind], entry.actorUsername]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('de')
        .includes(q)
    )
  }, [history.data, query])

  const selection: AuditSelection = {
    selected,
    toggle: (id) =>
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
  }
  const visibleAuditIds = view === 'audit' ? entries.map((entry) => entry.id) : []
  const selectedIds = visibleAuditIds.filter((id) => selected.has(id))
  const selectedPlayer = (players.data ?? []).find((player) => player.id === playerId)

  return (
    <Page
      title="Historie"
      icon="time"
      context={history.data ? `${entries.length} ${view === 'audit' ? 'Protokolleinträge' : 'Buchungen'}${history.data.length >= 500 ? ' (neueste 500)' : ''}` : undefined}
      actions={
        <Segmented
          label="Ansicht"
          size="sm"
          value={view}
          onChange={(next) => {
            setView(next)
            setSelected(new Set())
          }}
          options={[
            { value: 'bookings', label: <><Icon name="receipt" size={14} /> Buchungen</> },
            { value: 'audit', label: <><Icon name="document" size={14} /> App-Protokoll</> },
          ]}
        />
      }
    >
      <Card className="table-card">
        <div className="toolbar">
          <label className="search-field">
            <Icon name="search" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Notiz, Spieler, Abend…" aria-label="Historie durchsuchen" />
          </label>
          {view === 'bookings' ? (
            <>
              <label className={`chip select-chip ${playerId ? 'selected' : ''}`}>
                {selectedPlayer ? <Avatar id={selectedPlayer.id} name={selectedPlayer.name} size={20} /> : <Icon name="person" size={14} />}
                <select value={playerId} onChange={(event) => setPlayerId(event.target.value)} aria-label="Spieler filtern">
                  <option value="">Alle Spieler</option>
                  {(players.data ?? []).map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                      {player.isArchived ? ' (archiviert)' : ''}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={13} />
              </label>
              {playerId ? <IconButton icon="close" label="Spielerfilter entfernen" onClick={() => setPlayerId('')} /> : null}
            </>
          ) : (
            <div className="toolbar-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={visibleAuditIds.length === 0}
                onClick={() => setSelected(selectedIds.length === visibleAuditIds.length ? new Set() : new Set(visibleAuditIds))}
              >
                {selectedIds.length === visibleAuditIds.length && visibleAuditIds.length > 0 ? 'Auswahl aufheben' : 'Alle wählen'}
              </Button>
              <Button variant="danger" size="sm" icon="trash" disabled={selectedIds.length === 0} onClick={() => setDialog('delete')}>
                {selectedIds.length} löschen
              </Button>
              <Button variant="danger" size="sm" icon="alert" onClick={() => setDialog('purge')}>
                Protokoll leeren
              </Button>
            </div>
          )}
        </div>
        {view === 'bookings' ? (
          <div className="toolbar">
            <Chips label="Art der Buchung" value={kind} onChange={setKind} options={KIND_FILTERS.map((filter) => ({ ...filter }))} />
          </div>
        ) : (
          <Notice tone="info">Das App-Protokoll zeigt, was in der App selbst passiert ist. Aufträge aus dem Web hinterlassen hier keine Spuren.</Notice>
        )}
        {history.error ? <ErrorView error={history.error} /> : null}
        {!history.data && history.loading ? <SkeletonRows rows={8} avatar /> : null}
        {history.data ? <HistoryList entries={entries} editable grouped selection={view === 'audit' ? selection : undefined} highlight={highlight} /> : null}
      </Card>
      <OverrideNotice />
      {dialog === 'delete' ? <DeleteAuditDialog ids={selectedIds} onClose={() => setDialog(null)} onDone={() => setSelected(new Set())} /> : null}
      {dialog === 'purge' ? <PurgeAuditDialog onClose={() => setDialog(null)} /> : null}
    </Page>
  )
}
