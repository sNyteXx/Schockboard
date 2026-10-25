import { useEffect, useState } from 'react'
import type { ConnectionState, Invitation } from '@/remote/collaboration-protocol'
import { api } from '../api'
import { Badge, Button, Card, Notice, relativeTime } from '../components'
import { useApi, useApp } from '../state'

export function ConnectionsPanel() {
  const { device, toast } = useApp()
  const state = useApi<ConnectionState>('/connect')
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setInvitation(null); const timer = setInterval(state.reload, 5000); return () => clearInterval(timer) }, [device])
  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    try { await task(); state.reload() } catch (error) { toast((error as Error).message, 'error') } finally { setBusy(false) }
  }
  const data = state.data
  return <Card className="span-12" title="Gekoppelte Runde & Geräteumzug" icon="tablet">
    {state.error ? <Notice tone="danger">{state.error.message}</Notice> : null}
    {data?.host ? <Notice>Verbunden mit {data.host.label} · {data.host.role === 'operator' ? 'Bedienung freigegeben' : 'Zuschauer'}. Der Spieltisch führt den gemeinsamen Stand.</Notice> : <p>Teile die Runde per QR. Neue Geräte starten als Zuschauer; Bedienrechte gibst du danach ausdrücklich frei.</p>}
    <div className="form-actions">
      <Button disabled={busy || !!data?.transfer || !!data?.host} onClick={() => void run(async () => setInvitation(await api<Invitation>('/connect/invite', { method: 'POST', body: JSON.stringify({ purpose: 'join' }) })))}>QR zum Beitreten</Button>
      <Button variant="secondary" disabled={busy || !!data?.transfer || !!data?.host} onClick={() => void run(async () => { await api('/connect/request-transfer', { method: 'POST' }); toast('Umzug angefragt. Bitte auf dem Quellgerät unter Geräte & Runde bestätigen.') })}>Geräteumzug anfragen</Button>
    </div>
    {data?.pendingTransferRequest ? <Notice>Öffne auf dem Quellgerät „Geräte & Runde“ und bestätige den Umzug. Erst danach werden Buchungen gesperrt und der Übertragungscode freigegeben.</Notice> : null}
    {data?.transfer ? <div className="stack">
      <Notice tone="warning">{data.transfer.status === 'completed' ? 'Umzug abgeschlossen. Die Runde wird auf dem Zielgerät geführt.' : data.transfer.status === 'claimed' ? 'Zielgerät hat die Übertragung reserviert. Dort fortsetzen oder abbrechen.' : 'Quellgerät ist gesperrt. Bereit zur Übertragung.'}</Notice>
      {data.transfer.status === 'waiting' ? <div className="form-actions"><Button disabled={busy} onClick={() => void run(async () => setInvitation(await api<Invitation>('/connect/invite', { method: 'POST', body: JSON.stringify({ purpose: 'transfer' }) })))}>Übertragungs-QR anzeigen</Button><Button variant="secondary" disabled={busy} onClick={() => void run(async () => { await api(`/connect/transfers/${data.transfer!.id}/cancel`, { method: 'POST' }); setInvitation(null); toast('Umzug abgebrochen. Auf dem Quellgerät die Sperre prüfen lassen.') })}>Umzug abbrechen</Button></div> : null}
    </div> : null}
    {invitation ? <div className="invite-card"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(invitation.svg)}`} alt={invitation.purpose === 'join' ? 'QR-Code zum Beitreten' : 'QR-Code zur Übertragung'} width={260} height={260} /><div><strong>{invitation.purpose === 'join' ? 'Runde beitreten' : 'Stand auf neues Gerät übertragen'}</strong><p>Einmal verwendbar · gültig bis {new Date(invitation.expiresAt).toLocaleTimeString('de-DE')}</p><input aria-label="Einladungslink" value={invitation.url} readOnly onFocus={event => event.target.select()} /><p className="muted">In Schockboard Next unter Geräte & Runde scannen oder den Link einfügen.</p></div></div> : null}
    {data?.members.length ? <ul className="list">{data.members.map(member => <li key={member.deviceId} className="list-row"><div className="list-main"><strong>{member.label}</strong><p className="muted">Zuletzt gesehen {relativeTime(member.lastSeenAt)}</p><Badge>{member.role === 'operator' ? 'Bedienung' : 'Zuschauer'}</Badge></div><div className="form-actions"><Button size="sm" variant="secondary" disabled={busy || !!data.transfer} onClick={() => void run(() => api(`/connect/members/${member.deviceId}`, { method: 'PATCH', body: JSON.stringify({ role: member.role === 'operator' ? 'viewer' : 'operator' }) }))}>{member.role === 'operator' ? 'Nur zuschauen' : 'Bedienung freigeben'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`/connect/members/${member.deviceId}`, { method: 'DELETE' }))}>Trennen</Button></div></li>)}</ul> : <p className="muted">Keine weiteren Geräte an diesem Spieltisch.</p>}
  </Card>
}
