import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCalculator, setExchangeRates, setProgramContext } from './calculators.js'
import { TAX_STATE_CODES, figureTaxes } from './taxes.js'
import { formatDuration, parseLooseNumber } from './format.js'

function run(id, overrides = {}) {
  const calc = getCalculator(id)
  return calc.compute({ ...calc.defaults, ...overrides })
}

test('parses loose numbers and formats durations', () => {
  assert.equal(parseLooseNumber('1,000.50'), 1000.5)
  assert.equal(parseLooseNumber('$2,500'), 2500)
  assert.equal(parseLooseNumber('7.'), 7)
  assert.equal(parseLooseNumber(''), null)
  assert.equal(formatDuration(0), '0 months')
  assert.equal(formatDuration(1), '1 month')
  assert.equal(formatDuration(12), '1 year')
  assert.equal(formatDuration(14), '1 year 2 months')
  assert.equal(formatDuration(0.5), '15 days')
  assert.equal(formatDuration(18.5), '1 year 6 months 15 days')
})

test('compound interest matches the closed-form future value', () => {
  const result = run('compound', {
    principal: '10000',
    annualRate: '7',
    years: '10',
    compounds: '12',
    contributionFrequency: 'monthly',
    contribution: '100',
  })
  assert.equal(result.ok, true)
  const r = 0.07 / 12
  const n = 120
  const expected = 10000 * (1 + r) ** n + 100 * (((1 + r) ** n - 1) / r)
  assert.ok(Math.abs(result.result.raw.futureValue - expected) < 0.02)
  assert.equal(result.result.raw.totalContributed, 22000)
  assert.ok(Math.abs(result.result.raw.interestEarned - (expected - 22000)) < 0.02)
})

test('more frequent compounding grows a lump sum faster', () => {
  const annual = run('compound', {
    principal: '10000',
    annualRate: '7',
    years: '10',
    compounds: '1',
    contributionFrequency: 'none',
    contribution: '0',
  })
  const daily = run('compound', {
    principal: '10000',
    annualRate: '7',
    years: '10',
    compounds: '365',
    contributionFrequency: 'none',
    contribution: '0',
  })
  assert.equal(annual.ok, true)
  assert.equal(daily.ok, true)
  assert.ok(daily.result.raw.futureValue > annual.result.raw.futureValue)
  assert.equal(annual.result.raw.totalContributed, 10000)
})

test('yearly deposits with no growth are the sum of the deposits', () => {
  const result = run('compound', {
    principal: '0',
    annualRate: '0',
    years: '10',
    compounds: '12',
    contributionFrequency: 'yearly',
    contribution: '1000',
  })
  assert.equal(result.ok, true)
  assert.ok(Math.abs(result.result.raw.futureValue - 10000) < 0.01)
})

test('extreme growth is rejected instead of returning infinity', () => {
  const result = run('compound', {
    annualRate: '100',
    years: '100',
    compounds: '365',
    contributionFrequency: 'none',
    contribution: '0',
  })
  assert.equal(result.ok, false)
  assert.match(result.formError, /too large/i)
})

test('loan payment matches the standard amortization formula and pays off', () => {
  const result = run('loan', { amount: '200000', annualRate: '6', years: '30', extra: '0' })
  assert.equal(result.ok, true)
  const r = 0.06 / 12
  const n = 360
  const expected = (200000 * r * (1 + r) ** n) / ((1 + r) ** n - 1)
  assert.ok(Math.abs(result.result.raw.scheduledPayment - expected) < 0.01)
  assert.equal(result.result.raw.payoffMonths, 360)
  const rows = result.result.schedule.rows
  assert.equal(rows[rows.length - 1].balance, '$0.00')
})

test('a minimum payment reports how long the loan takes', () => {
  const result = run('loan', { amount: '1200', annualRate: '0', mode: 'minimum', minimum: '100' })
  assert.equal(result.ok, true)
  assert.equal(result.result.raw.payoffMonths, 12)
  assert.equal(result.result.raw.totalInterest, 0)
  assert.equal(result.result.raw.totalPaid, 1200)

  const short = run('loan', { amount: '1000', annualRate: '12', mode: 'minimum', minimum: '5' })
  assert.equal(short.ok, false)
  assert.match(short.fieldErrors.minimum, /higher/i)
})

test('refinance compares the current loan with the new one', () => {
  const result = run('refinance', {
    balance: '12000',
    currentRate: '0',
    remaining: '1',
    newRate: '0',
    newYears: '2',
    costs: '600',
    costsMode: 'upfront',
  })
  assert.equal(result.ok, true)
  assert.ok(Math.abs(result.result.raw.currentPayment - 1000) < 0.01)
  assert.ok(Math.abs(result.result.raw.newPayment - 500) < 0.01)
  assert.ok(Math.abs(result.result.raw.savings - 500) < 0.01)
  assert.equal(result.result.raw.breakEvenMonths, 2)
  assert.ok(Math.abs(result.result.raw.lifetime - -600) < 0.01)

  const rolled = run('refinance', {
    balance: '12000',
    currentRate: '0',
    remaining: '1',
    newRate: '0',
    newYears: '2',
    costs: '600',
    costsMode: 'rolled',
  })
  assert.equal(rolled.ok, true)
  assert.ok(Math.abs(rolled.result.raw.newPrincipal - 12600) < 0.01)
  assert.ok(Math.abs(rolled.result.raw.newPayment - 525) < 0.01)
})

test('extra principal shortens a loan', () => {
  const result = run('loan', { amount: '200000', annualRate: '6', years: '30', extra: '200' })
  assert.equal(result.ok, true)
  assert.ok(result.result.raw.payoffMonths < 360)
  assert.equal(result.result.schedule.rows.at(-1).balance, '$0.00')
})

test('mortgage separates housing costs from the loan', () => {
  const result = run('mortgage', {
    price: '450000',
    down: '90000',
    annualRate: '6',
    years: '30',
    tax: '5400',
    insurance: '1800',
    hoa: '0',
    extra: '0',
  })
  assert.equal(result.ok, true)
  assert.equal(result.result.raw.loanAmount, 360000)
  assert.ok(result.result.raw.monthlyHousing > result.result.raw.monthlyPayment)
  const rejected = run('mortgage', { down: '500000' })
  assert.equal(rejected.ok, false)
  assert.ok(rejected.fieldErrors.down)
})

