import { useEffect, useState, type FormEvent } from 'react'

import { formatCurrency } from '@/domain/format'
import { parseEuroToCents } from '@/domain/utils'

import { ApiError, queueCommand, type AppSettingsRecord } from '../api'
import { Card, ErrorView, Loading, Page, SyncHint } from '../components'
import { describeCommand, useApi, useApp } from '../state'

const MODES: Array<{ value: AppSettingsRecord['absencePenaltyMode']; label: string; description: string }> = [
  { value: 'full_average', label: 'Voller Durchschnitt', description: 'Jeder abwesende Stammspieler zahlt den Durchschnittsverlust der Anwesenden.' },
  { value: 'split_absent', label: 'Aufgeteilt', description: 'Der Durchschnitt wird auf alle abwesenden Stammspieler verteilt.' },
  { value: 'none', label: 'Keine', description: 'Abwesenheit kostet nichts.' },
]

export function SettingsPage() {
  const { pending, refresh, toast } = useApp()
  const settings = useApi<AppSettingsRecord>('/settings')
  const [form, setForm] = useState({ stake: '', label: '', mode: 'full_average' as AppSettingsRecord['absencePenaltyMode'] })
  const [busy, setBusy] = useState(false)
  const pendingSettings = pending.filter((command) => command.type === 'settings.update')

  useEffect(() => {
    if (settings.data) {
      setForm({
        stake: (settings.data.defaultStakeCents / 100).toFixed(2).replace('.', ','),
        label: settings.data.cashboxLabel,
        mode: settings.data.absencePenaltyMode,
      })
    }
  }, [settings.data])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const defaultStakeCents = parseEuroToCents(form.stake)
      await queueCommand('settings.update', { defaultStakeCents, cashboxLabel: form.label.trim(), absencePenaltyMode: form.mode })
      toast('Einstellungen beauftragt.')
      await refresh()
    } catch (error) {
      toast(error instanceof ApiError || error instanceof Error ? error.message : 'Fehler beim Speichern.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page eyebrow="Spielregeln" title="Einstellungen">
      <SyncHint />
      {settings.error ? <ErrorView error={settings.error} /> : null}
      {!settings.data && settings.loading ? <Loading /> : null}
      {settings.data ? (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <Card title="Ändern">
            <form className="stack" onSubmit={submit}>
              <label className="field">
                Einsatz pro Verlust in €
                <input inputMode="decimal" value={form.stake} onChange={(event) => setForm({ ...form, stake: event.target.value })} required />
              </label>
              <label className="field">
                Name der Kasse
                <input value={form.label} maxLength={60} onChange={(event) => setForm({ ...form, label: event.target.value })} required />
              </label>
              <div className="field">
                <span style={{ fontWeight: 700, fontSize: 14 }}>Abwesenheitsregel</span>
                <div className="stack" style={{ gap: 8 }}>
                  {MODES.map((mode) => (
                    <label key={mode.value} className="checkbox" style={{ alignItems: 'flex-start' }}>
                      <input type="radio" name="mode" checked={form.mode === mode.value} onChange={() => setForm({ ...form, mode: mode.value })} style={{ marginTop: 3 }} />
                      <span>
                        {mode.label}
                        <div className="muted small" style={{ fontWeight: 400 }}>
                          {mode.description}
                        </div>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <button className="btn" disabled={busy || !form.label.trim() || !form.stake}>
                  Änderung beauftragen
                </button>
              </div>
            </form>
          </Card>
          <Card title="Aktuell auf dem Gerät">
            <div className="list">
              <div className="list-item">
                <span className="muted">Einsatz</span>
                <strong>{formatCurrency(settings.data.defaultStakeCents)}</strong>
              </div>
              <div className="list-item">
                <span className="muted">Kasse</span>
                <strong>{settings.data.cashboxLabel}</strong>
              </div>
              <div className="list-item">
                <span className="muted">Abwesenheit</span>
                <strong>{MODES.find((mode) => mode.value === settings.data!.absencePenaltyMode)?.label}</strong>
              </div>
            </div>
            {pendingSettings.length > 0 ? (
              <div className="pending-note" style={{ marginTop: 12 }}>
                {pendingSettings.map((command) => (
                  <span key={command.id} className="badge pending">
                    ausstehend: {describeCommand(command, new Map())}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </Page>
  )
}
