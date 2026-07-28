import nodemailer from 'nodemailer'
import pool from './db'
import { decrypt, encrypt, normalizeEmail } from './crypto'

export interface SmtpSettings {
  user: string
  password: string
  host: string
  port: number
}

export async function getSmtpSettings(): Promise<SmtpSettings | null> {
  const result = await pool.query(
    'SELECT smtp_user, smtp_password, smtp_host, smtp_port FROM app_settings WHERE id = 1'
  )
  const row = result.rows[0]
  if (!row?.smtp_user || !row?.smtp_password) return null
  try {
    return {
      user: decrypt(row.smtp_user),
      password: decrypt(row.smtp_password),
      host: row.smtp_host || 'smtp.gmail.com',
      port: Number(row.smtp_port) || 465,
    }
  } catch {
    return null
  }
}

function transport(settings: SmtpSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.password },
  })
}

export async function saveSmtpSettings(input: {
  user: string
  password?: string
  host?: string
  port?: number
}): Promise<void> {
  const user = normalizeEmail(input.user)
  const existing = await getSmtpSettings()
  const password = String(input.password || '').replace(/\s+/g, '') || existing?.password
  if (!user || !password) throw new Error('Email og app-adgangskode er påkrævet')
  const settings = {
    user,
    password,
    host: String(input.host || 'smtp.gmail.com').trim(),
    port: Number(input.port) || 465,
  }
  await transport(settings).verify()
  await pool.query(
    `INSERT INTO app_settings (id, smtp_user, smtp_password, smtp_host, smtp_port, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       smtp_user = EXCLUDED.smtp_user,
       smtp_password = EXCLUDED.smtp_password,
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       updated_at = NOW()`,
    [encrypt(settings.user), encrypt(settings.password), settings.host, settings.port]
  )
}

export async function sendPasswordResetCode(to: string, code: string): Promise<void> {
  const settings = await getSmtpSettings()
  if (!settings) throw new Error('Mailafsendelse er ikke konfigureret')
  const text =
    `Hej\n\nDin sikkerhedskode til Urban Explorer er: ${code}\n\n` +
    'Koden udløber om 5 minutter. Hvis du ikke har bedt om den, kan du ignorere denne mail.'
  await transport(settings).sendMail({
    from: settings.user,
    to,
    subject: 'Sikkerhedskode til Urban Explorer',
    text,
    html: `<p>Hej</p><p>Din sikkerhedskode til Urban Explorer er:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Koden udløber om 5 minutter. Hvis du ikke har bedt om den, kan du ignorere denne mail.</p>`,
  })
}