test('savings goal solves both time and payment', () => {
  const time = run('savings', {
    goal: '1200',
    current: '0',
    annualRate: '0',
    mode: 'time',
    monthly: '100',
    years: '5',
  })
  assert.equal(time.ok, true)
  assert.equal(time.result.raw.months, 12)

  const payment = run('savings', {
    goal: '12000',
    current: '0',
    annualRate: '0',
    mode: 'payment',
    monthly: '0',
    years: '1',
  })
  assert.equal(payment.ok, true)
  assert.ok(Math.abs(payment.result.raw.monthlyPayment - 1000) < 0.01)
})

test('retirement with no growth preserves savings and applies the withdrawal rate', () => {
  const result = run('retirement', {
    currentAge: '30',
    retireAge: '40',
    savings: '10000',
    monthly: '0',
    annualRate: '0',
    inflation: '0',
    withdrawal: '4',
  })
  assert.equal(result.ok, true)
  assert.ok(Math.abs(result.result.raw.realNestEgg - 10000) < 0.01)
  assert.ok(Math.abs(result.result.raw.annualWithdrawal - 400) < 0.01)
})

test('net worth rolls up assets, debts, and monthly bills', () => {
  const savings = { ...getCalculator('savings').defaults, current: '10000' }
  const retirement = { ...getCalculator('retirement').defaults, savings: '40000' }
  const mortgage = { ...getCalculator('mortgage').defaults, price: '300000', down: '60000' }
  const subscriptions = { ...getCalculator('subscriptions').defaults, discount: 'student' }
  setProgramContext({ savings, retirement, mortgage, subscriptions })

  const result = run('networth', {
    entries: JSON.stringify([
      { kind: 'asset', name: 'Checking', amount: '2000' },
      { kind: 'debt', name: 'Personal loan', amount: '500' },
      { kind: 'bill', name: 'Electric', amount: '90' },
      { kind: 'asset', name: '', amount: '' },
    ]),
  })
  const sub = getCalculator('subscriptions').compute(subscriptions)
  assert.equal(result.ok, true)
  assert.equal(sub.ok, true)
  assert.ok(Math.abs(result.result.raw.assets - 352000) < 0.01)
  assert.ok(Math.abs(result.result.raw.debts - 240500) < 0.01)
  assert.ok(Math.abs(result.result.raw.net - 111500) < 0.01)
  assert.ok(Math.abs(result.result.raw.monthly - (sub.result.raw.monthly + 90)) < 0.01)
  assert.ok(Math.abs(result.result.raw.afterYear - (111500 - result.result.raw.monthly * 12)) < 0.02)
  const names = result.result.schedule.rows.map((row) => row.item)
  assert.deepEqual(names, ['Savings', 'Retirement', 'Home', 'Checking', 'Mortgage', 'Personal loan', 'Subscriptions', 'Electric'])

  setProgramContext({
    carloan: { ...getCalculator('carloan').defaults, price: '20000', down: '5000', tax: '0', fees: '0' },
    loan: { ...getCalculator('loan').defaults, amount: '4000' },
    creditcard: {
      ...getCalculator('creditcard').defaults,
      cards: JSON.stringify([{ name: 'Visa', balance: '800', apr: '18', minimum: '25' }]),
    },
    rent: { ...getCalculator('rent').defaults, rent: '1800', deposit: '1800', insurance: '0', utilities: '0', parking: '0', pet: '0' },
    carlease: { ...getCalculator('carlease').defaults },
    savings: { ...getCalculator('savings').defaults },
  })
  const borrowed = run('networth')
  assert.equal(borrowed.ok, true)
  assert.ok(Math.abs(borrowed.result.raw.assets - 21800) < 0.01)
  assert.ok(Math.abs(borrowed.result.raw.debts - 19800) < 0.01)
  assert.ok(Math.abs(borrowed.result.raw.net - 2000) < 0.01)
  assert.ok(Math.abs(borrowed.result.raw.monthly - 1800) < 0.01)
  const borrowedNames = borrowed.result.schedule.rows.map((row) => row.item)
  assert.ok(borrowedNames.includes('Vehicle'))
  assert.ok(borrowedNames.includes('Car loan'))
  assert.ok(borrowedNames.includes('Visa'))
  assert.ok(borrowedNames.includes('Rent'))
  assert.equal(borrowedNames.includes('Car lease'), false)
  assert.equal(borrowedNames.includes('Savings'), false)

  setProgramContext({
    carlease: { ...getCalculator('carlease').defaults, years: '0', months: '36', days: '0' },
  })
  const sameLease = run('networth')
  assert.equal(sameLease.result.raw.monthly, 0)

  setProgramContext({
    carlease: { ...getCalculator('carlease').defaults, years: '0', months: '24', days: '0' },
  })
  const shorterLease = run('networth')
  assert.ok(shorterLease.result.schedule.rows.some((row) => row.item === 'Car lease'))
  assert.ok(shorterLease.result.raw.monthly > 0)

  setProgramContext(null)
  const empty = run('networth')
  assert.equal(empty.ok, true)
  assert.equal(empty.result.raw.net, 0)
  assert.equal(empty.result.raw.monthly, 0)
  assert.equal(empty.result.schedule.rows[0].item, 'Nothing counted yet')

  const bad = run('networth', { entries: JSON.stringify([{ kind: 'debt', name: 'IOU', amount: 'nope' }]) })
  assert.equal(bad.ok, false)
  assert.ok(bad.fieldErrors['entries-0-amount'])
})

test('return reports CAGR and a loss', () => {
  const gain = run('return', { initial: '100', final: '121', years: '2' })
  assert.equal(gain.ok, true)
  assert.ok(Math.abs(gain.result.raw.cagr - 0.1) < 1e-10)
  assert.ok(Math.abs(gain.result.raw.simpleReturn - 0.21) < 1e-10)
  assert.equal(gain.result.headline.tone, 'positive')

  const loss = run('return', { initial: '10000', final: '7600', years: '2' })
  assert.equal(loss.ok, true)
  assert.equal(loss.result.headline.tone, 'negative')
  assert.ok(loss.result.raw.cagr < 0)
})

