import { useId, useState, type FormEvent, type ReactNode } from 'react'

import { formatCurrency, formatSignedCurrency } from '@/domain/format'
import { parseEuroToCents } from '@/domain/utils'

import type { CashboxSummary, PlayerDebtSummary, SessionOverview } from './api'
import { Avatar, Button, Field, Money, Notice, Segmented, Skeleton } from './components'
import { Icon } from './icons'
import { useQueue } from './overrides'
import { useApi, useApp } from './state'

/**
 * Booking forms (Zahlung, Korrektur, Entnahme, Spieler anlegen). The same
 * components render as cards on "Buchen" and inside the quick-action modal
 * (command palette, dashboard buttons). All of them only queue commands.
 */

export type BookingKind = 'payment' | 'correction' | 'withdrawal' | 'player'

export type FormProps = {
  /** Preselected player (payment/correction). */
  playerId?: string
  /** Called after the command was queued. */
  onDone?: () => void
  /** Renders the submit row (cards) – the modal passes its own footer via formId. */
  formId?: string
  hideSubmit?: boolean
}

const euroInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

function QuickAmounts(props: { amounts: Array<{ cents: number; label?: string; disabled?: boolean }>; onPick: (cents: number) => void; current: string }) {
  return (
    <div className="quick-amounts" role="group" aria-label="Schnellbeträge">
      {props.amounts.map((amount) => {
        const value = euroInput(amount.cents)
        return (
          <button
            key={`${amount.label ?? ''}${amount.cents}`}
            type="button"
            className={`chip sm ${props.current === value ? 'selected' : ''}`}
            disabled={amount.disabled}
            onClick={() => props.onPick(amount.cents)}
          >
            {amount.label ?? formatCurrency(amount.cents).replace(',00', '')}
          </button>
        )
      })}
    </div>
  )
}

function AmountInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; invalid?: boolean; describedBy?: string; label?: string }) {
  return (
    <span className={`amount-input ${props.invalid ? 'invalid' : ''}`}>
      <input
        inputMode="decimal"
        autoComplete="off"
        value={props.value}
        placeholder={props.placeholder ?? '0,00'}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        aria-label={props.label}
        required
      />
      <span className="amount-suffix" aria-hidden>
        €
      </span>
    </span>
  )
}

function PlayerSelect(props: { players: PlayerDebtSummary[] | null; value: string; onChange: (value: string) => void }) {
  const selected = props.players?.find((player) => player.playerId === props.value)
  if (!props.players) return <Skeleton height={44} radius={12} />
  return (
    <Field
      label="Spieler"
      hint={
        selected ? (
          <>
            offen <Money cents={selected.openDebtCents} debt />
          </>
        ) : undefined
      }
    >
      <span className="select-with-avatar">
        {selected ? <Avatar id={selected.playerId} name={selected.playerName} size={26} /> : <Icon name="person" size={18} className="select-lead" />}
        <select value={props.value} onChange={(event) => props.onChange(event.target.value)} required>
          <option value="">Bitte wählen…</option>
          {props.players.map((player) => (
            <option key={player.playerId} value={player.playerId}>
              {player.playerName} – offen {formatCurrency(player.openDebtCents)}
              {player.isArchived ? ' (archiviert)' : ''}
            </option>
          ))}
        </select>
      </span>
    </Field>
  )
}

function SubmitRow(props: { hidden?: boolean; disabled: boolean; children: ReactNode }) {
  if (props.hidden) return null
  return (
    <div className="form-actions">
      <Button type="submit" variant="primary" disabled={props.disabled}>
        {props.children}
      </Button>
    </div>
  )
}

function sortedPlayers(data: PlayerDebtSummary[] | null) {
  if (!data) return null
  return [...data].filter((player) => !player.isArchived || player.openDebtCents !== 0).sort((a, b) => a.playerName.localeCompare(b.playerName, 'de'))
}

