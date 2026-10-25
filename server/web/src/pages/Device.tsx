import { useState, type FormEvent } from 'react'

import { formatDateTime } from '@/domain/format'

import { ApiError, api, type DeviceSummary } from '../api'
import { Card, DeviceDot, isNewDevice, Page, relativeTime, SyncStatus } from '../components'
import { Modal } from '../overrides'
import { useApp } from '../state'

type Dialog =
  | { kind: 'rename'; device: DeviceSummary }
  | { kind: 'revoke'; device: DeviceSummary }
  | { kind: 'remove'; device: DeviceSummary }
  | { kind: 'clear'; device: DeviceSummary }
  | { kind: 'replace' }

export function DevicePage() {
  const { status, devices, activeDevices, device: selectedId, selectDevice, refresh, toast, isAdmin } = useApp()
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const blocked = devices.filter((device) => device.status === 'blocked')

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await task()
      toast(success, 'ok')
      setDialog(null)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Aktion fehlgeschlagen.', 'error')
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const close = () => setDialog(null)

  return (
    <Page
      eyebrow="Verbindung"
      title="Geräte"
      actions={
        isAdmin && activeDevices.length > 1 ? (
          <button className="btn ghost" onClick={() => setDialog({ kind: 'replace' })}>
            Gerät ersetzen
          </button>
        ) : null
      }
    >
      <div className="banner info small">
        <div>
          <strong>Jedes Gerät ist eine eigene Kasse.</strong> Spieler, Abende und Buchungen eines Geräts sind unabhängig von den anderen – der
          Server führt nichts zusammen. Oben in der Seitenleiste wählst du, welches Gerät du ansiehst; alle Seiten und Aufträge beziehen
          sich auf dieses Gerät. Aufträge übernimmt es still beim nächsten Hintergrund-Sync (meist innerhalb von 1–15 Min.).
        </div>
      </div>

      <Card title={`Aktive Geräte (${activeDevices.length} von höchstens ${status?.maxDevices ?? '–'})`}>
        {activeDevices.length === 0 ? (
          <div className="empty">Noch kein Gerät verbunden. Die App meldet sich beim ersten Start automatisch an.</div>
        ) : null}
        <div className="list">
          {activeDevices.map((device) => (
            <DeviceItem
              key={device.id}
              device={device}
              selected={device.id === selectedId}
              isAdmin={isAdmin}
              busy={busy}
              onSelect={() => selectDevice(device.id)}
              onDialog={(kind) => setDialog({ kind, device })}
            />
          ))}
        </div>
      </Card>

      {status?.paired ? (
        <Card title={`Datenstand von „${status.label ?? ''}“`}>
          <div className="stack">
            <SyncStatus />
            <div className="muted small">
              Schema-Version: {status.schemaVersion ?? '—'}
              {status.snapshotSizeBytes ? ` · Snapshot ${(status.snapshotSizeBytes / 1024).toFixed(0)} KB` : ''}
              {' · '}
              {status.pendingCommands} ausstehende Aufträge
            </div>
          </div>
        </Card>
      ) : null}

      <Card title="Neues Gerät verbinden">
        <div className="stack small">
          <div>
            Keine Kopplung nötig: Jede App, die auf diesen Server zeigt, meldet sich beim ersten Start selbst an und erscheint hier als neues
            Gerät (mit Kennzeichen <span className="badge info">Neu</span> für 24 Stunden) – bis zu {status?.maxDevices ?? '–'} aktive Geräte.
          </div>
          <div className="muted">
            Neu installiert oder Gerät gewechselt? Die App kommt als neues Gerät mit ihrem eigenen Stand. Danach das alte Gerät sperren – oder
            „Gerät ersetzen“ nutzen, dann übernimmt das neue auch den Namen des alten. Ein unbekanntes Gerät? Sofort sperren.
          </div>
          {!isAdmin ? <div className="banner small">Geräte umbenennen, sperren oder entfernen dürfen nur Administratoren.</div> : null}
        </div>
      </Card>

      {blocked.length > 0 ? (
        <Card title="Gesperrte Geräte">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Gesperrte Geräte können nicht mehr synchronisieren; ihre offenen Aufträge wurden storniert. Startet die App dort erneut, meldet sie
            sich als neues Gerät an.
          </div>
          <div className="list">
            {blocked.map((device) => (
              <DeviceItem key={device.id} device={device} isAdmin={isAdmin} busy={busy} onDialog={(kind) => setDialog({ kind, device })} />
            ))}
          </div>
        </Card>
      ) : null}

      {dialog?.kind === 'rename' ? (
        <RenameDialog
          device={dialog.device}
          busy={busy}
          onClose={close}
          onSave={(label) =>
            run(
              () => api(`/devices/${encodeURIComponent(dialog.device.id)}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
              'Gerät umbenannt.'
            )
          }
        />
      ) : null}

      {dialog?.kind === 'revoke' ? (
        <Modal title={`„${dialog.device.label}“ sperren?`} onClose={close} tone="danger">
          <div className="stack">
            <div>
              Das Gerät kann danach nicht mehr synchronisieren
              {dialog.device.pendingCommands > 0 ? `, seine ${dialog.device.pendingCommands} ausstehenden Aufträge werden storniert` : ''}. Sein
              Datenstand ist im Web nicht mehr sichtbar. Die Daten auf dem Gerät selbst bleiben unberührt.
            </div>
            <div className="muted small">Startet die App dort erneut, meldet sie sich als neues Gerät an.</div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost" onClick={close}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn danger solid"
                disabled={busy}
                onClick={() => run(() => api(`/devices/${encodeURIComponent(dialog.device.id)}/revoke`, { method: 'POST' }), 'Gerät gesperrt.')}
              >
                Sperren
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {dialog?.kind === 'remove' ? (
        <Modal title={`„${dialog.device.label}“ entfernen?`} onClose={close} tone="danger">
          <div className="stack">
            <div>Entfernt das gesperrte Gerät mit seinem letzten Datenstand und Auftragsverlauf vom Server. Das lässt sich nicht rückgängig machen.</div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost" onClick={close}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn danger solid"
                disabled={busy}
                onClick={() => run(() => api(`/devices/${encodeURIComponent(dialog.device.id)}`, { method: 'DELETE' }), 'Gerät entfernt.')}
              >
                Entfernen
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {dialog?.kind === 'clear' ? (
        <Modal title={`Auftragsverlauf von „${dialog.device.label}“ leeren?`} onClose={close} tone="danger">
          <div className="stack">
            <div>Alle abgeschlossenen Aufträge (übernommen, abgelehnt, storniert) dieses Geräts werden gelöscht. Ausstehende bleiben erhalten.</div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost" onClick={close}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn danger solid"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api(`/commands?device=${encodeURIComponent(dialog.device.id)}`, { method: 'DELETE' }),
                    'Auftragsverlauf geleert.'
                  )
                }
              >
                Verlauf leeren
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {dialog?.kind === 'replace' ? (
        <ReplaceDialog
          devices={activeDevices}
          busy={busy}
          onClose={close}
          onReplace={(oldId, newId) =>
            run(
              () => api(`/devices/${encodeURIComponent(oldId)}/revoke`, { method: 'POST', body: JSON.stringify({ replacedBy: newId }) }),
              'Altes Gerät gesperrt, Name übernommen.'
            )
          }
        />
      ) : null}
    </Page>
  )
}

function DeviceItem(props: {
  device: DeviceSummary
  selected?: boolean
  isAdmin: boolean
  busy: boolean
  onSelect?: () => void
  onDialog: (kind: 'rename' | 'revoke' | 'remove' | 'clear') => void
}) {
  const { device } = props
  const active = device.status === 'active'
  return (
    <div className={`list-item device-row ${props.selected ? 'selected' : ''}`}>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <DeviceDot device={device} />
          <span className="title">{device.label}</span>
          {active && isNewDevice(device) ? <span className="badge info">Neu</span> : null}
          {active ? null : <span className="badge danger">gesperrt</span>}
          {props.selected ? <span className="badge yellow">ausgewählt</span> : null}
          {device.pendingCommands > 0 ? <span className="badge pending">{device.pendingCommands} ausstehend</span> : null}
        </div>
        <div className="sub">
          {device.label !== device.deviceName ? `${device.deviceName} · ` : ''}
          verbunden seit {formatDateTime(device.pairedAt)}
          {device.revokedAt ? ` · gesperrt ${formatDateTime(device.revokedAt)}` : ''}
        </div>
        <div className="sub">
          zuletzt gesehen {relativeTime(device.lastSeenAt)} · letzter Stand {relativeTime(device.lastSnapshotAt)}
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {active && props.onSelect && !props.selected ? (
          <button className="btn small" onClick={props.onSelect}>
            Ansehen
          </button>
        ) : null}
        {props.isAdmin ? (
          <button className="btn ghost small" disabled={props.busy} onClick={() => props.onDialog('rename')}>
            Umbenennen
          </button>
        ) : null}
        {active ? (
          <button className="btn ghost small" disabled={props.busy} onClick={() => props.onDialog('clear')}>
            Auftragsverlauf leeren
          </button>
        ) : null}
        {props.isAdmin && active ? (
          <button className="btn danger small" disabled={props.busy} onClick={() => props.onDialog('revoke')}>
            Sperren
          </button>
        ) : null}
        {props.isAdmin && !active ? (
          <button className="btn danger small" disabled={props.busy} onClick={() => props.onDialog('remove')}>
            Entfernen
          </button>
        ) : null}
      </div>
    </div>
  )
}

function RenameDialog(props: { device: DeviceSummary; busy: boolean; onClose: () => void; onSave: (label: string) => void }) {
  const [label, setLabel] = useState(props.device.label)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (label.trim()) props.onSave(label.trim())
  }
  return (
    <Modal title="Gerät umbenennen" onClose={props.onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Name im Web (z.&nbsp;B. „Tablet Stammtisch“)
          <input value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} required />
        </label>
        <div className="muted small">Angemeldet als „{props.device.deviceName}“. Der Name gilt nur hier im Web.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={props.onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn" disabled={props.busy || !label.trim()}>
            Speichern
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ReplaceDialog(props: {
  devices: DeviceSummary[]
  busy: boolean
  onClose: () => void
  onReplace: (oldId: string, newId: string) => void
}) {
  const newest = [...props.devices].sort((a, b) => b.pairedAt.localeCompare(a.pairedAt))
  const [newId, setNewId] = useState(newest[0]?.id ?? '')
  const [oldId, setOldId] = useState(props.devices.find((device) => device.id !== newest[0]?.id)?.id ?? '')
  const valid = oldId && newId && oldId !== newId
  return (
    <Modal title="Gerät ersetzen" onClose={props.onClose} tone="danger">
      <div className="stack">
        <div className="small">
          Für eine Neuinstallation oder ein neues Tablet: Das alte Gerät wird gesperrt (seine ausstehenden Aufträge werden storniert), das neue
          übernimmt seinen Namen. Die Daten werden <strong>nicht</strong> zusammengeführt – das neue Gerät zeigt seinen eigenen Stand.
        </div>
        <label className="field">
          Altes Gerät (wird gesperrt)
          <select value={oldId} onChange={(event) => setOldId(event.target.value)}>
            {props.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label} – zuletzt gesehen {relativeTime(device.lastSeenAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Neues Gerät (übernimmt den Namen)
          <select value={newId} onChange={(event) => setNewId(event.target.value)}>
            {newest.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
                {isNewDevice(device) ? ' (neu)' : ''} – verbunden {formatDateTime(device.pairedAt)}
              </option>
            ))}
          </select>
        </label>
        {oldId && oldId === newId ? <div className="banner error small">Bitte zwei verschiedene Geräte wählen.</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={props.onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn danger solid" disabled={props.busy || !valid} onClick={() => props.onReplace(oldId, newId)}>
            Ersetzen
          </button>
        </div>
      </div>
    </Modal>
  )
}
