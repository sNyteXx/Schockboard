import { useRef, useState, type FormEvent, type ReactNode } from 'react'

import { formatCurrency, formatDate } from '@/domain/format'
import { parseEuroToCents, parseSignedEuroToCents } from '@/domain/utils'

import { ApiError, cancelCommand, queueCommand, type CommandType, type EntryKind, type StoredCommand } from './api'
import { Badge, Button, Field, IconButton, Notice } from './components'
import { ConfirmDialog, Modal } from './dialog'
import { describeEntryUpdate, describeSessionUpdate, entryKey, ENTRY_KIND_LABELS, useApp, usePendingOverrides } from './state'

export { Drawer, Modal } from './dialog'

/**
 * "Übermacht": silent admin overrides. They queue entry.* / session.* /
 * player.rename commands; the device applies them at its next background
 * sync without audit events or receipts. Pending changes are only shown as
 * hints – the numbers always come from the last snapshot.
 */

export const SILENT_COPY =
  'Wird still beim nächsten Hintergrund-Sync (meist innerhalb von 1–15 Min.) auf dem Gerät übernommen – ohne Eintrag im Protokoll der App und ohne Beleg.'

export function OverrideNotice({ compact = false }: { compact?: boolean }) {
  return (
    <Notice tone="override">
      <strong>Übermacht</strong> {compact ? 'Änderungen werden still übernommen – ohne Protokolleintrag in der App.' : SILENT_COPY}
    </Notice>
  )
}

// ---- queueing ---------------------------------------------------------------

