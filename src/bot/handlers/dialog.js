const { updateSession, completeSession } = require('../../db/sessions');
const { extractPdfText } = require('../../services/pdf-extractor');
const { parseUPD } = require('../../services/upd-parser');
const { generateChainDates } = require('../../services/date-generator');
const { generateEmailChain } = require('../../services/email-generator');
const { assembleChain } = require('../../services/email-assembler');
const { sendEmail } = require('../../services/smtp-sender');
const { logGeneration, logHistory } = require('../../db/logs');
const {
  parseRuDate,
  parseFlexibleDate,
  validateBusinessPersonName,
  validateBusinessTitle,
  validateChronologyWindow,
  validatePaymentsChronology,
  normalizeFinancials,
} = require('../../services/deal-validators');

const STATES = {
  IDLE: 'IDLE',
  WAITING_PDF: 'WAITING_PDF',
  PDF_PROCESSING: 'PDF_PROCESSING',
  WAITING_CONTEXT: 'WAITING_CONTEXT',
  WAITING_FORBIDDEN_WORDS: 'WAITING_FORBIDDEN_WORDS',
  WAITING_TONE: 'WAITING_TONE',
  WAITING_STYLE: 'WAITING_STYLE',
  WAITING_BUYER_EMAIL: 'WAITING_BUYER_EMAIL',
  WAITING_SELLER_EMAIL: 'WAITING_SELLER_EMAIL',
  WAITING_BUYER_NAME: 'WAITING_BUYER_NAME',
  WAITING_BUYER_TITLE: 'WAITING_BUYER_TITLE',
  WAITING_BUYER_PHONE: 'WAITING_BUYER_PHONE',
  WAITING_SELLER_NAME: 'WAITING_SELLER_NAME',
  WAITING_SELLER_TITLE: 'WAITING_SELLER_TITLE',
  WAITING_SELLER_PHONE: 'WAITING_SELLER_PHONE',
  WAITING_CONTRACT_NUMBER: 'WAITING_CONTRACT_NUMBER',
  WAITING_CONTRACT_DATE: 'WAITING_CONTRACT_DATE',
  WAITING_SUPPLIER_SIGNER_NAME: 'WAITING_SUPPLIER_SIGNER_NAME',
  WAITING_SUPPLIER_SIGNER_TITLE: 'WAITING_SUPPLIER_SIGNER_TITLE',
  WAITING_BUYER_SIGNER_NAME: 'WAITING_BUYER_SIGNER_NAME',
  WAITING_BUYER_SIGNER_TITLE: 'WAITING_BUYER_SIGNER_TITLE',
  WAITING_DELIVERY_ADDRESS: 'WAITING_DELIVERY_ADDRESS',
  WAITING_ACCEPTANCE_CONTACT_NAME: 'WAITING_ACCEPTANCE_CONTACT_NAME',
  WAITING_ACCEPTANCE_CONTACT_PHONE: 'WAITING_ACCEPTANCE_CONTACT_PHONE',
  WAITING_PAYMENTS: 'WAITING_PAYMENTS',
  WAITING_ALLOW_PREPAYMENT: 'WAITING_ALLOW_PREPAYMENT',
  WAITING_CLOSING_DOCS: 'WAITING_CLOSING_DOCS',
  WAITING_START_DATE: 'WAITING_START_DATE',
  WAITING_END_DATE: 'WAITING_END_DATE',
  WAITING_RECIPIENT_EMAIL: 'WAITING_RECIPIENT_EMAIL',
  GENERATING: 'GENERATING',
};

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || '').trim());
}

function isValidDate(str) {
  return Boolean(parseRuDate(str));
}

function isValidPhone(str) {
  return /^[\d\s\+\-\(\)]{7,20}$/.test(String(str || '').trim());
}

function isValidFullAddress(str) {
  const value = String(str || '').trim();
  if (value.length < 15) return false;
  if (!/\d/.test(value)) return false;
  if (!value.includes(',')) return false;
  return true;
}

