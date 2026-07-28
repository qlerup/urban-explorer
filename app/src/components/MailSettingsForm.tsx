'use client'

import { useEffect, useState } from 'react'

export default function MailSettingsForm() {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('smtp.gmail.com')
  const [port, setPort] = useState(465)
  const [configured, setConfigured] = useState(false)
  const [hubManaged, setHubManaged] = useState(false)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/settings/mail').then(r => r.json()).then(data => {
      setUser(data.user || '')
      setHost(data.host || 'smtp.gmail.com')
      setPort(data.port || 465)
      setConfigured(Boolean(data.configured))
      setHubManaged(Boolean(data.hubManaged))
    })
  }, [])

  if (hubManaged) return (
    <div>
      <h2 className="font-semibold text-gray-200 mb-2">Email til glemt adgangskode</h2>
      <p className="text-sm text-gray-500">Denne installation bruger FjordHubs mailopsætning. Den konfigureres under Indstillinger i FjordHub.</p>
    </div>
  )

  async function save(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setStatus('')
    try {
      const response = await fetch('/api/settings/mail', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password, host, port }),
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
        <p className="text-sm text-gray-500 mt-1">Fx Gmail-adresse og app-adgangskode. Forbindelsen testes, før den gemmes krypteret.</p>
      </div>
      <div><label className="block text-sm text-gray-300 mb-1.5">Afsender-email</label><input className="input" type="email" value={user} onChange={e => setUser(e.target.value)} required /></div>
      <div><label className="block text-sm text-gray-300 mb-1.5">App-adgangskode</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required={!configured} placeholder={configured ? 'Lad stå tom for at beholde den nuværende' : ''} /></div>
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <div><label className="block text-sm text-gray-300 mb-1.5">SMTP-server</label><input className="input" value={host} onChange={e => setHost(e.target.value)} required /></div>
        <div><label className="block text-sm text-gray-300 mb-1.5">Port</label><input className="input" type="number" value={port} onChange={e => setPort(Number(e.target.value))} required /></div>
      </div>
      {status && <p className="text-sm text-gray-300">{status}</p>}
      <button className="btn-primary" disabled={loading}>{loading ? 'Tester...' : 'Test og gem'}</button>
    </form>
  )
}
