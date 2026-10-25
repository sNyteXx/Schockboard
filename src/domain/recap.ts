import type { Achievement } from './achievements'
import { formatCurrency, formatDate } from './format'

export type Recap = {
  title: string
  subtitle: string
  evenings: number
  losses: number
  beerRounds: number
  players: Array<{ id: string; name: string; losses: number; debtCents?: number }>
  achievements: Achievement[]
}

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)

/** Shared export artwork; accounts are included only after explicit selection. */
export function recapSvg(recap: Recap) {
  const rows = recap.players.length
  const awardLines = recap.achievements.map(award => `${award.playerName}: ${award.title}`)
  const height = 370 + rows * 55 + (awardLines.length ? 80 + awardLines.length * 36 : 0)
  const text = (x: number, y: number, value: string | number, size = 26, color = '#f7f6ef', extra = '') => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" ${extra}>${escape(value)}</text>`
  const max = Math.max(0, ...recap.players.map(player => player.losses))
  const pechvogel = max ? recap.players.filter(player => player.losses === max).map(player => player.name).join(' & ') : 'Weiße Weste für alle'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#292816"/><stop offset="1" stop-color="#101210"/></linearGradient></defs>
  <rect width="960" height="${height}" rx="32" fill="url(#bg)"/><rect width="960" height="10" rx="5" fill="#fde100"/>
  <g font-family="Inter, Arial, sans-serif">
  ${text(48, 65, 'SCHOCKBOARD NEXT', 22, '#fde100', 'font-weight="700" letter-spacing="4"')}
  ${text(48, 120, recap.title, 42, '#ffffff', 'font-weight="700"')}
  ${text(48, 158, recap.subtitle, 22, '#b5b6a9')}
  ${text(48, 217, `${recap.evenings} Abende   ·   ${recap.losses} Verluste   ·   ${recap.beerRounds} Bierrunden`, 26)}
  ${text(48, 259, `Pechvogel: ${pechvogel}`, 25, '#fde100')}
  ${recap.players.map((player, index) => {
    const y = 320 + index * 55
    return `<path d="M48 ${y + 14}H912" stroke="#ffffff" stroke-opacity=".08"/>${text(48, y, player.name.slice(0, 34), 25)}${text(570, y, `${player.losses} Verluste`, 24)}${player.debtCents !== undefined ? text(912, y, `${formatCurrency(player.debtCents)}`, 24, '#fde100', 'text-anchor="end"') : ''}`
  }).join('')}
  ${awardLines.length ? text(48, 350 + rows * 55, 'ERFOLGE', 20, '#fde100', 'letter-spacing="3"') + awardLines.map((line, index) => text(48, 390 + rows * 55 + index * 36, line, 23)).join('') : ''}
  ${text(48, height - 30, recap.players.some(player => player.debtCents !== undefined) ? 'Kontostände zum Exportzeitpunkt · Minus bedeutet Guthaben' : 'Eure Runde. Euer Abend.', 17, '#a4a69a')}
  </g></svg>`
}

export function achievementDate(award: Achievement) { return award.unlockedAt ? formatDate(award.unlockedAt) : 'Noch offen' }
