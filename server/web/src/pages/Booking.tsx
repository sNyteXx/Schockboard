import { useState, type FormEvent } from 'react'

import { formatCurrency, formatSignedCurrency } from '@/domain/format'
import { parseEuroToCents, parseSignedEuroToCents } from '@/domain/utils'

import { ApiError, queueCommand, type PlayerDebtSummary, type SessionOverview } from '../api'
import { Card, ErrorView, Page, SyncHint } from '../components'
import { useApi, useApp } from '../state'

function PlayerSelect(props: { players: PlayerDebtSummary[]; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      Spieler
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)} required>
        <option value="">Bitte wählen…</option>
        {props.players.map((player) => (
          <option key={player.playerId} value={player.playerId}>
            {player.playerName} – offen {formatCurrency(player.openDebtCents)}
            {player.isArchived ? ' (archiviert)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

export function BookingPage() {
  const { refresh, toast } = useApp()
  const debts = useApi<PlayerDebtSummary[]>('/debts')
  const sessions = useApi<SessionOverview[]>('/sessions')
  const players = [...(debts.data ?? [])].sort((a, b) => a.playerName.localeCompare(b.playerName, 'de'))

  const [payment, setPayment] = useState({ playerId: '', amount: '', note: '' })
  const [correction, setCorrection] = useState({ playerId: '', amount: '', reason: '', sessionId: '' })
  const [busy, setBusy] = useState<'payment' | 'correction' | null>(null)

  async function submit(kind: 'payment' | 'correction', event: FormEvent) {
    event.preventDefault()
    setBusy(kind)
    try {
      if (kind === 'payment') {
        const amountCents = parseEuroToCents(payment.amount)
        if (amountCents <= 0) throw new Error('Zahlung muss positiv sein.')
        await queueCommand('payment.record', { playerId: payment.playerId, amountCents, note: payment.note.trim() || null })
        toast(`Zahlung über ${formatCurrency(amountCents)} beauftragt.`)
        setPayment({ playerId: '', amount: '', note: '' })
      } else {
        const amountCents = parseSignedEuroToCents(correction.amount)
        if (amountCents === 0) throw new Error('Betrag darf nicht 0 sein.')
        await queueCommand('correction.record', {
          playerId: correction.playerId,
          amountCents,
          reason: correction.reason.trim(),
          sessionId: correction.sessionId || null,
        })
        toast(`Korrektur über ${formatSignedCurrency(amountCents)} beauftragt.`)
        setCorrection({ playerId: '', amount: '', reason: '', sessionId: '' })
      }
      await refresh()
    } catch (error) {
      toast(error instanceof ApiError || error instanceof Error ? error.message : 'Fehler beim Speichern.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page eyebrow="Kasse & Ausgleich" title="Buchen">
      <SyncHint />
      {debts.error ? <ErrorView error={debts.error} /> : null}
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Zahlung">
          <form className="stack" onSubmit={(event) => submit('payment', event)}>
            <PlayerSelect players={players} value={payment.playerId} onChange={(playerId) => setPayment({ ...payment, playerId })} />
            <label className="field">
              Betrag in €
              <input inputMode="decimal" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} placeholder="5,00" required />
            </label>
            <label className="field">
              Notiz <span className="hint">optional, z. B. „Bar“ oder „PayPal“</span>
              <input value={payment.note} maxLength={200} onChange={(event) => setPayment({ ...payment, note: event.target.value })} />
            </label>
            <div>
              <button className="btn" disabled={busy !== null || !payment.playerId || !payment.amount}>
                Zahlung beauftragen
              </button>
            </div>
          </form>
        </Card>

        <Card title="Korrektur">
          <form className="stack" onSubmit={(event) => submit('correction', event)}>
            <PlayerSelect players={players} value={correction.playerId} onChange={(playerId) => setCorrection({ ...correction, playerId })} />
            <label className="field">
              Betrag in € <span className="hint">positiv erhöht die Schulden, negativ (z. B. -2,50) senkt sie</span>
              <input inputMode="decimal" value={correction.amount} onChange={(event) => setCorrection({ ...correction, amount: event.target.value })} placeholder="-2,50" required />
            </label>
            <label className="field">
              Grund
              <input value={correction.reason} maxLength={200} onChange={(event) => setCorrection({ ...correction, reason: event.target.value })} required />
            </label>
            <label className="field">
              Spielabend <span className="hint">optional</span>
              <select value={correction.sessionId} onChange={(event) => setCorrection({ ...correction, sessionId: event.target.value })}>
                <option value="">Kein Abend</option>
                {(sessions.data ?? []).map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title} – {new Date(session.startedAt).toLocaleDateString('de-DE')}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button className="btn" disabled={busy !== null || !correction.playerId || !correction.amount || !correction.reason.trim()}>
                Korrektur beauftragen
              </button>
            </div>
          </form>
        </Card>
      </div>
    </Page>
  )
}
