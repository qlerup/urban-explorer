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

export default function MailSettingsForm() {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('smtp.gmail.com')
  const [port, setPort] = useState(465)
  const [fromAddress, setFromAddress] = useState('')
  const [configured, setConfigured] = useState(false)
  const [hubManaged, setHubManaged] = useState(false)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

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

  async function save(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setStatus('')
    try {
      const response = await fetch('/api/settings/mail', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password, host, port, fromAddress }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Kunne ikke gemme')
      setConfigured(true); setPassword(''); setStatus('Forbindelsen virker, og mailopsætningen er gemt.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kunne ikke gemme')
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <h2 className="font-semibold text-gray-200">Email til glemt adgangskode</h2>
        <p className="text-sm text-gray-500 mt-1">Fx Gmail eller Resend. Forbindelsen testes, før den gemmes krypteret.</p>
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
      <button className="btn-primary" disabled={loading}>{loading ? 'Tester...' : 'Test og gem'}</button>
    </form>
  )
}
