import { formatCurrency, formatDate, formatDateTime } from '@/domain/format'

import type { CashboxChart, DashboardSnapshot, EveningsChart, HistoryRow, PlayerChartRow, SessionOverview } from '../api'
import { Donut } from '../charts/Donut'
import { LineChart } from '../charts/LineChart'
import { RankingBars } from '../charts/RankingBars'
import { ACCENT } from '../charts/scale'
import { playerDebtSeries, totalDebtValues } from '../charts/series'
import { Sparkline } from '../charts/Sparkline'
import { Card, ErrorView, Loading, Money, Page, PendingHints, SyncHint, SyncStatus } from '../components'
import { RenamePendingBadges } from '../overrides'
import { Link, navigate, pendingForPlayer, useApi, useApp } from '../state'
import { HistoryList } from './History'

export function DashboardPage() {
  const { pending } = useApp()
  const dashboard = useApi<Omit<DashboardSnapshot, 'recentHistory'> & { recentHistory: HistoryRow[] }>('/dashboard')
  const sessions = useApi<SessionOverview[]>('/sessions')
  const players = useApi<PlayerChartRow[]>('/charts/players')
  const cashbox = useApi<CashboxChart>('/charts/cashbox')
  const evenings = useApi<EveningsChart>('/charts/evenings?season=all')

  const data = dashboard.data
  const recentSessions = (sessions.data ?? []).filter((session) => session.status === 'closed').slice(0, 3)
  const lastEvenings = (evenings.data?.evenings ?? []).slice(-10)
  const lastEvening = lastEvenings[lastEvenings.length - 1]
  const debtLines = players.data ? playerDebtSeries(players.data) : null

  return (
    <Page eyebrow="Echte Liebe" title="Übersicht">
      <Card title="Sync-Status">
        <div className="grid cols-2" style={{ alignItems: 'center' }}>
          <SyncStatus />
          <SyncHint />
        </div>
        {pending.length > 0 ? (
          <div className="row" style={{ marginTop: 12 }}>
            <span className="badge pending">{pending.length} Auftrag/Aufträge ausstehend</span>
            <Link to="/auftraege">Zur Auftragsliste</Link>
          </div>
        ) : null}
      </Card>

      {dashboard.error ? <ErrorView error={dashboard.error} /> : null}
      {!data && dashboard.loading ? <Loading /> : null}

      {data ? (
        <>
          <div className="grid cols-3">
            <section className="card accent kpi">
              <div className="stat-label">{data.settings.cashboxLabel}</div>
              <div className="stat-value">{formatCurrency(data.cashbox.totalPaymentsCents)}</div>
              <div className="muted small">eingezahlt</div>
              <Sparkline
                label="Kasse: Einzahlungen kumuliert"
                color="#090b09"
                values={[0, ...(cashbox.data?.payments.map((payment) => payment.cumulativeCents) ?? [])]}
              />
            </section>
            <section className="card kpi">
              <div className="stat-label muted">Offene Schulden</div>
              <div className="stat-value" style={{ color: 'var(--accent)' }}>
                {formatCurrency(data.cashbox.totalOutstandingCents)}
              </div>
              <div className="muted small">über alle Spieler</div>
              <Sparkline label="Offene Schulden im Zeitverlauf" color={ACCENT} values={[0, ...(players.data ? totalDebtValues(players.data) : [])]} />
            </section>
            <section className="card kpi">
              <div className="stat-label muted">Verluste letzte Abende</div>
              <div className="stat-value">{lastEvening ? formatCurrency(lastEvening.totalCents) : '–'}</div>
              <div className="muted small">
                {lastEvening ? `zuletzt „${lastEvening.title}“, ${formatDate(lastEvening.date)}` : 'noch kein beendeter Abend'}
              </div>
              <Sparkline label="Summe der letzten zehn Abende" color={ACCENT} values={lastEvenings.map((evening) => evening.totalCents)} />
            </section>
          </div>

          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <Card title="Kasse vs. offen">
              <Donut
                centerLabel="Gesamt"
                centerValue={formatCurrency(data.cashbox.totalPaymentsCents + Math.max(0, data.cashbox.totalOutstandingCents))}
                slices={[
                  { label: 'In der Kasse', value: data.cashbox.totalPaymentsCents, color: ACCENT },
                  { label: 'Noch offen', value: Math.max(0, data.cashbox.totalOutstandingCents), color: '#5b6657' },
                ]}
              />
            </Card>

            <Card title="Offene Schulden" actions={<Link to="/spieler">Alle Spieler</Link>}>
              <RankingBars
                emptyText="Keine Spieler."
                rows={[...data.debtors]
                  .sort((a, b) => b.openDebtCents - a.openDebtCents)
                  .map((debtor) => ({
                    id: debtor.playerId,
                    value: debtor.openDebtCents,
                    label: (
                      <>
                        {debtor.playerName} {debtor.isCore ? null : <span className="badge">Gast</span>}
                      </>
                    ),
                    onClick: () => navigate(`/spieler?spieler=${encodeURIComponent(debtor.playerId)}`),
                    extra: (
                      <>
                        <PendingHints commands={pendingForPlayer(pending, debtor.playerId).filter((command) => command.type !== 'player.rename')} />
                        <RenamePendingBadges playerId={debtor.playerId} />
                      </>
                    ),
                  }))}
              />
            </Card>
          </div>

          <Card title="Offene Schulden pro Spieler">
            {players.error ? <ErrorView error={players.error} /> : null}
            {debtLines ? (
              <LineChart
                ariaLabel="Offene Schulden pro Spieler im Zeitverlauf"
                series={debtLines.series}
                initiallyHidden={debtLines.hidden}
                emptyText="Noch keine Buchungen."
              />
            ) : (
              <div className="skeleton" />
            )}
            <div className="muted small" style={{ marginTop: 8 }}>
              Stand nach jedem Abend, jeder Zahlung und Korrektur. Legende antippen, um Spieler ein- oder auszublenden.
            </div>
          </Card>

          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <Card title="Aktiver Abend">
              {data.openSession ? (
                <Link to={`/abende/${encodeURIComponent(data.openSession.id)}`} className="card link">
                  <div className="spread">
                    <h3 style={{ margin: 0 }}>{data.openSession.title}</h3>
                    <span className="badge yellow">läuft</span>
                  </div>
                  <div className="muted small">seit {formatDateTime(data.openSession.startedAt)}</div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <span className="badge">{data.openSession.presentCount} anwesend</span>
                    <span className="badge">{data.openSession.lossCount} Einträge</span>
                    <span className="badge yellow">{formatCurrency(data.openSession.totalLossCents)}</span>
                  </div>
                </Link>
              ) : (
                <div className="empty">Gerade läuft kein Spielabend.</div>
              )}
              {recentSessions.length > 0 ? (
                <div className="list" style={{ marginTop: 12 }}>
                  <div className="muted small" style={{ fontWeight: 700 }}>
                    Letzte Abende
                  </div>
                  {recentSessions.map((session) => (
                    <Link key={session.id} to={`/abende/${encodeURIComponent(session.id)}`} className="list-item">
                      <div>
                        <div className="title">{session.title}</div>
                        <div className="sub">
                          {formatDate(session.startedAt)} · {session.presentCount} anwesend
                        </div>
                      </div>
                      <Money cents={session.totalLossCents + session.totalAbsenceCents} />
                    </Link>
                  ))}
                </div>
              ) : null}
            </Card>

            <Card title="Zuletzt passiert" actions={<Link to="/historie">Ganze Historie</Link>}>
              <HistoryList entries={data.recentHistory} />
            </Card>
          </div>
        </>
      ) : null}
    </Page>
  )
}
