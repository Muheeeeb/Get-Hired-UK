import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter;

function getTransporter() {
  if (!transporter) {
    if (env.smtp.host) {
      transporter = nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.port === 465,
        auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      });
    } else {
      // Dev fallback: log the email instead of sending.
      transporter = nodemailer.createTransport({ jsonTransport: true });
    }
  }
  return transporter;
}

export async function sendMail({ to, subject, html, text }) {
  const info = await getTransporter().sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    text,
  });
  if (!env.smtp.host) {
    console.log(`[mail:dev] To: ${to} | Subject: ${subject}`);
  }
  return info;
}

/** Branded navy/gold email shell used by the Daily Pulse and password resets. */
export function brandedEmail({ heading, bodyHtml, ctaLabel, ctaUrl }) {
  return `
  <div style="margin:0;padding:32px 16px;background:#F7F6F2;font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
      <tr><td style="background:#0A1F44;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
        <div style="color:#E4C55A;font-size:13px;letter-spacing:3px;text-transform:uppercase;">Get Hired UK</div>
        <div style="color:#F7F6F2;font-size:24px;margin-top:8px;font-weight:bold;">${heading}</div>
      </td></tr>
      <tr><td style="background:#ffffff;padding:32px;border:1px solid #e5e0d5;border-top:none;">
        <div style="color:#111827;font-size:16px;line-height:1.6;font-family:Helvetica,Arial,sans-serif;">${bodyHtml}</div>
        ${
          ctaLabel
            ? `<div style="text-align:center;margin-top:28px;">
                 <a href="${ctaUrl}" style="display:inline-block;background:#C9A227;color:#0A1F44;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:10px;">${ctaLabel}</a>
               </div>`
            : ''
        }
      </td></tr>
      <tr><td style="background:#071634;border-radius:0 0 16px 16px;padding:18px 32px;text-align:center;">
        <div style="color:#8b96ad;font-size:12px;font-family:Helvetica,Arial,sans-serif;">Working hard for your next role, every single day.</div>
      </td></tr>
    </table>
  </div>`;
}