// ---- Zahlung -----------------------------------------------------------------

export function PaymentForm(props: FormProps) {
  const debts = useApi<PlayerDebtSummary[]>('/debts')
  const players = sortedPlayers(debts.data)
  const { run, busy } = useQueue()
  const [playerId, setPlayerId] = useState(props.playerId ?? '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selected = players?.find((player) => player.playerId === playerId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    let amountCents: number
    try {
      amountCents = parseEuroToCents(amount)
      if (amountCents <= 0) throw new Error('Zahlung muss positiv sein.')
    } catch (problem) {
      setError((problem as Error).message)
      return
    }
    const ok = await run('payment.record', { playerId, amountCents, note: note.trim() || null }, `Zahlung über ${formatCurrency(amountCents)} beauftragt.`)
    if (ok) {
      setAmount('')
      setNote('')
      if (!props.playerId) setPlayerId('')
      props.onDone?.()
    }
  }

  const quick = [
    ...(selected && selected.openDebtCents > 0 ? [{ cents: selected.openDebtCents, label: `Offen ${formatCurrency(selected.openDebtCents)}` }] : []),
    { cents: 500 },
    { cents: 1000 },
    { cents: 2000 },
  ]

  return (
    <form className="form" id={props.formId} onSubmit={submit} noValidate>
      <PlayerSelect players={players} value={playerId} onChange={setPlayerId} />
      <Field label="Betrag">
        <AmountInput value={amount} onChange={setAmount} placeholder="5,00" invalid={Boolean(error)} label="Betrag in Euro" />
      </Field>
      <QuickAmounts amounts={quick} current={amount} onPick={(cents) => setAmount(euroInput(cents))} />
      <Field label="Notiz" hint="optional, z. B. „Bar“ oder „PayPal“">
        <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <SubmitRow hidden={props.hideSubmit} disabled={busy || !playerId || !amount}>
        Zahlung beauftragen
      </SubmitRow>
    </form>
  )
}

// ---- Korrektur -----------------------------------------------------------------

export function CorrectionForm(props: FormProps) {
  const debts = useApi<PlayerDebtSummary[]>('/debts')
  const sessions = useApi<SessionOverview[]>('/sessions')
  const players = sortedPlayers(debts.data)
  const { run, busy } = useQueue()
  const [playerId, setPlayerId] = useState(props.playerId ?? '')
  const [direction, setDirection] = useState<'down' | 'up'>('down')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [error, setError] = useState<string | null>(null)

  let preview: number | null = null
  try {
    preview = amount ? parseEuroToCents(amount) * (direction === 'down' ? -1 : 1) : null
  } catch {
    preview = null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    let amountCents: number
    try {
      amountCents = parseEuroToCents(amount) * (direction === 'down' ? -1 : 1)
      if (amountCents === 0) throw new Error('Betrag darf nicht 0 sein.')
    } catch (problem) {
      setError((problem as Error).message)
      return
    }
    if (!reason.trim()) {
      setError('Korrekturen brauchen einen Grund.')
      return
    }
    const ok = await run(
      'correction.record',
      { playerId, amountCents, reason: reason.trim(), sessionId: sessionId || null },
      `Korrektur über ${formatSignedCurrency(amountCents)} beauftragt.`
    )
    if (ok) {
      setAmount('')
      setReason('')
      setSessionId('')
      if (!props.playerId) setPlayerId('')
      props.onDone?.()
    }
  }

  return (
    <form className="form" id={props.formId} onSubmit={submit} noValidate>
      <PlayerSelect players={players} value={playerId} onChange={setPlayerId} />
      <Segmented
        label="Richtung"
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'down', label: <><Icon name="trending-down" size={15} /> Schulden senken</> },
          { value: 'up', label: <><Icon name="trending-up" size={15} /> Schulden erhöhen</> },
        ]}
      />
      <Field label="Betrag" hint={preview ? <>wird gebucht als <strong className="amount">{formatSignedCurrency(preview)}</strong></> : undefined}>
        <AmountInput value={amount} onChange={setAmount} placeholder="2,50" invalid={Boolean(error)} label="Betrag in Euro" />
      </Field>
      <QuickAmounts amounts={[{ cents: 50 }, { cents: 100 }, { cents: 200 }, { cents: 500 }]} current={amount} onPick={(cents) => setAmount(euroInput(cents))} />
      <Field label="Grund">
        <input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} required placeholder="z. B. Rundungsfehler" />
      </Field>
      <Field label="Spielabend" hint="optional">
        <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
          <option value="">Kein Abend</option>
          {(sessions.data ?? []).map((session) => (
            <option key={session.id} value={session.id}>
              {session.title} – {new Date(session.startedAt).toLocaleDateString('de-DE')}
            </option>
          ))}
        </select>
      </Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <SubmitRow hidden={props.hideSubmit} disabled={busy || !playerId || !amount || !reason.trim()}>
        Korrektur beauftragen
      </SubmitRow>
    </form>
  )
}

