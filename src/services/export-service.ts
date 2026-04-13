import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

import { formatCurrency, formatDateTime } from '@/domain/format'
import { getCashboxSummary, getDebtSummaries, getHistoryEntries } from '@/db/queries'

function escapeCsv(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? '' : String(value)
  return `"${raw.replaceAll('"', '""')}"`
}

async function writeAndShare(filename: string, content: string) {
  const directory = FileSystem.documentDirectory

  if (!directory) {
    throw new Error('Dateisystem nicht verfügbar.')
  }

  const fileUri = `${directory}${filename}`
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  })
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: 'CSV exportieren',
  })
}

export const ExportService = {
  buildHistoryCsv() {
    const rows = getHistoryEntries({ kind: 'all', includeAudit: true })
    const header = ['Zeit', 'Typ', 'Titel', 'Detail', 'Betrag', 'Session', 'Actor']
    const lines = rows.map((entry) =>
      [
        formatDateTime(entry.createdAt),
        entry.kind,
        entry.playerName ?? entry.message,
        entry.message,
        entry.amountCents !== null ? formatCurrency(entry.amountCents) : '',
        entry.sessionTitle ?? '',
        entry.actorUsername ?? '',
      ]
        .map(escapeCsv)
        .join(';')
    )

    return [header.map(escapeCsv).join(';'), ...lines].join('\n')
  },

  buildCashboxCsv() {
    const debtors = getDebtSummaries()
    const summary = getCashboxSummary()
    const rows = [
      ['Kennzahl', 'Wert'],
      ['Kassenstand', formatCurrency(summary.totalPaymentsCents)],
      ['Offene Schulden', formatCurrency(summary.totalOutstandingCents)],
      [],
      ['Spieler', 'Offen', 'Verluste', 'Abwesenheit', 'Korrekturen', 'Zahlungen'],
      ...debtors.map((debtor) => [
        debtor.playerName,
        formatCurrency(debtor.openDebtCents),
        formatCurrency(debtor.lossCents),
        formatCurrency(debtor.absenceCents),
        formatCurrency(debtor.correctionCents),
        formatCurrency(debtor.paymentCents),
      ]),
    ]

    return rows.map((row) => row.map(escapeCsv).join(';')).join('\n')
  },

  async shareHistoryCsv() {
    await writeAndShare('schockboard-history.csv', this.buildHistoryCsv())
  },

  async shareCashboxCsv() {
    await writeAndShare('schockboard-cashbox.csv', this.buildCashboxCsv())
  },
}
