import { useState } from 'react'
import type { Achievement } from '@/domain/achievements'
import { achievementDate, recapSvg, type Recap } from '@/domain/recap'
import { Button, Card, ErrorView, Field, Page, SkeletonRows } from '../components'
import { useApi, useApp, useSearch } from '../state'

export function AchievementsPage() {
  const { toast } = useApp()
  const query = useSearch()
  const sessionId = new URLSearchParams(query).get('session')
  const [tab, setTab] = useState<'trophies' | 'recap'>(sessionId ? 'recap' : 'trophies')
  const [player, setPlayer] = useState('all')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [balances, setBalances] = useState(false)
  const [busy, setBusy] = useState(false)
  const awards = useApi<Achievement[]>('/achievements')
  const recap = useApi<Recap>(tab === 'recap' ? `/recap?${sessionId ? `sessionId=${encodeURIComponent(sessionId)}` : `year=${/^\d{4}$/.test(year) ? year : new Date().getFullYear()}`}&includeBalances=${balances ? '1' : '0'}` : null)
  const selected = (awards.data ?? []).filter(award => player === 'all' || award.playerId === player)
  const names = new Map((awards.data ?? []).map(award => [award.playerId, award.playerName]))
  const svg = recap.data ? recapSvg(recap.data) : null
  async function share() {
    if (!svg) return
    setBusy(true)
    try {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Bilderstellung nicht verfügbar.')
      context.drawImage(image, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Bild konnte nicht erstellt werden.')), 'image/png'))
      const file = new File([blob], 'schockboard-rueckblick.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: recap.data!.title })
      else { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) { if ((error as Error).name !== 'AbortError') toast((error as Error).message, 'error') } finally { setBusy(false) }
  }
  return <Page title="Erfolge & Rückblick" icon="star" context="Trophäen für eure Runde · aus der gesamten Historie berechnet">
    <div className="form-actions"><Button variant={tab === 'trophies' ? 'primary' : 'secondary'} onClick={() => setTab('trophies')}>Trophäen</Button><Button variant={tab === 'recap' ? 'primary' : 'secondary'} onClick={() => setTab('recap')}>{sessionId ? 'Abendrückblick' : 'Jahresrückblick'}</Button></div>
    {tab === 'trophies' ? <>
      {awards.error ? <ErrorView error={awards.error} /> : null}
      <Card title={`${selected.filter(award => award.unlockedAt).length} freigeschaltet`}><Field label="Spieler"><select value={player} onChange={event => setPlayer(event.target.value)}><option value="all">Alle Spieler</option>{[...names].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field><p className="muted">Abgeschlossene Spielabende zählen rückwirkend. Leere Testabende zählen nicht. Korrekturen ändern die Auswertung.</p></Card>
      {!awards.data && awards.loading ? <SkeletonRows rows={4} /> : null}
      <div className="achievement-grid">{selected.map(award => <Card key={`${award.playerId}:${award.id}`} className={`achievement ${award.unlockedAt ? 'unlocked' : ''}`} title={award.title} icon="star" eyebrow={award.playerName}><p>{award.description}</p><progress aria-label={`${award.playerName}: ${award.title}`} value={award.progress} max={award.target} /><div className="card-foot"><strong>{award.progress} / {award.target}</strong><span>{achievementDate(award)}</span></div></Card>)}</div>
    </> : <>
      <Card title={sessionId ? 'Euer Abend als Bild' : 'Euer Jahr als Bild'}>
        {!sessionId ? <Field label="Jahr"><input value={year} onChange={event => setYear(event.target.value)} inputMode="numeric" maxLength={4} /></Field> : null}
        <label className="check-row"><input type="checkbox" checked={balances} onChange={event => setBalances(event.target.checked)} /> Persönliche Kontostände einschließen</label>
        <p className="muted">Die Vorschau entspricht dem geteilten Bild. Kontostände bleiben standardmäßig privat.</p>
        <Button disabled={busy || !svg || (!sessionId && !/^\d{4}$/.test(year))} onClick={() => void share()}>Als PNG teilen / herunterladen</Button>
      </Card>
      {recap.error ? <ErrorView error={recap.error} /> : null}
      {svg ? <img className="recap-image" alt="Vorschau des Rückblicks" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /> : null}
    </>}
  </Page>
}
