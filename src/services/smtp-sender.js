const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = require('../config');

function createTransport() {
  const isSecure = SMTP_PORT === 465;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: isSecure,
    auth: {
      type: 'LOGIN',
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

/**
 * @param {object} options
 * @param {string} options.to        - recipient email (entered by user)
 * @param {string} options.subject   - email subject (last in chain)
 * @param {string} options.body      - assembled chain text
 * @param {string} options.fromName  - sender display name (first email's from)
 */
async function sendEmail({ to, subject, body, fromName }) {
  const transport = createTransport();

  const from = fromName
    ? `"${fromName}" <${SMTP_FROM}>`
    : SMTP_FROM;

  const info = await transport.sendMail({
    from,
    to,
    subject,
    text: body,
    // Wrap in <pre> for basic HTML clients to preserve formatting
    html: `<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(body)}</pre>`,
  });

  return info;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendEmail };
