import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!transporter) {
    console.log(`\n📧 [mail:dev] Para: ${to}\n   Asunto: ${subject}\n   ${text.replace(/\n/g, '\n   ')}\n`);
    return;
  }
  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
}
