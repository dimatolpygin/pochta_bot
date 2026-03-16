const {
  normalizeFinancials,
  validateBusinessPersonName,
  validateBusinessTitle,
  validateChronologyWindow,
  validatePaymentsChronology,
} = require('../src/services/deal-validators');

function runScenario(name, fn) {
  try {
    const ok = fn();
    if (!ok) {
      console.log(`FAIL | ${name}`);
      return false;
    }
    console.log(`PASS | ${name}`);
    return true;
  } catch (err) {
    console.log(`FAIL | ${name}`);
    console.log(`  ${err.message}`);
    return false;
  }
}

function scenarioDirtyFields() {
  const badName = validateBusinessPersonName('хуйлуша', 'ФИО контактного лица');
  const badTitle = validateBusinessTitle('сука', 'Должность');
  const goodName = validateBusinessPersonName('Иванов Иван', 'ФИО контактного лица');
  const goodTitle = validateBusinessTitle('Менеджер по закупкам', 'Должность');

  return !badName.ok && !badTitle.ok && goodName.ok && goodTitle.ok;
}

function scenarioConflictingArithmetic() {
  const data = {
    items: [
      { name: 'Товар 1', qty: 10, price: 5, amount: 60, vat_amount: 0 },
    ],
    total_without_vat: 60,
    total_vat: 0,
    total_with_vat: 60,
  };

  const { normalized, corrections, issues } = normalizeFinancials(data);
  const correctedAmount = normalized.items[0].amount;

  return correctedAmount === 50 && corrections.length > 0 && issues.length > 0;
}

function scenarioConflictingDates() {
  const range = validateChronologyWindow('20.08.2025', '16.08.2025');
  const payment = validatePaymentsChronology(
    [{ date: '15.08.2025', amount: 100, basis: 'Оплата', document: 'ПП', creditedDate: '16.08.2025' }],
    '2025-08-20',
    false
  );

  return !range.ok && payment.code === 'PREPAYMENT_CONFLICT';
}

function main() {
  const results = [
    runScenario('Грязные поля ввода', scenarioDirtyFields),
    runScenario('Конфликтная арифметика', scenarioConflictingArithmetic),
    runScenario('Конфликтные даты', scenarioConflictingDates),
  ];

  const failed = results.some((r) => !r);
  if (failed) {
    process.exit(1);
  }
}

main();
