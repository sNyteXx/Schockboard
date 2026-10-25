import { formatCurrency } from '@/domain/format'

import type { CashboxChart, CashboxSummary, HistoryRow } from '../api'
import { LineChart } from '../charts/LineChart'
import { CHART } from '../charts/scale'
import { cashboxSeries, paymentsSeries } from '../charts/series'
import { Card, ErrorView, Page, SkeletonChart, SkeletonRows, StatTile, SyncHint } from '../components'
import { BOOKING_META, CorrectionForm, PaymentForm, WithdrawalForm } from '../forms'
import { useApi } from '../state'
import { HistoryList } from './History'

export function BookingPage() {
  const cashbox = useApi<CashboxChart>('/charts/cashbox')
  const withdrawals = useApi<HistoryRow[]>('/history?kind=withdrawal&limit=50')
  const summary = useApi<CashboxSummary>('/cashbox')
  const data = cashbox.data

  return (
    <Page title="Buchen" icon="cash" context="Zahlungen, Korrekturen und Entnahmen – still beauftragt, vom Gerät übernommen">
      {cashbox.error ? <ErrorView error={cashbox.error} /> : null}
      {!cashbox.error ? (
        <>
          <div className="stat-grid four">
            <StatTile label="Kassenstand" icon="wallet" tone="accent" value={data ? formatCurrency(data.cashOnHandCents) : '…'} hint="eingezahlt − entnommen" />
            <StatTile label="Eingezahlt" icon="cash-in" value={data ? formatCurrency(data.totalPaymentsCents) : '…'} hint={data ? `${data.payments.length} Zahlungen` : undefined} />
            <StatTile label="Entnommen" icon="cash-out" value={data ? formatCurrency(data.totalWithdrawalsCents) : '…'} hint={data ? `${data.withdrawals.length} Entnahmen` : undefined} />
            <StatTile label="Noch offen" icon="alert" tone="danger" value={summary.data ? formatCurrency(summary.data.totalOutstandingCents) : '…'} hint="Schulden der Spieler" />
          </div>

          <div className="dash">
            {(['payment', 'correction', 'withdrawal'] as const).map((kind) => {
              const meta = BOOKING_META[kind]
              return (
                <Card key={kind} className="span-4 form-card" icon={meta.icon} title={meta.title.replace(' buchen', '')} eyebrow={meta.description} id={`form-${kind}`}>
                  {kind === 'payment' ? <PaymentForm /> : kind === 'correction' ? <CorrectionForm /> : <WithdrawalForm />}
                </Card>
              )
            })}

            <Card className="span-8" icon="trending-up" eyebrow="Kasse" title="Kassenstand über die Zeit">
              {data ? (
                <LineChart
                  ariaLabel="Kassenstand (Einzahlungen minus Entnahmen) und Einzahlungen kumuliert"
                  height={260}
                  series={[cashboxSeries(data, CHART.accent), ...(data.withdrawals.length > 0 ? [paymentsSeries(data, CHART.muted)] : [])]}
                  emptyText="Noch keine Zahlungen."
                />
              ) : (
                <SkeletonChart height={260} />
              )}
              <div className="card-foot">Jede Zahlung hebt, jede Entnahme senkt den Kassenstand. Die gestrichelte Linie zeigt alle Einzahlungen ohne Entnahmen.</div>
            </Card>

            <Card className="span-4" icon="cash-out" eyebrow="Kasse" title="Entnahmen">
              {withdrawals.error ? <ErrorView error={withdrawals.error} /> : null}
              {withdrawals.data ? <HistoryList entries={withdrawals.data} editable /> : <SkeletonRows rows={3} />}
            </Card>
          </div>
        </>
      ) : null}
      <SyncHint />
    </Page>
  )
}
