import type { ReactNode, SVGProps } from 'react'

/**
 * Small inline icon set in the style of Ionicons "outline" (the app's icon
 * family): 24 px grid, 1.8 px round strokes, no fills except dots. No icon
 * font, no CDN.
 */
const PATHS = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4" />
      <path d="M18 14.4c1.9.7 3.2 2.5 3.5 5.1" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5" />
    </>
  ),
  'person-add': (
    <>
      <circle cx="10" cy="8" r="3.8" />
      <path d="M3 20.5c.7-3.8 3.5-6.2 7-6.2 1.6 0 3 .5 4.2 1.3" />
      <path d="M18.5 14v6M15.5 17h6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7.5h14.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
      <path d="M16.5 14h1" />
    </>
  ),
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19M6 15h4" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5 21 8l-9 4.5L3 8z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16 9 4.5 9-4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </>
  ),
  tablet: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  add: <path d="M12 5v14M5 12h14" />,
  remove: <path d="M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  pencil: (
    <>
      <path d="M15.5 4.5 19.5 8.5 8.5 19.5H4.5v-4z" />
      <path d="m13 7 4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2" />
      <path d="M6.5 6.5 7.5 20h9l1-13.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 4.5v15" />
      <path d="m6 13.5 6 6 6-6" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 19.5v-15" />
      <path d="m6 10.5 6-6 6 6" />
    </>
  ),
  'cash-in': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M8.5 13l3.5 3.5 3.5-3.5" />
    </>
  ),
  'cash-out': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 16.5v-9M8.5 11 12 7.5l3.5 3.5" />
    </>
  ),
  'trending-down': (
    <>
      <path d="m3 7 6.5 6.5 4-4L21 17" />
      <path d="M15 17h6v-6" />
    </>
  ),
  'trending-up': (
    <>
      <path d="m3 17 6.5-6.5 4 4L21 7" />
      <path d="M15 7h6v6" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h15M15 4l4 4-4 4" />
      <path d="M20 16H5M9 12l-4 4 4 4" />
    </>
  ),
  'swap-vertical': (
    <>
      <path d="M8 20V5M4 9l4-4 4 4" />
      <path d="M16 4v15M12 15l4 4 4-4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.2" r=".6" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r=".6" fill="currentColor" />
    </>
  ),
  beer: (
    <>
      <path d="M5.5 7.5h10v11a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2z" />
      <path d="M15.5 10h2a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-2" />
      <path d="M5.5 7.5a2.5 2.5 0 0 1 2.4-3.2 3 3 0 0 1 5.2.2 2.4 2.4 0 0 1 2.4 3" />
      <path d="M9 11.5v5M12 11.5v5" />
    </>
  ),
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="9" cy="9" r=".9" fill="currentColor" />
      <circle cx="15" cy="15" r=".9" fill="currentColor" />
      <circle cx="15" cy="9" r=".9" fill="currentColor" />
      <circle cx="9" cy="15" r=".9" fill="currentColor" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8.5h6M9 12h6" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4v4.5H15" />
    </>
  ),
  sync: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9" />
      <path d="M19.5 4.5V9H15" />
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15" />
      <path d="M4.5 19.5V15H9" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  shield: (
    <>
      <path d="M12 3 19.5 6v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  star: <path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
      <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" />
      <path d="M10 12.5h4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  ellipsis: (
    <>
      <circle cx="6" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="18" cy="12" r="1.1" fill="currentColor" />
    </>
  ),
  flash: <path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z" />,
  'cloud-up': (
    <>
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.4 7.5" />
      <path d="M12 20.5v-7M9 16l3-3 3 3" />
    </>
  ),
  document: (
    <>
      <path d="M6.5 3.5h7l4 4v13h-11z" />
      <path d="M13.5 3.5v4h4M9 12.5h6M9 16h6" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6.2 7.3v5.7l-3.6 2v-7.7z" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9" />
    </>
  ),
  return: (
    <>
      <path d="M19 5v6a3 3 0 0 1-3 3H6" />
      <path d="m9.5 10.5-3.5 3.5 3.5 3.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18, label, className, ...rest }: { name: IconName; size?: number; label?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className ?? ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {label ? <title>{label}</title> : null}
      {PATHS[name]}
    </svg>
  )
}
