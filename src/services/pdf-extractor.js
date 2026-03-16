const axios = require('axios');
const { Mistral } = require('@mistralai/mistralai');
const { MAX_PDF_SIZE_MB, TELEGRAM_BOT_TOKEN, MISTRAL_API_KEY } = require('../config');

const MAX_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;
const mistral = new Mistral({ apiKey: MISTRAL_API_KEY });

async function extractPdfText(fileId) {
  // Get file path from Telegram
  const metaUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const metaRes = await axios.get(metaUrl);
  if (!metaRes.data.ok) throw new Error('Не удалось получить информацию о файле от Telegram');

  const filePath = metaRes.data.result.file_path;
  const fileSize = metaRes.data.result.file_size;

  if (fileSize && fileSize > MAX_BYTES) {
    throw new Error(`Файл слишком большой (${(fileSize / 1024 / 1024).toFixed(1)} МБ). Максимум ${MAX_PDF_SIZE_MB} МБ.`);
  }

  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(fileRes.data);

  if (buffer.length > MAX_BYTES) {
    throw new Error(`Файл слишком большой. Максимум ${MAX_PDF_SIZE_MB} МБ.`);
  }

  const base64 = buffer.toString('base64');
  const result = await mistral.ocr.process({
    model: 'mistral-ocr-latest',
    document: {
      type: 'document_url',
      documentUrl: `data:application/pdf;base64,${base64}`,
    },
  });

  const text = (result.pages || []).map((p) => p.markdown || '').join('\n\n').trim();

  if (!text) {
    throw new Error('Mistral OCR не смог извлечь текст из PDF.');
  }

  return text;
}

module.exports = { extractPdfText };
