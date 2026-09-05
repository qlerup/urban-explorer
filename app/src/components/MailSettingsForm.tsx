'use client'

import { useEffect, useState } from 'react'

function ForgotPasswordToggle() {
  const [enabled, setEnabled] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/forgot-password').then(r => r.json()).then(data => {
      setEnabled(data.enabled !== false)
      setLoaded(true)
    })
  }, [])

  async function toggle(next: boolean) {
    setEnabled(next); setSaving(true)
    try {
      await fetch('/api/settings/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
    } finally { setSaving(false) }
  }

  if (!loaded) return null
  return (
    <div className="pb-4 mb-4 border-b border-gray-800">
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={e => toggle(e.target.checked)} />
        <span className="text-sm text-gray-200">Tillad &quot;Glemt adgangskode?&quot; på login-siden</span>
      </label>
      <p className="text-xs text-gray-500 mt-1 ml-6">
        Slår kun denne apps egen glemt-kode-side til/fra. FjordHub og andre apps har hver deres egen tilsvarende indstilling.
      </p>
    </div>
  )
}

interface PendingMail {
  user: string
  password: string
  host: string
  port: number
  fromAddress: string
}

function TestEmailModal({ pending, onClose, onConfirmed }: {
  pending: PendingMail
  onClose: () => void
  onConfirmed: () => Promise<void>
}) {
  const [testTo, setTestTo] = useState('')
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function sendTest() {
    if (!testTo.trim()) return
    setSending(true); setError('')
    try {
      const response = await fetch('/api/settings/mail/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pending, testTo }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Kunne ikke sende testmailen')
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke sende testmailen')
    } finally { setSending(false) }
  }

  async function confirm() {
    setConfirming(true)
    try {
      await onConfirmed()
    } finally { setConfirming(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md">
        <h3 className="font-semibold text-gray-100 mb-1.5">Send en testmail først</h3>
        <p className="text-sm text-gray-500 mb-4">Vi sender en rigtig mail med de nye indstillinger, så du kan bekræfte at den faktisk kommer frem, før den gemmes.</p>

        {!sent ? (
          <>
            <label className="block text-sm text-gray-300 mb-1.5">Send testmail til</label>
            <input className="input" type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="din@email.dk" autoFocus />
            {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="btn-secondary" onClick={onClose}>Annuller</button>
              <button type="button" className="btn-primary" onClick={sendTest} disabled={sending}>{sending ? 'Sender…' : 'Send testmail'}</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-green-400">Testmailen er sendt. Tjek indbakken (og Spam) for at bekræfte at den kom frem.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" className="btn-secondary" onClick={() => setSent(false)}>Prøv en anden adresse</button>
              <button type="button" className="btn-primary" onClick={confirm} disabled={confirming}>{confirming ? 'Gemmer…' : 'Jeg modtog mailen'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function MailSettingsForm() {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('smtp.gmail.com')
  const [port, setPort] = useState(465)
  const [fromAddress, setFromAddress] = useState('')
  const [configured, setConfigured] = useState(false)
  const [hubManaged, setHubManaged] = useState(false)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PendingMail | null>(null)

  useEffect(() => {
    fetch('/api/settings/mail').then(r => r.json()).then(data => {
      setUser(data.user || '')
      setHost(data.host || 'smtp.gmail.com')
      setPort(data.port || 465)
      setFromAddress(data.fromAddress || '')
      setConfigured(Boolean(data.configured))
      setHubManaged(Boolean(data.hubManaged))
    })
  }, [])

  if (hubManaged) return (
    <div>
      <h2 className="font-semibold text-gray-200 mb-2">Email til glemt adgangskode</h2>
      <ForgotPasswordToggle />
      <p className="text-sm text-gray-500">Denne installation bruger FjordHubs mailopsætning. Selve mailafsendelsen konfigureres under Indstillinger i FjordHub.</p>
    </div>
  )

  function openTestModal(event: React.FormEvent) {
    event.preventDefault(); setStatus('')
    setPending({ user, password, host, port, fromAddress })
  }

  async function actuallySave() {
    if (!pending) return
    setSaving(true)
    try {
      const response = await fetch('/api/settings/mail', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Kunne ikke gemme')
      setConfigured(true); setPassword(''); setStatus('Mailopsætningen er gemt.')
      setPending(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kunne ikke gemme')
      setPending(null)
    } finally { setSaving(false) }
  }

  return (
    <>
      <form onSubmit={openTestModal} className="space-y-4">
        <div>
          <h2 className="font-semibold text-gray-200">Email til glemt adgangskode</h2>
          <p className="text-sm text-gray-500 mt-1">Fx Gmail eller Resend. Du sender en testmail for at bekræfte at den virker, før den gemmes.</p>
        </div>
        <ForgotPasswordToggle />
        <div><label className="block text-sm text-gray-300 mb-1.5">Afsender-email</label><input className="input" type="email" value={fromAddress} onChange={e => setFromAddress(e.target.value)} placeholder="noreply@dit-domæne.dk" required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm text-gray-300 mb-1.5">SMTP-brugernavn</label><input className="input" value={user} onChange={e => setUser(e.target.value)} placeholder='fx din Gmail-adresse, eller "resend"' required /></div>
          <div><label className="block text-sm text-gray-300 mb-1.5">Adgangskode / API-nøgle</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required={!configured} placeholder={configured ? 'Lad stå tom for at beholde den nuværende' : ''} /></div>
        </div>
        <div className="grid grid-cols-[1fr_100px] gap-3">
          <div><label className="block text-sm text-gray-300 mb-1.5">SMTP-server</label><input className="input" value={host} onChange={e => setHost(e.target.value)} placeholder="fx smtp.resend.com" required /></div>
          <div><label className="block text-sm text-gray-300 mb-1.5">Port</label><input className="input" type="number" value={port} onChange={e => setPort(Number(e.target.value))} required /></div>
        </div>
        {status && <p className="text-sm text-gray-300">{status}</p>}
        <button className="btn-primary" disabled={saving}>{saving ? 'Gemmer…' : 'Test og gem'}</button>
      </form>
      {pending && (
        <TestEmailModal pending={pending} onClose={() => setPending(null)} onConfirmed={actuallySave} />
      )}
    </>
  )
}
