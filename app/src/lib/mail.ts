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
    from: { name: 'Urban Explorer', address: settings.user },
    to,
    subject: `${code} er din sikkerhedskode til Urban Explorer`,
    text,
    html: `<!doctype html>
<html lang="da"><body style="margin:0;padding:0;background:#f5f1e8">
<div style="background:#f5f1e8;padding:32px 16px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#29251c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">
      <tr><td style="padding:0 6px 14px">
        <div style="font-size:11px;letter-spacing:2px;color:#8a8272;text-transform:uppercase;font-weight:700">Urban Explorer</div>
        <div style="font-family:'Palatino Linotype',Palatino,Georgia,serif;font-size:28px;font-weight:700;margin-top:4px">Nulstil adgangskode</div>
      </td></tr>
      <tr><td style="background:#fffdf7;border:1px solid #e3dccb;border-radius:14px;padding:24px">
        <div style="font-size:14px;line-height:1.6;color:#514b40">Brug sikkerhedskoden herunder for at vælge en ny adgangskode.</div>
        <div style="margin:22px 0;padding:18px 12px;background:#f8eee2;border:1px solid #e08a3c;border-radius:10px;text-align:center;font-size:30px;font-weight:800;letter-spacing:8px;color:#9a4f16">${code}</div>
        <div style="font-size:13px;line-height:1.6;color:#8a8272"><strong style="color:#514b40">Koden udløber om 5 minutter.</strong><br>Hvis du ikke har bedt om at nulstille din adgangskode, kan du roligt ignorere mailen.</div>
      </td></tr>
      <tr><td style="padding:14px 6px 0;font-size:12px;color:#8a8272;text-align:center">Sendt automatisk af Urban Explorer · Du skal ikke besvare denne mail</td></tr>
    </table>
  </td></tr></table>
</div>
</body></html>`,
  })
}
