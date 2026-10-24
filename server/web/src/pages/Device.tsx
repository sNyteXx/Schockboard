import { useState } from 'react'

import { formatDateTime } from '@/domain/format'

import { ApiError, api } from '../api'
import { Card, Page, SyncStatus } from '../components'
import { useApp } from '../state'

export function DevicePage() {
  const { status, refresh, toast, isAdmin } = useApp()
  const [busy, setBusy] = useState(false)

  async function run(path: string, method: 'POST' | 'DELETE', success: string) {
    setBusy(true)
    try {
      await api(path, { method })
      await refresh()
      toast(success, 'ok')
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Aktion fehlgeschlagen.', 'error')
    } finally {
      setBusy(false)
    }
  }

  function revoke() {
    if (!window.confirm('Gerät trennen? Es kann danach nicht mehr synchronisieren, bis ein neues Gerät zugelassen wird.')) return
    void run('/device/revoke', 'POST', 'Gerät getrennt.')
  }

  const openUntil = status?.enrollmentOpenUntil
  const firstDevice = openUntil === 'first-device'

  return (
    <Page eyebrow="Verbindung" title="Gerät">
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Status">
          <div className="stack">
            <div className="row">
              {status?.paired ? <span className="badge success">verbunden</span> : <span className="badge danger">kein Gerät</span>}
              {status?.deviceLabel ? <span className="muted small">{status.deviceLabel.replace(/^app: /, '')}</span> : null}
              {status?.pairedAt ? <span className="muted small">seit {formatDateTime(status.pairedAt)}</span> : null}
            </div>
            <SyncStatus />
            <div className="muted small">
              Schema-Version: {status?.schemaVersion ?? '—'}
              {status?.snapshotSizeBytes ? ` · Snapshot ${(status.snapshotSizeBytes / 1024).toFixed(0)} KB` : ''}
              {' · '}
              {status?.pendingCommands ?? 0} ausstehende Aufträge
            </div>
            {status?.paired && isAdmin ? (
              <div>
                <button className="btn ghost" onClick={revoke} disabled={busy}>
                  Gerät trennen
                </button>
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Neues Gerät">
          <div className="stack">
            <div className="muted small">
              Die App verbindet sich von selbst mit diesem Server – ohne Kopplung. Angenommen wird immer nur ein Gerät: das allererste automatisch,
              danach nur innerhalb eines kurzen Zeitfensters, das du hier öffnest (z.&nbsp;B. nach Neuinstallation oder Gerätewechsel). Ein neues Gerät
              ersetzt das bisherige.
            </div>
            {firstDevice ? (
              <div className="banner warn small">Noch kein Gerät verbunden – das erste Gerät, das die App startet, wird automatisch übernommen.</div>
            ) : openUntil ? (
              <div className="banner warn small">Anmeldung offen bis {formatDateTime(openUntil)}. Jetzt die App auf dem neuen Gerät öffnen.</div>
            ) : null}
            {!isAdmin ? <div className="banner small">Gerät zulassen oder trennen dürfen nur Administratoren.</div> : null}
            <div className="row" hidden={!isAdmin}>
              {openUntil && !firstDevice ? (
                <button className="btn ghost" onClick={() => run('/device/enrollment', 'DELETE', 'Anmeldung geschlossen.')} disabled={busy}>
                  Anmeldung schließen
                </button>
              ) : !firstDevice ? (
                <button className="btn" onClick={() => run('/device/enrollment', 'POST', 'Neues Gerät für 10 Minuten zugelassen.')} disabled={busy}>
                  Neues Gerät zulassen (10 Min.)
                </button>
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    </Page>
  )
}
