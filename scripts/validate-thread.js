const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { file: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) {
      args.file = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function detectDefaultThreadFile(cwd) {
  const files = fs.readdirSync(cwd, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);

  const preferred = files.find((name) => name === 'thread-sample.txt');
  if (preferred) return preferred;

  const byHint = files.find((name) => /thread/i.test(name) && /\.txt$/i.test(name));
  if (byHint) return byHint;

  const anyTxt = files.find((name) => /\.txt$/i.test(name));
  return anyTxt || null;
}

function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw)
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function parseEmails(threadText) {
  const blocks = [];
  const regex = /From:\s*"([^"]+)"\s*<([^>]+)>[\s\S]*?To:\s*<([^>]+)>[\s\S]*?Date:\s*([^\r\n]+)\r?\nSubject:\s*([^\r\n]+)[\s\S]*?Attachments:\s*([^\r\n]*)\r?\n------------------------------------------\r?\n\r?\n([\s\S]*?)\r?\n\r?\n==========================================/g;

  let match;
  while ((match = regex.exec(threadText)) !== null) {
    blocks.push({
      from: match[1].trim(),
      fromEmail: match[2].trim(),
      toEmail: match[3].trim(),
      dateRaw: match[4].trim(),
      subject: match[5].trim(),
      attachments: match[6].split(',').map((s) => s.trim()).filter(Boolean),
      body: match[7].trim(),
    });
  }

  return blocks;
}

function hasRegex(text, pattern) {
  return pattern.test(text);
}

function findDistinctRounded(values, digits = 2) {
  const seen = new Set();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const key = Number(v).toFixed(digits);
    seen.add(key);
  }
  return Array.from(seen);
}

function detectArithmeticIssues(text) {
  const issues = [];
  const pattern = /в количестве\s+([\d\s.,]+)\s+[^,\n]+\s+по цене\s+([\d\s.,]+)\s+руб[^,\n]*[\s\S]{0,80}?(?:общей стоимостью|на общую сумму)\s+([\d\s.,]+)\s+руб/gi;
  let m;

  while ((m = pattern.exec(text)) !== null) {
    const qty = toNumber(m[1]);
    const price = toNumber(m[2]);
    const amount = toNumber(m[3]);
    if (qty === null || price === null || amount === null) continue;

    const expected = Math.round((qty * price + Number.EPSILON) * 100) / 100;
    if (Math.abs(expected - amount) > 0.01) {
      issues.push(`qty*price (${expected}) != amount (${amount})`);
    }
  }

  return issues;
}

function detectStageOrder(emails) {
  const order = ['inquiry', 'quote', 'discount_req', 'discount_ok', 'contract_ok', 'contract_sent', 'order', 'order_confirm', 'shipment', 'acceptance', 'payment', 'closing_docs'];

  function detectStage(email) {
    const body = email.body.toLowerCase();
    const attachments = email.attachments.join(',').toLowerCase();

    if (attachments.includes('kp.pdf')) return 'quote';
    if (attachments.includes('dogovor_')) return 'contract_sent';
    if (attachments.includes('upd_')) return 'shipment';
    if (attachments.includes('zakryvayushchie')) return 'closing_docs';
    if (body.includes('сумма оплаты:')) return 'payment';
    if (body.includes('результат приёмки') || body.includes('товар принят')) return 'acceptance';
    if (body.includes('плановую дату отгрузки')) return 'order_confirm';
    if (body.includes('оформляем заявку на поставку')) return 'order';
    if (body.includes('сканированную копию договора')) return 'contract_sent';
    if (body.includes('подтвердить договор поставки')) return 'contract_ok';
    if (body.includes('скидк')) return 'discount_req';
    if (body.includes('сумма сделки с ндс')) return 'discount_ok';
    if (body.includes('коммерческое предложение')) return 'inquiry';
    return null;
  }

  const detected = emails.map(detectStage).filter(Boolean);
  const indexes = detected.map((s) => order.indexOf(s)).filter((n) => n >= 0);
  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i] < indexes[i - 1]) {
      return { ok: false, detected };
    }
  }
  return { ok: true, detected };
}