// ---- Entnahme --------------------------------------------------------------------

const WITHDRAWAL_NOTES = ['Kasten Bier', 'Getränke', 'Kreide & Deckel', 'Ausflug', 'Trinkgeld']

/** Cash on hand minus already queued withdrawals (the server checks the same). */
export function useAvailableCash() {
  const { pending } = useApp()
  const cashbox = useApi<CashboxSummary>('/cashbox')
  const queued = pending.filter((command) => command.type === 'cashbox.withdraw').reduce((sum, command) => sum + Number(command.payload.amountCents ?? 0), 0)
  return {
    loading: !cashbox.data && cashbox.loading,
    error: cashbox.error,
    cashOnHand: cashbox.data?.cashOnHandCents ?? null,
    queued,
    available: cashbox.data ? cashbox.data.cashOnHandCents - queued : null,
  }
}

export function WithdrawalForm(props: FormProps) {
  const cash = useAvailableCash()
  const { run, busy } = useQueue()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hintId = useId()

  let cents: number | null = null
  try {
    cents = amount ? parseEuroToCents(amount) : null
  } catch {
    cents = null
  }
  const available = cash.available ?? 0
  const tooMuch = cents !== null && cash.available !== null && cents > available

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    let amountCents: number
    try {
      amountCents = parseEuroToCents(amount)
      if (amountCents <= 0) throw new Error('Betrag muss größer 0 sein.')
    } catch (problem) {
      setError((problem as Error).message)
      return
    }
    if (amountCents > available) {
      setError(`In der Kasse sind nur ${formatCurrency(Math.max(0, available))} verfügbar.`)
      return
    }
    if (!note.trim()) {
      setError('Bitte angeben, wofür das Geld entnommen wird.')
      return
    }
    const ok = await run('cashbox.withdraw', { amountCents, note: note.trim() }, `Entnahme über ${formatCurrency(amountCents)} beauftragt.`)
    if (ok) {
      setAmount('')
      setNote('')
      props.onDone?.()
    }
  }

  return (
    <form className="form" id={props.formId} onSubmit={submit} noValidate>
      <div className="cash-available" id={hintId}>
        <Icon name="wallet" size={16} />
        <span>Verfügbar</span>
        {cash.available === null ? <Skeleton width={80} height={18} /> : <strong className="amount">{formatCurrency(Math.max(0, cash.available))}</strong>}
        {cash.queued > 0 ? <span className="subtle-text">({formatCurrency(cash.queued)} bereits beauftragt)</span> : null}
      </div>
      <Field label="Betrag" hint={tooMuch ? <span className="text-danger">Mehr als in der Kasse ist.</span> : 'Spielerkonten bleiben unverändert.'}>
        <AmountInput value={amount} onChange={setAmount} placeholder="12,00" invalid={tooMuch || Boolean(error)} describedBy={hintId} label="Betrag in Euro" />
      </Field>
      <QuickAmounts
        amounts={[500, 1000, 2000, 5000].map((value) => ({ cents: value, disabled: cash.available !== null && value > available }))}
        current={amount}
        onPick={(value) => setAmount(euroInput(value))}
      />
      <Field label="Wofür?">
        <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} required placeholder="z. B. Kasten Bier" list={`${hintId}-notes`} />
      </Field>
      <datalist id={`${hintId}-notes`}>
        {WITHDRAWAL_NOTES.map((entry) => (
          <option key={entry} value={entry} />
        ))}
      </datalist>
      <div className="quick-amounts" role="group" aria-label="Häufige Zwecke">
        {WITHDRAWAL_NOTES.slice(0, 4).map((entry) => (
          <button key={entry} type="button" className={`chip sm ${note === entry ? 'selected' : ''}`} onClick={() => setNote(entry)}>
            {entry}
          </button>
        ))}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <SubmitRow hidden={props.hideSubmit} disabled={busy || !amount || !note.trim() || tooMuch || cash.available === null || available <= 0}>
        Entnahme beauftragen
      </SubmitRow>
    </form>
  )
}