export function useQueue() {
  const { refresh, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  async function run(type: CommandType, payload: Record<string, unknown>, message: string) {
    if (running.current) return false
    running.current = true
    setBusy(true)
    try {
      await queueCommand(type, payload)
      toast(message)
      await refresh()
      return true
    } catch (error) {
      toast(error instanceof ApiError || error instanceof Error ? error.message : 'Fehler beim Speichern.', 'error')
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { run, busy }
}

export function useUndo() {
  const { refresh, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  async function undo(command: StoredCommand) {
    setBusy(command.id)
    try {
      await cancelCommand(command.id)
      toast('Auftrag zurückgenommen.')
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Fehler.', 'error')
    } finally {
      await refresh()
      setBusy(null)
    }
  }
  return { undo, busy }
}

export function UndoButton({ command, label = 'zurücknehmen' }: { command: StoredCommand; label?: string }) {
  const { undo, busy } = useUndo()
  return (
    <button type="button" className="link-btn" disabled={busy === command.id} onClick={() => void undo(command)}>
      {label}
    </button>
  )
}

// ---- bookings ---------------------------------------------------------------

export type BookingRef = {
  kind: EntryKind
  id: string
  amountCents: number
  note: string | null
  /** e.g. "Verlust von Anna" – used in dialogs. */
  description: string
}

export function useEntryPending(kind: EntryKind | null | undefined, id: string) {
  const overrides = usePendingOverrides()
  if (!kind) return { deletion: undefined, updates: [] as StoredCommand[] }
  const key = entryKey(kind, id)
  return { deletion: overrides.entryDeletes.get(key), updates: overrides.entryUpdates.get(key) ?? [] }
}

/** Inline "ausstehend" hints of a booking: pending delete or the new values of pending edits. */
export function EntryPendingBadges({ kind, id }: { kind: EntryKind | null | undefined; id: string }) {
  const { deletion, updates } = useEntryPending(kind, id)
  if (!deletion && updates.length === 0) return null
  return (
    <div className="pending-note">
      {deletion ? (
        <Badge tone="pending" icon="time">
          wird gelöscht · <UndoButton command={deletion} />
        </Badge>
      ) : null}
      {updates.map((command) => (
        <Badge key={command.id} tone="pending" icon="time">
          {describeEntryUpdate(command.payload)} · <UndoButton command={command} />
        </Badge>
      ))}
    </div>
  )
}

const NOTE_LABELS: Record<EntryKind, string> = {
  loss: 'Notiz',
  payment: 'Notiz',
  correction: 'Grund',
  absence: 'Notiz',
  withdrawal: 'Verwendungszweck',
}

/** Kinds whose note may not be empty. */
const NOTE_REQUIRED: Partial<Record<EntryKind, string>> = {
  correction: 'Korrekturen brauchen einen Grund.',
  withdrawal: 'Entnahmen brauchen einen Verwendungszweck.',
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Inline editor for amount and note of one booking (Historie, Abend-Detail).
 * Enter saves, Escape cancels.
 */
export function InlineEntryEditor({ booking, onClose }: { booking: BookingRef; onClose: () => void }) {
  const { run, busy } = useQueue()
  const [amount, setAmount] = useState(centsToInput(booking.amountCents))
  const [note, setNote] = useState(booking.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const signed = booking.kind === 'correction'
  const required = NOTE_REQUIRED[booking.kind]

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const payload: Record<string, unknown> = { kind: booking.kind, entryId: booking.id }
    try {
      const cents = signed ? parseSignedEuroToCents(amount) : parseEuroToCents(amount)
      if (signed && cents === 0) throw new Error('Korrektur darf nicht 0 sein.')
      if (booking.kind === 'withdrawal' && cents <= 0) throw new Error('Entnahme muss größer 0 sein.')
      if (cents !== booking.amountCents) payload.amountCents = cents
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Ungültiger Betrag.')
      return
    }
    const trimmed = note.trim()
    if (trimmed !== (booking.note ?? '').trim()) {
      if (required && !trimmed) {
        setError(required)
        return
      }
      payload.note = trimmed || null
    }
    if (payload.amountCents === undefined && payload.note === undefined) {
      onClose()
      return
    }
    if (await run('entry.update', payload, 'Änderung beauftragt – wird still übernommen.')) onClose()
  }

  return (
    <form
      className="inline-editor"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
      aria-label={`${booking.description} bearbeiten`}
    >
      <Field label={signed ? 'Betrag (±)' : 'Betrag'} className="inline-amount">
        <span className="amount-input">
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required aria-invalid={Boolean(error) || undefined} />
          <span className="amount-suffix" aria-hidden>
            €
          </span>
        </span>
      </Field>
      <Field label={NOTE_LABELS[booking.kind]} className="inline-note">
        <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder={required ? 'Pflichtfeld' : 'leer = keine Notiz'} />
      </Field>
      <div className="inline-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" size="sm" icon="check" disabled={busy}>
          Speichern
        </Button>
      </div>
      {error ? <Notice tone="danger" className="inline-error">{error}</Notice> : null}
      <div className="inline-hint">{signed ? 'Positiv erhöht die Schulden, negativ senkt sie. ' : ''}Still beauftragt, ohne Protokolleintrag in der App.</div>
    </form>
  )
}

export function DeleteEntryDialog({ booking, onClose }: { booking: BookingRef; onClose: () => void }) {
  const { run, busy } = useQueue()
  return (
    <ConfirmDialog
      title="Buchung löschen?"
      tone="danger"
      confirmLabel="Löschen beauftragen"
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        if (await run('entry.delete', { kind: booking.kind, entryId: booking.id }, 'Löschung beauftragt – wird still übernommen.')) onClose()
      }}
    >
      <p>
        <strong>{booking.description}</strong> über <strong className="amount">{formatCurrency(booking.amountCents)}</strong>
        {booking.note ? <span className="muted"> („{booking.note}“)</span> : null} wird endgültig entfernt.
      </p>
      <OverrideNotice />
    </ConfirmDialog>
  )
}

/** Edit (inline) and delete (confirm) buttons of a booking row. */
export function EntryActions({ booking, onEdit }: { booking: BookingRef; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const { deletion } = useEntryPending(booking.kind, booking.id)
  return (
    <>
      <div className="row-actions">
        <IconButton icon="pencil" label={`${booking.description} bearbeiten`} disabled={Boolean(deletion)} onClick={onEdit} />
        <IconButton icon="trash" tone="danger" label={`${booking.description} löschen`} disabled={Boolean(deletion)} onClick={() => setConfirm(true)} />
      </div>
      {confirm ? <DeleteEntryDialog booking={booking} onClose={() => setConfirm(false)} /> : null}
    </>
  )
}

/**
 * One booking line (avatar/icon, title, meta, amount) with inline edit and
 * delete. Used by the history and the evening detail.
 */
export function BookingRow(props: {
  booking: BookingRef | null
  lead: ReactNode
  title: ReactNode
  meta?: ReactNode
  amount: ReactNode
  struck?: boolean
  badges?: ReactNode
  before?: ReactNode
  after?: ReactNode
  highlighted?: boolean
  id?: string
}) {
  const [editing, setEditing] = useState(false)
  const { deletion } = useEntryPending(props.booking?.kind, props.booking?.id ?? '')
  const struck = props.struck || Boolean(deletion)
  return (
    <li className={`list-row booking-row ${struck ? 'struck' : ''} ${editing ? 'editing' : ''} ${props.highlighted ? 'highlight' : ''}`} id={props.id}>
      <div className="list-row-main">
        {props.before}
        <span className="list-lead">{props.lead}</span>
        <div className="list-text">
          <div className="list-title strike">{props.title}</div>
          {props.meta ? <div className="list-meta">{props.meta}</div> : null}
          {props.booking ? <EntryPendingBadges kind={props.booking.kind} id={props.booking.id} /> : null}
          {props.badges}
        </div>
        <div className="list-end">
          <span className="list-value strike">{props.amount}</span>
          {props.booking && !editing ? <EntryActions booking={props.booking} onEdit={() => setEditing(true)} /> : null}
          {props.after}
        </div>
      </div>
      {editing && props.booking ? <InlineEntryEditor booking={props.booking} onClose={() => setEditing(false)} /> : null}
    </li>
  )
}

// ---- evenings ---------------------------------------------------------------

export type SessionRef = { id: string; title: string; startedAt: string; stakeCents: number; bookingCount: number }

export function SessionPendingBadges({ sessionId }: { sessionId: string }) {
  const overrides = usePendingOverrides()
  const deletion = overrides.sessionDeletes.get(sessionId)
  const updates = overrides.sessionUpdates.get(sessionId) ?? []
  if (!deletion && updates.length === 0) return null
  return (
    <div className="pending-note">
      {deletion ? (
        <Badge tone="pending" icon="time">
          Abend wird gelöscht · <UndoButton command={deletion} />
        </Badge>
      ) : null}
      {updates.map((command) => (
        <Badge key={command.id} tone="pending" icon="time">
          {describeSessionUpdate(command.payload)} · <UndoButton command={command} />
        </Badge>
      ))}
    </div>
  )
}

/** Inline editor for title and stake of an evening (header of the detail page). */
export function InlineSessionEditor({ session, onClose }: { session: SessionRef; onClose: () => void }) {
  const { run, busy } = useQueue()
  const [title, setTitle] = useState(session.title)
  const [stake, setStake] = useState(centsToInput(session.stakeCents))
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const payload: Record<string, unknown> = { sessionId: session.id }
    if (title.trim() && title.trim() !== session.title) payload.title = title.trim()
    try {
      const cents = parseEuroToCents(stake)
      if (cents !== session.stakeCents) payload.stakeCents = cents
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Ungültiger Einsatz.')
      return
    }
    if (payload.title === undefined && payload.stakeCents === undefined) {
      onClose()
      return
    }
    if (await run('session.update', payload, 'Änderung des Abends beauftragt.')) onClose()
  }

  return (
    <form
      className="inline-editor session-editor"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <Field label="Titel" className="inline-note">
        <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} required autoFocus />
      </Field>
      <Field label="Einsatz" className="inline-amount">
        <span className="amount-input">
          <input inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} required />
          <span className="amount-suffix" aria-hidden>
            €
          </span>
        </span>
      </Field>
      <div className="inline-actions">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" size="sm" icon="check" disabled={busy}>
          Speichern
        </Button>
      </div>
      {error ? <Notice tone="danger" className="inline-error">{error}</Notice> : null}
      <div className="inline-hint">Ein geänderter Einsatz ändert keine bereits gebuchten Verluste.</div>
    </form>
  )
}

export function DeleteSessionDialog({ session, onClose }: { session: SessionRef; onClose: () => void }) {
  const { run, busy } = useQueue()
  return (
    <ConfirmDialog
      title="Abend löschen?"
      tone="danger"
      confirmLabel="Abend löschen"
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        if (await run('session.delete', { sessionId: session.id }, `Löschung von „${session.title}“ beauftragt.`)) onClose()
      }}
    >
      <p>
        Der Abend <strong>„{session.title}“</strong> vom {formatDate(session.startedAt)} wird mit{' '}
        <strong>
          {session.bookingCount} {session.bookingCount === 1 ? 'Buchung' : 'Buchungen'}
        </strong>{' '}
        (Verluste, Bierrunden, Abwesenheit) und der Anwesenheit endgültig gelöscht. Zahlungen und Korrekturen bleiben erhalten.
      </p>
      <OverrideNotice />
    </ConfirmDialog>
  )
}

// ---- players ------------------------------------------------------------------

export function RenamePendingBadges({ playerId }: { playerId: string }) {
  const overrides = usePendingOverrides()
  const renames = overrides.renames.get(playerId) ?? []
  if (renames.length === 0) return null
  return (
    <div className="pending-note">
      {renames.map((command) => (
        <Badge key={command.id} tone="pending" icon="time">
          heißt künftig „{String(command.payload.name)}“ · <UndoButton command={command} />
        </Badge>
      ))}
    </div>
  )
}

export function RenameDialog({ player, onClose }: { player: { id: string; name: string }; onClose: () => void }) {
  const { run, busy } = useQueue()
  const [name, setName] = useState(player.name)
  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === player.name) return onClose()
    if (await run('player.rename', { playerId: player.id, name: trimmed }, `${player.name} heißt nach dem Sync „${trimmed}“.`)) onClose()
  }
  return (
    <Modal title={`${player.name} umbenennen`} icon="pencil" onClose={onClose} size="sm">
      <form className="form" onSubmit={submit}>
        <Field label="Neuer Name">
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <OverrideNotice compact />
        <div className="form-actions end">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            Umbenennen beauftragen
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export { ENTRY_KIND_LABELS }