test('years, months, and days add into one term', () => {
  const monthsOnly = run('loan', { amount: '1800', annualRate: '0', years: '0', months: '18', days: '0', extra: '0' })
  assert.equal(monthsOnly.ok, true)
  assert.ok(Math.abs(monthsOnly.result.raw.monthlyPayment - 100) < 0.01)
  assert.equal(monthsOnly.result.raw.payoffMonths, 18)

  const withDays = run('loan', { amount: '300', annualRate: '0', years: '1', months: '0', days: '15', extra: '0' })
  assert.equal(withDays.ok, true)
  assert.ok(Math.abs(withDays.result.raw.payoffMonths - 12.5) < 1e-9)
  assert.match(withDays.result.formula.join('\n'), /12\.5 months/)

  const blank = run('loan', { years: '0', months: '0', days: '0' })
  assert.equal(blank.ok, false)
  assert.match(blank.fieldErrors.term, /at least 1 day/)
})

test('car loan adds tax and fees and subtracts the trade-in', () => {
  const cash = run('carloan', {
    price: '30000',
    down: '3000',
    trade: '5000',
    tradeOwed: '0',
    tax: '6',
    fees: '0',
    annualRate: '0',
    termUnit: 'years',
    years: '5',
    extra: '0',
  })
  assert.equal(cash.ok, true)
  assert.equal(cash.result.raw.salesTax, 1500)
  assert.equal(cash.result.raw.amount, 23500)
  assert.ok(Math.abs(cash.result.raw.monthly - 23500 / 60) < 0.01)

  const owed = run('carloan', {
    price: '20000',
    down: '0',
    trade: '8000',
    tradeOwed: '3000',
    tax: '0',
    fees: '100',
    annualRate: '0',
    years: '0',
    months: '12',
    days: '0',
    extra: '0',
  })
  assert.equal(owed.result.raw.amount, 15100)
  assert.ok(Math.abs(owed.result.raw.monthly - 15100 / 12) < 0.01)

  const covered = run('carloan', { price: '10000', down: '20000', tax: '0', fees: '0', trade: '0', tradeOwed: '0' })
  assert.equal(covered.ok, false)
})

test('car lease splits depreciation and the money factor', () => {
  const base = {
    msrp: '40000',
    price: '36000',
    down: '0',
    trade: '0',
    tradeOwed: '0',
    residual: '50',
    tax: '0',
    acquisition: '0',
    disposition: '0',
    years: '0',
    months: '36',
    days: '0',
  }
  const depreciation = (36000 - 20000) / 36
  const finance = (36000 + 20000) * (6 / 2400)
  const pretax = depreciation + finance

  const lease = run('carlease', { ...base, rateKind: 'apr', annualRate: '6' })
  assert.equal(lease.ok, true)
  assert.ok(Math.abs(lease.result.raw.monthly - pretax) < 0.01)
  assert.ok(Math.abs(lease.result.raw.dueAtSigning - pretax) < 0.01)
  assert.equal(lease.result.raw.residualValue, 20000)

  const taxed = run('carlease', { ...base, rateKind: 'apr', annualRate: '6', tax: '10' })
  assert.ok(Math.abs(taxed.result.raw.monthly - pretax * 1.1) < 0.01)

  const byFactor = run('carlease', { ...base, rateKind: 'factor', factor: '0.0025' })
  assert.ok(Math.abs(byFactor.result.raw.monthly - pretax) < 0.01)

  const withFees = run('carlease', {
    ...base,
    rateKind: 'apr',
    annualRate: '0',
    down: '1000',
    acquisition: '695',
    disposition: '395',
  })
  const netCap = 36000 - 1000 + 695
  const expected = (netCap - 20000) / 36
  assert.ok(Math.abs(withFees.result.raw.monthly - expected) < 0.01)
  assert.ok(Math.abs(withFees.result.raw.total - (1000 + expected * 36 + 395)) < 0.02)
})

test('rent rolls fees into monthly housing and compounds the annual increase', () => {
  const flat = run('rent', {
    rent: '1000',
    years: '1',
    increase: '0',
    insurance: '120',
    utilities: '50',
    parking: '0',
    pet: '0',
    deposit: '1000',
  })
  assert.equal(flat.ok, true)
  assert.ok(Math.abs(flat.result.raw.monthlyHousing - 1060) < 0.01)
  assert.ok(Math.abs(flat.result.raw.moveIn - 2060) < 0.01)
  assert.ok(Math.abs(flat.result.raw.totalHousing - 12720) < 0.01)

  const raised = run('rent', {
    rent: '1000',
    years: '2',
    increase: '10',
    insurance: '0',
    utilities: '0',
    parking: '0',
    pet: '0',
    deposit: '0',
  })
  assert.equal(raised.ok, true)
  assert.ok(Math.abs(raised.result.raw.totalHousing - 25200) < 0.01)
  assert.equal(raised.result.schedule.rows[1].rent, '$1,100.00')
  assert.equal(raised.result.raw.freeMonths, 0)
})

test('rent-free months waive base rent at the start and leave fees in place', () => {
  const twoFree = run('rent', {
    rent: '1000',
    years: '1',
    promo: 'free',
    freeMonths: '2',
    increase: '0',
    insurance: '0',
    utilities: '50',
    parking: '0',
    pet: '0',
    deposit: '0',
  })
  assert.equal(twoFree.ok, true)
  assert.ok(Math.abs(twoFree.result.raw.monthlyHousing - 1050) < 0.01)
  assert.ok(Math.abs(twoFree.result.raw.totalRent - 10000) < 0.01)
  assert.ok(Math.abs(twoFree.result.raw.rentWaived - 2000) < 0.01)
  assert.ok(Math.abs(twoFree.result.raw.totalHousing - 10600) < 0.01)
  assert.ok(Math.abs(twoFree.result.raw.moveIn - 50) < 0.01)
  assert.ok(Math.abs(twoFree.result.raw.effective - 10600 / 12) < 0.01)
  assert.equal(twoFree.result.headline.label, 'Effective monthly')
  assert.equal(twoFree.result.schedule.rows[0].free, '2 months')

  const acrossYears = run('rent', {
    rent: '1000',
    years: '2',
    promo: 'free',
    freeMonths: '14',
    increase: '10',
    insurance: '0',
    utilities: '0',
    parking: '0',
    pet: '0',
    deposit: '0',
  })
  assert.equal(acrossYears.ok, true)
  assert.ok(Math.abs(acrossYears.result.raw.rentWaived - 14200) < 0.01)
  assert.ok(Math.abs(acrossYears.result.raw.totalHousing - 11000) < 0.01)
  assert.equal(acrossYears.result.schedule.rows[0].free, '12 months')
  assert.equal(acrossYears.result.schedule.rows[1].free, '2 months')

  const partial = run('rent', {
    rent: '2000',
    years: '1',
    promo: 'free',
    freeMonths: '1.5',
    increase: '0',
    insurance: '0',
    utilities: '0',
    parking: '0',
    pet: '0',
    deposit: '500',
  })
  assert.equal(partial.ok, true)
  assert.ok(Math.abs(partial.result.raw.rentWaived - 3000) < 0.01)
  assert.ok(Math.abs(partial.result.raw.totalHousing - 21000) < 0.01)
  assert.ok(Math.abs(partial.result.raw.moveIn - 500) < 0.01)

  const tooLong = run('rent', { promo: 'free', freeMonths: '13', years: '1' })
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.fieldErrors.freeTerm, /longer than the lease/)

  const none = run('rent', { promo: 'free', freeMonths: '0' })
  assert.equal(none.ok, false)

  const halfYear = run('rent', {
    rent: '1000',
    years: '1',
    months: '6',
    days: '0',
    increase: '10',
    insurance: '0',
    utilities: '0',
    parking: '0',
    pet: '0',
    deposit: '0',
  })
  assert.equal(halfYear.ok, true)
  assert.equal(halfYear.result.raw.months, 18)
  assert.ok(Math.abs(halfYear.result.raw.totalHousing - 18600) < 0.01)
  assert.equal(halfYear.result.schedule.rows[1].rent, '$1,100.00')

  const shortLease = run('rent', { years: '0', months: '0', days: '0' })
  assert.equal(shortLease.ok, false)
})

