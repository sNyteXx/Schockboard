import { ConnectionsPanel } from './Connections'
import { useState, type FormEvent } from 'react'

import { formatDateTime } from '@/domain/format'

import { ApiError, api, type DeviceSummary } from '../api'
import { Badge, Button, Card, DeviceDot, EmptyState, Field, isNewDevice, Notice, Page, relativeTime, SkeletonRows, StatTile, SyncStatus } from '../components'
import { ConfirmDialog, Modal } from '../dialog'
import { Icon } from '../icons'
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
      title="Geräte"
      icon="tablet"
      context={`${activeDevices.length} von höchstens ${status?.maxDevices ?? '–'} aktiv · eigenständige und gekoppelte Geräte`}
      actions={
        isAdmin && activeDevices.length > 1 ? (
          <Button variant="secondary" size="sm" icon="swap" onClick={() => setDialog({ kind: 'replace' })}>
            Gerät ersetzen
          </Button>
        ) : null
      }
    >
      <div className="dash">
        {isAdmin ? <ConnectionsPanel /> : null}
        <Card className="span-8" icon="tablet" title="Aktive Geräte">
          {activeDevices.length === 0 ? (
            <EmptyState icon="tablet" title="Noch kein Gerät verbunden" text="Die App meldet sich beim ersten Start automatisch an." />
          ) : (
            <ul className="list">
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
            </ul>
          )}
        </Card>

        <Card className="span-4" icon="cloud-up" title={status?.paired ? `Datenstand von „${status.label ?? ''}“` : 'Datenstand'}>
          {status?.paired ? (
            <div className="stack">
              <SyncStatus />
              <div className="stat-grid">
                <StatTile label="Schema" value={status.schemaVersion ?? '—'} />
                <StatTile label="Snapshot" value={status.snapshotSizeBytes ? `${(status.snapshotSizeBytes / 1024).toFixed(0)} KB` : '—'} />
                <StatTile label="Ausstehend" value={status.pendingCommands} hint="Aufträge" />
              </div>
            </div>
          ) : status ? (
            <EmptyState compact icon="cloud-up" title="Kein Datenstand" />
          ) : (
            <SkeletonRows rows={3} />
          )}
        </Card>

        <Card className="span-6" icon="add" title="Neues Gerät verbinden">
          <div className="prose">
            <p>
              Keine Kopplung nötig: Jede App, die auf diesen Server zeigt, meldet sich beim ersten Start selbst an und erscheint hier als neues Gerät
              (Kennzeichen <Badge tone="info">Neu</Badge> für 24 Stunden) – bis zu {status?.maxDevices ?? '–'} aktive Geräte.
            </p>
            <p className="muted">
              Neu installiert oder Gerät gewechselt? Die App kommt als neues Gerät mit ihrem eigenen Stand. Danach das alte Gerät sperren – oder
              „Gerät ersetzen“ nutzen, dann übernimmt das neue auch den Namen des alten. Ein unbekanntes Gerät? Sofort sperren.
            </p>
            {!isAdmin ? <Notice tone="info">Geräte umbenennen, sperren oder entfernen dürfen nur Administratoren.</Notice> : null}
          </div>
        </Card>

        <Card className="span-6" icon="info" title="Jedes Gerät ist eine eigene Kasse">
          <div className="prose muted">
            <p>
              Spieler, Abende und Buchungen eines Geräts sind unabhängig von den anderen – der Server führt nichts zusammen. Oben rechts wählst du,
              welches Gerät du ansiehst; alle Seiten und Aufträge beziehen sich darauf.
            </p>
            <p>Aufträge übernimmt es still beim nächsten Hintergrund-Sync (meist innerhalb von 1–15 Min.).</p>
          </div>
        </Card>

        {blocked.length > 0 ? (
          <Card className="span-12" icon="shield" title="Gesperrte Geräte" eyebrow="können nicht mehr synchronisieren">
            <ul className="list">
              {blocked.map((device) => (
                <DeviceItem key={device.id} device={device} isAdmin={isAdmin} busy={busy} onDialog={(kind) => setDialog({ kind, device })} />
              ))}
            </ul>
            <div className="card-foot">Ihre offenen Aufträge wurden storniert. Startet die App dort erneut, meldet sie sich als neues Gerät an.</div>
          </Card>
        ) : null}
      </div>

      {dialog?.kind === 'rename' ? (
        <RenameDialog
          device={dialog.device}
          busy={busy}
          onClose={close}
          onSave={(label) =>
            run(() => api(`/devices/${encodeURIComponent(dialog.device.id)}`, { method: 'PATCH', body: JSON.stringify({ label }) }), 'Gerät umbenannt.')
          }
        />
      ) : null}

      {dialog?.kind === 'revoke' ? (
        <ConfirmDialog
          title={`„${dialog.device.label}“ sperren?`}
          icon="shield"
          tone="danger"
          confirmLabel="Sperren"
          busy={busy}
          onClose={close}
          onConfirm={() => run(() => api(`/devices/${encodeURIComponent(dialog.device.id)}/revoke`, { method: 'POST' }), 'Gerät gesperrt.')}
        >
          <p>
            Das Gerät kann danach nicht mehr synchronisieren
            {dialog.device.pendingCommands > 0 ? `, seine ${dialog.device.pendingCommands} ausstehenden Aufträge werden storniert` : ''}. Sein Datenstand ist
            im Web nicht mehr sichtbar. Die Daten auf dem Gerät selbst bleiben unberührt.
          </p>
          <p className="muted">Startet die App dort erneut, meldet sie sich als neues Gerät an.</p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === 'remove' ? (
        <ConfirmDialog
          title={`„${dialog.device.label}“ entfernen?`}
          tone="danger"
          confirmLabel="Entfernen"
          busy={busy}
          onClose={close}
          onConfirm={() => run(() => api(`/devices/${encodeURIComponent(dialog.device.id)}`, { method: 'DELETE' }), 'Gerät entfernt.')}
        >
          <p>Entfernt das gesperrte Gerät mit seinem letzten Datenstand und Auftragsverlauf vom Server. Das lässt sich nicht rückgängig machen.</p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === 'clear' ? (
        <ConfirmDialog
          title={`Auftragsverlauf von „${dialog.device.label}“ leeren?`}
          tone="danger"
          confirmLabel="Verlauf leeren"
          busy={busy}
          onClose={close}
          onConfirm={() => run(() => api(`/commands?device=${encodeURIComponent(dialog.device.id)}`, { method: 'DELETE' }), 'Auftragsverlauf geleert.')}
        >
          <p>Alle abgeschlossenen Aufträge (übernommen, abgelehnt, storniert) dieses Geräts werden gelöscht. Ausstehende bleiben erhalten.</p>
        </ConfirmDialog>
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
    <li className={`list-row device-row ${props.selected ? 'selected' : ''}`}>
      <div className="list-row-main wrap">
        <span className={`list-lead ${active ? '' : 'tone-danger'}`}>
          <Icon name="tablet" size={17} />
        </span>
        <div className="list-text">
          <div className="list-title">
            <DeviceDot device={device} live={active} /> {device.label}
            {active && isNewDevice(device) ? <Badge tone="info">Neu</Badge> : null}
            {props.selected ? <Badge tone="accent" icon="eye">angezeigt</Badge> : null}
            {device.pendingCommands > 0 ? <Badge tone="pending" icon="layers">{device.pendingCommands} ausstehend</Badge> : null}
          </div>
          <div className="list-meta">
            {device.label !== device.deviceName ? `${device.deviceName} · ` : ''}
            verbunden seit {formatDateTime(device.pairedAt)}
            {device.revokedAt ? ` · gesperrt ${formatDateTime(device.revokedAt)}` : ''}
          </div>
          <div className="list-meta">
            zuletzt gesehen {relativeTime(device.lastSeenAt)} · letzter Stand {relativeTime(device.lastSnapshotAt)}
          </div>
        </div>
        <div className="row-actions labeled">
          {active && props.onSelect && !props.selected ? (
            <Button variant="primary" size="sm" icon="eye" onClick={props.onSelect}>
              Ansehen
            </Button>
          ) : null}
          {props.isAdmin ? (
            <Button variant="ghost" size="sm" icon="pencil" disabled={props.busy} onClick={() => props.onDialog('rename')}>
              Umbenennen
            </Button>
          ) : null}
          {active ? (
            <Button variant="ghost" size="sm" icon="trash" disabled={props.busy} onClick={() => props.onDialog('clear')}>
              Verlauf leeren
            </Button>
          ) : null}
          {props.isAdmin && active ? (
            <Button variant="danger" size="sm" icon="shield" disabled={props.busy} onClick={() => props.onDialog('revoke')}>
              Sperren
            </Button>
          ) : null}
          {props.isAdmin && !active ? (
            <Button variant="danger" size="sm" icon="trash" disabled={props.busy} onClick={() => props.onDialog('remove')}>
              Entfernen
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function RenameDialog(props: { device: DeviceSummary; busy: boolean; onClose: () => void; onSave: (label: string) => void }) {
  const [label, setLabel] = useState(props.device.label)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (label.trim()) props.onSave(label.trim())
  }
  return (
    <Modal title="Gerät umbenennen" icon="pencil" onClose={props.onClose} size="sm">
      <form className="form" onSubmit={submit}>
        <Field label="Name im Web" hint={`Angemeldet als „${props.device.deviceName}“. Der Name gilt nur hier im Web.`}>
          <input value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} required placeholder="z. B. Tablet Stammtisch" />
        </Field>
        <div className="form-actions end">
          <Button variant="ghost" onClick={props.onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" disabled={props.busy || !label.trim()}>
            Speichern
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ReplaceDialog(props: { devices: DeviceSummary[]; busy: boolean; onClose: () => void; onReplace: (oldId: string, newId: string) => void }) {
  const newest = [...props.devices].sort((a, b) => b.pairedAt.localeCompare(a.pairedAt))
  const [newId, setNewId] = useState(newest[0]?.id ?? '')
  const [oldId, setOldId] = useState(props.devices.find((device) => device.id !== newest[0]?.id)?.id ?? '')
  const valid = oldId && newId && oldId !== newId
  return (
    <ConfirmDialog
      title="Gerät ersetzen"
      icon="swap"
      tone="danger"
      confirmLabel="Ersetzen"
      busy={props.busy}
      disabled={!valid}
      onClose={props.onClose}
      onConfirm={() => props.onReplace(oldId, newId)}
    >
      <div className="form">
        <p className="muted">
          Für eine Neuinstallation oder ein neues Tablet: Das alte Gerät wird gesperrt (seine ausstehenden Aufträge werden storniert), das neue übernimmt
          seinen Namen. Die Daten werden <strong>nicht</strong> zusammengeführt.
        </p>
        <Field label="Altes Gerät (wird gesperrt)">
          <select value={oldId} onChange={(event) => setOldId(event.target.value)}>
            {props.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label} – zuletzt gesehen {relativeTime(device.lastSeenAt)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Neues Gerät (übernimmt den Namen)">
          <select value={newId} onChange={(event) => setNewId(event.target.value)}>
            {newest.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
                {isNewDevice(device) ? ' (neu)' : ''} – verbunden {formatDateTime(device.pairedAt)}
              </option>
            ))}
          </select>
        </Field>
        {oldId && oldId === newId ? <Notice tone="danger">Bitte zwei verschiedene Geräte wählen.</Notice> : null}
      </div>
    </ConfirmDialog>
  )
}
