import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { formatCurrency, formatDate, formatSignedCurrency } from '@/domain/format'

import { useActions } from './actions'
import { api, type HistoryRow, type PlayerDebtSummary, type SessionOverview } from './api'
import { Avatar, DeviceDot, relativeTime } from './components'
import { Icon, type IconName } from './icons'
import { navigate, useApp } from './state'

/**
 * Command palette (Ctrl/⌘+K or "/"): jump to pages, players, evenings and
 * bookings, or run actions like "Zahlung buchen" and "Gerät wechseln".
 * ARIA combobox + listbox; ↑/↓ moves, Enter runs, Esc closes.
 */

type Item = {
  id: string
  group: string
  label: string
  sub?: string
  icon?: IconName
  lead?: ReactNode
  hint?: ReactNode
  keywords?: string
  run: () => void
}

const PAGES: Array<{ to: string; label: string; icon: IconName; keywords: string }> = [
  { to: '/', label: 'Kommandozentrale', icon: 'grid', keywords: 'übersicht dashboard start home' },
  { to: '/spieler', label: 'Spieler', icon: 'people', keywords: 'mannschaft schulden salden' },
  { to: '/abende', label: 'Abende', icon: 'calendar', keywords: 'spielabende sessions' },
  { to: '/historie', label: 'Historie', icon: 'time', keywords: 'buchungen verlauf protokoll audit' },
  { to: '/buchen', label: 'Buchen', icon: 'cash', keywords: 'kasse zahlung korrektur entnahme' },
  { to: '/auftraege', label: 'Aufträge', icon: 'layers', keywords: 'warteschlange commands ausstehend' },
  { to: '/einstellungen', label: 'Einstellungen', icon: 'settings', keywords: 'einsatz regeln kasse name' },
  { to: '/geraete', label: 'Geräte', icon: 'tablet', keywords: 'tablet sync verbindung sperren' },
]

const KIND_LABELS: Record<string, string> = {
  loss: 'Verlust',
  beerround: 'Bierrunde',
  absence: 'Abwesenheit',
  payment: 'Zahlung',
  correction: 'Korrektur',
  withdrawal: 'Entnahme',
}

const normalize = (value: string) =>
  value
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')

