'use client'

import Link from 'next/link'
import { useState } from 'react'

type Step = 'email' | 'code' | 'password' | 'done'

export default function PasswordResetForm({ hubManaged }: { hubManaged: boolean }) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function call(body: Record<string, string>) {
    const response = await fetch('/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Der skete en fejl')
    return data
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true); setError('')
    try {
      const data = await call({ action: 'request', email })
      setChallengeId(data.challengeId)
      setMessage(data.message)
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke sende koden')
    } finally { setLoading(false) }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true); setError('')
    try {
      const data = await call({ action: 'verify', challengeId, code })
      setResetToken(data.resetToken)
      setStep('password')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Koden kunne ikke godkendes')
    } finally { setLoading(false) }
  }

  async function complete(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true); setError('')
    try {
      await call({ action: 'complete', challengeId, resetToken, password, confirmPassword })
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adgangskoden kunne ikke ændres')
    } finally { setLoading(false) }
  }

  if (step === 'done') return (
    <div className="space-y-4 text-center">
      <p className="text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-3">
        Din adgangskode er ændret.
      </p>
      <Link href="/login" className="btn-primary block">Tilbage til login</Link>
    </div>
  )

  return (
    <div className="space-y-4">
      {step === 'email' && (
        <form onSubmit={requestCode} className="space-y-4">
          <p className="text-sm text-gray-400">
            Indtast email-adressen på din {hubManaged ? 'FjordHub-konto' : 'Urban Explorer-konto'}.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <button className="btn-primary" disabled={loading}>{loading ? 'Sender...' : 'Send sikkerhedskode'}</button>
        </form>
      )}
      {step === 'code' && (
        <form onSubmit={verifyCode} className="space-y-4">
          <p className="text-sm text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">{message}</p>
          <p className="text-sm text-gray-400">Koden består af 6 cifre og udløber efter 5 minutter.</p>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Sikkerhedskode</label>
            <input className="input text-center tracking-[0.35em] text-lg" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
          </div>
          <button className="btn-primary" disabled={loading}>{loading ? 'Tjekker...' : 'Fortsæt'}</button>
        </form>
      )}
      {step === 'password' && (
        <form onSubmit={complete} className="space-y-4">
          <p className="text-sm text-gray-400">Du ændrer adgangskoden for <span className="text-gray-200 font-medium">{email}</span>.</p>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Ny adgangskode</label>
            <input className="input" type="password" minLength={hubManaged ? 6 : 12} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Gentag adgangskode</label>
            <input className="input" type="password" minLength={hubManaged ? 6 : 12} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
          </div>
          <button className="btn-primary" disabled={loading}>{loading ? 'Gemmer...' : 'Gem ny adgangskode'}</button>
        </form>
      )}
      {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
      <div className="text-center"><Link href="/login" className="text-sm text-gray-500 hover:text-gray-300">Tilbage til login</Link></div>
    </div>
  )
}
