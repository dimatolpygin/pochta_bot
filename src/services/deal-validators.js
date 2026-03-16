function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
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

function parseRuDate(value) {
  const str = String(value || '').trim();
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return null;
  const [d, m, y] = str.split('.').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

function parseIsoDate(value) {
  const str = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

function parseFlexibleDate(value) {
  return parseRuDate(value) || parseIsoDate(value);
}

function containsToxicLanguage(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return false;

  const patterns = [
    /(?:хуй|хуе|хуё|хуя|пизд|еба|ёба|ебл|бляд|блят|сук|чмо|жоп|гандон|мудак|мраз|дебил)/iu,
    /(?:fuck|shit|bitch|asshole|dickhead|motherfucker)/iu,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function validateBusinessPersonName(value, fieldLabel) {
  const text = normalizeSpaces(value);
  if (text.length < 5) {
    return { ok: false, error: `${fieldLabel}: введите полное ФИО (минимум 5 символов).` };
  }
  if (containsToxicLanguage(text)) {
    return { ok: false, error: `${fieldLabel}: обнаружена недопустимая лексика. Введите корректные деловые данные.` };
  }
  if (/\d/.test(text)) {
    return { ok: false, error: `${fieldLabel}: ФИО не должно содержать цифры.` };
  }
  if (!/^[A-Za-zА-Яа-яЁё\-\s.]+$/.test(text)) {
    return { ok: false, error: `${fieldLabel}: используйте только буквы, пробелы, точку и дефис.` };
  }

  const words = text.split(' ').filter(Boolean);
  if (words.length < 2) {
    return { ok: false, error: `${fieldLabel}: укажите минимум имя и фамилию.` };
  }

  return { ok: true, value: text };
}

function validateBusinessTitle(value, fieldLabel) {
  const text = normalizeSpaces(value);
  if (text.length < 2) {
    return { ok: false, error: `${fieldLabel}: введите корректную должность.` };
  }
  if (containsToxicLanguage(text)) {
    return { ok: false, error: `${fieldLabel}: обнаружена недопустимая лексика. Введите корректные деловые данные.` };
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(text)) {
    return { ok: false, error: `${fieldLabel}: должность должна содержать буквы.` };
  }
  if (!/^[A-Za-zА-Яа-яЁё0-9\-\s"«»().,]+$/.test(text)) {
    return { ok: false, error: `${fieldLabel}: используйте корректные символы для должности.` };
  }
  return { ok: true, value: text };
}

function validateChronologyWindow(startDateStr, endDateStr) {
  const start = parseRuDate(startDateStr);
  const end = parseRuDate(endDateStr);
  if (!start || !end) {
    return { ok: false, code: 'INVALID_RANGE_FORMAT', error: 'Проверьте формат дат сделки (ДД.ММ.ГГГГ).' };
  }
  if (start.getTime() > end.getTime()) {
    return { ok: false, code: 'START_AFTER_END', error: 'Дата начала сделки не может быть позже даты завершения.' };
  }
  return { ok: true, start, end };
}

function validatePaymentsChronology(payments, shipmentDateValue, allowPrepayment) {
  const shipmentDate = parseFlexibleDate(shipmentDateValue);
  if (!Array.isArray(payments) || payments.length === 0) {
    return { ok: false, code: 'NO_PAYMENTS', error: 'Нужно указать хотя бы одну оплату.' };
  }

  for (const payment of payments) {
    const paymentDate = parseRuDate(payment.date);
    const creditedDate = parseRuDate(payment.creditedDate);
    if (!paymentDate || !creditedDate) {
      return { ok: false, code: 'INVALID_PAYMENT_DATE', error: 'В оплатах указаны некорректные даты.' };
    }

    if (creditedDate.getTime() < paymentDate.getTime()) {
      return {
        ok: false,
        code: 'CREDIT_BEFORE_PAYMENT',
        error: `Дата зачисления ${payment.creditedDate} раньше даты оплаты ${payment.date}.`,
      };
    }

    if (!allowPrepayment && shipmentDate) {
      if (paymentDate.getTime() < shipmentDate.getTime() || creditedDate.getTime() < shipmentDate.getTime()) {
        return {
          ok: false,
          code: 'PREPAYMENT_CONFLICT',
          error: `Оплата ${payment.date} / зачисление ${payment.creditedDate} раньше отгрузки ${formatRuDate(shipmentDate)}.`,
        };
      }
    }
  }

  return { ok: true };
}

function formatRuDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

function isMismatch(left, right, tolerance = 0.01) {
  return Math.abs((Number(left) || 0) - (Number(right) || 0)) > tolerance;
}

function normalizeFinancials(updData) {
  const clone = {
    ...updData,
    items: Array.isArray(updData?.items) ? updData.items.map((item) => ({ ...item })) : [],
  };

  const corrections = [];
  const issues = [];

  clone.items = clone.items.map((item, index) => {
    let qty = parseNumber(item.qty);
    const price = parseNumber(item.price);
    let amount = parseNumber(item.amount);
    const vatAmountRaw = parseNumber(item.vat_amount);
    const vatAmount = vatAmountRaw === null ? null : round2(vatAmountRaw);

    if (qty !== null) qty = round3(qty);
    if (amount !== null) amount = round2(amount);

    if (price !== null && price > 0) {
      if (qty !== null && qty > 0) {
        const expectedAmount = round2(qty * price);
        if (amount !== null && isMismatch(expectedAmount, amount)) {
          issues.push(
            `Позиция ${index + 1}: сумма строки (${amount}) не бьётся с qty*price (${expectedAmount}).`
          );
          corrections.push(
            `Позиция ${index + 1}: сумма строки скорректирована (${amount} -> ${expectedAmount}) по формуле qty*price.`
          );
          amount = expectedAmount;
        } else if (amount === null) {
          amount = expectedAmount;
          corrections.push(
            `Позиция ${index + 1}: сумма восстановлена (${amount}) по формуле qty*price.`
          );
        }
      } else if (amount !== null && amount > 0) {
        const correctedQty = round3(amount / price);
        if (correctedQty > 0) {
          corrections.push(
            `Позиция ${index + 1}: количество скорректировано (${qty ?? 'null'} -> ${correctedQty}) по формуле amount/price.`
          );
          qty = correctedQty;
        }
      }
    }

    if (amount === null) {
      issues.push(`Позиция ${index + 1}: не хватает данных qty/price/amount.`);
    }

    return {
      ...item,
      qty,
      price: price === null ? null : round2(price),
      amount: amount === null ? null : round2(amount),
      vat_amount: vatAmount,
    };
  });

  const sumWithoutVat = round2(clone.items.reduce((sum, item) => sum + (item.amount || 0), 0));
  const sumVat = round2(clone.items.reduce((sum, item) => sum + (item.vat_amount || 0), 0));

  clone.total_without_vat = parseNumber(clone.total_without_vat);
  clone.total_vat = parseNumber(clone.total_vat);
  clone.total_with_vat = parseNumber(clone.total_with_vat);

  if (sumWithoutVat > 0) {
    if (clone.total_without_vat === null) {
      clone.total_without_vat = sumWithoutVat;
      corrections.push('Восстановлена total_without_vat по сумме строк.');
    } else if (isMismatch(clone.total_without_vat, sumWithoutVat)) {
      corrections.push(
        `total_without_vat скорректирована (${clone.total_without_vat} -> ${sumWithoutVat}) по сумме строк.`
      );
      clone.total_without_vat = sumWithoutVat;
    }
  }

  if (clone.total_vat === null) {
    clone.total_vat = sumVat;
    corrections.push('Восстановлена total_vat по сумме НДС строк.');
  } else if (sumVat > 0 && isMismatch(clone.total_vat, sumVat)) {
    corrections.push(`total_vat скорректирована (${clone.total_vat} -> ${sumVat}) по сумме НДС строк.`);
    clone.total_vat = sumVat;
  }

  if (clone.total_without_vat !== null && clone.total_vat !== null) {
    const expected = round2(clone.total_without_vat + clone.total_vat);
    if (clone.total_with_vat === null || isMismatch(clone.total_with_vat, expected)) {
      corrections.push(`Итог с НДС скорректирован (${clone.total_with_vat ?? 'null'} -> ${expected}).`);
      clone.total_with_vat = expected;
    }
  }

  return { normalized: clone, corrections, issues };
}

module.exports = {
  containsToxicLanguage,
  normalizeFinancials,
  parseFlexibleDate,
  parseRuDate,
  validateBusinessPersonName,
  validateBusinessTitle,
  validateChronologyWindow,
  validatePaymentsChronology,
};