/** 0 = no match; higher is better (prefix of label > word start > anywhere). */
function score(item: Item, query: string) {
  if (!query) return 1
  const label = normalize(item.label)
  const haystack = `${label} ${normalize(item.sub ?? '')} ${normalize(item.keywords ?? '')}`
  const terms = query.split(/\s+/).filter(Boolean)
  let total = 0
  for (const term of terms) {
    if (label.startsWith(term)) total += 6
    else if (new RegExp(`(^|[\\s·(„-])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(haystack)) total += 3
    else if (haystack.includes(term)) total += 1
    else return 0
  }
  return total
}

type Data = { players: PlayerDebtSummary[]; sessions: SessionOverview[]; history: HistoryRow[] }

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { activeDevices, selectedDevice, selectDevice, pending, device } = useApp()
  const { openBooking } = useActions()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'root' | 'devices'>('root')
  const [active, setActive] = useState(0)
  const [data, setData] = useState<Data | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    let alive = true
    Promise.all([
      api<PlayerDebtSummary[]>('/debts').catch(() => []),
      api<SessionOverview[]>('/sessions').catch(() => []),
      api<HistoryRow[]>('/history?limit=300').catch(() => []),
    ]).then(([players, sessions, history]) => alive && setData({ players, sessions, history }))
    return () => {
      alive = false
    }
  }, [device])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    document.body.classList.add('dialog-open')
    return () => {
      document.body.classList.remove('dialog-open')
      previous?.focus?.({ preventScroll: true })
    }
  }, [])

  const go = (to: string) => () => {
    onClose()
    navigate(to)
  }

  const items = useMemo<Item[]>(() => {
    if (mode === 'devices') {
      return activeDevices.map((entry) => ({
        id: `device:${entry.id}`,
        group: 'Gerät wählen',
        label: entry.label,
        sub: `zuletzt gesehen ${relativeTime(entry.lastSeenAt)}${entry.pendingCommands ? ` · ${entry.pendingCommands} ausstehend` : ''}`,
        lead: <DeviceDot device={entry} />,
        hint: entry.id === selectedDevice?.id ? <Icon name="check" size={15} /> : undefined,
        run: () => {
          selectDevice(entry.id)
          onClose()
        },
      }))
    }
    const list: Item[] = [
      { id: 'a:payment', group: 'Aktionen', label: 'Zahlung buchen', icon: 'cash-in', keywords: 'einzahlen bezahlen geld', run: () => openBooking('payment') },
      { id: 'a:withdrawal', group: 'Aktionen', label: 'Entnahme buchen', icon: 'cash-out', keywords: 'auszahlen kasse bier einkauf', run: () => openBooking('withdrawal') },
      { id: 'a:correction', group: 'Aktionen', label: 'Korrektur buchen', icon: 'swap-vertical', keywords: 'korrigieren gutschrift', run: () => openBooking('correction') },
      { id: 'a:player', group: 'Aktionen', label: 'Spieler anlegen', icon: 'person-add', keywords: 'neu gast stammspieler', run: () => openBooking('player') },
      ...(activeDevices.length > 1
        ? [
            {
              id: 'a:device',
              group: 'Aktionen',
              label: 'Gerät wechseln',
              sub: selectedDevice ? `aktuell „${selectedDevice.label}“` : undefined,
              icon: 'swap' as IconName,
              keywords: 'tablet kasse umschalten',
              run: () => {
                setMode('devices')
                setQuery('')
                setActive(0)
              },
            },
          ]
        : []),
      ...(pending.length > 0
        ? [{ id: 'a:pending', group: 'Aktionen', label: `${pending.length} ausstehende Aufträge ansehen`, icon: 'layers' as IconName, keywords: 'zurücknehmen stornieren', run: go('/auftraege?filter=pending') }]
        : []),
      ...PAGES.map((page) => ({ id: `p:${page.to}`, group: 'Seiten', label: page.label, icon: page.icon, keywords: page.keywords, run: go(page.to) })),
    ]
    if (data) {
      for (const player of data.players) {
        list.push({
          id: `pl:${player.playerId}`,
          group: 'Spieler',
          label: player.playerName,
          sub: `${player.isCore ? 'Stamm' : 'Gast'}${player.isArchived ? ' · archiviert' : ''} · offen ${formatCurrency(player.openDebtCents)}`,
          lead: <Avatar id={player.playerId} name={player.playerName} size={24} muted={player.isArchived} />,
          keywords: 'spieler',
          run: go(`/spieler?spieler=${encodeURIComponent(player.playerId)}`),
        })
      }
      for (const session of data.sessions) {
        list.push({
          id: `s:${session.id}`,
          group: 'Abende',
          label: session.title,
          sub: `${formatDate(session.startedAt)} · ${session.status === 'open' ? 'läuft' : 'beendet'} · ${formatCurrency(session.totalLossCents + session.totalAbsenceCents)}`,
          icon: session.status === 'open' ? 'pulse' : 'calendar',
          keywords: `abend ${formatDate(session.startedAt)}`,
          run: go(`/abende/${encodeURIComponent(session.id)}`),
        })
      }
      for (const entry of data.history) {
        if (entry.kind === 'audit') continue
        const kind = KIND_LABELS[entry.kind] ?? entry.kind
        const who = entry.kind === 'withdrawal' ? (entry.note ?? entry.message) : (entry.playerName ?? '')
        list.push({
          id: `h:${entry.kind}:${entry.id}`,
          group: 'Buchungen',
          label: `${kind}${who ? ` · ${who}` : ''}`,
          sub: `${formatDate(entry.createdAt)}${entry.sessionTitle ? ` · ${entry.sessionTitle}` : ''}${entry.note && entry.kind !== 'withdrawal' ? ` · ${entry.note}` : ''}`,
          icon: entry.kind === 'payment' ? 'cash-in' : entry.kind === 'withdrawal' ? 'cash-out' : entry.kind === 'beerround' ? 'beer' : entry.kind === 'correction' ? 'swap-vertical' : 'receipt',
          hint: entry.amountCents !== null ? <span className="amount">{formatSignedCurrency(entry.kind === 'payment' || entry.kind === 'withdrawal' ? -entry.amountCents : entry.amountCents)}</span> : undefined,
          keywords: `buchung ${entry.message}`,
          run: go(`/historie?eintrag=${encodeURIComponent(entry.id)}`),
        })
      }
    }
    return list
  }, [mode, data, activeDevices, selectedDevice, pending.length])

  const results = useMemo(() => {
    const q = normalize(query.trim())
    const limits: Record<string, number> = q ? { Aktionen: 5, Seiten: 4, Spieler: 6, Abende: 5, Buchungen: 8 } : { Aktionen: 6, Seiten: 8 }
    const scored = items
      .map((item, index) => ({ item, index, score: score(item, q) }))
      .filter((entry) => entry.score > 0 && (mode === 'devices' || limits[entry.item.group] !== undefined))
    const byGroup = new Map<string, typeof scored>()
    for (const entry of scored) byGroup.set(entry.item.group, [...(byGroup.get(entry.item.group) ?? []), entry])
    const groups = [...byGroup.entries()].map(([group, entries]) => ({
      group,
      best: Math.max(...entries.map((entry) => entry.score)),
      items: entries
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, mode === 'devices' ? 20 : limits[group])
        .map((entry) => entry.item),
    }))
    // With a query the best-matching group comes first; without, the natural order.
    if (q) groups.sort((a, b) => b.best - a.best)
    return groups
  }, [items, query, mode])

  const flat = results.flatMap((group) => group.items)
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1))
  const activeItem = flat[activeIndex]

  useEffect(() => setActive(0), [query, mode])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') setActive((index) => (flat.length ? (index + 1) % flat.length : 0))
    else if (event.key === 'ArrowUp') setActive((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0))
    else if (event.key === 'Home' && event.ctrlKey) setActive(0)
    else if (event.key === 'End' && event.ctrlKey) setActive(flat.length - 1)
    else if (event.key === 'Enter') activeItem?.run()
    else if (event.key === 'Escape') {
      if (mode !== 'root') setMode('root')
      else onClose()
    } else if (event.key === 'Backspace' && !query && mode !== 'root') setMode('root')
    else if (event.key === 'Tab') {
      // Focus stays in the palette.
    } else return
    event.preventDefault()
  }

  let position = -1
  return createPortal(
    <div className="overlay palette-overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Suche und Befehle">
        <div className="palette-search">
          <Icon name="search" size={18} />
          {mode === 'devices' ? (
            <button type="button" className="palette-crumb" onClick={() => setMode('root')}>
              Gerät wechseln <Icon name="close" size={12} />
            </button>
          ) : null}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={mode === 'devices' ? 'Gerät suchen…' : 'Spieler, Abende, Buchungen oder Aktion suchen…'}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? `${listId}-${activeIndex}` : undefined}
            aria-label="Suche"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results" role="listbox" id={listId} ref={listRef} aria-label="Ergebnisse">
          {flat.length === 0 ? (
            <div className="palette-empty">
              <Icon name="search" size={20} />
              {data || !query ? `Nichts gefunden für „${query}“.` : 'Lade Daten…'}
            </div>
          ) : null}
          {results.map((group) => (
            <div key={group.group} role="group" aria-label={group.group}>
              <div className="palette-group">{group.group}</div>
              {group.items.map((item) => {
                position += 1
                const index = position
                return (
                  <div
                    key={item.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex}
                    className="palette-item"
                    onPointerMove={() => index !== activeIndex && setActive(index)}
                    onClick={() => item.run()}
                  >
                    <span className="palette-lead">{item.lead ?? (item.icon ? <Icon name={item.icon} size={17} /> : null)}</span>
                    <span className="palette-text">
                      <span className="palette-label">{item.label}</span>
                      {item.sub ? <span className="palette-sub">{item.sub}</span> : null}
                    </span>
                    {item.hint ? <span className="palette-hint">{item.hint}</span> : null}
                    <Icon name="return" size={14} className="palette-enter" />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> wählen
          </span>
          <span>
            <kbd>↵</kbd> öffnen
          </span>
          <span>
            <kbd>Strg</kbd>/<kbd>⌘</kbd> <kbd>K</kbd> oder <kbd>/</kbd> Suche
          </span>
          {selectedDevice ? <span className="palette-device">Gerät: {selectedDevice.label}</span> : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