function parseAmount(value) {
  const normalized = String(value || '')
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');
  if (!normalized) return null;

  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function parsePayments(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { ok: false, error: 'Нужно указать хотя бы одну оплату отдельной строкой.' };
  }

  const parsed = [];
  for (const [index, line] of lines.entries()) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length !== 5) {
      return {
        ok: false,
        error: `Строка ${index + 1}: нужен формат "дата, сумма, основание, документ, дата зачисления".`,
      };
    }

    const [date, amountRaw, basis, document, creditedDate] = parts;

    if (!isValidDate(date)) {
      return { ok: false, error: `Строка ${index + 1}: неверная дата оплаты (ДД.ММ.ГГГГ).` };
    }

    const amount = parseAmount(amountRaw);
    if (amount === null) {
      return { ok: false, error: `Строка ${index + 1}: сумма должна быть положительным числом.` };
    }

    if (!basis) {
      return { ok: false, error: `Строка ${index + 1}: заполните основание оплаты.` };
    }

    if (!document) {
      return { ok: false, error: `Строка ${index + 1}: заполните документ оплаты.` };
    }

    if (!isValidDate(creditedDate)) {
      return { ok: false, error: `Строка ${index + 1}: неверная дата зачисления (ДД.ММ.ГГГГ).` };
    }

    parsed.push({
      date,
      amount,
      basis,
      document,
      creditedDate,
    });
  }

  return { ok: true, data: parsed };
}

function parseClosingDocs(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { ok: false, error: 'Нужно указать хотя бы один закрывающий документ.' };
  }

  const parsed = [];
  for (const [index, line] of lines.entries()) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length !== 4) {
      return {
        ok: false,
        error: `Строка ${index + 1}: нужен формат "тип, номер, дата, формат(скан/оригинал)".`,
      };
    }

    const [type, number, date, format] = parts;

    if (!type) return { ok: false, error: `Строка ${index + 1}: заполните тип документа.` };
    if (!number) return { ok: false, error: `Строка ${index + 1}: заполните номер документа.` };
    if (!isValidDate(date)) return { ok: false, error: `Строка ${index + 1}: неверная дата документа (ДД.ММ.ГГГГ).` };
    if (!format) return { ok: false, error: `Строка ${index + 1}: заполните формат (скан/оригинал).` };

    parsed.push({ type, number, date, format });
  }

  return { ok: true, data: parsed };
}