test('sales tax uses the selected state rate and an optional local rate', () => {
  const calc = getCalculator('salestax')
  const states = calc.fields.find((field) => field.key === 'state')
  assert.equal(states.options.length, 50)

  const california = run('salestax', { price: '100', quantity: '1', state: 'CA', local: '0' })
  assert.equal(california.ok, true)
  assert.ok(Math.abs(california.result.raw.tax - 7.25) < 0.001)
  assert.ok(Math.abs(california.result.raw.total - 107.25) < 0.001)

  const oregon = run('salestax', { price: '80', quantity: '1', state: 'OR', local: '0' })
  assert.equal(oregon.ok, true)
  assert.equal(oregon.result.raw.tax, 0)
  assert.equal(oregon.result.raw.total, 80)

  const local = run('salestax', { price: '100', quantity: '1', state: 'NY', local: '4.5' })
  assert.equal(local.ok, true)
  assert.ok(Math.abs(local.result.raw.tax - 8.5) < 0.001)
  assert.ok(Math.abs(local.result.raw.subtotal - 100) < 0.001)
  assert.equal(local.result.all.rows.length, 50)
  assert.equal(local.result.all.rows[0].state, 'New York')
  assert.equal(local.result.all.rows[0].rate, '8.5%')

  const several = run('salestax', { price: '10', quantity: '3', state: 'CA', local: '0' })
  assert.ok(Math.abs(several.result.raw.subtotal - 30) < 0.001)
  assert.ok(Math.abs(several.result.raw.tax - 2.175) < 0.001)

  const noted = run('salestax', { price: '80', quantity: '1', state: 'OR', local: '0', comment: 'Notebook' })
  assert.equal(noted.ok, true)
  assert.equal(noted.result.raw.tax, 0)
  assert.equal(noted.result.raw.total, 80)
  assert.equal(noted.result.schedule.rows[0].line, 'Notebook')
  assert.match(noted.result.headline.detail, /Notebook/)

  const listed = run('salestax', {
    entry: 'list',
    state: 'CA',
    local: '0',
    items: JSON.stringify([
      { comment: 'Milk', price: '10', quantity: '1' },
      { comment: 'Bread', price: '20', quantity: '2' },
    ]),
  })
  assert.equal(listed.ok, true)
  assert.ok(Math.abs(listed.result.raw.subtotal - 50) < 0.001)
  assert.ok(Math.abs(listed.result.raw.tax - 3.625) < 0.001)
  assert.equal(listed.result.raw.lines, 2)
  assert.equal(listed.result.raw.quantity, 3)
  assert.equal(listed.result.schedule.rows[0].line, 'Milk')
  assert.equal(listed.result.schedule.rows[1].line, 'Bread × 2')

  const blank = run('salestax', {
    entry: 'list',
    items: JSON.stringify([{ comment: '', price: '', quantity: '1' }]),
  })
  assert.equal(blank.ok, false)
  assert.equal(blank.fieldErrors['item-0-price'], 'Enter a number')
})

test('credit card payoff counts months until the balance is gone', () => {
  const single = JSON.stringify([{ name: 'Card', balance: '1000', apr: '12', minimum: '25' }])
  const result = run('creditcard', { method: 'avalanche', payment: '100', cards: single })
  assert.equal(result.ok, true)
  const periods = Math.log(100 / (100 - 10)) / Math.log(1.01)
  assert.equal(result.result.raw.payoffMonths, Math.ceil(periods - 1e-9))
  assert.ok(Math.abs(result.result.raw.totalPaid - (1000 + result.result.raw.totalInterest)) < 0.02)
  assert.ok(result.result.raw.totalInterest > 50 && result.result.raw.totalInterest < 70)
  assert.ok(Math.abs(result.result.raw.suggestedIncome - result.result.raw.suggestedPayment / 0.36) < 0.01)
  const suggested = run('creditcard', { method: 'avalanche', payment: String(result.result.raw.suggestedPayment), cards: single })
  assert.equal(suggested.ok, true)
  assert.ok(suggested.result.raw.payoffMonths <= 36)

  const low = run('creditcard', { method: 'avalanche', payment: '20', cards: single })
  assert.equal(low.ok, true)
  assert.equal(low.result.raw.paidOff, true)
  assert.ok(low.result.raw.payoffMonths > result.result.raw.payoffMonths)
  assert.match(low.fieldErrors.payment, /Minimum payment needs to be higher/)
  assert.match(low.result.headline.warning, /Minimum payment needs to be higher/)

  const withBlank = run('creditcard', {
    method: 'avalanche',
    payment: '100',
    cards: JSON.stringify([
      { name: 'Card', balance: '1000', apr: '12', minimum: '25' },
      { name: '', balance: '', apr: '', minimum: '' },
    ]),
  })
  assert.equal(withBlank.ok, true)
  assert.equal(withBlank.result.raw.payoffMonths, result.result.raw.payoffMonths)
  assert.equal(withBlank.fieldErrors['cards-1-balance'], undefined)

  const short = run('creditcard', {
    method: 'minimums',
    cards: JSON.stringify([{ name: 'Card', balance: '1000', apr: '12', minimum: '10' }]),
  })
  assert.equal(short.ok, true)
  assert.equal(short.result.raw.paidOff, false)
  assert.match(short.fieldErrors['cards-0-minimum'], /higher/i)
  assert.equal(short.result.headline.value, 'Balance grows')
})

