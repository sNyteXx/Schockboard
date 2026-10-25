import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Crypto from 'expo-crypto'
import { SvgXml } from 'react-native-svg'
import { Alert } from '@/components/dialog'
import { AppText, Badge, Button, Card, CardHeader, Field, Input, Notice, Screen, ScreenHeader, Split } from '@/components/ui'
import { RoundBoard } from '@/components/round-board'
import { ConnectionError, Connections } from '@/remote/connection-client'
import { invitationCode, type ConnectionState, type Invitation, type RoundState, type RoundCommandType } from '@/remote/collaboration-protocol'
import { HandoffStore, type Handoff } from '@/remote/handoff'
import { SyncEngine } from '@/remote/sync-engine'
import { formatCurrency, formatDateTime } from '@/domain/format'
import { parseEuroToCents } from '@/domain/utils'
import { useRuntime } from '@/providers/runtime-provider'
import { spacing } from '@/theme/tokens'

type PendingBooking = { requestId: string; type: RoundCommandType; payload: Record<string, unknown> }

export default function ConnectScreen() {
  const router = useRouter(), runtime = useRuntime()
  const params = useLocalSearchParams<{ code?: string }>()
  const [state, setState] = useState<ConnectionState | null>(null)
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [round, setRound] = useState<RoundState | null>(null)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [code, setCode] = useState(params.code ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const [amount, setAmount] = useState('1,00')
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const working = useRef(false)

  const refresh = useCallback(async () => {
    const next = await Connections.state()
    setState(next)
    setHandoff(await HandoffStore.get())
    setRound(previous => previous?.role === next.host?.role ? previous : null)
    setRound(next.host ? await Connections.round() : null)
    setError(null)
  }, [])
  useEffect(() => {
    let alive = true
    const update = async () => { try { await refresh() } catch (error) { if (alive) setError((error as Error).message) } }
    void Connections.pendingBooking().then(setPendingBooking).catch(error => setError(error.message))
    void SyncEngine.syncNow(true).then(update)
    const timer = setInterval(() => { if (!working.current) void update() }, 5_000)
    return () => { alive = false; clearInterval(timer) }
  }, [refresh])
  useEffect(() => { if (params.code) setCode(params.code) }, [params.code])
  useEffect(() => { void runtime.refreshAuthState() }, [state?.host?.deviceId])

  async function run(task: () => Promise<unknown>) {
    if (working.current) return
    working.current = true; setBusy(true); setError(null)
    try { await task(); await refresh(); await runtime.refreshAuthState(); runtime.bumpDataVersion() }
    catch (error) { setError((error as Error).message); setHandoff(await HandoffStore.get()) }
    finally { working.current = false; setBusy(false) }
  }
  function claim() {
    const value = invitationCode(code)
    if (!value) { setError('Bitte einen gültigen Schockboard-Code scannen oder einfügen.'); return }
    void run(async () => {
      const result = await Connections.claim(value)
      setCode('')
      setState(result.state)
      setNotice(result.purpose === 'join' ? 'Als Zuschauer verbunden. Bedienrechte gibt der Spieltisch frei.' : 'Umzug reserviert. Prüfe die Übertragung und bestätige unten.')
    })
  }
  function prepareTransfer() {
    Alert.alert('Auf neues Gerät umziehen?', 'Der aktuelle Stand wird gesichert und dieses Gerät für Buchungen gesperrt. Das neue Gerät übernimmt nach dem Scannen Spieler, Abende, Kasse und Einstellungen. Nach erfolgreicher Übertragung bleibt dieses Gerät Zuschauer.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Sichern und Umzug vorbereiten', onPress: () => void run(async () => {
        const result = await SyncEngine.syncNow(true)
        if (result.status !== 'ok') throw new Error('Vor dem Umzug muss die Synchronisierung erfolgreich sein.')
        runtime.cancelUndo()
        setInvitation(await Connections.prepareTransfer())
      }) },
    ])
  }
  function receiveTransfer(id: string) {
    Alert.alert('Daten dieses Geräts ersetzen?', 'Spieler, Abende, Kasse und Einstellungen werden vollständig durch den übertragenen Stand ersetzt. Vorher wird der bisherige Stand automatisch gesichert. Es werden keine Kassen zusammengeführt.', [
      { text: 'Abbrechen', style: 'cancel' }, { text: 'Sichern und übernehmen', style: 'destructive', onPress: () => void run(async () => { runtime.cancelUndo(); await SyncEngine.syncNow(true); await Connections.receiveTransfer(id); setNotice('Übertragung vollständig bestätigt. Dieses Gerät führt jetzt die Runde.'); setInvitation(null) }) },
    ])
  }
  async function send(booking: PendingBooking) {
    await Connections.savePendingBooking(booking)
    setPendingBooking(booking)
    let result
    try { result = await Connections.book(booking.requestId, booking.type, booking.payload) }
    catch (error) {
      if (error instanceof ConnectionError && [400, 403, 409, 422].includes(error.status)) {
        await Connections.savePendingBooking(null)
        setPendingBooking(null)
      }
      throw error
    }
    await Connections.savePendingBooking(null)
    setPendingBooking(null)
    if (result.status === 'rejected' || result.status === 'cancelled') throw new Error('Der Spieltisch hat die Buchung abgelehnt oder sie wurde storniert. Details stehen im Verlauf.')
    setNotice(result.status === 'pending' ? 'Buchung beauftragt. Sie zählt erst nach Bestätigung durch den Spieltisch.' : 'Buchung bereits bestätigt. Es wurde keine zweite Buchung angelegt.')
  }
  function book(type: RoundCommandType, playerId: string) {
    void run(async () => {
      if (!round?.session) throw new Error('Kein laufender Abend.')
      const payload: Record<string, unknown> = { playerId, sessionId: round.session.session.id }
      if (type !== 'loss.record') payload.amountCents = parseEuroToCents(amount)
      await send({ requestId: Crypto.randomUUID(), type, payload })
    })
  }
  function sync() {
    void run(async () => {
      const result = await SyncEngine.syncNow(true)
      if (result.status === 'error') throw new Error(result.message)
      if (result.status === 'not-paired') throw new Error('Anmeldung noch nicht möglich.')
    })
  }
  const sourceTransfer = state?.transfer?.hostId === state?.deviceId ? state?.transfer : null
  const incoming = state && state.transfer?.guestId === state.deviceId && state.transfer?.status === 'claimed' ? state.transfer : null

  return <Screen maxWidth={1100}>
    <ScreenHeader title={state?.host ? "Eure Runde" : "Geräte & Runde"} context={state?.host ? "Gemeinsam am Spieltisch · automatisch aktualisiert" : "Verbinden, gemeinsam spielen und sicher umziehen"} />
    {!state?.host ? <Button tone="ghost" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>Zurück</Button> : null}
    {error ? <Notice type="error" message={error} /> : null}
    {notice ? <Notice type="success" message={notice} /> : null}
    {round ? <RoundBoard round={round} actions={<Split><Button tone="secondary" disabled={busy} onPress={sync}>Aktualisieren</Button><Button tone="ghost" onPress={() => runtime.setTableLocked(true)}>Tisch sperren</Button></Split>} /> : null}
    {pendingBooking ? <Card><Notice type="error" message="Bestätigung fehlt. Wiederholen verwendet dieselbe Buchungskennung und erzeugt keine zweite Buchung." /><Button disabled={busy} onPress={() => void run(() => send(pendingBooking))}>Buchung erneut bestätigen</Button></Card> : null}
    {round?.role === 'operator' ? <Card><CardHeader title="Am Spieltisch buchen" icon="dice-outline" aside={<Badge>{round.role === 'operator' ? 'Bedienung' : 'Zuschauer'}</Badge>} />
      <AppText tone="muted">{round.hostLabel} · letzter Stand {round.receivedAt ? formatDateTime(round.receivedAt) : 'unbekannt'}. Bei fehlender Verbindung bleibt der zuletzt geladene Stand sichtbar.</AppText>
      {round.role === 'operator' ? <Field label="Betrag für Zahlung / Bierrunde (€)"><Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /></Field> : null}
      {round.session?.attendance.filter(row => row.present).map(player => <View key={player.playerId} style={{ gap: spacing.sm }}>
        <AppText>{player.playerName} · {round.session!.losses.filter(row => row.playerId === player.playerId && !row.isBeerRound).length} Verluste</AppText>
        {round.role === 'operator' ? <><AppText tone="muted">Konto: {formatCurrency(round.balances.find(row => row.playerId === player.playerId)?.openDebtCents ?? 0)}</AppText><Split>
          <Button disabled={busy || !!pendingBooking} onPress={() => book('loss.record', player.playerId)}>+ Verlust</Button>
          <Button tone="secondary" disabled={busy || !!pendingBooking} onPress={() => book('beerround.record', player.playerId)}>Bierrunde</Button>
          <Button tone="secondary" disabled={busy || !!pendingBooking} onPress={() => book('payment.record', player.playerId)}>Zahlung</Button>
        </Split></> : null}
      </View>)}
      {round.commands.slice(0, 8).map(command => <AppText key={command.id} tone={command.status === 'rejected' ? 'danger' : 'muted'}>{command.type === 'loss.record' ? 'Verlust' : command.type === 'payment.record' ? 'Zahlung' : 'Bierrunde'}: {({ pending: 'ausstehend', applied: 'übernommen', rejected: 'abgelehnt', cancelled: 'storniert' } as Record<string, string>)[command.status] ?? command.status}{command.error ? ` · ${command.error}` : ''}</AppText>)}
    </Card> : null}
    <Card><CardHeader title={state?.label ?? 'Verbindung'} icon="phone-portrait-outline" />
      <AppText tone="muted">{state?.host ? `Verbunden mit ${state.host.label} · ${state.host.role === 'operator' ? 'Bedienung freigegeben' : 'Zuschauer'}` : 'Dieses Gerät führt seine eigene Runde.'}</AppText>
      {!round ? <Button disabled={busy} onPress={sync}>Jetzt synchronisieren</Button> : null}
      {state?.host ? <Button tone="ghost" disabled={busy || !!pendingBooking || !!sourceTransfer} onPress={() => void run(() => Connections.leave())}>Runde verlassen</Button> : null}
    </Card>
    {state?.pendingTransferRequest ? <Notice type="success" message="In der Kommandozentrale wurde ein Umzug angefragt. Bestätige ihn hier mit „Geräteumzug vorbereiten“." /> : null}
    {incoming || handoff?.kind === 'receiver' ? <Card><CardHeader title="Übertragung übernehmen" icon="download-outline" />
      <AppText>Der bisherige Stand wird gesichert und anschließend ersetzt. Spieler, Historie, Kasse und Einstellungen kommen vom Quellgerät.</AppText>
      <Button disabled={busy} onPress={() => receiveTransfer(incoming?.id ?? handoff!.id!)}>Sichern und Übertragung fortsetzen</Button>
      <Button tone="secondary" disabled={busy} onPress={() => void run(() => Connections.cancelTransfer())}>Umzug abbrechen</Button>
    </Card> : null}
    {handoff?.kind === 'source' || sourceTransfer ? <Card><CardHeader title={sourceTransfer?.status === 'completed' ? 'Umzug abgeschlossen' : 'Quellgerät gesperrt'} icon="lock-closed-outline" />
      <AppText>{sourceTransfer?.status === 'completed' ? 'Die Runde wird auf dem neuen Gerät geführt. Du kannst hier als Zuschauer verbunden bleiben.' : 'Bis zur Bestätigung oder zum Abbruch können hier keine Buchungen erfolgen.'}</AppText>
      {sourceTransfer?.status === 'waiting' ? <Button disabled={busy} onPress={() => void run(async () => setInvitation(await Connections.invite('transfer')))}>Neuen QR-Code anzeigen</Button> : null}
      {sourceTransfer?.status !== 'completed' ? <Button tone="secondary" disabled={busy || sourceTransfer?.status === 'claimed'} onPress={() => void run(async () => { await Connections.cancelTransfer(); setInvitation(null) })}>Umzug abbrechen / Sperre prüfen</Button> : null}
      {sourceTransfer?.status === 'claimed' ? <AppText tone="muted">Das Zielgerät hat übernommen. Fortsetzen oder abbrechen ist dort möglich.</AppText> : null}
    </Card> : null}
    {!state?.host && !handoff && !sourceTransfer && !incoming ? <Card><CardHeader title="Runde freigeben" icon="qr-code-outline" />
      <AppText>Neue Geräte starten als Zuschauer. Deine eigenen Daten bleiben beim Beitritt erhalten.</AppText>
      <Split><Button disabled={busy} onPress={() => void run(async () => { await SyncEngine.syncNow(true); setInvitation(await Connections.invite('join')) })}>QR zum Beitreten</Button><Button tone="secondary" disabled={busy} onPress={prepareTransfer}>Geräteumzug vorbereiten</Button></Split>
    </Card> : null}
    {invitation ? <Card><CardHeader title={invitation.purpose === 'join' ? 'Runde beitreten' : 'Geräteumzug'} icon="qr-code-outline" />
      <View style={{ alignItems: 'center' }}><SvgXml xml={invitation.svg} width={260} height={260} /></View>
      <AppText tone="muted">Einmal verwendbar · gültig bis {formatDateTime(invitation.expiresAt)}</AppText>
      <AppText selectable>{invitation.url}</AppText>
    </Card> : null}
    {!state?.host && !handoff && !sourceTransfer && !incoming ? <Card><CardHeader title="Einladung scannen" icon="scan-outline" />
      {scanning && permission?.granted ? <View style={{ height: 280 }}><CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { const parsed = invitationCode(data); if (parsed) { setCode(parsed); setScanning(false) } }} /></View> : null}
      <Split><Button tone="secondary" disabled={busy} onPress={() => void run(async () => { if (permission?.granted || (await requestPermission()).granted) setScanning(value => !value); else throw new Error('Kamera nicht freigegeben. Du kannst den Einladungslink einfügen.') })}>{scanning ? 'Kamera schließen' : 'QR scannen'}</Button></Split>
      <Field label="Einladungslink oder Einmalcode"><Input value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} /></Field>
      <Button disabled={busy || !invitationCode(code)} onPress={claim}>Einladung annehmen</Button>
    </Card> : null}
    {state?.members.length ? <Card><CardHeader title="Verbundene Geräte" icon="people-outline" />{state.members.map(member => <View key={member.deviceId} style={{ gap: spacing.sm }}>
      <AppText>{member.label} · {member.role === 'operator' ? 'Bedienung' : 'Zuschauer'}</AppText>
      <AppText tone="muted">Zuletzt gesehen: {member.lastSeenAt ? formatDateTime(member.lastSeenAt) : 'noch nicht'}</AppText>
      <Split><Button tone="secondary" disabled={busy} onPress={() => void run(() => Connections.setRole(member.deviceId, member.role === 'viewer' ? 'operator' : 'viewer'))}>{member.role === 'viewer' ? 'Bedienung freigeben' : 'Nur zuschauen'}</Button><Button tone="ghost" disabled={busy} onPress={() => void run(() => Connections.remove(member.deviceId))}>Trennen</Button></Split>
    </View>)}</Card> : null}

  </Screen>
}
