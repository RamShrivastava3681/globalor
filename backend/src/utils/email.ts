import nodemailer from "nodemailer";
import { config } from "../config.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const { smtp } = config;
  if (!smtp.host || !smtp.user || !smtp.pass) {
    console.warn("   ⚠️ SMTP not configured — email won't be sent.");
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });
  }

  return transporter;
}

export interface WelcomeEmailParams {
  to: string;
  companyName: string;
  contactName: string | null;
  password: string;
}

export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<void> {
  const t = getTransporter();
  if (!t) return;

  const { smtp } = config;
  const name = params.contactName || params.companyName;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f4f6f9; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a365d 0%, #2563eb 100%); color: #ffffff; padding: 32px 36px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.5px; }
    .body { padding: 32px 36px; color: #1f2937; }
    .body p { line-height: 1.6; margin: 0 0 16px; font-size: 15px; }
    .credentials { background: #f0f4ff; border-radius: 8px; padding: 20px 24px; margin: 20px 0; border: 1px solid #dbeafe; }
    .credentials .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 4px; }
    .credentials .value { font-size: 15px; font-weight: 600; color: #1e40af; margin-bottom: 16px; word-break: break-all; }
    .credentials .value:last-child { margin-bottom: 0; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin-top: 8px; }
    .btn:hover { background: #1d4ed8; }
    .footer { padding: 24px 36px; text-align: center; color: #9ca3af; font-size: 13px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Insight Factor</h1>
    </div>
    <div class="body">
      <p>Hello <strong>${name}</strong>,</p>
      <p>Your account has been created on the <strong>Insight Factor</strong> platform. Below are your login credentials:</p>
      <div class="credentials">
        <div class="label">Email Address</div>
        <div class="value">${params.to}</div>
        <div class="label">Temporary Password</div>
        <div class="value">${params.password}</div>
      </div>
      <p style="text-align: center;">
        <a href="${config.appUrl}/auth" class="btn">Sign In to Your Account</a>
      </p>
      <p style="font-size: 14px; color: #6b7280;">For security reasons, please change your password after your first login.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Insight Factor. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  try {
    await t.sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail || smtp.user}>`,
      to: params.to,
      subject: "Welcome to Insight Factor — Your Account Credentials",
      html,
    });
    console.log(`   ✅ Welcome email sent to ${params.to}`);
  } catch (err) {
    console.error(`   ❌ Failed to send welcome email to ${params.to}:`, err);
  }
}

export interface NoaEmailParams {
  to: string;
  debtorName: string;
  debtorContactName: string | null;
  invoiceNumber: string;
  amount: number;
  companyName: string;
  noaUrl: string;
}

export async function sendNoaEmail(params: NoaEmailParams): Promise<void> {
  const t = getTransporter();
  if (!t) return;

  const { smtp } = config;
  const name = params.debtorContactName || params.debtorName;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f4f6f9; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a365d 0%, #2563eb 100%); color: #ffffff; padding: 32px 36px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.5px; }
    .body { padding: 32px 36px; color: #1f2937; }
    .body p { line-height: 1.6; margin: 0 0 16px; font-size: 15px; }
    .details { background: #f0f4ff; border-radius: 8px; padding: 20px 24px; margin: 20px 0; border: 1px solid #dbeafe; }
    .details .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .details .row + .row { border-top: 1px solid #e5e7eb; }
    .details .label { color: #6b7280; }
    .details .value { font-weight: 600; color: #1e40af; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; }
    .btn:hover { background: #1d4ed8; }
    .footer { padding: 24px 36px; text-align: center; color: #9ca3af; font-size: 13px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Notice of Assignment</h1>
    </div>
    <div class="body">
      <p>Dear <strong>${name}</strong>,</p>
      <p><strong>${params.companyName}</strong> has assigned the following invoice to us as part of a factoring arrangement. Please review and respond to this notification.</p>
      <div class="details">
        <div class="row"><span class="label">Invoice Number</span><span class="value">${params.invoiceNumber}</span></div>
        <div class="row"><span class="label">Invoice Amount</span><span class="value">$${params.amount.toLocaleString()}</span></div>
        <div class="row"><span class="label">Assigning Company</span><span class="value">${params.companyName}</span></div>
      </div>
      <p style="text-align: center; margin-top: 24px;">
        <a href="${params.noaUrl}" class="btn">Review &amp; Respond</a>
      </p>
      <p style="font-size: 14px; color: #6b7280; margin-top: 16px;">By clicking the button above, you can view the full details and accept, reject, or comment on this notice.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Insight Factor. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  try {
    await t.sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail || smtp.user}>`,
      to: params.to,
      subject: `Notice of Assignment — Invoice ${params.invoiceNumber}`,
      html,
    });
    console.log(`   ✅ NOA email sent to ${params.to}`);
  } catch (err) {
    console.error(`   ❌ Failed to send NOA email to ${params.to}:`, err);
  }
}