// ---- Spieler anlegen --------------------------------------------------------------

export function CreatePlayerForm(props: FormProps) {
  const { run, busy } = useQueue()
  const [name, setName] = useState('')
  const [isCore, setIsCore] = useState(true)
  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (await run('player.create', { name: trimmed, isCore }, `„${trimmed}“ wird beim nächsten Sync angelegt.`)) {
      setName('')
      props.onDone?.()
    }
  }
  return (
    <form className="form" id={props.formId} onSubmit={submit}>
      <Field label="Name">
        <span className="select-with-avatar">
          {name.trim() ? <Avatar id={`preview:${name.trim()}`} name={name} size={26} muted /> : <Icon name="person" size={18} className="select-lead" />}
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="z. B. Marco" required />
        </span>
      </Field>
      <Segmented
        label="Rolle"
        value={isCore ? 'core' : 'guest'}
        onChange={(value) => setIsCore(value === 'core')}
        options={[
          { value: 'core', label: <><Icon name="star" size={15} /> Stammspieler</> },
          { value: 'guest', label: <><Icon name="person" size={15} /> Gast</> },
        ]}
      />
      <div className="field-hint">Stammspieler zählen für Abwesenheitsgebühren. Die Farbe vergibt die App beim Anlegen.</div>
      <SubmitRow hidden={props.hideSubmit} disabled={busy || !name.trim()}>
        Anlegen beauftragen
      </SubmitRow>
    </form>
  )
}

export const BOOKING_META: Record<BookingKind, { title: string; icon: 'cash-in' | 'swap-vertical' | 'cash-out' | 'person-add'; submit: string; description: string }> = {
  payment: { title: 'Zahlung buchen', icon: 'cash-in', submit: 'Zahlung beauftragen', description: 'Ein Spieler zahlt in die Kasse ein.' },
  correction: { title: 'Korrektur buchen', icon: 'swap-vertical', submit: 'Korrektur beauftragen', description: 'Schulden eines Spielers erhöhen oder senken.' },
  withdrawal: { title: 'Entnahme buchen', icon: 'cash-out', submit: 'Entnahme beauftragen', description: 'Geld aus der Kasse nehmen (z. B. Getränke).' },
  player: { title: 'Spieler anlegen', icon: 'person-add', submit: 'Anlegen beauftragen', description: 'Neuer Stammspieler oder Gast.' },
}

export function BookingFormFor(props: FormProps & { kind: BookingKind }) {
  const { kind, ...rest } = props
  if (kind === 'payment') return <PaymentForm {...rest} />
  if (kind === 'correction') return <CorrectionForm {...rest} />
  if (kind === 'withdrawal') return <WithdrawalForm {...rest} />
  return <CreatePlayerForm {...rest} />
}