function formatNormalizationSummary(updData) {
  const report = Array.isArray(updData.normalizationReport) ? updData.normalizationReport : [];
  const warnings = Array.isArray(updData.validationWarnings) ? updData.validationWarnings : [];

  if (report.length === 0 && warnings.length === 0) return null;

  const sections = [];
  if (report.length > 0) {
    sections.push(`Автокоррекции:\n${report.map((line) => `- ${line}`).join('\n')}`);
  }
  if (warnings.length > 0) {
    sections.push(`Проверка арифметики:\n${warnings.map((line) => `- ${line}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

function hasRequiredDealMeta(data) {
  return Boolean(
    data.contractNumber &&
    data.contractDate &&
    data.supplierSignerName &&
    data.supplierSignerTitle &&
    data.buyerSignerName &&
    data.buyerSignerTitle &&
    data.deliveryAddress &&
    data.acceptanceContactName &&
    data.acceptanceContactPhone &&
    Array.isArray(data.payments) && data.payments.length > 0 &&
    Array.isArray(data.closingDocs) && data.closingDocs.length > 0
  );
}

function getShipmentAnchorDate(updData) {
  return updData?.shipment_date || updData?.upd_date || null;
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

function getLatestDate(values) {
  let latest = null;

  for (const value of values || []) {
    const parsed = parseFlexibleDate(value);
    if (!parsed) continue;
    if (!latest || parsed.getTime() > latest.getTime()) {
      latest = parsed;
    }
  }

  return latest;
}

function getLatestTimelineAnchor(data) {
  const anchors = [];

  const contractDate = parseFlexibleDate(data.contractDate);
  if (contractDate) {
    anchors.push({ date: contractDate, label: `дата договора ${formatDate(contractDate)}` });
  }

  const shipmentDate = parseFlexibleDate(getShipmentAnchorDate(data.updData));
  if (shipmentDate) {
    anchors.push({ date: shipmentDate, label: `дата отгрузки/УПД ${formatDate(shipmentDate)}` });
  }

  for (const payment of data.payments || []) {
    const paymentDate = parseRuDate(payment.date);
    if (paymentDate) {
      anchors.push({ date: paymentDate, label: `дата оплаты ${formatDate(paymentDate)}` });
    }

    const creditedDate = parseRuDate(payment.creditedDate);
    if (creditedDate) {
      anchors.push({ date: creditedDate, label: `дата зачисления ${formatDate(creditedDate)}` });
    }
  }

  for (const doc of data.closingDocs || []) {
    const docDate = parseRuDate(doc.date);
    if (docDate) {
      anchors.push({ date: docDate, label: `дата закрывающего документа ${formatDate(docDate)}` });
    }
  }

  if (anchors.length === 0) return null;
  anchors.sort((a, b) => a.date.getTime() - b.date.getTime());
  return anchors[anchors.length - 1];
}

function validateEndDateAgainstAnchors(data, endDateText) {
  const endDate = parseRuDate(endDateText);
  if (!endDate) return { ok: false, error: 'Введите дату завершения сделки в формате ДД.ММ.ГГГГ.' };

  const latestAnchor = getLatestTimelineAnchor(data);
  if (!latestAnchor) return { ok: true };

  if (endDate.getTime() < latestAnchor.date.getTime()) {
    const minEndDate = formatDate(latestAnchor.date);
    return {
      ok: false,
      error: `Дата завершения сделки ${endDateText} раньше, чем ${latestAnchor.label}. Укажите дату не раньше ${minEndDate}.`,
    };
  }

  return { ok: true };
}

function validateClosingDocsChronology(data) {
  const shipmentDate = parseFlexibleDate(getShipmentAnchorDate(data.updData));
  if (!shipmentDate) return { ok: true };

  for (const doc of data.closingDocs || []) {
    const date = parseRuDate(doc.date);
    if (!date) {
      return {
        ok: false,
        nextState: STATES.WAITING_CLOSING_DOCS,
        error: `В закрывающих документах указана некорректная дата: ${doc.date}.`,
      };
    }
    if (date.getTime() < shipmentDate.getTime()) {
      return {
        ok: false,
        nextState: STATES.WAITING_CLOSING_DOCS,
        error: `Дата закрывающего документа ${doc.date} не может быть раньше отгрузки ${String(getShipmentAnchorDate(data.updData)).replace(/-/g, '.')}.`,
      };
    }
  }

  return { ok: true };
}

function validateReadyForGeneration(data) {
  const range = validateChronologyWindow(data.startDate, data.endDate);
  if (!range.ok) {
    return { ok: false, nextState: STATES.WAITING_START_DATE, error: range.error };
  }

  const endDateCheck = validateEndDateAgainstAnchors(data, data.endDate);
  if (!endDateCheck.ok) {
    return { ok: false, nextState: STATES.WAITING_END_DATE, error: endDateCheck.error };
  }

  const paymentCheck = validatePaymentsChronology(
    data.payments,
    getShipmentAnchorDate(data.updData),
    Boolean(data.allowPrepayment)
  );
  if (!paymentCheck.ok) {
    return { ok: false, nextState: STATES.WAITING_PAYMENTS, error: paymentCheck.error };
  }

  const closingDocsCheck = validateClosingDocsChronology(data);
  if (!closingDocsCheck.ok) return closingDocsCheck;

  return { ok: true };
}

async function setState(session, state, extraData = {}) {
  const data = { ...session.data, ...extraData };
  await updateSession(session.session_id, { state, data });
  session.state = state;
  session.data = data;
}

async function handlePdfProcessing(ctx, session) {
  const { fileId } = session.data;
  await ctx.reply('Обрабатываю PDF... Пожалуйста, подождите.');

  try {
    const pdfText = await extractPdfText(fileId);
    await ctx.reply('PDF прочитан. Извлекаю данные из УПД через GPT-4o...');

    const parsedUpdData = await parseUPD(pdfText);
    const { normalized: updData, corrections, issues } = normalizeFinancials(parsedUpdData);

    updData.normalizationReport = [
      ...(Array.isArray(parsedUpdData.normalizationReport) ? parsedUpdData.normalizationReport : []),
      ...(Array.isArray(corrections) ? corrections : []),
    ];
    updData.validationWarnings = [
      ...(Array.isArray(parsedUpdData.validationWarnings) ? parsedUpdData.validationWarnings : []),
      ...(Array.isArray(issues) ? issues : []),
    ];

    let confirmText = `Данные из УПД извлечены:\n\n` +
      `Продавец: ${updData.seller_name || '?'} (ИНН: ${updData.seller_inn || '?'})\n` +
      `Покупатель: ${updData.buyer_name || '?'} (ИНН: ${updData.buyer_inn || '?'})\n` +
      `УПД №${updData.upd_number || '?'} от ${updData.upd_date || '?'}\n` +
      `Товаров: ${updData.items?.length || 0} позиций\n` +
      `Итого с НДС: ${updData.total_with_vat || '?'} руб.`;

    if (updData.missing_fields?.length > 0) {
      confirmText += `\n\nНе удалось извлечь: ${updData.missing_fields.join(', ')}`;
    }

    await ctx.reply(confirmText);

    const normalizationSummary = formatNormalizationSummary(updData);
    if (normalizationSummary) {
      await ctx.reply(`Результат нормализации УПД:\n\n${normalizationSummary}`);
    }

    await setState(session, STATES.WAITING_BUYER_EMAIL, { updData, allowPrepayment: false });
    await ctx.reply('Введите email покупателя:');
  } catch (err) {
    console.error('[dialog] PDF processing error:', err);
    await setState(session, STATES.IDLE, {});
    await ctx.reply(`Ошибка при обработке PDF: ${err.message}\n\nНачните заново с /start_deal`);
  }
}

async function handleGenerating(ctx, session) {
  const d = session.data;
  const context = d.context || '';
  const forbiddenWords = Array.isArray(d.forbiddenWords) ? d.forbiddenWords : [];

  if (!hasRequiredDealMeta(d)) {
    await setState(session, STATES.WAITING_CONTRACT_NUMBER, {});
    return ctx.reply('Не заполнены обязательные поля по договору/приёмке/документам.\nВведите номер договора поставки:');
  }

  const chronology = validateReadyForGeneration(d);
  if (!chronology.ok) {
    await setState(session, chronology.nextState || STATES.WAITING_START_DATE, {});
    return ctx.reply(`${chronology.error}\n\nИсправьте данные и отправьте снова.`);
  }

  await ctx.reply('Генерирую цепочку писем... Это займёт около минуты.');

  try {
    const seed = Math.floor(Math.random() * 10000);
    const letterCount = 12;

    const paymentAnchorDate = getLatestDate((d.payments || []).flatMap((p) => [p.date, p.creditedDate]));
    const closingDocsAnchorDate = getLatestDate((d.closingDocs || []).map((doc) => doc.date));

    const dates = generateChainDates(
      d.startDate,
      d.endDate,
      letterCount,
      d.updData.upd_date,
      d.contractDate,
      d.updData.shipment_date,
      {
        paymentDate: paymentAnchorDate ? formatDate(paymentAnchorDate) : null,
        paymentCreditedDate: paymentAnchorDate ? formatDate(paymentAnchorDate) : null,
        closingDocsDate: closingDocsAnchorDate ? formatDate(closingDocsAnchorDate) : null,
      }
    );

    const dealMeta = {
      contract: {
        number: d.contractNumber,
        date: d.contractDate,
      },
      signers: {
        supplier: {
          name: d.supplierSignerName,
          title: d.supplierSignerTitle,
        },
        buyer: {
          name: d.buyerSignerName,
          title: d.buyerSignerTitle,
        },
      },
      delivery: {
        address: d.deliveryAddress,
      },
      acceptance: {
        contactName: d.acceptanceContactName,
        contactPhone: d.acceptanceContactPhone,
        status: 'Замечаний нет',
      },
      payments: d.payments,
      closingDocs: d.closingDocs,
      allowPrepayment: Boolean(d.allowPrepayment),
    };

    const { emails, persona, lengths } = await generateEmailChain({
      updData: d.updData,
      dealMeta,
      buyerName: d.buyerName,
      buyerTitle: d.buyerTitle,
      buyerPhone: d.buyerPhone,
      buyerEmail: d.buyerEmail,
      sellerName: d.sellerName,
      sellerTitle: d.sellerTitle,
      sellerPhone: d.sellerPhone,
      sellerEmail: d.sellerEmail,
      context,
      forbiddenWords,
      tone: d.tone,
      style: d.style,
      dates,
      seed,
    });

    await ctx.reply(`Сгенерировано ${emails.length} писем. Собираю и отправляю...`);

    const { body, subject } = assembleChain(emails);

    await sendEmail({
      to: d.recipientEmail,
      subject,
      body,
      fromName: emails[0].from,
    });

    try {
      await logGeneration({
        sessionId: session.session_id,
        userId: ctx.from.id,
        recipientEmail: d.recipientEmail,
        updData: d.updData,
        seed,
        letterCount: emails.length,
        errors: null,
      });
      await logHistory({
        seed,
        persona,
        lengthTemplates: lengths,
        techParams: {
          startDate: d.startDate,
          endDate: d.endDate,
          letterCount: emails.length,
          context,
          forbiddenWords,
          tone: d.tone,
          style: d.style,
          contractNumber: d.contractNumber,
          contractDate: d.contractDate,
          allowPrepayment: Boolean(d.allowPrepayment),
        },
      });
    } catch (logErr) {
      console.error('[dialog] Log error (non-critical):', logErr.message);
    }

    await completeSession(session.session_id);
    await ctx.reply(
      `Готово! Письмо с цепочкой из ${emails.length} писем отправлено на ${d.recipientEmail}.\n\n` +
      `Тема: "${subject}"\n` +
      `Персона: ${persona}\n\n` +
      `Для новой генерации — /start_deal`
    );
  } catch (err) {
    console.error('[dialog] Generation error:', err);
    await logGeneration({
      sessionId: session.session_id,
      userId: ctx.from.id,
      recipientEmail: d.recipientEmail,
      updData: d.updData,
      seed: 0,
      letterCount: 0,
      errors: err.message,
    }).catch(() => {});
    await completeSession(session.session_id);
    await ctx.reply(`Ошибка при генерации или отправке: ${err.message}\n\nПопробуйте снова: /start_deal`);
  }
}

function registerDialogHandlers(bot) {
  bot.command('start_deal', async (ctx) => {
    const session = ctx.userSession;
    if (!session) return ctx.reply('Ошибка сессии. Попробуйте позже.');

    await setState(session, STATES.WAITING_TONE, {
      context: '',
      forbiddenWords: [],
      forbiddenWordsRaw: '-',
      allowPrepayment: false,
      pendingPayments: null,
    });
    await ctx.reply('Опишите желаемый тон переписки (произвольный текст, например: нейтральный, деловой, дружелюбный):');
  });

  bot.command('cancel', async (ctx) => {
    const session = ctx.userSession;
    if (!session) return;
    await setState(session, STATES.IDLE, {});
    await ctx.reply('Операция отменена. Для начала используйте /start_deal');
  });

  bot.on('document', async (ctx) => {
    const session = ctx.userSession;
    if (!session || session.state !== STATES.WAITING_PDF) {
      if (session?.state === STATES.IDLE) {
        return ctx.reply('Используйте /start_deal для начала работы.');
      }
      return;
    }

    const doc = ctx.message.document;

    if (doc.mime_type !== 'application/pdf') {
      return ctx.reply('Пожалуйста, отправьте файл в формате PDF.');
    }

    await setState(session, STATES.PDF_PROCESSING, { fileId: doc.file_id });
    await handlePdfProcessing(ctx, session);
  });

  bot.on('text', async (ctx) => {
    const session = ctx.userSession;
    if (!session) return;

    const text = ctx.message.text.trim();
    let state = session.state;

    if (text.startsWith('/')) return;

    if (state === STATES.WAITING_CONTEXT || state === STATES.WAITING_FORBIDDEN_WORDS) {
      await setState(session, STATES.WAITING_TONE, {
        context: '',
        forbiddenWords: [],
        forbiddenWordsRaw: '-',
      });
      state = STATES.WAITING_TONE;
      await ctx.reply(
        'Сценарий обновлён: шаги контекста и запрещённых слов удалены.\n' +
        'Опишите желаемый тон переписки (произвольный текст, например: нейтральный, деловой, дружелюбный):'
      );
      return;
    }

    switch (state) {
      case STATES.IDLE:
        return ctx.reply('Введите /start_deal чтобы начать генерацию.');

      case STATES.WAITING_PDF:
        return ctx.reply('Пожалуйста, отправьте PDF-файл с УПД.');

      case STATES.WAITING_TONE: {
        if (text.length < 2) return ctx.reply('Пожалуйста, укажите тон переписки (минимум 2 символа).');
        await setState(session, STATES.WAITING_STYLE, { tone: text });
        return ctx.reply('Опишите стиль переписки (произвольный текст, например: официальный, краткий, подробно аргументированный):');
      }

      case STATES.WAITING_STYLE: {
        if (text.length < 2) return ctx.reply('Пожалуйста, укажите стиль переписки (минимум 2 символа).');
        await setState(session, STATES.WAITING_PDF, { style: text });
        return ctx.reply(
          'Отправьте PDF-файл с УПД (Универсальным Передаточным Документом).\n' +
          'Максимальный размер: 10 МБ.'
        );
      }

      case STATES.WAITING_BUYER_EMAIL: {
        if (!isValidEmail(text)) return ctx.reply('Некорректный email покупателя. Введите email в формате user@domain.com');
        await setState(session, STATES.WAITING_SELLER_EMAIL, { buyerEmail: text });
        return ctx.reply('Введите email продавца:');
      }

      case STATES.WAITING_SELLER_EMAIL: {
        if (!isValidEmail(text)) return ctx.reply('Некорректный email продавца. Введите email в формате user@domain.com');
        await setState(session, STATES.WAITING_BUYER_NAME, { sellerEmail: text });
        return ctx.reply('Введите ФИО контактного лица покупателя:');
      }

      case STATES.WAITING_BUYER_NAME: {
        const check = validateBusinessPersonName(text, 'ФИО контактного лица покупателя');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_BUYER_TITLE, { buyerName: check.value });
        return ctx.reply('Введите должность контактного лица покупателя:');
      }

      case STATES.WAITING_BUYER_TITLE: {
        const check = validateBusinessTitle(text, 'Должность контактного лица покупателя');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_BUYER_PHONE, { buyerTitle: check.value });
        return ctx.reply('Введите телефон контактного лица покупателя:');
      }

      case STATES.WAITING_BUYER_PHONE: {
        if (!isValidPhone(text)) return ctx.reply('Введите корректный номер телефона.');
        await setState(session, STATES.WAITING_SELLER_NAME, { buyerPhone: text });
        return ctx.reply('Введите ФИО контактного лица продавца:');
      }

      case STATES.WAITING_SELLER_NAME: {
        const check = validateBusinessPersonName(text, 'ФИО контактного лица продавца');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_SELLER_TITLE, { sellerName: check.value });
        return ctx.reply('Введите должность контактного лица продавца:');
      }

      case STATES.WAITING_SELLER_TITLE: {
        const check = validateBusinessTitle(text, 'Должность контактного лица продавца');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_SELLER_PHONE, { sellerTitle: check.value });
        return ctx.reply('Введите телефон контактного лица продавца:');
      }

      case STATES.WAITING_SELLER_PHONE: {
        if (!isValidPhone(text)) return ctx.reply('Введите корректный номер телефона.');
        await setState(session, STATES.WAITING_CONTRACT_NUMBER, { sellerPhone: text });
        return ctx.reply('Введите номер договора поставки (обязательно, источник — договор):');
      }

      case STATES.WAITING_CONTRACT_NUMBER: {
        if (text.length < 2) return ctx.reply('Введите корректный номер договора (минимум 2 символа).');
        await setState(session, STATES.WAITING_CONTRACT_DATE, { contractNumber: text });
        return ctx.reply('Введите дату договора поставки (формат: ДД.ММ.ГГГГ):');
      }

      case STATES.WAITING_CONTRACT_DATE: {
        if (!isValidDate(text)) return ctx.reply('Введите дату договора в формате ДД.ММ.ГГГГ.');
        await setState(session, STATES.WAITING_SUPPLIER_SIGNER_NAME, { contractDate: text });
        return ctx.reply('Введите ФИО подписанта со стороны поставщика:');
      }

      case STATES.WAITING_SUPPLIER_SIGNER_NAME: {
        const check = validateBusinessPersonName(text, 'ФИО подписанта поставщика');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_SUPPLIER_SIGNER_TITLE, { supplierSignerName: check.value });
        return ctx.reply('Введите должность подписанта со стороны поставщика:');
      }

      case STATES.WAITING_SUPPLIER_SIGNER_TITLE: {
        const check = validateBusinessTitle(text, 'Должность подписанта поставщика');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_BUYER_SIGNER_NAME, { supplierSignerTitle: check.value });
        return ctx.reply('Введите ФИО подписанта со стороны покупателя:');
      }

      case STATES.WAITING_BUYER_SIGNER_NAME: {
        const check = validateBusinessPersonName(text, 'ФИО подписанта покупателя');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_BUYER_SIGNER_TITLE, { buyerSignerName: check.value });
        return ctx.reply('Введите должность подписанта со стороны покупателя:');
      }

      case STATES.WAITING_BUYER_SIGNER_TITLE: {
        const check = validateBusinessTitle(text, 'Должность подписанта покупателя');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_DELIVERY_ADDRESS, { buyerSignerTitle: check.value });
        return ctx.reply('Введите полный адрес доставки / склада покупателя:');
      }

      case STATES.WAITING_DELIVERY_ADDRESS: {
        if (!isValidFullAddress(text)) {
          return ctx.reply(
            'Введите полный адрес доставки в формате: г. ..., ул. ..., д. ...\n' +
            'Требования: минимум 15 символов, минимум одна цифра (дом/корпус), минимум одна запятая.'
          );
        }
        await setState(session, STATES.WAITING_ACCEPTANCE_CONTACT_NAME, { deliveryAddress: text });
        return ctx.reply('Введите ФИО контактного лица на приёмке:');
      }

      case STATES.WAITING_ACCEPTANCE_CONTACT_NAME: {
        const check = validateBusinessPersonName(text, 'ФИО контактного лица на приёмке');
        if (!check.ok) return ctx.reply(check.error);
        await setState(session, STATES.WAITING_ACCEPTANCE_CONTACT_PHONE, { acceptanceContactName: check.value });
        return ctx.reply('Введите телефон контактного лица на приёмке:');
      }

      case STATES.WAITING_ACCEPTANCE_CONTACT_PHONE: {
        if (!isValidPhone(text)) return ctx.reply('Введите корректный телефон контактного лица на приёмке.');
        await setState(session, STATES.WAITING_PAYMENTS, { acceptanceContactPhone: text });
        return ctx.reply(
          'Введите оплаты (по одной строке):\n' +
          'дата, сумма, основание, документ, дата зачисления\n\n' +
          'Пример:\n' +
          '15.08.2025, 125000.00, Оплата по счёту №45, ПП №128, 16.08.2025'
        );
      }

      case STATES.WAITING_PAYMENTS: {
        const parsed = parsePayments(text);
        if (!parsed.ok) return ctx.reply(parsed.error);

        const shipmentDate = getShipmentAnchorDate(session.data?.updData);
        const chronologyCheck = validatePaymentsChronology(parsed.data, shipmentDate, false);

        if (!chronologyCheck.ok && chronologyCheck.code === 'PREPAYMENT_CONFLICT') {
          await setState(session, STATES.WAITING_ALLOW_PREPAYMENT, {
            pendingPayments: parsed.data,
          });
          return ctx.reply(
            `${chronologyCheck.error}\n` +
            'Это похоже на предоплату. Разрешить предоплату для этой сделки? Ответьте: да или нет.'
          );
        }

        if (!chronologyCheck.ok) {
          return ctx.reply(chronologyCheck.error);
        }

        await setState(session, STATES.WAITING_CLOSING_DOCS, {
          payments: parsed.data,
          pendingPayments: null,
          allowPrepayment: false,
        });
        return ctx.reply(
          'Введите закрывающие документы (по одной строке):\n' +
          'тип, номер, дата, формат(скан/оригинал)\n\n' +
          'Пример:\n' +
          'Счёт-фактура, 155, 20.08.2025, оригинал'
        );
      }

      case STATES.WAITING_ALLOW_PREPAYMENT: {
        const answer = text.toLowerCase();
        if (answer !== 'да' && answer !== 'нет') {
          return ctx.reply('Ответьте "да" или "нет".');
        }

        if (answer === 'нет') {
          await setState(session, STATES.WAITING_PAYMENTS, {
            pendingPayments: null,
            allowPrepayment: false,
          });
          return ctx.reply('Хорошо. Скорректируйте оплаты так, чтобы они были не раньше даты отгрузки, и отправьте снова.');
        }

        const pendingPayments = Array.isArray(session.data.pendingPayments) ? session.data.pendingPayments : null;
        if (!pendingPayments) {
          await setState(session, STATES.WAITING_PAYMENTS, { allowPrepayment: false });
          return ctx.reply('Не удалось сохранить список оплат. Отправьте оплаты заново.');
        }

        await setState(session, STATES.WAITING_CLOSING_DOCS, {
          payments: pendingPayments,
          pendingPayments: null,
          allowPrepayment: true,
        });
        return ctx.reply(
          'Предоплата разрешена для этой сделки.\n' +
          'Введите закрывающие документы (по одной строке):\n' +
          'тип, номер, дата, формат(скан/оригинал)'
        );
      }

      case STATES.WAITING_CLOSING_DOCS: {
        const parsed = parseClosingDocs(text);
        if (!parsed.ok) return ctx.reply(parsed.error);
        await setState(session, STATES.WAITING_START_DATE, { closingDocs: parsed.data });
        return ctx.reply('Введите дату начала переписки (формат: ДД.ММ.ГГГГ):');
      }

      case STATES.WAITING_START_DATE: {
        if (!isValidDate(text)) return ctx.reply('Введите дату в формате ДД.ММ.ГГГГ (например: 01.03.2025).');
        await setState(session, STATES.WAITING_END_DATE, { startDate: text });
        return ctx.reply('Введите дату завершения переписки (формат: ДД.ММ.ГГГГ):');
      }

      case STATES.WAITING_END_DATE: {
        if (!isValidDate(text)) return ctx.reply('Введите дату в формате ДД.ММ.ГГГГ (например: 31.03.2025).');

        const rangeCheck = validateChronologyWindow(session.data.startDate, text);
        if (!rangeCheck.ok) {
          return ctx.reply(`${rangeCheck.error}\nВведите дату завершения переписки ещё раз.`);
        }

        const endDateCheck = validateEndDateAgainstAnchors(session.data, text);
        if (!endDateCheck.ok) {
          return ctx.reply(`${endDateCheck.error}
Введите дату завершения переписки ещё раз.`);
        }

        await setState(session, STATES.WAITING_RECIPIENT_EMAIL, { endDate: text });
        return ctx.reply('Введите email получателя итогового письма (куда отправить сгенерированную переписку):');
      }

      case STATES.WAITING_RECIPIENT_EMAIL: {
        if (!isValidEmail(text)) return ctx.reply('Некорректный email. Введите email в формате user@domain.com');
        await setState(session, STATES.GENERATING, { recipientEmail: text });
        await handleGenerating(ctx, session);
        break;
      }

      case STATES.GENERATING:
        return ctx.reply('Идёт генерация, пожалуйста подождите...');

      default:
        return ctx.reply('Неизвестное состояние. Введите /start_deal для начала.');
    }
  });
}

module.exports = { registerDialogHandlers, STATES };



