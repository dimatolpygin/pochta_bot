const OpenAI = require('openai');
const { OPENAI_API_KEY, OPENAI_MODEL } = require('../config');
const { normalizeFinancials } = require('./deal-validators');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const PERSONAS = [
  {
    id: 'dry_business',
    name: 'Сухой деловой',
    description: 'Краткие, нейтральные, строго по делу. Никаких лишних слов.',
  },
  {
    id: 'polite_manager',
    name: 'Вежливый менеджерский',
    description: 'Тёплый, вежливый тон, клиентоориентированная коммуникация.',
  },
  {
    id: 'casual_business',
    name: 'Разговорный деловой',
    description: 'Живой деловой язык без канцеляризма.',
  },
  {
    id: 'formal_legal',
    name: 'Формально-юридический',
    description: 'Официальный стиль, ссылки на договор и реквизиты, точность формулировок.',
  },
];

const LENGTH_OPTIONS = ['short', 'medium', 'long'];

const STAGE_FLOW = [
  { type: 'inquiry', from: 'buyer', to: 'seller' },
  { type: 'quote', from: 'seller', to: 'buyer' },
  { type: 'discount_req', from: 'buyer', to: 'seller' },
  { type: 'discount_ok', from: 'seller', to: 'buyer' },
  { type: 'contract_ok', from: 'buyer', to: 'seller' },
  { type: 'contract_sent', from: 'seller', to: 'buyer' },
  { type: 'order', from: 'buyer', to: 'seller' },
  { type: 'order_confirm', from: 'seller', to: 'buyer' },
  { type: 'shipment', from: 'seller', to: 'buyer' },
  { type: 'acceptance', from: 'buyer', to: 'seller' },
  { type: 'payment', from: 'buyer', to: 'seller' },
  { type: 'closing_docs', from: 'seller', to: 'buyer' },
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const normalized = String(value)
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');

  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeDateText(value) {
  if (!value) return null;
  const str = String(value).trim();

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}.${m}.${y}`;
  }

  return str;
}

function formatMoney(value) {
  return `${parseNumber(value).toFixed(2)} руб.`;
}

function isVatFreeRate(value) {
  const text = String(value || '').toLowerCase().replace(/\s+/g, '');
  return text.includes('безндс') || text === '0' || text === '0%';
}

function isVatFreeDeal(updData) {
  const totalVat = parseNumber(updData?.total_vat);
  if (Math.abs(totalVat) <= 0.01) return true;

  const items = Array.isArray(updData?.items) ? updData.items : [];
  if (items.length === 0) return false;

  return items.every((item) => {
    const itemVatAmount = parseNumber(item?.vat_amount);
    return isVatFreeRate(item?.vat_rate) || Math.abs(itemVatAmount) <= 0.01;
  });
}

function vatTotalLabel(updData) {
  return isVatFreeDeal(updData) ? 'без НДС' : 'с НДС';
}

function formatItemsForInquiry(items) {
  if (!Array.isArray(items) || items.length === 0) return 'Товары согласно запросу.';
  return items.map((item, index) => {
    const qty = item.qty === null || item.qty === undefined ? '-' : item.qty;
    const unit = item.unit || 'шт';
    return `${index + 1}. ${item.name} — ${qty} ${unit}.`;
  }).join('\n');
}

function formatItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'Товары согласно УПД.';

  return items.map((item, index) => {
    const qty = item.qty === null || item.qty === undefined ? '-' : item.qty;
    const unit = item.unit || 'шт';
    const price = item.price === null || item.price === undefined ? '-' : item.price;
    const amount = item.amount === null || item.amount === undefined ? '-' : item.amount;
    const vatRate = item.vat_rate || 'не указан';
    const vatLabel = isVatFreeRate(vatRate) ? 'без НДС' : `НДС ${vatRate}`;

    return `${index + 1}. ${item.name} — ${qty} ${unit}, цена ${price} руб., сумма ${amount} руб. (${vatLabel}).`;
  }).join('\n');
}

function sanitizeFilenamePart(value, fallback = 'X') {
  const str = String(value || fallback).trim();
  return str.replace(/\s+/g, '').replace(/[\\/:*?"<>|]/g, '');
}

function assertFinancialInvariants(updData) {
  const issues = [];

  const items = Array.isArray(updData.items) ? updData.items : [];
  for (const [idx, item] of items.entries()) {
    const qty = parseNumber(item.qty);
    const price = parseNumber(item.price);
    const amount = parseNumber(item.amount);

    if (qty > 0 && price > 0 && amount > 0) {
      const expected = round2(qty * price);
      if (Math.abs(expected - amount) > 0.01) {
        issues.push(`Позиция ${idx + 1}: qty*price (${expected}) не совпадает с amount (${amount}).`);
      }
    }
  }

  const linesTotalWithoutVat = round2(items.reduce((acc, item) => acc + parseNumber(item.amount), 0));
  const linesTotalVat = round2(items.reduce((acc, item) => acc + parseNumber(item.vat_amount), 0));
  const totalWithoutVat = parseNumber(updData.total_without_vat);
  const totalVat = parseNumber(updData.total_vat);
  const totalWithVat = parseNumber(updData.total_with_vat);

  if (!Number.isFinite(totalWithVat) || totalWithVat <= 0) {
    issues.push('Не определена корректная итоговая сумма сделки.');
  }

  if (totalWithoutVat > 0 && Math.abs(linesTotalWithoutVat - totalWithoutVat) > 0.01) {
    issues.push(`Сумма строк без НДС (${linesTotalWithoutVat}) не совпадает с total_without_vat (${totalWithoutVat}).`);
  }

  if (linesTotalVat > 0 && Math.abs(linesTotalVat - totalVat) > 0.01) {
    issues.push(`Сумма НДС по строкам (${linesTotalVat}) не совпадает с total_vat (${totalVat}).`);
  }

  const expectedTotalWithVat = round2(totalWithoutVat + totalVat);
  if (Math.abs(expectedTotalWithVat - totalWithVat) > 0.01) {
    issues.push(`Итог total_with_vat (${totalWithVat}) не совпадает с total_without_vat + total_vat (${expectedTotalWithVat}).`);
  }

  if (issues.length > 0) {
    throw new Error(`Нарушены финансовые инварианты: ${issues.join(' ')}`);
  }
}

function normalizeDealMeta(dealMeta, updData) {
  const contractNumber = String(dealMeta?.contract?.number || '').trim() || String(updData?.contract_number || '').trim();
  const contractDate = normalizeDateText(dealMeta?.contract?.date) || normalizeDateText(updData?.contract_date);

  const supplierSignerName = String(dealMeta?.signers?.supplier?.name || '').trim();
  const supplierSignerTitle = String(dealMeta?.signers?.supplier?.title || '').trim();
  const buyerSignerName = String(dealMeta?.signers?.buyer?.name || '').trim();
  const buyerSignerTitle = String(dealMeta?.signers?.buyer?.title || '').trim();

  const deliveryAddress = String(dealMeta?.delivery?.address || '').trim();
  const acceptanceContactName = String(dealMeta?.acceptance?.contactName || '').trim();
  const acceptanceContactPhone = String(dealMeta?.acceptance?.contactPhone || '').trim();

  const payments = Array.isArray(dealMeta?.payments) && dealMeta.payments.length > 0
    ? dealMeta.payments.map((p) => ({
      date: normalizeDateText(p.date),
      amount: parseNumber(p.amount),
      basis: String(p.basis || '').trim(),
      document: String(p.document || '').trim(),
      creditedDate: normalizeDateText(p.creditedDate),
    }))
    : [{
      date: normalizeDateText(updData?.upd_date),
      amount: parseNumber(updData?.total_with_vat),
      basis: `Оплата по УПД №${updData?.upd_number || 'б/н'}`,
      document: 'Платёжное поручение',
      creditedDate: normalizeDateText(updData?.upd_date),
    }];

  const closingDocs = Array.isArray(dealMeta?.closingDocs) && dealMeta.closingDocs.length > 0
    ? dealMeta.closingDocs.map((doc) => ({
      type: String(doc.type || '').trim(),
      number: String(doc.number || '').trim(),
      date: normalizeDateText(doc.date),
      format: String(doc.format || '').trim(),
    }))
    : [{ type: 'УПД', number: String(updData?.upd_number || ''), date: normalizeDateText(updData?.upd_date), format: 'скан' }];

  return {
    contract: {
      number: contractNumber,
      date: contractDate,
    },
    signers: {
      supplier: { name: supplierSignerName, title: supplierSignerTitle },
      buyer: { name: buyerSignerName, title: buyerSignerTitle },
    },
    delivery: {
      address: deliveryAddress,
    },
    acceptance: {
      contactName: acceptanceContactName,
      contactPhone: acceptanceContactPhone,
      status: String(dealMeta?.acceptance?.status || 'Замечаний нет').trim(),
    },
    payments,
    closingDocs,
  };
}

function getThreadSubject(seed) {
  const options = ['предложение о сотрудничестве', 'запрос КП', 'заказ товара'];
  return options[seed % options.length];
}

function buildSystemPrompt(persona, length, tone, style) {
  const lengthDesc = {
    short: 'короткое (3-5 предложений)',
    medium: 'среднее (7-10 предложений)',
    long: 'подробное (12-15 предложений)',
  }[length];

  const toneLine = tone ? `Тон: ${tone}.` : '';
  const styleLine = style ? `Стиль: ${style}.` : '';

  return `Ты пишешь деловые письма на русском языке.
Стиль автора: ${persona.name} — ${persona.description}
Длина письма: ${lengthDesc}
Пиши только тело письма, без служебных заголовков From/To/Subject.
Не добавляй вымышленные факты и не меняй даты/номера/суммы.
Не добавляй подпись, прощание или реквизиты отправителя в конце письма — они добавляются автоматически.
${toneLine}
${styleLine}`;
}

function contractRef(meta) {
  return `договор поставки № ${meta.contract.number} от ${meta.contract.date}`;
}

function supplierSignerRef(meta, sellerOrg) {
  return `подписанного со стороны ${sellerOrg} (${meta.signers.supplier.title} ${meta.signers.supplier.name})`;
}

function buyerSignerRef(meta, buyerOrg) {
  return `подписанного со стороны ${buyerOrg} (${meta.signers.buyer.title} ${meta.signers.buyer.name})`;
}

function ensureMarkers(body, markers) {
  const text = String(body || '').trim();
  const normalized = text.toLowerCase();
  const missing = (markers || []).filter((marker) => !normalized.includes(String(marker).toLowerCase()));

  if (missing.length === 0) return text;

  return `${text}\n\n${missing.join('\n')}`.trim();
}

function stripTrailingSignature(text) {
  return text.replace(/\n{0,3}[Сс]\s+уважением[,.]?[\s\S]*$/i, '').trim();
}

function renderSignature(body, fromName, fromTitle, fromPhone) {
  return `${String(body || '').trim()}\n\nС уважением,\n${fromName}\n${fromTitle}\nТел.: ${fromPhone}`;
}

function buildStage(stage, ctx, dateEntry) {
  const { updData, dealMeta } = ctx;
  const updRef = `УПД №${updData.upd_number} от ${normalizeDateText(updData.upd_date)}`;
  const contract = contractRef(dealMeta);
  const supplierSigner = supplierSignerRef(dealMeta, updData.seller_name || 'поставщика');
  const buyerSigner = buyerSignerRef(dealMeta, updData.buyer_name || 'покупателя');
  const deliveryAddress = `Адрес доставки: ${dealMeta.delivery.address}`;
  const acceptanceContact = `Контактное лицо на приёмке: ${dealMeta.acceptance.contactName}, тел. ${dealMeta.acceptance.contactPhone}`;
  const shipmentDateMarker = `Дата отгрузки: ${dateEntry.textDate}`;
  const totalLabel = vatTotalLabel(updData);
  const offerTotalMarker = `Итоговая сумма предложения ${totalLabel}: ${formatMoney(updData.total_with_vat)}`;
  const dealTotalMarker = `Сумма сделки ${totalLabel}: ${formatMoney(updData.total_with_vat)}`;

  const paymentTotal = formatMoney(dealMeta.payments.reduce((acc, p) => acc + parseNumber(p.amount), 0));
  const paymentLines = dealMeta.payments.map((p, idx) =>
    `${idx + 1}) ${p.date} — ${formatMoney(p.amount)}, основание: ${p.basis}, документ: ${p.document}, зачисление: ${p.creditedDate}`
  ).join('\n');

  const closingDocLines = dealMeta.closingDocs.map((doc, idx) =>
    `${idx + 1}) ${doc.type} №${doc.number} от ${doc.date}, формат: ${doc.format}`
  ).join('\n');

  const contractNumber = dealMeta.contract.number;
  const supplierSignerName = dealMeta.signers.supplier.name;
  const buyerSignerName = dealMeta.signers.buyer.name;
  const addressText = dealMeta.delivery.address;

  const base = { facts: [], markers: [], attachments: [] };

  switch (stage.type) {
    case 'inquiry':
      base.facts = [
        'Этап: запрос КП.',
        'Это первое письмо — покупатель ещё не знает цен, запрашивает наличие и стоимость товара.',
        `Интересующие позиции:\n${formatItemsForInquiry(updData.items)}`,
      ];
      base.markers = [];
      break;

    case 'quote':
      base.facts = [
        'Этап: КП от поставщика.',
        `Предложение по товарам:\n${formatItems(updData.items)}`,
        `${offerTotalMarker}.`,
      ];
      base.markers = [offerTotalMarker];
      base.attachments = ['KP.pdf'];
      break;

    case 'discount_req':
      base.facts = [
        'Этап: торг / согласование.',
        'Покупатель просит скидку с учётом объёма и длительного сотрудничества.',
      ];
      break;

    case 'discount_ok':
      base.facts = [
        'Этап: торг / согласование.',
        `Поставщик подтверждает итоговые условия и сумму ${formatMoney(updData.total_with_vat)} ${totalLabel}.`,
      ];
      base.markers = [dealTotalMarker];
      break;

    case 'contract_ok':
      base.facts = [
        'Этап: договор.',
        'Покупатель подтверждает согласие с условиями и готовность заключить договор.',
      ];
      base.markers = [contractNumber];
      break;

    case 'contract_sent': {
      const contractFileDate = sanitizeFilenamePart(dealMeta.contract.date, '01012000').replace(/\./g, '');
      const contractFileNumber = sanitizeFilenamePart(dealMeta.contract.number, 'X');
      base.facts = [
        'Этап: договор.',
        `Направляем ${contract}.`,
        `Договор подписан с нашей стороны: ${supplierSigner}.`,
        'Ждём подписания с вашей стороны.',
      ];
      base.markers = [contractNumber, supplierSignerName.split(' ')[0]];
      base.attachments = [`Dogovor_N${contractFileNumber}ot${contractFileDate}.pdf`];
      break;
    }

    case 'order':
      base.facts = [
        'Этап: заявка / согласование сроков.',
        `Договор со своей стороны подписали: ${buyerSigner}, оригиналы отправим вам почтой.`,
        `Заявка оформляется в соответствии с ${contract}.`,
        deliveryAddress,
      ];
      base.markers = [contractNumber, buyerSignerName, addressText];
      break;

    case 'order_confirm':
      base.facts = [
        'Этап: заявка / согласование сроков.',
        `Поставщик подтверждает заявку и плановую дату отгрузки ${dateEntry.textDate}.`,
        shipmentDateMarker,
        acceptanceContact,
      ];
      base.markers = [shipmentDateMarker, acceptanceContact];
      break;

    case 'shipment': {
      const updFileDate = sanitizeFilenamePart(normalizeDateText(updData.upd_date), '01012000').replace(/\./g, '');
      const updFileNumber = sanitizeFilenamePart(updData.upd_number, 'X');
      base.facts = [
        'Этап: отгрузка.',
        `Отгрузка выполнена ${dateEntry.textDate} в соответствии с ${contract}.`,
        shipmentDateMarker,
        `Направляем отгрузочные документы: ${updRef}.`,
        deliveryAddress,
      ];
      base.markers = [contractNumber, shipmentDateMarker, updRef, addressText];
      base.attachments = [`UPD_N${updFileNumber}ot${updFileDate}.pdf`];
      break;
    }

    case 'acceptance':
      base.facts = [
        'Этап: приёмка.',
        `Подтверждаем получение: доставили по ${updRef}, товар принят.`,
        acceptanceContact,
        `Результат приёмки: ${dealMeta.acceptance.status}.`,
      ];
      base.markers = [updRef, acceptanceContact, dealMeta.acceptance.status];
      break;

    case 'payment': {
      const firstPayment = dealMeta.payments[0];
      base.facts = [
        'Этап: оплата.',
        `Оплаты по сделке:\n${paymentLines}`,
        `Итоговая сумма оплаты: ${paymentTotal}.`,
      ];
      base.markers = [
        `Сумма оплаты: ${paymentTotal}`,
        `Основание оплаты: ${firstPayment.basis}`,
        `Подтверждение зачисления: ${firstPayment.creditedDate}`,
      ];
      break;
    }

    case 'closing_docs':
      base.facts = [
        'Этап: закрывающие документы.',
        `Направляем закрывающие документы:\n${closingDocLines}`,
      ];
      base.markers = ['направляем закрывающие документы'];
      base.attachments = ['Zakryvayushchie_dokumenty.pdf'];
      break;

    default:
      break;
  }

  return base;
}

async function generateEmailChain(params) {
  const {
    updData,
    dealMeta,
    buyerName,
    buyerTitle,
    buyerPhone,
    buyerEmail,
    sellerName,
    sellerTitle,
    sellerPhone,
    sellerEmail,
    tone,
    style,
    dates,
    seed,
  } = params;

  const persona = PERSONAS[seed % PERSONAS.length];
  const lengths = STAGE_FLOW.map(() => pickRandom(LENGTH_OPTIONS));
  const threadSubject = getThreadSubject(seed);

  const { normalized: normalizedUpdData } = normalizeFinancials(updData);
  assertFinancialInvariants(normalizedUpdData);

  const normalizedDealMeta = normalizeDealMeta(dealMeta, normalizedUpdData);
  const sharedCtx = {
    updData: normalizedUpdData,
    dealMeta: normalizedDealMeta,
  };

  const emails = [];
  const count = Math.min(STAGE_FLOW.length, dates.length);

  for (let i = 0; i < count; i++) {
    const stage = STAGE_FLOW[i];
    const dateEntry = dates[i];
    const length = lengths[i];

    const isFromBuyer = stage.from === 'buyer';
    const fromName = isFromBuyer ? buyerName : sellerName;
    const fromTitle = isFromBuyer ? buyerTitle : sellerTitle;
    const fromPhone = isFromBuyer ? buyerPhone : sellerPhone;
    const fromEmail = isFromBuyer ? buyerEmail : sellerEmail;
    const toName = isFromBuyer ? sellerName : buyerName;
    const toEmail = isFromBuyer ? sellerEmail : buyerEmail;

    const stageContent = buildStage(stage, sharedCtx, dateEntry);

    const userPrompt = `Этап переписки: ${stage.type}