test('snowball and avalanche pay cards in different orders', () => {
  const cards = JSON.stringify([
    { name: 'Store', balance: '100', apr: '10', minimum: '10' },
    { name: 'Visa', balance: '400', apr: '30', minimum: '20' },
  ])
  const snowball = run('creditcard', { method: 'snowball', payment: '80', cards })
  const avalanche = run('creditcard', { method: 'avalanche', payment: '80', cards })
  assert.equal(snowball.ok, true)
  assert.equal(avalanche.ok, true)
  assert.deepEqual(snowball.result.raw.order, ['Store', 'Visa'])
  assert.deepEqual(avalanche.result.raw.order, ['Visa', 'Store'])
  assert.ok(avalanche.result.raw.totalInterest < snowball.result.raw.totalInterest)

  const zero = JSON.stringify([
    { name: 'Big', balance: '100', apr: '0', minimum: '10' },
    { name: 'Small', balance: '40', apr: '0', minimum: '10' },
  ])
  const flat = run('creditcard', { method: 'snowball', payment: '30', cards: zero })
  assert.equal(flat.ok, true)
  assert.equal(flat.result.raw.payoffMonths, 5)
  assert.equal(flat.result.raw.totalInterest, 0)
  assert.deepEqual(flat.result.raw.order, ['Small', 'Big'])
})

test('debt-to-income adds passive income to wages', () => {
  const wages = run('dti', {
    wages: '5000',
    passiveMode: 'none',
    housing: '1800',
    auto: '400',
    cards: '150',
    student: '200',
    other: '0',
  })
  assert.equal(wages.ok, true)
  assert.ok(Math.abs(wages.result.raw.debts - 2550) < 0.01)
  assert.ok(Math.abs(wages.result.raw.ratio - 2550 / 5000) < 0.0001)
  assert.equal(wages.result.raw.passive, 0)

  const rental = run('dti', {
    wages: '5000',
    passiveMode: 'add',
    passive: JSON.stringify([
      { kind: 'rent', amount: '1000' },
      { kind: 'dividends', amount: '200' },
    ]),
    housing: '1800',
    auto: '400',
    cards: '150',
    student: '200',
    other: '0',
  })
  assert.equal(rental.ok, true)
  assert.ok(Math.abs(rental.result.raw.income - 6200) < 0.01)
  assert.ok(Math.abs(rental.result.raw.passive - 1200) < 0.01)
  assert.ok(Math.abs(rental.result.raw.ratio - 2550 / 6200) < 0.0001)
  assert.ok(rental.result.raw.ratio < wages.result.raw.ratio)
  assert.equal(rental.result.schedule.rows[1].line, 'Rental income')
  assert.equal(rental.result.schedule.rows[2].line, 'Dividends')

  const noted = run('dti', {
    wages: '5000',
    passiveMode: 'none',
    housingSource: 'amount',
    housing: '1800',
    auto: '0',
    cards: '0',
    student: '0',
    others: JSON.stringify([
      { comment: 'Medical', amount: '80' },
      { comment: '', amount: '' },
    ]),
  })
  assert.equal(noted.ok, true)
  assert.ok(Math.abs(noted.result.raw.debts - 1880) < 0.01)
  assert.equal(noted.result.schedule.rows.some((row) => row.line === 'Medical'), true)
  assert.equal(noted.fieldErrors['others-1-amount'], undefined)

  const mortgage = { ...getCalculator('mortgage').defaults, price: '500000', down: '100000' }
  setProgramContext(
    { mortgage, rent: { ...getCalculator('rent').defaults } },
    { mortgage: 5, rent: 1 },
  )
  const linked = run('dti', {
    wages: '8000',
    passiveMode: 'none',
    housingSource: 'auto',
    housing: '1',
    auto: '0',
    cards: '0',
    student: '0',
    others: JSON.stringify([{ comment: '', amount: '0' }]),
  })
  const mortgageResult = run('mortgage', mortgage)
  assert.equal(linked.ok, true)
  assert.equal(linked.result.raw.housingFrom, 'mortgage')
  assert.ok(Math.abs(linked.result.raw.housing - mortgageResult.result.raw.monthlyHousing) < 0.02)
  assert.ok(linked.result.raw.housing > 1)

  const rentValues = { ...getCalculator('rent').defaults, rent: '3000' }
  setProgramContext(
    { mortgage, rent: rentValues },
    { mortgage: 5, rent: 9 },
  )
  const fromRent = run('dti', {
    wages: '8000',
    housingSource: 'auto',
    auto: '0',
    cards: '0',
    student: '0',
  })
  const rentResult = run('rent', rentValues)
  assert.equal(fromRent.result.raw.housingFrom, 'rent')
  assert.ok(Math.abs(fromRent.result.raw.housing - rentResult.result.raw.monthlyHousing) < 0.02)
  setProgramContext(null)
})

test('exchange converts through USD and lists the other currencies', () => {
  setExchangeRates({
    status: 'ready',
    date: '2026-10-18',
    rates: { USD: 1, EUR: 0.9, JPY: 150, GBP: 0.75 },
    currencies: [
      { code: 'EUR', name: 'Euro' },
      { code: 'GBP', name: 'British Pound' },
      { code: 'JPY', name: 'Japanese Yen' },
      { code: 'USD', name: 'US Dollar' },
    ],
    fetchedAt: Date.now(),
  })

  const euros = run('exchange', { amount: '100', from: 'USD', to: 'EUR', query: '' })
  assert.equal(euros.ok, true)
  assert.ok(Math.abs(euros.result.raw.converted - 90) < 0.001)
  assert.equal(euros.result.raw.listed, 3)
  assert.match(euros.result.schedule.rows[0].pair, /Euro/)
  assert.equal(euros.result.all.rows[0].currency, 'Euro · EUR')

  const yen = run('exchange', { amount: '100', from: 'EUR', to: 'JPY', query: '' })
  assert.equal(yen.ok, true)
  assert.ok(Math.abs(yen.result.raw.converted - (100 * 150) / 0.9) < 0.001)

  const filtered = run('exchange', { amount: '100', from: 'USD', to: 'EUR', query: 'yen' })
  assert.equal(filtered.ok, true)
  assert.equal(filtered.result.raw.listed, 1)
  assert.match(filtered.result.all.rows[0].currency, /JPY/)
})

