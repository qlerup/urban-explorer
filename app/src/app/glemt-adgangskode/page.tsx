import PasswordResetForm from '@/components/PasswordResetForm'
import { isFjordHubManaged } from '@/lib/fjordhub'

export const dynamic = 'force-dynamic'

export default function ForgotPasswordPage() {
  const hubManaged = isFjordHubManaged()
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-void-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <span className="text-4xl mb-2">🔦</span>
          <h1 className="text-2xl font-bold text-gray-100">Glemt adgangskode</h1>
          <p className="text-gray-500 text-sm mt-1">Nulstil din adgang sikkert</p>
        </div>
        <div className="card"><PasswordResetForm hubManaged={hubManaged} /></div>
      </div>
    </main>
  )
}
