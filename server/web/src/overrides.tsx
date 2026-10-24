import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { formatCurrency, formatDate } from '@/domain/format'
import { parseEuroToCents, parseSignedEuroToCents } from '@/domain/utils'

import { ApiError, cancelCommand, queueCommand, type CommandType, type EntryKind, type StoredCommand } from './api'
import { describeEntryUpdate, describeSessionUpdate, entryKey, ENTRY_KIND_LABELS, useApp, usePendingOverrides } from './state'

/**
 * "Übermacht": silent admin overrides. They queue entry.* / session.* /
 * player.rename commands; the device applies them at its next background
 * sync without audit events or receipts. Pending changes are only shown as
 * hints – the numbers always come from the last snapshot.
 */

export const SILENT_COPY =
  'Wird still beim nächsten Hintergrund-Sync (meist innerhalb von 1–15 Min.) auf dem Gerät übernommen – ohne Eintrag im Protokoll der App und ohne Beleg.'

export function OverrideNotice() {
  return (
    <div className="banner override small">
      <strong>Übermacht</strong>
      <span>{SILENT_COPY}</span>
    </div>
  )
}

// ---- generic dialog & drawer ----------------------------------------------

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; tone?: 'danger' }) {
  useEscape(props.onClose)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button.btn:not(.ghost)')
    first?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <div className="overlay" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div ref={ref} className={`modal ${props.tone ?? ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{props.title}</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

export function Drawer(props: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(props.onClose)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div className="overlay drawer-overlay" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{props.title}</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        {props.children}
      </aside>
    </div>
  )
}

// ---- queueing ---------------------------------------------------------------

export function useQueue() {
  const { refresh, toast } = useApp()
  const [busy, setBusy] = useState(false)
  async function run(type: CommandType, payload: Record<string, unknown>, message: string) {
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
      setBusy(false)
    }
  }
  return { run, busy }
}

function UndoButton({ command }: { command: StoredCommand }) {
  const { refresh, toast } = useApp()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="link-btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await cancelCommand(command.id)
          toast('Auftrag zurückgenommen.')
        } catch (error) {
          toast(error instanceof ApiError ? error.message : 'Fehler.', 'error')
        } finally {
          await refresh()
          setBusy(false)
        }
      }}
    >
      zurücknehmen
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
        <span className="badge pending">
          ausstehend: wird gelöscht <UndoButton command={deletion} />
        </span>
      ) : null}
      {updates.map((command) => (
        <span key={command.id} className="badge pending">
          ausstehend: {describeEntryUpdate(command.payload)} <UndoButton command={command} />
        </span>
      ))}
    </div>
  )
}

export function EntryActions({ booking }: { booking: BookingRef }) {
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const { deletion } = useEntryPending(booking.kind, booking.id)
  return (
    <>
      <div className="row-actions">
        <button type="button" className="btn ghost small" disabled={Boolean(deletion)} onClick={() => setDialog('edit')}>
          Bearbeiten
        </button>
        <button type="button" className="btn danger small" disabled={Boolean(deletion)} onClick={() => setDialog('delete')}>
          Löschen
        </button>
      </div>
      {dialog === 'edit' ? <EditEntryDialog booking={booking} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? <DeleteEntryDialog booking={booking} onClose={() => setDialog(null)} /> : null}
    </>
  )
}

const NOTE_LABELS: Record<EntryKind, string> = {
  loss: 'Notiz',
  payment: 'Notiz',
  correction: 'Grund',
  absence: 'Notiz',
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function EditEntryDialog({ booking, onClose }: { booking: BookingRef; onClose: () => void }) {
  const { run, busy } = useQueue()
  const [amount, setAmount] = useState(centsToInput(booking.amountCents))
  const [note, setNote] = useState(booking.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const signed = booking.kind === 'correction'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const payload: Record<string, unknown> = { kind: booking.kind, entryId: booking.id }
    try {
      const cents = signed ? parseSignedEuroToCents(amount) : parseEuroToCents(amount)
      if (signed && cents === 0) throw new Error('Korrektur darf nicht 0 sein.')
      if (cents !== booking.amountCents) payload.amountCents = cents
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Ungültiger Betrag.')
      return
    }
    const trimmed = note.trim()
    if (trimmed !== (booking.note ?? '').trim()) {
      if (signed && !trimmed) {
        setError('Korrekturen brauchen einen Grund.')
        return
      }
      payload.note = trimmed || null
    }
    if (payload.amountCents === undefined && payload.note === undefined) {
      setError('Nichts geändert.')
      return
    }
    if (await run('entry.update', payload, 'Änderung beauftragt – wird still übernommen.')) onClose()
  }

  return (
    <Modal title={`${ENTRY_KIND_LABELS[booking.kind]} bearbeiten`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="muted small">
          {booking.description} · aktuell {formatCurrency(booking.amountCents)}
        </div>
        <label className="field">
          Betrag in €{signed ? <span className="hint">positiv erhöht die Schulden, negativ senkt sie</span> : null}
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="field">
          {NOTE_LABELS[booking.kind]}
          {signed ? null : <span className="hint">leer lassen entfernt die Notiz</span>}
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error ? <div className="banner error small">{error}</div> : null}
        <OverrideNotice />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn" disabled={busy}>
            Änderung beauftragen
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteEntryDialog({ booking, onClose }: { booking: BookingRef; onClose: () => void }) {
  const { run, busy } = useQueue()
  return (
    <Modal title="Buchung löschen?" onClose={onClose} tone="danger">
      <div className="stack">
        <div>
          <strong>{booking.description}</strong> über <strong className="amount">{formatCurrency(booking.amountCents)}</strong>
          {booking.note ? <span className="muted"> („{booking.note}“)</span> : null} wird endgültig entfernt.
        </div>
        <OverrideNotice />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn danger solid"
            disabled={busy}
            onClick={async () => {
              if (await run('entry.delete', { kind: booking.kind, entryId: booking.id }, 'Löschung beauftragt – wird still übernommen.')) onClose()
            }}
          >
            Löschen beauftragen
          </button>
        </div>
      </div>
    </Modal>
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
        <span className="badge pending">
          ausstehend: Abend wird gelöscht <UndoButton command={deletion} />
        </span>
      ) : null}
      {updates.map((command) => (
        <span key={command.id} className="badge pending">
          ausstehend: {describeSessionUpdate(command.payload)} <UndoButton command={command} />
        </span>
      ))}
    </div>
  )
}

export function SessionActions({ session }: { session: SessionRef }) {
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const overrides = usePendingOverrides()
  const deleting = overrides.sessionDeletes.has(session.id)
  return (
    <>
      <button type="button" className="btn ghost" disabled={deleting} onClick={() => setDialog('edit')}>
        Abend bearbeiten
      </button>
      <button type="button" className="btn danger" disabled={deleting} onClick={() => setDialog('delete')}>
        Abend löschen
      </button>
      {dialog === 'edit' ? <EditSessionDialog session={session} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? <DeleteSessionDialog session={session} onClose={() => setDialog(null)} /> : null}
    </>
  )
}

function EditSessionDialog({ session, onClose }: { session: SessionRef; onClose: () => void }) {
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
      setError('Nichts geändert.')
      return
    }
    if (await run('session.update', payload, 'Änderung des Abends beauftragt.')) onClose()
  }

  return (
    <Modal title="Abend bearbeiten" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Titel
          <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="field">
          Einsatz in € <span className="hint">ändert keine bereits gebuchten Verluste</span>
          <input inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} required />
        </label>
        {error ? <div className="banner error small">{error}</div> : null}
        <OverrideNotice />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn" disabled={busy}>
            Änderung beauftragen
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteSessionDialog({ session, onClose }: { session: SessionRef; onClose: () => void }) {
  const { run, busy } = useQueue()
  return (
    <Modal title="Abend löschen?" onClose={onClose} tone="danger">
      <div className="stack">
        <div>
          Der Abend <strong>„{session.title}“</strong> vom {formatDate(session.startedAt)} wird mit{' '}
          <strong>
            {session.bookingCount} {session.bookingCount === 1 ? 'Buchung' : 'Buchungen'}
          </strong>{' '}
          (Verluste, Bierrunden, Abwesenheit) und der Anwesenheit endgültig gelöscht. Zahlungen und Korrekturen bleiben erhalten.
        </div>
        <OverrideNotice />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn danger solid"
            disabled={busy}
            onClick={async () => {
              if (await run('session.delete', { sessionId: session.id }, `Löschung von „${session.title}“ beauftragt.`)) onClose()
            }}
          >
            Abend löschen
          </button>
        </div>
      </div>
    </Modal>
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
        <span key={command.id} className="badge pending">
          ausstehend: heißt künftig „{String(command.payload.name)}“ <UndoButton command={command} />
        </span>
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
    <Modal title={`${player.name} umbenennen`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Neuer Name
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
        </label>
        <OverrideNotice />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn" disabled={busy || !name.trim()}>
            Umbenennen beauftragen
          </button>
        </div>
      </form>
    </Modal>
  )
}
