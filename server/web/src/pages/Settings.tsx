import { useEffect, useState, type FormEvent } from 'react'

import { formatCurrency } from '@/domain/format'
import { parseEuroToCents } from '@/domain/utils'

import type { AppSettingsRecord } from '../api'
import { Badge, Button, Card, ErrorView, Field, Notice, Page, SkeletonRows, SyncHint } from '../components'
import { Icon } from '../icons'
import { UndoButton, useQueue } from '../overrides'
import { describeCommand, useApi, useApp } from '../state'

const MODES: Array<{ value: AppSettingsRecord['absencePenaltyMode']; label: string; description: string }> = [
  { value: 'full_average', label: 'Voller Durchschnitt', description: 'Jeder abwesende Stammspieler zahlt den Durchschnittsverlust der Anwesenden.' },
  { value: 'split_absent', label: 'Aufgeteilt', description: 'Der Durchschnitt wird auf alle abwesenden Stammspieler verteilt.' },
  { value: 'none', label: 'Keine', description: 'Abwesenheit kostet nichts.' },
]

export function SettingsPage() {
  const { pending } = useApp()
  const settings = useApi<AppSettingsRecord>('/settings')
  const { run, busy } = useQueue()
  const [form, setForm] = useState({ stake: '', label: '', mode: 'full_average' as AppSettingsRecord['absencePenaltyMode'] })
  const [error, setError] = useState<string | null>(null)
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
    setError(null)
    let defaultStakeCents: number
    try {
      defaultStakeCents = parseEuroToCents(form.stake)
    } catch (problem) {
      setError((problem as Error).message)
      return
    }
    await run('settings.update', { defaultStakeCents, cashboxLabel: form.label.trim(), absencePenaltyMode: form.mode }, 'Einstellungen beauftragt.')
  }

  return (
    <Page title="Einstellungen" icon="settings" context="Spielregeln des ausgewählten Geräts">
      {settings.error ? <ErrorView error={settings.error} /> : null}
      {!settings.data && settings.loading ? (
        <div className="grid two">
          <Card>
            <SkeletonRows rows={4} />
          </Card>
          <Card>
            <SkeletonRows rows={3} />
          </Card>
        </div>
      ) : null}
      {settings.data ? (
        <div className="dash">
          <Card className="span-7" icon="pencil" title="Ändern">
            <form className="form" onSubmit={submit}>
              <div className="form-row">
                <Field label="Einsatz pro Verlust">
                  <span className="amount-input">
                    <input inputMode="decimal" value={form.stake} onChange={(event) => setForm({ ...form, stake: event.target.value })} required />
                    <span className="amount-suffix" aria-hidden>
                      €
                    </span>
                  </span>
                </Field>
                <Field label="Name der Kasse">
                  <input value={form.label} maxLength={60} onChange={(event) => setForm({ ...form, label: event.target.value })} required />
                </Field>
              </div>
              <fieldset className="field">
                <legend className="field-label">Abwesenheitsregel</legend>
                <div className="radio-cards">
                  {MODES.map((mode) => (
                    <label key={mode.value} className={`radio-card ${form.mode === mode.value ? 'selected' : ''}`}>
                      <input type="radio" name="mode" checked={form.mode === mode.value} onChange={() => setForm({ ...form, mode: mode.value })} />
                      <span className="radio-card-title">{mode.label}</span>
                      <span className="radio-card-text">{mode.description}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <div className="form-actions">
                <Button type="submit" variant="primary" icon="check" disabled={busy || !form.label.trim() || !form.stake}>
                  Änderung beauftragen
                </Button>
              </div>
            </form>
          </Card>
          <Card className="span-5" icon="tablet" title="Aktuell auf dem Gerät">
            <dl className="kv">
              <dt>Einsatz</dt>
              <dd className="amount">{formatCurrency(settings.data.defaultStakeCents)}</dd>
              <dt>Kasse</dt>
              <dd>{settings.data.cashboxLabel}</dd>
              <dt>Abwesenheit</dt>
              <dd>{MODES.find((mode) => mode.value === settings.data!.absencePenaltyMode)?.label}</dd>
            </dl>
            {pendingSettings.length > 0 ? (
              <div className="pending-note">
                {pendingSettings.map((command) => (
                  <Badge key={command.id} tone="pending" icon="time">
                    {describeCommand(command, new Map())} · <UndoButton command={command} />
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="card-foot">
                <Icon name="check" size={13} /> Keine ausstehenden Änderungen.
              </div>
            )}
          </Card>
        </div>
      ) : null}
      <SyncHint />
    </Page>
  )
}