test('subscriptions price the catalog and copy into debt, pay, and savings', () => {
  const both = run('subscriptions')
  assert.equal(both.ok, true)
  assert.equal(both.result.raw.monthly, 29)
  assert.equal(both.result.raw.count, 2)
  assert.equal(both.result.schedule.rows[0].service, 'YouTube Premium')
  assert.equal(both.result.schedule.rows[0].monthly, '$16.00')
  assert.equal(both.result.all.rows.length, 40)
  assert.equal(both.result.all.rows.find((row) => row.service === 'Video · YouTube Premium').price, '$16.00')

  const student = run('subscriptions', {
    discount: 'student',
    services: JSON.stringify([
      { service: 'spotify', name: '', price: '' },
      { service: 'youtube', name: '', price: '' },
      { service: 'hulu', name: '', price: '' },
    ]),
  })
  assert.ok(Math.abs(student.result.raw.monthly - (6.99 + 16 + 1.99)) < 0.001)
  assert.equal(student.result.schedule.rows[1].note.includes('Full price'), true)

  const military = run('subscriptions', {
    discount: 'military',
    services: JSON.stringify([{ service: 'peacock', name: '', price: '' }]),
  })
  assert.equal(military.result.raw.monthly, 6.99)

  const responder = run('subscriptions', {
    discount: 'responder',
    services: JSON.stringify([
      { service: 'peacock', name: '', price: '' },
      { service: 'youtubetv', name: '', price: '' },
      { service: 'spotify', name: '', price: '' },
      { service: 'foxnation', name: '', price: '' },
    ]),
  })
  assert.ok(Math.abs(responder.result.raw.monthly - (7.99 + 67.99 + 13 + 0)) < 0.001)
  assert.equal(responder.result.schedule.rows[2].note.includes('Full price'), true)
  assert.equal(responder.result.schedule.rows[3].note.includes('First year free'), true)
  assert.equal(responder.result.all.rows.find((row) => row.service === 'Video · Peacock').price, '$7.99')

  const annual = run('subscriptions', {
    billing: 'annual',
    services: JSON.stringify([{ service: 'appletv', name: '', price: '' }]),
  })
  assert.ok(Math.abs(annual.result.raw.monthly - 119 / 12) < 0.001)

  const custom = run('subscriptions', {
    services: JSON.stringify([
      { service: 'custom', name: 'Patreon', price: '5' },
      { service: 'custom', name: '', price: '' },
    ]),
  })
  assert.equal(custom.result.raw.monthly, 5)
  assert.equal(custom.result.raw.count, 1)

  setProgramContext(null)
  const untouched = run('dti', { housingSource: 'amount', subscriptionSource: 'auto' })
  assert.equal(untouched.result.raw.subscriptions, 0)

  setProgramContext({
    subscriptions: {
      ...getCalculator('subscriptions').defaults,
      discount: 'military',
      services: JSON.stringify([{ service: 'peacock', name: '', price: '' }]),
    },
  })
  const linked = run('dti', {
    wages: '4000',
    housingSource: 'amount',
    housing: '0',
    auto: '0',
    cards: '0',
    student: '0',
    subscriptionSource: 'auto',
    others: JSON.stringify([{ comment: '', amount: '0' }]),
  })
  assert.equal(linked.result.raw.subscriptionsFrom, 'subscriptions')
  assert.equal(linked.result.raw.subscriptions, 6.99)
  assert.ok(Math.abs(linked.result.raw.debts - 6.99) < 0.001)

  const wage = run('wage', { taxes: 'estimate', taxState: 'TX', filing: 'single' })
  assert.ok(Math.abs(wage.result.raw.afterSubscriptions - (wage.result.raw.takeHome / 12 - 6.99)) < 0.02)

  const saved = run('savings')
  assert.equal(saved.result.stats.some((stat) => stat.label === 'Subscriptions'), true)
  setProgramContext(null)
  assert.equal(run('savings').result.stats.some((stat) => stat.label === 'Subscriptions'), false)
})

test('wage converts hourly and salary into the same gross periods', () => {
  const hourly = run('wage', { mode: 'hourly', rate: '25', hours: '40', weeks: '52' })
  assert.equal(hourly.ok, true)
  assert.equal(hourly.result.raw.annual, 52000)
  assert.equal(hourly.result.raw.weekly, 1000)
  assert.equal(hourly.result.raw.hourly, 25)

  const salary = run('wage', { mode: 'salary', salary: '52000', hours: '40', weeks: '52' })
  assert.equal(salary.ok, true)
  assert.equal(salary.result.raw.hourly, 25)
  assert.equal(salary.result.raw.annual, 52000)
})