function buildChecklistReport(text, emails) {
  const fullText = text;

  const paymentTotalMatches = [...fullText.matchAll(/Сумма оплаты:\s*([\d\s.,]+)\s*руб/gi)].map((m) => toNumber(m[1]));
  const vatTotalMatches = [
    ...fullText.matchAll(/Итоговая сумма предложения с НДС:\s*([\d\s.,]+)\s*руб/gi),
    ...fullText.matchAll(/Сумма сделки с НДС:\s*([\d\s.,]+)\s*руб/gi),
    ...fullText.matchAll(/Общая сумма составляет\s*([\d\s.,]+)\s*руб/gi),
  ].map((m) => toNumber(m[1]));

  const chronologyDates = emails.map((e) => Date.parse(e.dateRaw)).filter((ts) => Number.isFinite(ts));
  let chronological = true;
  for (let i = 1; i < chronologyDates.length; i++) {
    if (chronologyDates[i] < chronologyDates[i - 1]) {
      chronological = false;
      break;
    }
  }

  const stageOrder = detectStageOrder(emails);
  const arithmeticIssues = detectArithmeticIssues(fullText);
  const vatDistinct = findDistinctRounded(vatTotalMatches);

  const checks = [
    { id: '1', title: 'Договор', pass: hasRegex(fullText, /договор поставки №\s*[^\n]+\s+от\s+\d{2}\.\d{2}\.\d{4}/i) },
    { id: '2', title: 'Подписанты', pass: hasRegex(fullText, /подписанного со стороны/i) && (fullText.match(/подписанного со стороны/gi) || []).length >= 2 },
    { id: '3', title: 'Адрес доставки', pass: hasRegex(fullText, /Адрес доставки:\s*.+/i) },
    { id: '4', title: 'Контакт на приёмке', pass: hasRegex(fullText, /Контактное лицо на при[её]мке:\s*.+тел\.?/i) },
    { id: '5', title: 'Разделение сущностей', pass: stageOrder.ok },
    { id: '6', title: 'Отгрузка', pass: hasRegex(fullText, /Дата отгрузки:/i) && hasRegex(fullText, /Основание отгрузки:\s*УПД №/i) && hasRegex(fullText, /Статус отгрузки:/i) },
    { id: '7', title: 'Приёмка', pass: hasRegex(fullText, /Результат при[её]мки|товар принят/i) },
    { id: '8', title: 'Оплата', pass: hasRegex(fullText, /Сумма оплаты:/i) && hasRegex(fullText, /Основание оплаты:/i) && hasRegex(fullText, /Подтверждение зачисления:/i) },
    { id: '9', title: 'Закрывающие документы', pass: hasRegex(fullText, /закрывающие документы/i) },
    { id: '10', title: 'Хронология', pass: chronological && stageOrder.ok },
    { id: '12', title: 'Суммы и арифметика', pass: arithmeticIssues.length === 0 },
    { id: '13', title: 'НДС', pass: vatDistinct.length <= 1 || vatDistinct.every((v) => v === vatDistinct[0]) },
    { id: '14', title: 'УПД', pass: hasRegex(fullText, /УПД №\s*\S+\s+от\s+\d{2}\.\d{2}\.\d{4}/i) },
    { id: '15', title: 'Юридические маркеры', pass: hasRegex(fullText, /договор поставки №/i) && hasRegex(fullText, /УПД №/i) && hasRegex(fullText, /Подтверждение зачисления:/i) },
    { id: '16', title: 'Подписант покупателя', pass: hasRegex(fullText, /подписанного со стороны[^\n]*покупател/i) },
  ];

  return {
    checks,
    arithmeticIssues,
    vatDistinct,
    stageOrder,
    emailsCount: emails.length,
  };
}

function printReport(report, filePath) {
  console.log(`Файл: ${filePath}`);
  console.log(`Писем в thread: ${report.emailsCount}`);
  console.log('');
  console.log('PASS/FAIL по чек-листу:');

  for (const check of report.checks) {
    const status = check.pass ? 'PASS' : 'FAIL';
    console.log(`${check.id.padStart(2, ' ')} | ${status} | ${check.title}`);
  }

  if (report.arithmeticIssues.length > 0) {
    console.log('');
    console.log('Проблемы арифметики:');
    for (const issue of report.arithmeticIssues) {
      console.log(`- ${issue}`);
    }
  }

  if (report.vatDistinct.length > 1) {
    console.log('');
    console.log(`Обнаружены разные суммы с НДС: ${report.vatDistinct.join(', ')}`);
  }

  if (!report.stageOrder.ok) {
    console.log('');
    console.log(`Нарушен порядок стадий: ${report.stageOrder.detected.join(' -> ')}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    args.file = detectDefaultThreadFile(process.cwd());
  }

  if (!args.file) {
    console.error('Thread file was not found. Use: --file <path>');
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), args.file);
  const text = fs.readFileSync(resolved, 'utf8');
  const emails = parseEmails(text);
  const report = buildChecklistReport(text, emails);
  printReport(report, resolved);

  const failed = report.checks.some((c) => !c.pass);
  process.exit(failed ? 1 : 0);
}

main();
