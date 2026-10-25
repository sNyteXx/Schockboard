import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Modal } from './dialog'
import { BOOKING_META, BookingFormFor, type BookingKind } from './forms'
import { CommandPalette } from './palette'
import { useApp } from './state'

/**
 * Global quick actions: the command palette (Ctrl/⌘+K, "/") and the booking
 * modal (Zahlung, Korrektur, Entnahme, Spieler) reachable from anywhere.
 */

type Actions = {
  openPalette: () => void
  openBooking: (kind: BookingKind, options?: { playerId?: string }) => void
}

const ActionsContext = createContext<Actions | null>(null)

export function useActions() {
  const value = useContext(ActionsContext)
  if (!value) throw new Error('ActionsProvider missing')
  return value
}

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const { device } = useApp()
  const [palette, setPalette] = useState(false)
  const [booking, setBooking] = useState<{ kind: BookingKind; playerId?: string } | null>(null)

  const openPalette = useCallback(() => setPalette(true), [])
  const openBooking = useCallback((kind: BookingKind, options?: { playerId?: string }) => {
    setPalette(false)
    setBooking({ kind, playerId: options?.playerId })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.documentElement.dataset.tableLocked === 'true') return
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette((open) => !open)
        return
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target) && !document.body.classList.contains('dialog-open')) {
        event.preventDefault()
        setPalette(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A device switch invalidates a half-filled booking for the old device.
  useEffect(() => setBooking(null), [device])

  const value = useMemo(() => ({ openPalette, openBooking }), [openPalette, openBooking])
  const meta = booking ? BOOKING_META[booking.kind] : null

  return (
    <ActionsContext.Provider value={value}>
      {children}
      {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}
      {booking && meta ? (
        <Modal title={meta.title} icon={meta.icon} description={meta.description} onClose={() => setBooking(null)}>
          <BookingFormFor kind={booking.kind} playerId={booking.playerId} onDone={() => setBooking(null)} />
        </Modal>
      ) : null}
    </ActionsContext.Provider>
  )
}