Дата письма: ${dateEntry.textDate}
От кого: ${fromName}, ${fromTitle}, тел. ${fromPhone}, email ${fromEmail}
Кому: ${toName}

Обязательные факты:\n${stageContent.facts.map((line) => `- ${line}`).join('\n')}

Обязательные маркеры (включить дословно):\n${stageContent.markers.map((line) => `- ${line}`).join('\n') || '- (нет)'}`;

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.65,
      seed: seed + i,
      messages: [
        { role: 'system', content: buildSystemPrompt(persona, length, tone, style) },
        { role: 'user', content: userPrompt },
      ],
    });

    const rawBody = String(response.choices?.[0]?.message?.content || '').trim();
    const cleanBody = stripTrailingSignature(rawBody);
    const bodyWithMarkers = ensureMarkers(cleanBody, stageContent.markers);
    const body = renderSignature(bodyWithMarkers, fromName, fromTitle, fromPhone);
    const subject = i === 0 ? threadSubject : `Re: ${threadSubject}`;

    emails.push({
      index: i,
      from: fromName,
      fromEmail,
      to: toName,
      toEmail,
      subject,
      body,
      attachments: stageContent.attachments,
      date: dateEntry.date,
      rfcDate: dateEntry.rfcDate,
      textDate: dateEntry.textDate,
      type: stage.type,
    });
  }

  return { emails, persona: persona.id, threadSubject, lengths };
}

module.exports = { generateEmailChain, PERSONAS };