test('wage and overtime estimate 2026 taxes and accept filled-in deductions', () => {
  assert.equal(TAX_STATE_CODES.length, 50)
  const noWageTax = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WY']
  for (const code of TAX_STATE_CODES) {
    const tax = figureTaxes({ gross: 80000, filing: 'married', state: code })
    assert.equal(tax.error, undefined, code)
    assert.ok(tax.takeHome > 0 && tax.takeHome < 80000, code)
    assert.ok(tax.stateTax >= 0, code)
    if (noWageTax.includes(code)) assert.equal(tax.stateTax, 0, code)
  }
  const washington = figureTaxes({ gross: 80000, filing: 'single', state: 'WA' })
  assert.equal(washington.stateTax, 0)
  assert.ok(Math.abs(washington.payroll - 80000 * 0.0058) < 0.01)

  const california = run('wage', { mode: 'salary', salary: '52000', hours: '40', weeks: '52', taxes: 'estimate', taxState: 'CA', filing: 'single' })
  assert.equal(california.result.raw.social, 3224)
  assert.equal(california.result.raw.medicare, 754)
  assert.equal(california.result.raw.federal, 4060)
  assert.ok(Math.abs(california.result.raw.stateTax - 1169.49) < 0.01)
  assert.ok(Math.abs(california.result.raw.payroll - 676) < 0.01)
  assert.ok(Math.abs(california.result.raw.takeHome - 42116.51) < 0.01)

  const texas = run('wage', { taxes: 'estimate', taxState: 'TX', filing: 'single', retirement: '0', health: '0' })
  assert.equal(texas.result.raw.stateTax, 0)
  assert.equal(texas.result.raw.takeHome, 43962)
  assert.equal(texas.result.all.rows.length, 50)
  assert.equal(texas.result.all.rows[0].state, 'Texas')
  assert.equal(texas.result.all.rows[0].takeHome, '$43,962.00')

  const deferred = run('wage', { taxes: 'estimate', taxState: 'TX', filing: 'single', retirement: '10', retirementKind: 'traditional' })
  assert.equal(deferred.result.raw.social, 3224)
  assert.equal(deferred.result.raw.federal, 3436)
  assert.equal(deferred.result.raw.takeHome, 39386)

  const roth = run('wage', { taxes: 'estimate', taxState: 'TX', filing: 'single', retirement: '10', retirementKind: 'roth' })
  assert.equal(roth.result.raw.social, 3224)
  assert.equal(roth.result.raw.federal, 4060)
  assert.equal(roth.result.raw.takeHome, 38762)

  const insured = run('wage', { taxes: 'estimate', taxState: 'TX', filing: 'single', health: '100', vision: '0', dental: '0', hsa: '0', other: '0' })
  assert.ok(Math.abs(insured.result.raw.social - 3149.6) < 0.01)
  assert.ok(Math.abs(insured.result.raw.takeHome - 42997.8) < 0.01)

  const filled = run('wage', {
    taxes: 'custom',
    social: '3000',
    medicare: '700',
    federal: '4000',
    stateTax: '1000',
    payroll: '200',
    retirementAmount: '2000',
    healthAmount: '1200',
    visionAmount: '100',
    dentalAmount: '0',
    hsaAmount: '0',
    otherAmount: '0',
  })
  assert.equal(filled.ok, true)
  assert.equal(filled.result.raw.takeHome, 52000 - 12200)
  assert.equal(filled.result.all, null)

  const capped = run('wage', { mode: 'salary', salary: '200000', taxes: 'estimate', taxState: 'TX', retirement: '20' })
  assert.equal(capped.result.headline.warning.includes('24,500'), true)

  const week = run('overtime', { state: 'TX', rate: '25', entry: 'week', hours: '40', taxes: 'estimate', filing: 'single' })
  assert.equal(week.result.raw.total, 1000)
  assert.ok(Math.abs(week.result.raw.takeHome - (43962 / 52)) < 0.02)
})

