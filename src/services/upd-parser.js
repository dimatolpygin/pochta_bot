const OpenAI = require('openai');
const { OPENAI_API_KEY, OPENAI_MODEL } = require('../config');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const SYSTEM_PROMPT = `Ты — эксперт по разбору российских бухгалтерских документов.
Тебе дадут текст УПД (Универсального Передаточного Документа).
Извлеки данные и верни строго валидный JSON без Markdown-обёртки.

Структура JSON:
{
  "buyer_name": "string",
  "seller_name": "string",
  "buyer_inn": "string",
  "buyer_kpp": "string",
  "seller_inn": "string",
  "seller_kpp": "string",
  "upd_number": "string",
  "upd_date": "YYYY-MM-DD",
  "shipment_date": "YYYY-MM-DD or null",
  "contract_number": "string or null",
  "contract_date": "YYYY-MM-DD or null",
  "items": [
    {
      "name": "string",
      "qty": number,
      "unit": "string",
      "price": number,
      "amount": number,
      "vat_rate": "string",
      "vat_amount": number
    }
  ],
  "total_without_vat": number,
  "total_vat": number,
  "total_with_vat": number,
  "missing_fields": ["список полей, которые не удалось извлечь"]
}

Если поле не найдено — укажи null и добавь его имя в missing_fields.
Числа — без пробелов, только цифры и точка.
Не путай номер договора и номер УПД.

ВАЖНО — числа с пробелом как разделителем тысяч:
В российских документах пробел используется как разделитель тысяч внутри числа.
Примеры: "1 576.00" = 1576.00, "8 499.00" = 8499.00, "23 302.00" = 23302.00.
Не объединяй значение из одной колонки с пробелом из другой.

ВАЖНО — таблица позиций УПД:
Колонки в строке товара (слева направо): Количество | Цена за единицу | Стоимость без налога | Сумма налога | Стоимость с налогом.
Колонка "Количество" — целое или дробное число (обычно небольшое: 1–1000).
Колонка "Цена" — цена за единицу, может быть четырёхзначной: "1 576.00" = 1576.00.
Колонка "Стоимость без налога" = Количество × Цена.
Проверяй: если Количество × Цена не равно Стоимости, значит одно из чисел прочитано неверно — перепроверь деление колонок.`;

const REQUIRED_FIELDS = [
  'buyer_name',
  'seller_name',
  'upd_number',
  'upd_date',
  'items',
  'total_without_vat',
  'total_vat',
  'total_with_vat',
];

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str || null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = String(value)
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');

  if (!normalized || normalized === '-' || normalized === '.') return null;

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function normalizeDate(value) {
  const str = toStringOrNull(value);
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [day, month, year] = str.split('.');
    return `${year}-${month}-${day}`;
  }

  return null;
}

function normalizeVatRate(value) {
  const str = toStringOrNull(value);
  if (!str) return null;

  const lower = str.toLowerCase();
  if (lower.includes('без')) return 'без НДС';

  const num = parseNumber(str);
  if (num === null) return str;
  if (num === 0) return 'без НДС';
  return `${num}%`;
}

function numberTolerance(value) {
  const abs = Math.abs(Number(value) || 0);
  return Math.max(0.01, abs * 0.01);
}

function isMismatch(a, b) {
  return Math.abs((a || 0) - (b || 0)) > numberTolerance(Math.max(a || 0, b || 0));
}

function normalizeItems(items, normalizationReport, validationWarnings) {
  if (!Array.isArray(items)) return [];

  return items.map((rawItem, index) => {
    const row = rawItem || {};
    let qty = parseNumber(row.qty);
    const price = parseNumber(row.price);
    let amount = parseNumber(row.amount);
    const vatAmount = parseNumber(row.vat_amount);
    const vatRate = normalizeVatRate(row.vat_rate);

    if (qty !== null) qty = round3(qty);
    if (amount !== null) amount = round2(amount);

    if (price !== null && amount !== null) {
      const candidateQty = round3(amount / price);
      const hasLikelyQtyParsingError =
        qty === null ||
        qty <= 0 ||
        qty > 10000;

      if (hasLikelyQtyParsingError && candidateQty > 0 && candidateQty < 10000) {
        const oldQty = qty;
        qty = candidateQty;
        normalizationReport.push(
          `Позиция ${index + 1}: скорректировано количество (${oldQty ?? 'null'} -> ${qty}) по формуле amount/price.`
        );
      }
    }

    if (amount === null && qty !== null && price !== null) {
      amount = round2(qty * price);
      normalizationReport.push(
        `Позиция ${index + 1}: восстановлена сумма строки (${amount}) из количества и цены.`
      );
    }

    if (qty !== null && price !== null && amount !== null) {
      const expectedAmount = round2(qty * price);
      if (isMismatch(amount, expectedAmount)) {
        validationWarnings.push(
          `Позиция ${index + 1}: сумма строки (${amount}) не бьётся с qty*price (${expectedAmount}).`
        );
      }
    }

    return {
      name: toStringOrNull(row.name) || `Позиция ${index + 1}`,
      qty,
      unit: toStringOrNull(row.unit) || 'шт',
      price: price === null ? null : round2(price),
      amount,
      vat_rate: vatRate,
      vat_amount: vatAmount === null ? null : round2(vatAmount),
    };
  });
}

