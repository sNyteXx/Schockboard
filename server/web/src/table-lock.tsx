import { useEffect, useState } from 'react'
import { Button, IconButton } from './components'
import { Modal } from './dialog'

export function WebTableLock() {
  const [locked, setLocked] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { document.documentElement.dataset.tableLocked = String(locked); return () => { delete document.documentElement.dataset.tableLocked } }, [locked])
  return <>
    <IconButton label="Tisch sperren" icon="shield" onClick={() => { setConfirm(false); setLocked(true) }} />
    {locked ? <Modal title="Tisch gesperrt" icon="shield" placement="bottom" dismissible={false} onClose={() => {}} footer={confirm ? <><Button variant="secondary" onClick={() => setConfirm(false)}>Gesperrt lassen</Button><Button variant="primary" onClick={() => setLocked(false)}>Jetzt freigeben</Button></> : <Button variant="primary" onClick={() => setConfirm(true)}>Entsperren</Button>}><p>{confirm ? 'Bedienung jetzt wieder freigeben?' : 'Berührschutz aktiv. Der Spielstand bleibt sichtbar und wird aktualisiert.'}</p></Modal> : null}
  </>
}
