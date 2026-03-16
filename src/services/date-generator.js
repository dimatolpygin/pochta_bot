const TZ_OFFSET = '+0300';
const WORK_START = 9;
const WORK_END = 18;

function isWorkday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function nextWorkday(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (!isWorkday(d)) d.setDate(d.getDate() + 1);
  return d;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function withTime(date, hour, minute) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function randomWorkTime(date) {
  const safeDate = isWorkday(date) ? new Date(date) : nextWorkday(date);
  const hour = randomInt(WORK_START, WORK_END - 1);
  const minute = randomInt(0, 59);
  return withTime(safeDate, hour, minute);
}

function replyTime(prevDate) {
  const d = new Date(prevDate);
  const delayMinutes = randomInt(20, 180);
  d.setMinutes(d.getMinutes() + delayMinutes);

  if (d.getHours() >= WORK_END || !isWorkday(d)) {
    const next = nextWorkday(d);
    return withTime(next, randomInt(WORK_START, 11), randomInt(0, 59));
  }

  return d;
}

function ensureStrictlyAfter(date, minDate, isReply) {
  if (date.getTime() > minDate.getTime()) return date;
  if (isReply) return replyTime(minDate);

  const next = nextWorkday(minDate);
  return withTime(next, randomInt(WORK_START, 13), randomInt(0, 59));
}

function enforceChronology(dates) {
  for (let i = 1; i < dates.length; i++) {
    const min = dates[i - 1].date;
    dates[i].date = ensureStrictlyAfter(dates[i].date, min, i % 2 === 1);
  }

  if (dates[8] && dates[9]) {
    dates[9].date = ensureStrictlyAfter(dates[9].date, dates[8].date, true);
  }

  if (dates[9] && dates[10]) {
    dates[10].date = ensureStrictlyAfter(dates[10].date, dates[9].date, false);
  }

  if (dates[10] && dates[11]) {
    dates[11].date = ensureStrictlyAfter(dates[11].date, dates[10].date, true);
  }
}

function toRFC(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${days[date.getDay()]}, ${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:00 ${TZ_OFFSET}`;
}

function toTextDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function parseDate(str) {
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [d, m, y] = str.split('.').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }

  return null;
}

function maxDate(values) {
  let latest = null;
  for (const value of values) {
    if (!value) continue;
    if (!latest || value.getTime() > latest.getTime()) {
      latest = value;
    }
  }
  return latest;
}

function generateChainDates(startDate, endDate, count, updDateStr, contractDateStr, shipmentDateStr, anchors = {}) {
  const start = parseDate(startDate) || new Date();
  const end = parseDate(endDate);
  const updDate = parseDate(updDateStr);
  const contractDate = parseDate(contractDateStr);
  const shipmentDate = parseDate(shipmentDateStr) || updDate;
  const paymentDate = parseDate(anchors.paymentCreditedDate) || parseDate(anchors.paymentDate);
  const closingDocsDate = parseDate(anchors.closingDocsDate);

  const dates = [];
  let current = randomWorkTime(isWorkday(start) ? start : nextWorkday(start));

  for (let i = 0; i < count; i++) {
    const isReply = i % 2 === 1;
    let d;

    if (i === 0) {
      d = current;
    } else if (isReply) {
      d = replyTime(dates[i - 1].date);
    } else {
      const gap = randomInt(1, 3);
      let base = new Date(dates[i - 1].date);
      for (let g = 0; g < gap; g++) base = nextWorkday(base);
      d = randomWorkTime(base);
    }

    dates.push({
      date: d,
      rfcDate: '',
      textDate: '',
      type: getEmailType(i),
    });
  }

  if (dates[4] && contractDate) {
    dates[4].date = ensureStrictlyAfter(dates[4].date, randomWorkTime(contractDate), false);
  }

  if (dates[5] && contractDate) {
    dates[5].date = ensureStrictlyAfter(dates[5].date, randomWorkTime(contractDate), true);
  }

  if (dates[4] && dates[5]) {
    dates[5].date = ensureStrictlyAfter(dates[5].date, dates[4].date, true);
  }

  if (dates[8] && shipmentDate) {
    dates[8].date = randomWorkTime(shipmentDate);
  }
  if (dates[7] && dates[8]) {
    dates[8].date = ensureStrictlyAfter(dates[8].date, dates[7].date, false);
  }

  if (dates[10] && paymentDate) {
    dates[10].date = ensureStrictlyAfter(dates[10].date, randomWorkTime(paymentDate), false);
  }

  if (dates[11] && closingDocsDate) {
    dates[11].date = ensureStrictlyAfter(dates[11].date, randomWorkTime(closingDocsDate), true);
  }

  enforceChronology(dates);

  const hardFloorForLast = maxDate([
    dates[dates.length - 2]?.date || null,
    contractDate,
    paymentDate,
    closingDocsDate,
  ]);

  if (
    end &&
    dates.length > 1 &&
    dates[dates.length - 1].date > end &&
    (!hardFloorForLast || hardFloorForLast.getTime() <= end.getTime())
  ) {
    const last = randomWorkTime(end);
    dates[dates.length - 1].date = ensureStrictlyAfter(last, dates[dates.length - 2].date, true);
    enforceChronology(dates);
  }

  for (const item of dates) {
    item.rfcDate = toRFC(item.date);
    item.textDate = toTextDate(item.date);
  }

  return dates;
}

function getEmailType(index) {
  const types = [
    'inquiry',
    'quote',
    'discount_req',
    'discount_ok',
    'contract_ok',
    'contract_sent',
    'order',
    'order_confirm',
    'shipment',
    'acceptance',
    'payment',
    'closing_docs',
  ];
  return types[index] || `email_${index}`;
}

module.exports = { generateChainDates, toRFC, toTextDate, parseDate };