function ensureMissingFields(parsed) {
  const missing = new Set(Array.isArray(parsed.missing_fields) ? parsed.missing_fields : []);

  for (const field of REQUIRED_FIELDS) {
    const value = parsed[field];
    const isMissing = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
    if (isMissing) missing.add(field);
  }

  parsed.missing_fields = Array.from(missing);
}

function normalizeUPDData(parsed) {
  const normalizationReport = [];
  const validationWarnings = [];

  parsed.buyer_name = toStringOrNull(parsed.buyer_name);
  parsed.seller_name = toStringOrNull(parsed.seller_name);
  parsed.buyer_inn = toStringOrNull(parsed.buyer_inn);
  parsed.buyer_kpp = toStringOrNull(parsed.buyer_kpp);
  parsed.seller_inn = toStringOrNull(parsed.seller_inn);
  parsed.seller_kpp = toStringOrNull(parsed.seller_kpp);
  parsed.upd_number = toStringOrNull(parsed.upd_number);
  parsed.contract_number = toStringOrNull(parsed.contract_number);
  parsed.upd_date = normalizeDate(parsed.upd_date);
  parsed.shipment_date = normalizeDate(parsed.shipment_date);
  parsed.contract_date = normalizeDate(parsed.contract_date);

  parsed.items = normalizeItems(parsed.items, normalizationReport, validationWarnings);

  const itemAmountSum = round2(parsed.items.reduce((acc, it) => acc + (it.amount || 0), 0));
  const itemVatSum = round2(parsed.items.reduce((acc, it) => acc + (it.vat_amount || 0), 0));

  parsed.total_without_vat = parseNumber(parsed.total_without_vat);
  parsed.total_vat = parseNumber(parsed.total_vat);
  parsed.total_with_vat = parseNumber(parsed.total_with_vat);

  if (parsed.total_without_vat === null && itemAmountSum > 0) {
    parsed.total_without_vat = itemAmountSum;
    normalizationReport.push('Восстановлена сумма без НДС на основе строк УПД.');
  }

  if (parsed.total_vat === null && itemVatSum > 0) {
    parsed.total_vat = itemVatSum;
    normalizationReport.push('Восстановлена сумма НДС на основе строк УПД.');
  }

  if (parsed.total_with_vat === null && parsed.total_without_vat !== null && parsed.total_vat !== null) {
    parsed.total_with_vat = round2(parsed.total_without_vat + parsed.total_vat);
    normalizationReport.push('Восстановлена итоговая сумма с НДС (без НДС + НДС).');
  }

  if (parsed.total_without_vat !== null) parsed.total_without_vat = round2(parsed.total_without_vat);
  if (parsed.total_vat !== null) parsed.total_vat = round2(parsed.total_vat);
  if (parsed.total_with_vat !== null) parsed.total_with_vat = round2(parsed.total_with_vat);

  if (
    parsed.total_without_vat !== null &&
    parsed.total_vat !== null &&
    parsed.total_with_vat !== null
  ) {
    const expectedTotalWithVat = round2(parsed.total_without_vat + parsed.total_vat);
    if (isMismatch(parsed.total_with_vat, expectedTotalWithVat)) {
      normalizationReport.push(
        `Исправлена итоговая сумма с НДС (${parsed.total_with_vat} -> ${expectedTotalWithVat}) для согласованности арифметики.`
      );
      parsed.total_with_vat = expectedTotalWithVat;
    }
  }

  if (itemAmountSum > 0 && parsed.total_without_vat !== null && isMismatch(parsed.total_without_vat, itemAmountSum)) {
    validationWarnings.push(
      `Сумма строк без НДС (${itemAmountSum}) отличается от total_without_vat (${parsed.total_without_vat}).`
    );
  }

  if (itemVatSum > 0 && parsed.total_vat !== null && isMismatch(parsed.total_vat, itemVatSum)) {
    validationWarnings.push(
      `Сумма НДС по строкам (${itemVatSum}) отличается от total_vat (${parsed.total_vat}).`
    );
  }

  parsed.normalizationReport = normalizationReport;
  parsed.validationWarnings = validationWarnings;

  ensureMissingFields(parsed);

  return parsed;
}

async function parseUPD(pdfText) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Текст УПД:\n\n${pdfText}` },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GPT вернул невалидный JSON при разборе УПД');
  }

  if (!Array.isArray(parsed.items)) parsed.items = [];
  if (!Array.isArray(parsed.missing_fields)) parsed.missing_fields = [];

  return normalizeUPDData(parsed);
}

module.exports = { parseUPD };
