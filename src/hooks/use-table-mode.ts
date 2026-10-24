import { useDeviceLayout } from '@/hooks/use-device-layout'

/** Pure rule so it can be unit-tested: landscape tablet or very wide window. */
export function isTableModeLayout(input: { width: number; isWide: boolean; isLandscape: boolean }) {
  return (input.isWide && input.isLandscape) || input.width >= 1000
}

/** Number of tile columns in the center of the three-column table layout. */
export function tableModeColumns(width: number) {
  return width >= 1500 ? 4 : 3
}

export function useTableMode() {
  const layout = useDeviceLayout()
  const tableMode = isTableModeLayout(layout)
  return { ...layout, tableMode, tableColumns: tableModeColumns(layout.width) }
}
