/**
 * Assembles the full email chain into a single text body
 * formatted as nested email thread.
 */

const SEPARATOR = '==========================================';
const INNER_SEP = '------------------------------------------';

/**
 * @param {Array} emails - array from email-generator
 * @returns {{ body: string, subject: string }}
 */
function assembleChain(emails) {
  const parts = emails.map((email) => {
    const attachmentsLine = email.attachments && email.attachments.length > 0
      ? email.attachments.join(', ')
      : '';

    return [
      SEPARATOR,
      `From: "${email.from}" <${email.fromEmail}>`,
      `To: <${email.toEmail}>`,
      `Date: ${email.rfcDate}`,
      `Subject: ${email.subject}`,
      `Cc:`,
      `Attachments: ${attachmentsLine}`,
      INNER_SEP,
      '',
      email.body,
      '',
      SEPARATOR,
    ].join('\n');
  });

  const body = parts.join('\n\n');
  const subject = emails[emails.length - 1].subject;

  return { body, subject };
}

module.exports = { assembleChain };
