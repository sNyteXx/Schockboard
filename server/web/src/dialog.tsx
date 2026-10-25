import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { Button } from './components'
import { Icon, type IconName } from './icons'

/**
 * In-app dialogs (never window.confirm/alert): modal, side drawer and a
 * confirm dialog. Focus moves in, Tab is trapped, Escape and a click on the
 * backdrop close, focus returns to the opener.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Open dialogs, innermost last – only the top one reacts to keys. */
const stack: HTMLElement[] = []

function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, initialFocus: 'first-field' | 'container') {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const previous = document.activeElement as HTMLElement | null
    stack.push(element)
    const target =
      initialFocus === 'first-field'
        ? (element.querySelector<HTMLElement>('[data-autofocus], input:not([type="hidden"]):not([disabled]), select, textarea') ??
          element.querySelector<HTMLElement>('.dialog-foot .btn-primary, .dialog-foot .btn-danger-solid'))
        : null
    ;(target ?? element).focus({ preventScroll: true })
    document.body.classList.add('dialog-open')

    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== element) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      } else if (event.key === 'Tab') {
        const items = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null)
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      stack.splice(stack.indexOf(element), 1)
      if (stack.length === 0) document.body.classList.remove('dialog-open')
      previous?.focus?.({ preventScroll: true })
    }
  }, [ref, initialFocus])
}

export function Modal(props: {
  title: ReactNode
  icon?: IconName
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  tone?: 'danger'
  size?: 'sm' | 'md' | 'lg'
  description?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialog(ref, props.onClose, 'first-field')
  return createPortal(
    <div className="overlay" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div
        ref={ref}
        className={`modal ${props.size ?? 'md'} ${props.tone ?? ''}`}
        role={props.tone === 'danger' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-head">
          {props.icon ? (
            <span className={`dialog-icon ${props.tone ?? ''}`} aria-hidden>
              <Icon name={props.icon} size={18} />
            </span>
          ) : null}
          <div className="dialog-titles">
            <h2 id={titleId}>{props.title}</h2>
            {props.description ? <div className="dialog-description">{props.description}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Schließen">
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="dialog-body">{props.children}</div>
        {props.footer ? <div className="dialog-foot">{props.footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}

export function Drawer(props: { title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useDialog(ref, props.onClose, 'container')
  return createPortal(
    <div className="overlay drawer-overlay" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="dialog-head drawer-head">
          {props.leading}
          <div className="dialog-titles">
            <h2 id={titleId}>{props.title}</h2>
            {props.subtitle ? <div className="dialog-description">{props.subtitle}</div> : null}
          </div>
          {props.actions}
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Schließen">
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="drawer-body">{props.children}</div>
      </aside>
    </div>,
    document.body
  )
}

/** Replacement for window.confirm(): a destructive or neutral yes/no dialog. */
export function ConfirmDialog(props: {
  title: ReactNode
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
  busy?: boolean
  tone?: 'danger'
  icon?: IconName
  disabled?: boolean
}) {
  return (
    <Modal
      title={props.title}
      icon={props.icon ?? (props.tone === 'danger' ? 'trash' : 'info')}
      tone={props.tone}
      onClose={props.onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Abbrechen
          </Button>
          <Button
            variant={props.tone === 'danger' ? 'danger-solid' : 'primary'}
            disabled={props.busy || props.disabled}
            onClick={() => void props.onConfirm()}
          >
            {props.confirmLabel}
          </Button>
        </>
      }
    >
      {props.children}
    </Modal>
  )
}
