import { useEffect, useState } from 'react'
import { Button, IconButton } from './components'
import { Modal } from './dialog'

export function WebTableLock() {
  const [locked, setLocked] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { document.documentElement.dataset.tableLocked = String(locked); return () => { delete document.documentElement.dataset.tableLocked } }, [locked])
  return <>
    <IconButton label="Tisch sperren" icon="shield" onClick={() => { setConfirm(false); setLocked(true) }} />
    {locked ? <Modal title="Tisch gesperrt" icon="shield" onClose={() => {}} footer={confirm ? <Button onClick={() => setLocked(false)}>Bedienung jetzt freigeben</Button> : <Button variant="secondary" onClick={() => setConfirm(true)}>Entsperren</Button>}><p>Die Anzeige wird weiter aktualisiert. Die Bedienung bleibt bis zur ausdrücklichen Freigabe gesperrt.</p></Modal> : null}
  </>
}
