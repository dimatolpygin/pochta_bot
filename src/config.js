require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env variable: ${name}`);
  return val;
}

module.exports = {
  TELEGRAM_BOT_TOKEN: required('TELEGRAM_BOT_TOKEN'),
  OPENAI_API_KEY: required('OPENAI_API_KEY'),
  MISTRAL_API_KEY: required('MISTRAL_API_KEY'),
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o',

  SMTP_HOST: required('SMTP_HOST'),
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: required('SMTP_USER'),
  SMTP_PASS: required('SMTP_PASS'),
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER,

  ADMIN_PASSWORD: required('ADMIN_PASSWORD'),

  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),

  SESSION_TIMEOUT_MINUTES: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '10', 10),
  MAX_PDF_SIZE_MB: parseInt(process.env.MAX_PDF_SIZE_MB || '10', 10),
  MAX_GENERATIONS_PER_DAY: parseInt(process.env.MAX_GENERATIONS_PER_DAY || '100', 10),
};