test('overtime follows each state rule', () => {
  const texas = run('overtime', { state: 'TX', rate: '20', entry: 'week', hours: '45' })
  assert.equal(texas.ok, true)
  assert.equal(texas.result.raw.ot, 5)
  assert.equal(texas.result.raw.total, 950)

  const california = run('overtime', {
    state: 'CA', rate: '20', entry: 'days',
    h1: '10', h2: '10', h3: '10', h4: '10', h5: '10', h6: '0', h7: '0',
  })
  assert.equal(california.result.raw.regular, 40)
  assert.equal(california.result.raw.ot, 10)
  assert.equal(california.result.raw.doubleTime, 0)
  assert.equal(california.result.raw.total, 1100)

  const doubleTime = run('overtime', {
    state: 'CA', rate: '20', entry: 'days',
    h1: '13', h2: '0', h3: '0', h4: '0', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(doubleTime.result.raw.regular, 8)
  assert.equal(doubleTime.result.raw.ot, 4)
  assert.equal(doubleTime.result.raw.doubleTime, 1)

  const seventh = run('overtime', {
    state: 'CA', rate: '20', entry: 'days',
    h1: '8', h2: '8', h3: '8', h4: '8', h5: '8', h6: '8', h7: '8',
  })
  assert.equal(seventh.result.raw.regular, 40)
  assert.equal(seventh.result.raw.ot, 16)
  assert.equal(seventh.result.raw.doubleTime, 0)

  const alaska = run('overtime', {
    state: 'AK', rate: '20', entry: 'days',
    h1: '13', h2: '0', h3: '0', h4: '0', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(alaska.result.raw.ot, 5)
  assert.equal(alaska.result.raw.doubleTime, 0)

  const colorado = run('overtime', {
    state: 'CO', rate: '20', entry: 'days',
    h1: '13', h2: '13', h3: '13', h4: '0', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(colorado.result.raw.ot, 3)

  const kentucky = run('overtime', {
    state: 'KY', rate: '20', entry: 'days',
    h1: '6', h2: '6', h3: '6', h4: '6', h5: '6', h6: '6', h7: '6',
  })
  assert.equal(kentucky.result.raw.ot, 6)

  const nevadaLow = run('overtime', {
    state: 'NV', rate: '15', entry: 'days', nevada: 'standard',
    h1: '10', h2: '10', h3: '10', h4: '10', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(nevadaLow.result.raw.ot, 8)

  const nevadaHigh = run('overtime', {
    state: 'NV', rate: '20', entry: 'days', nevada: 'standard',
    h1: '10', h2: '10', h3: '10', h4: '10', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(nevadaHigh.result.raw.ot, 0)

  const nevadaFour = run('overtime', {
    state: 'NV', rate: '15', entry: 'days', nevada: 'four',
    h1: '10', h2: '10', h3: '10', h4: '10', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(nevadaFour.result.raw.ot, 0)

  const mill = run('overtime', {
    state: 'OR', rate: '20', entry: 'days', oregon: 'manufacturing',
    h1: '11', h2: '11', h3: '11', h4: '0', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(mill.result.raw.ot, 3)

  const oregon = run('overtime', {
    state: 'OR', rate: '20', entry: 'days', oregon: 'general',
    h1: '11', h2: '11', h3: '11', h4: '0', h5: '0', h6: '0', h7: '0',
  })
  assert.equal(oregon.result.raw.ot, 0)

  const weekOnly = run('overtime', { state: 'CA', rate: '20', entry: 'week', hours: '45' })
  assert.equal(weekOnly.result.raw.ot, 5)
  assert.equal(weekOnly.result.raw.doubleTime, 0)

  const listed = run('overtime')
  assert.equal(listed.result.raw.listed, 50)
  assert.equal(listed.result.schedule.rows[0].line, 'Regular')
  assert.equal(listed.result.all.rows.length, 50)
  assert.equal(listed.result.all.rows[0].state, 'California')
})

test('calculator respects precedence and rejects division by zero', () => {
  assert.equal(run('calc', { expression: '2+3*4' }).result.raw.value, 14)
  assert.equal(run('calc', { expression: '(2+3)*4' }).result.raw.value, 20)
  assert.equal(run('calc', { expression: '200*10%' }).result.raw.value, 20)
  assert.equal(run('calc', { expression: '40*25+5*37.5' }).result.raw.value, 1187.5)
  assert.equal(run('calc', { expression: '10/0' }).ok, false)
  assert.equal(run('calc').ok, true)
})

test('scientific calculator handles trig, powers, roots, and factorials', () => {
  const sine = run('scientific', { angle: 'deg', expression: 'sin(30)' })
  assert.equal(sine.ok, true)
  assert.ok(Math.abs(sine.result.raw.value - 0.5) < 1e-10)

  const turn = run('scientific', { angle: 'rad', expression: 'sin(pi/2)' })
  assert.ok(Math.abs(turn.result.raw.value - 1) < 1e-10)

  const power = run('scientific', { expression: '2^10+5!' })
  assert.equal(power.result.raw.value, 1024 + 120)

  const logs = run('scientific', { expression: 'log(1000)*ln(e)' })
  assert.ok(Math.abs(logs.result.raw.value - 3) < 1e-10)

  const root = run('scientific', { expression: 'sqrt(2)^2' })
  assert.ok(Math.abs(root.result.raw.value - 2) < 1e-9)

  const inverse = run('scientific', { angle: 'deg', expression: 'asin(1)' })
  assert.ok(Math.abs(inverse.result.raw.value - 90) < 1e-8)

  assert.equal(run('scientific', { expression: 'log(0)' }).ok, false)
  assert.equal(run('scientific').ok, true)
})

test('default scenarios all calculate', () => {
  setExchangeRates({
    status: 'ready',
    date: '2026-10-18',
    rates: { USD: 1, EUR: 0.9, JPY: 150, GBP: 0.75 },
    currencies: [
      { code: 'EUR', name: 'Euro' },
      { code: 'GBP', name: 'British Pound' },
      { code: 'JPY', name: 'Japanese Yen' },
      { code: 'USD', name: 'US Dollar' },
    ],
    fetchedAt: Date.now(),
  })
  setProgramContext(null)
  for (const id of ['compound', 'return', 'loan', 'carloan', 'carlease', 'mortgage', 'creditcard', 'dti', 'refinance', 'rent', 'salestax', 'subscriptions', 'savings', 'retirement', 'networth', 'exchange', 'wage', 'overtime', 'scientific', 'calc']) {
    const result = run(id)
    assert.equal(result.ok, true, id)
    assert.ok(result.result.headline.value)
    assert.ok(result.result.schedule.rows.length > 0)
  }
})

test('an empty optional number is treated as zero', () => {
  const filled = run('loan', { extra: '0' })
  const blank = run('loan', { extra: '', tax: '' })
  assert.equal(blank.ok, true)
  assert.equal(blank.result.raw.monthlyPayment, filled.result.raw.monthlyPayment)

  const partialTerm = run('loan', { years: '', months: '12', days: '', extra: '' })
  assert.equal(partialTerm.ok, true)
  assert.equal(partialTerm.result.raw.payoffMonths, 12)

  const amount = run('loan', { amount: '' })
  assert.equal(amount.ok, false)
  assert.equal(amount.fieldErrors.amount, 'Enter a number')

  const age = run('retirement', { currentAge: '' })
  assert.equal(age.ok, false)
  assert.equal(age.fieldErrors.currentAge, 'Enter a number')

  setProgramContext(null)
  const named = run('networth', { entries: JSON.stringify([{ kind: 'asset', name: 'Checking', amount: '' }]) })
  assert.equal(named.ok, true)
  assert.equal(named.result.schedule.rows[0].item, 'Nothing counted yet')

  const card = run('creditcard', {
    method: 'avalanche',
    payment: '100',
    cards: JSON.stringify([{ name: 'Card', balance: '1000', apr: '', minimum: '' }]),
  })
  assert.equal(card.ok, true)
  assert.match(card.fieldErrors['cards-0-minimum'], /higher/i)

  const passive = run('dti', {
    passiveMode: 'add',
    passive: JSON.stringify([{ kind: 'rent', amount: '' }]),
  })
  assert.equal(passive.ok, true)
  assert.equal(passive.result.raw.passive, 0)
})

test('loans and debts show an empirical suggested payment', () => {
  const loan = run('loan', { amount: '12000', annualRate: '0', years: '5', months: '0', days: '0', extra: '0' })
  assert.equal(loan.ok, true)
  assert.ok(Math.abs(loan.result.raw.suggestedPayment - 12000 / 36) < 0.001)
  assert.match(loan.result.formula.join('\n'), /3 years/)

  const minimum = run('loan', { amount: '12000', annualRate: '0', mode: 'minimum', minimum: '200' })
  assert.equal(minimum.ok, true)
  assert.ok(Math.abs(minimum.result.raw.suggestedPayment - 12000 / 36) < 0.001)

  const car = run('carloan', {
    price: '30000', down: '0', trade: '0', tradeOwed: '0', tax: '0', fees: '0', annualRate: '0', years: '6', months: '0', days: '0', extra: '0',
  })
  assert.equal(car.ok, true)
  assert.ok(Math.abs(car.result.raw.suggestedPayment - 500) < 0.001)
  assert.match(car.result.formula.join('\n'), /20\/4\/10/)

  const lease = run('carlease')
  assert.ok(Math.abs(lease.result.raw.suggestedPayment - 400) < 0.001)

  const mortgage = run('mortgage', {
    price: '320000', down: '64000', annualRate: '0', years: '15', months: '0', days: '0', tax: '0', insurance: '0', hoa: '0', extra: '0',
  })
  const principal = 256000 / 180
  assert.ok(Math.abs(mortgage.result.raw.suggestedPayment - principal * 13 / 12) < 0.01)

  const longer = run('mortgage')
  assert.ok(longer.result.raw.suggestedPayment > longer.result.raw.monthlyHousing)

  const refinance = run('refinance', {
    balance: '18000', currentRate: '0', remaining: '5', remainingMonths: '0', remainingDays: '0',
    newRate: '0', newYears: '30', newMonths: '0', newDays: '0', costs: '0',
  })
  assert.ok(Math.abs(refinance.result.raw.suggestedPayment - 18000 / 180) < 0.001)

  const dti = run('dti')
  assert.ok(Math.abs(dti.result.raw.suggestedDebt - 6500 * 0.36) < 0.001)
  assert.ok(Math.abs(dti.result.raw.suggestedHousing - 6500 * 0.28) < 0.001)
})
