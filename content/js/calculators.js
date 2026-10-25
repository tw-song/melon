import {
  addMonths,
  formatAge,
  formatDuration,
  formatMonthYear,
  formatYears,
  money,
  parseLooseNumber,
  percentNumber,
  plain,
  sig,
} from './format.js'
import { amortize, monthsToGoal, paymentForTarget, payOffCard, payOffCards, projectCompound, projectMonthly } from './simulate.js'
import { quoteSubscription, subscriptionById, subscriptionCatalog } from './subscriptions.js'
import { RETIREMENT_LIMIT, TAX_STATE_CODES, figureTaxes, stateTaxDetail } from './taxes.js'

const amountMax = { max: 1e12, maxMessage: 'Enter a smaller amount' }
const TERM_HINT = 'Years, months, and days are added together. 30 days count as one month.'

function termField(key, label, keys, extra = {}) {
  const [years, months, days] = keys
  return {
    key,
    label,
    kind: 'span',
    required: true,
    hint: TERM_HINT,
    parts: [
      { key: years, label: 'Years', max: 100 },
      { key: months, label: 'Months', max: 1200 },
      { key: days, label: 'Days', max: 36600 },
    ],
    ...extra,
  }
}

// Statewide rates as of January 1, 2026. California, Utah, and Virginia include
// the local add-on that is charged everywhere in the state.
const stateSalesTax = [
  ['AL', 'Alabama', 4],
  ['AK', 'Alaska', 0],
  ['AZ', 'Arizona', 5.6],
  ['AR', 'Arkansas', 6.5],
  ['CA', 'California', 7.25],
  ['CO', 'Colorado', 2.9],
  ['CT', 'Connecticut', 6.35],
  ['DE', 'Delaware', 0],
  ['FL', 'Florida', 6],
  ['GA', 'Georgia', 4],
  ['HI', 'Hawaii', 4],
  ['ID', 'Idaho', 6],
  ['IL', 'Illinois', 6.25],
  ['IN', 'Indiana', 7],
  ['IA', 'Iowa', 6],
  ['KS', 'Kansas', 6.5],
  ['KY', 'Kentucky', 6],
  ['LA', 'Louisiana', 5],
  ['ME', 'Maine', 5.5],
  ['MD', 'Maryland', 6],
  ['MA', 'Massachusetts', 6.25],
  ['MI', 'Michigan', 6],
  ['MN', 'Minnesota', 6.875],
  ['MS', 'Mississippi', 7],
  ['MO', 'Missouri', 4.225],
  ['MT', 'Montana', 0],
  ['NE', 'Nebraska', 5.5],
  ['NV', 'Nevada', 6.85],
  ['NH', 'New Hampshire', 0],
  ['NJ', 'New Jersey', 6.625],
  ['NM', 'New Mexico', 4.875],
  ['NY', 'New York', 4],
  ['NC', 'North Carolina', 4.75],
  ['ND', 'North Dakota', 5],
  ['OH', 'Ohio', 5.75],
  ['OK', 'Oklahoma', 4.5],
  ['OR', 'Oregon', 0],
  ['PA', 'Pennsylvania', 6],
  ['RI', 'Rhode Island', 7],
  ['SC', 'South Carolina', 6],
  ['SD', 'South Dakota', 4.2],
  ['TN', 'Tennessee', 7],
  ['TX', 'Texas', 6.25],
  ['UT', 'Utah', 6.1],
  ['VT', 'Vermont', 6],
  ['VA', 'Virginia', 5.3],
  ['WA', 'Washington', 6.5],
  ['WV', 'West Virginia', 6],
  ['WI', 'Wisconsin', 5],
  ['WY', 'Wyoming', 4],
].map(([code, name, rate]) => ({ code, name, rate }))

const stateOptions = stateSalesTax.map((state) => ({
  value: state.code,
  label: `${state.name} · ${formatRate(state.rate)}`,
}))

function formatRate(percent) {
  return `${Math.round(percent * 1000) / 1000}%`
}

export const MAX_SALE_ITEMS = 12

const defaultSaleItem = { comment: '', price: '49.99', quantity: '1' }

export function parseSaleItems(raw) {
  let parsed = null
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  const source = Array.isArray(parsed) && parsed.length ? parsed : [defaultSaleItem]
  return source.slice(0, MAX_SALE_ITEMS).map((item) => ({
    comment: typeof item?.comment === 'string' ? item.comment : '',
    price: typeof item?.price === 'string' ? item.price : item?.price == null ? '' : String(item.price),
    quantity: typeof item?.quantity === 'string' ? item.quantity : item?.quantity == null ? '1' : String(item.quantity),
  }))
}

export function parseLines(raw, fallback) {
  const blank = fallback || { amount: '' }
  let parsed = null
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  const source = Array.isArray(parsed) && parsed.length ? parsed : [{ ...blank }]
  return source.slice(0, 12).map((item) => {
    const next = {}
    for (const key of Object.keys(blank)) {
      const value = item?.[key]
      next[key] = typeof value === 'string' ? value : value == null ? String(blank[key] ?? '') : String(value)
    }
    return next
  })
}

const passiveKinds = [
  { value: 'rent', label: 'Rental income' },
  { value: 'dividends', label: 'Dividends' },
  { value: 'interest', label: 'Interest' },
  { value: 'royalties', label: 'Royalties' },
  { value: 'pension', label: 'Pension' },
  { value: 'other', label: 'Other' },
]

const passiveBlank = { kind: 'rent', amount: '800' }

const otherBlank = { comment: '', amount: '' }

const worthBlank = { kind: 'asset', name: '', amount: '' }

const defaultOthers = [{ comment: '', amount: '0' }]

const cardBlank = { name: '', balance: '', apr: '', minimum: '' }

let programInputs = null
let programEditedAt = {}

export function setProgramContext(inputs, editedAt = {}) {
  programInputs = inputs
  programEditedAt = editedAt || {}
}

function spanLength(source, defaults, parts) {
  const read = (key) => {
    const raw = source?.[key]
    const n = parseLooseNumber(raw === undefined || raw === '' ? defaults[key] : raw)
    return n === null ? 0 : n
  }
  return read(parts[0]) * 12 + read(parts[1]) + read(parts[2]) / 30
}

function inputsDiffer(id) {
  const saved = programInputs?.[id]
  if (!saved) return false
  const calc = getCalculator(id)
  return calc.fields.some((field) => {
    if (field.kind === 'span') {
      const parts = field.parts.map((part) => part.key)
      const changed = parts.some((key) => typeof saved[key] === 'string' && saved[key] !== calc.defaults[key])
      if (!changed) return false
      return Math.abs(spanLength(saved, calc.defaults, parts) - spanLength(calc.defaults, calc.defaults, parts)) > 1e-6
    }
    return typeof saved[field.key] === 'string' && saved[field.key] !== calc.defaults[field.key]
  })
}

function housingAmount(id) {
  const saved = programInputs?.[id]
  if (!saved) return null
  const outcome = id === 'rent' ? computeRent(saved) : computeMortgage(saved)
  if (!outcome.ok) return null
  return outcome.result.raw.monthlyHousing
}

export function subscriptionLink() {
  if (!inputsDiffer('subscriptions')) return null
  const saved = programInputs?.subscriptions
  if (!saved) return null
  const outcome = computeSubscriptions(saved)
  if (!outcome.ok) return null
  return { monthly: outcome.result.raw.monthly }
}

function subscriptionStat() {
  const link = subscriptionLink()
  if (!link) return []
  return [{ label: 'Subscriptions', value: money(link.monthly), tone: 'negative' }]
}

function subscriptionFormula() {
  const link = subscriptionLink()
  if (!link) return []
  return [`Subscriptions = ${money(link.monthly)} a month, copied from Subscriptions.`]
}

function wageSubscriptionStats(annualTakeHome) {
  const link = subscriptionLink()
  if (!link) return []
  const left = annualTakeHome / 12 - link.monthly
  return [{
    label: 'Left after subscriptions',
    value: money(left),
    tone: left >= 0 ? 'positive' : 'negative',
  }]
}

export function housingLink(source) {
  const mortgageOn = inputsDiffer('mortgage')
  const rentOn = inputsDiffer('rent')
  let from = null
  if (source === 'mortgage') from = 'mortgage'
  else if (source === 'rent') from = 'rent'
  else if (mortgageOn && rentOn) from = (programEditedAt.rent || 0) > (programEditedAt.mortgage || 0) ? 'rent' : 'mortgage'
  else if (mortgageOn) from = 'mortgage'
  else if (rentOn) from = 'rent'
  if (!from) return null
  const amount = housingAmount(from)
  if (amount == null) return null
  return { from, amount }
}

const sampleCards = [
  { name: 'Visa', balance: '5000', apr: '27', minimum: '150' },
  { name: 'Store', balance: '2000', apr: '19.9', minimum: '50' },
]

const exchangeState = {
  status: 'loading',
  date: '',
  rates: {},
  currencies: [],
  error: '',
  fetchedAt: 0,
}

export function exchangeOptions() {
  if (!exchangeState.currencies.length) {
    return [
      { value: 'USD', label: 'US Dollar · USD' },
      { value: 'EUR', label: 'Euro · EUR' },
    ]
  }
  return exchangeState.currencies.map((currency) => ({
    value: currency.code,
    label: `${currency.name} · ${currency.code}`,
  }))
}

export function setExchangeRates(snapshot) {
  exchangeState.status = snapshot.status
  exchangeState.date = snapshot.date || ''
  exchangeState.rates = snapshot.rates || {}
  exchangeState.currencies = snapshot.currencies || []
  exchangeState.error = snapshot.error || ''
  exchangeState.fetchedAt = snapshot.fetchedAt || Date.now()
}

export function getExchangeState() {
  return exchangeState
}

const federalOvertime = '1.5× after 40 hours in a workweek. No daily overtime.'

const overtimeNotes = {
  AK: {
    kind: 'daily8',
    summary: '1.5× after 8 hours in a day and after 40 in a week',
    detail: 'Alaska counts daily and weekly overtime together. Hours already paid as daily overtime are not counted again toward the 40-hour week.',
  },
  CA: {
    kind: 'california',
    summary: '1.5× after 8 hours in a day, 2× after 12, plus the 7th day',
    detail: 'California pays 1.5× from 8 to 12 hours in a day and 2× after 12. The first 8 hours on the 7th consecutive day are 1.5×, and hours after that are 2×. Weekly overtime still applies to straight-time hours over 40.',
  },
  CO: {
    kind: 'colorado',
    summary: '1.5× after 12 hours in a day or 40 in a week, whichever is greater',
    detail: 'Colorado uses the greater of daily overtime after 12 hours and weekly overtime after 40. Twelve consecutive hours can also require overtime even when a calendar day stays under 12.',
  },
  HI: {
    kind: 'weekly',
    summary: federalOvertime,
    detail: 'Hawaii follows the federal 40-hour week for most jobs. Public-works jobs can require 1.5× after 8 hours in a day and for Saturdays, Sundays, and state holidays.',
  },
  KS: {
    kind: 'weekly',
    summary: '1.5× after 40 hours for covered workers',
    detail: 'Workers covered by federal law earn 1.5× after 40 hours. Kansas’s own 46-hour threshold applies only when federal overtime law does not cover the worker.',
  },
  KY: {
    kind: 'kentucky',
    summary: '1.5× after 40 hours, and 1.5× for a 7th consecutive day',
    detail: 'Kentucky pays 1.5× after 40 hours. When someone works all seven days and the week is over 40 hours, every hour on the seventh day is 1.5×.',
  },
  MD: {
    kind: 'weekly',
    summary: federalOvertime,
    detail: 'Maryland follows the federal 40-hour week. Agricultural workers earn 1.5× after 60 hours instead.',
  },
  MN: {
    kind: 'weekly',
    summary: '1.5× after 40 hours for covered workers',
    detail: 'Workers covered by federal law earn 1.5× after 40 hours. Minnesota’s own 48-hour threshold applies only when federal overtime law does not cover the worker.',
  },
  NV: {
    kind: 'nevada',
    summary: '1.5× after 8 hours in a day when pay is under $18, otherwise after 40 in a week',
    detail: 'From July 1, 2026, Nevada daily overtime applies when the regular rate is under $18 an hour, which is 1.5× the $12 minimum wage. At $18 or more, overtime starts after 40 hours in the week. An agreed 4-day, 10-hour schedule waives the 8-hour day.',
  },
  NY: {
    kind: 'weekly',
    summary: federalOvertime,
    detail: 'New York follows the federal 40-hour week. Residential employees earn 1.5× after 44 hours.',
  },
  OR: {
    kind: 'oregon',
    summary: '1.5× after 40 hours; manufacturing also pays 1.5× after 10 hours in a day',
    detail: 'Most Oregon jobs use the federal 40-hour week. Mills, factories, manufacturing, and canneries also pay 1.5× after 10 hours in a day.',
  },
}

const stateNames = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]

const overtimeStates = stateNames.map(([code, name]) => {
  const note = overtimeNotes[code] || {
    kind: 'weekly',
    summary: federalOvertime,
    detail: `${name} follows the federal Fair Labor Standards Act. ${federalOvertime}`,
  }
  return { code, name, ...note }
})

const overtimeOptions = overtimeStates.map((state) => ({
  value: state.code,
  label: state.name,
}))

const NEVADA_DAILY_RATE = 18

const taxDefaults = {
  taxes: 'estimate',
  taxState: 'CA',
  filing: 'single',
  retirement: '0',
  retirementKind: 'traditional',
  health: '0',
  vision: '0',
  dental: '0',
  hsa: '0',
  other: '0',
  stubEntry: 'amount',
  stubPeriod: 'annual',
  stubGross: '0',
  social: '0',
  medicare: '0',
  federal: '0',
  stateTax: '0',
  payroll: '0',
  retirementAmount: '0',
  healthAmount: '0',
  visionAmount: '0',
  dentalAmount: '0',
  hsaAmount: '0',
  otherAmount: '0',
  socialRate: '0',
  medicareRate: '0',
  federalRate: '0',
  stateRate: '0',
  payrollRate: '0',
  retirementRate: '0',
  healthRate: '0',
  visionRate: '0',
  dentalRate: '0',
  hsaRate: '0',
  otherRate: '0',
}

const STUB_PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 }

function taxFields({ includeState }) {
  const estimate = (values) => values.taxes !== 'custom'
  const amountMode = (values) => values.taxes === 'custom' && values.stubEntry !== 'percent'
  const percentMode = (values) => values.taxes === 'custom' && values.stubEntry === 'percent'
  const moneyItem = (key, label) => ({
    key,
    label,
    kind: 'number',
    prefix: '$',
    min: 0,
    ...amountMax,
    showIf: amountMode,
    hint: 'Dollar line from the paystub. It is turned into a percent of gross.',
  })
  const rateItem = (key, label) => ({
    key,
    label,
    kind: 'number',
    suffix: '%',
    min: 0,
    max: 100,
    showIf: percentMode,
    hint: 'Percent of gross. It is turned into a dollar amount of this pay.',
  })
  return [
    {
      key: 'taxes',
      label: 'Taxes and deductions',
      kind: 'segment',
      options: [
        { value: 'estimate', label: 'State default' },
        { value: 'custom', label: 'Fill in' },
      ],
      hint: 'State default uses 2026 Social Security, Medicare, federal income tax, and that state’s income tax. Fill in uses a paystub, in dollars or percents.',
    },
    {
      key: 'stubEntry',
      label: 'Enter as',
      kind: 'segment',
      showIf: (values) => values.taxes === 'custom',
      options: [
        { value: 'amount', label: 'Dollars' },
        { value: 'percent', label: 'Percent' },
      ],
      hint: 'Dollars from the paystub become a percent of gross. A percent becomes the dollar amount of this pay.',
    },
    {
      key: 'stubPeriod',
      label: 'Paystub period',
      kind: 'segment',
      showIf: amountMode,
      options: [
        { value: 'weekly', label: 'Weekly' },
        { value: 'biweekly', label: 'Biweekly' },
        { value: 'semimonthly', label: 'Semimonthly' },
        { value: 'monthly', label: 'Monthly' },
        { value: 'annual', label: 'Annual' },
      ],
      hint: 'How often the paystub is paid. Used when paystub gross is 0. Wage scales the dollars to a year. Overtime scales them to this week.',
    },
    {
      key: 'stubGross',
      label: 'Paystub gross',
      kind: 'number',
      prefix: '$',
      min: 0,
      ...amountMax,
      showIf: amountMode,
      hint: 'Gross printed on that paystub. Each line is divided by this, then that percent is applied to the pay above. Leave 0 to scale the dollars by the pay period instead.',
    },
    ...(includeState
      ? [{
          key: 'taxState',
          label: 'Tax state',
          kind: 'select',
          options: overtimeOptions,
          showIf: estimate,
          hint: 'State income tax default for all 50 states.',
        }]
      : []),
    {
      key: 'filing',
      label: 'Filing status',
      kind: 'segment',
      showIf: estimate,
      options: [
        { value: 'single', label: 'Single' },
        { value: 'married', label: 'Married' },
        { value: 'head', label: 'Head of household' },
      ],
      hint: 'Head of household uses the federal head-of-household brackets and the state’s single brackets.',
    },
    {
      key: 'retirement',
      label: '401(k)',
      kind: 'number',
      suffix: '%',
      min: 0,
      max: 100,
      showIf: estimate,
      hint: `Percent of gross. The 2026 employee deferral limit is $${RETIREMENT_LIMIT.toLocaleString('en-US')}.`,
    },
    {
      key: 'retirementKind',
      label: '401(k) type',
      kind: 'segment',
      showIf: estimate,
      options: [
        { value: 'traditional', label: 'Traditional' },
        { value: 'roth', label: 'Roth' },
      ],
      hint: 'Traditional lowers income tax. Roth does not. Neither lowers Social Security or Medicare.',
    },
    { key: 'health', label: 'Health insurance', kind: 'number', prefix: '$', min: 0, ...amountMax, showIf: estimate, hint: 'Pre-tax amount per month.' },
    { key: 'vision', label: 'Vision', kind: 'number', prefix: '$', min: 0, ...amountMax, showIf: estimate, hint: 'Pre-tax amount per month.' },
    { key: 'dental', label: 'Dental', kind: 'number', prefix: '$', min: 0, ...amountMax, showIf: estimate, hint: 'Pre-tax amount per month.' },
    { key: 'hsa', label: 'HSA', kind: 'number', prefix: '$', min: 0, ...amountMax, showIf: estimate, hint: 'Pre-tax amount per month.' },
    { key: 'other', label: 'Other pre-tax', kind: 'number', prefix: '$', min: 0, ...amountMax, showIf: estimate, hint: 'Pre-tax amount per month, such as a flexible spending account or parking.' },
    moneyItem('social', 'Social Security'),
    moneyItem('medicare', 'Medicare'),
    moneyItem('federal', 'Federal income tax'),
    moneyItem('stateTax', 'State income tax'),
    moneyItem('payroll', 'State payroll tax'),
    moneyItem('retirementAmount', '401(k)'),
    moneyItem('healthAmount', 'Health insurance'),
    moneyItem('visionAmount', 'Vision'),
    moneyItem('dentalAmount', 'Dental'),
    moneyItem('hsaAmount', 'HSA'),
    moneyItem('otherAmount', 'Other'),
    rateItem('socialRate', 'Social Security'),
    rateItem('medicareRate', 'Medicare'),
    rateItem('federalRate', 'Federal income tax'),
    rateItem('stateRate', 'State income tax'),
    rateItem('payrollRate', 'State payroll tax'),
    rateItem('retirementRate', '401(k)'),
    rateItem('healthRate', 'Health insurance'),
    rateItem('visionRate', 'Vision'),
    rateItem('dentalRate', 'Dental'),
    rateItem('hsaRate', 'HSA'),
    rateItem('otherRate', 'Other'),
  ]
}

export const calculators = [
  {
    id: 'compound',
    name: 'Compound interest',
    group: 'Growth',
    icon: 'trend',
    description: 'Future value of a starting balance plus recurring deposits.',
    defaults: {
      principal: '10000',
      annualRate: '7',
      years: '20',
      months: '0',
      days: '0',
      compounds: '12',
      contributionFrequency: 'monthly',
      contribution: '500',
    },
    examples: [
      {
        name: 'Index fund',
        values: {
          principal: '10000',
          annualRate: '7',
          years: '20',
          compounds: '12',
          contributionFrequency: 'monthly',
          contribution: '500',
        },
      },
      {
        name: 'High-yield savings',
        values: {
          principal: '5000',
          annualRate: '4',
          years: '5',
          compounds: '12',
          contributionFrequency: 'monthly',
          contribution: '200',
        },
      },
    ],
    fields: [
      { key: 'principal', label: 'Starting amount', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'annualRate', label: 'Annual rate', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'Nominal annual rate.' },
      termField('time', 'Time', ['years', 'months', 'days']),
      {
        key: 'compounds',
        label: 'Compounding',
        kind: 'select',
        options: [
          { value: '1', label: 'Annually' },
          { value: '2', label: 'Semiannually' },
          { value: '4', label: 'Quarterly' },
          { value: '12', label: 'Monthly' },
          { value: '365', label: 'Daily' },
        ],
      },
      {
        key: 'contributionFrequency',
        label: 'Deposits',
        kind: 'segment',
        hint: 'Added at the end of each month or year.',
        options: [
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly' },
          { value: 'none', label: 'None' },
        ],
      },
      {
        key: 'contribution',
        label: 'Deposit amount',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        showIf: (values) => values.contributionFrequency !== 'none',
      },
    ],
    compute: computeCompound,
  },
  {
    id: 'return',
    name: 'Return',
    group: 'Growth',
    icon: 'percent',
    description: 'Simple and annualized return between two values.',
    defaults: {
      initial: '8000',
      final: '12500',
      years: '5',
      months: '0',
      days: '0',
    },
    examples: [
      { name: 'Five-year gain', values: { initial: '8000', final: '12500', years: '5' } },
      { name: 'Two-year loss', values: { initial: '10000', final: '7600', years: '2' } },
    ],
    fields: [
      { key: 'initial', label: 'Starting value', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true },
      { key: 'final', label: 'Ending value', kind: 'number', prefix: '$', min: 0, ...amountMax },
      termField('time', 'Time', ['years', 'months', 'days'], { hint: `Time between the two values. ${TERM_HINT}` }),
    ],
    compute: computeReturn,
  },
  {
    id: 'loan',
    name: 'Loan',
    group: 'Borrowing',
    icon: 'card',
    description: 'Monthly payment for a chosen term, or how long a minimum payment takes to clear the loan.',
    defaults: {
      amount: '28000',
      annualRate: '6.5',
      mode: 'term',
      years: '5',
      months: '0',
      days: '0',
      extra: '0',
      minimum: '500',
    },
    examples: [
      { name: 'Car loan', values: { amount: '28000', annualRate: '6.5', mode: 'term', years: '5', extra: '0' } },
      { name: 'With extra payments', values: { amount: '28000', annualRate: '6.5', mode: 'term', years: '5', extra: '150' } },
      { name: 'Minimum payment', values: { amount: '28000', annualRate: '6.5', mode: 'minimum', minimum: '500' } },
    ],
    fields: [
      { key: 'amount', label: 'Loan amount', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true },
      { key: 'annualRate', label: 'Annual rate', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'APR, compounded monthly.' },
      {
        key: 'mode',
        label: 'Solve for',
        kind: 'segment',
        options: [
          { value: 'term', label: 'Term' },
          { value: 'minimum', label: 'Minimum payment' },
        ],
      },
      termField('term', 'Term', ['years', 'months', 'days'], { showIf: (values) => values.mode !== 'minimum' }),
      {
        key: 'extra',
        label: 'Extra monthly payment',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        showIf: (values) => values.mode !== 'minimum',
      },
      {
        key: 'minimum',
        label: 'Minimum payment',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        showIf: (values) => values.mode === 'minimum',
        required: true,
        hint: 'The amount you pay each month. The result is how long the loan takes.',
      },
    ],
    compute: computeLoan,
  },
  {
    id: 'carloan',
    name: 'Car loan',
    group: 'Borrowing',
    icon: 'car',
    description: 'Monthly payment for a car, with sales tax, fees, a down payment, and a trade-in.',
    defaults: {
      price: '35000',
      down: '3500',
      trade: '0',
      tradeOwed: '0',
      tax: '7',
      fees: '500',
      annualRate: '6.5',
      years: '5',
      months: '0',
      days: '0',
      extra: '0',
    },
    examples: [
      {
        name: 'Five-year car',
        values: { price: '35000', down: '3500', trade: '0', tradeOwed: '0', tax: '7', fees: '500', annualRate: '6.5', years: '5', months: '0', days: '0', extra: '0' },
      },
      {
        name: 'With a trade-in',
        values: { price: '32000', down: '2000', trade: '8000', tradeOwed: '2500', tax: '6', fees: '400', annualRate: '5.9', years: '0', months: '60', days: '0', extra: '0' },
      },
    ],
    fields: [
      { key: 'price', label: 'Vehicle price', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true },
      { key: 'down', label: 'Down payment', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Paid up front. It is not part of the monthly payment.' },
      { key: 'trade', label: 'Trade-in value', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Allowance for the car you trade. Sales tax is charged on the price minus this allowance.' },
      { key: 'tradeOwed', label: 'Owed on trade-in', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Added to the loan. It does not lower the sales tax.' },
      { key: 'tax', label: 'Sales tax', kind: 'number', suffix: '%', min: 0, max: 20 },
      { key: 'fees', label: 'Fees', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Title, registration, and dealer fees added to the amount financed.' },
      { key: 'annualRate', label: 'Annual rate', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'APR, compounded monthly.' },
      termField('term', 'Term', ['years', 'months', 'days']),
      { key: 'extra', label: 'Extra monthly payment', kind: 'number', prefix: '$', min: 0, ...amountMax },
    ],
    compute: computeCarLoan,
  },
  {
    id: 'carlease',
    name: 'Car lease',
    group: 'Borrowing',
    icon: 'lease',
    description: 'Monthly lease payment from the negotiated price, residual value, and money factor.',
    defaults: {
      msrp: '40000',
      price: '38000',
      down: '2000',
      trade: '0',
      tradeOwed: '0',
      residual: '55',
      rateKind: 'apr',
      annualRate: '6',
      factor: '0.0025',
      tax: '0',
      acquisition: '695',
      disposition: '395',
      years: '3',
      months: '0',
      days: '0',
    },
    examples: [
      {
        name: '36-month lease',
        values: {
          msrp: '40000', price: '38000', down: '2000', trade: '0', tradeOwed: '0', residual: '55',
          rateKind: 'apr', annualRate: '6', tax: '0', acquisition: '695', disposition: '395', years: '0', months: '36', days: '0',
        },
      },
      {
        name: 'Money factor',
        values: {
          msrp: '40000', price: '36000', down: '0', trade: '0', tradeOwed: '0', residual: '50',
          rateKind: 'factor', factor: '0.0025', tax: '8', acquisition: '0', disposition: '0', years: '0', months: '36', days: '0',
        },
      },
    ],
    fields: [
      { key: 'msrp', label: 'MSRP', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true, hint: 'Sticker price. The residual is a percent of this, not of the negotiated price.' },
      { key: 'price', label: 'Negotiated price', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true, hint: 'Price before the down payment, trade-in, and acquisition fee.' },
      { key: 'down', label: 'Down payment', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Cap cost reduction, paid up front.' },
      { key: 'trade', label: 'Trade-in value', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'tradeOwed', label: 'Owed on trade-in', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Added to the capitalized cost.' },
      { key: 'residual', label: 'Residual', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'Percent of MSRP the car is expected to be worth at the end.' },
      {
        key: 'rateKind',
        label: 'Rate',
        kind: 'segment',
        options: [
          { value: 'apr', label: 'APR' },
          { value: 'factor', label: 'Money factor' },
        ],
      },
      {
        key: 'annualRate',
        label: 'APR',
        kind: 'number',
        suffix: '%',
        min: 0,
        max: 100,
        showIf: (values) => values.rateKind !== 'factor',
        hint: 'Converted to a money factor by dividing by 2,400.',
      },
      {
        key: 'factor',
        label: 'Money factor',
        kind: 'number',
        min: 0,
        max: 1,
        showIf: (values) => values.rateKind === 'factor',
        hint: 'A 0.0025 money factor is a 6% APR.',
      },
      { key: 'tax', label: 'Sales tax', kind: 'number', suffix: '%', min: 0, max: 20, hint: 'Added to the monthly payment.' },
      { key: 'acquisition', label: 'Acquisition fee', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Added to the capitalized cost.' },
      { key: 'disposition', label: 'Disposition fee', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Due when the car is returned. It is not part of the monthly payment.' },
      termField('term', 'Term', ['years', 'months', 'days']),
    ],
    compute: computeCarLease,
  },
  {
    id: 'creditcard',
    name: 'Credit card',
    group: 'Borrowing',
    icon: 'credit',
    description: 'Pay off one or more cards with avalanche, snowball, or minimums, plus a payment and income that can handle the debt.',
    defaults: {
      method: 'avalanche',
      payment: '350',
      cards: JSON.stringify(sampleCards),
    },
    examples: [
      {
        name: 'Avalanche',
        values: { method: 'avalanche', payment: '350', cards: JSON.stringify(sampleCards) },
      },
      {
        name: 'Snowball',
        values: { method: 'snowball', payment: '350', cards: JSON.stringify(sampleCards) },
      },
    ],
    fields: [
      {
        key: 'method',
        label: 'Method',
        kind: 'segment',
        options: [
          { value: 'avalanche', label: 'Avalanche' },
          { value: 'snowball', label: 'Snowball' },
          { value: 'minimums', label: 'Minimums' },
        ],
        hint: 'Avalanche sends extra money to the highest APR. Snowball sends it to the smallest balance. Minimums pay each card’s minimum and do not roll a finished card’s payment forward.',
      },
      {
        key: 'cards',
        label: 'Cards',
        kind: 'lines',
        max: 8,
        addLabel: 'Add card',
        itemNoun: 'card',
        blank: cardBlank,
        hint: 'Minimum is the amount due on that card. Extra money follows the method you picked.',
        columns: [
          { key: 'name', label: 'Name', type: 'text', wide: true, placeholder: 'Optional' },
          { key: 'balance', label: 'Balance', type: 'number', prefix: '$', required: true },
          { key: 'apr', label: 'APR', type: 'number', suffix: '%' },
          { key: 'minimum', label: 'Minimum', type: 'number', prefix: '$' },
        ],
      },
      {
        key: 'payment',
        label: 'Monthly payment',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        showIf: (values) => values.method !== 'minimums',
        required: true,
        hint: 'Total you send every month. Each minimum is paid first.',
      },
    ],
    compute: computeCreditCard,
  },
  {
    id: 'dti',
    name: 'Debt to income',
    group: 'Borrowing',
    icon: 'scale',
    description: 'Monthly debt payments compared with wages and any passive income.',
    defaults: {
      wages: '6500',
      passiveMode: 'none',
      passive: JSON.stringify([passiveBlank]),
      housingSource: 'auto',
      housing: '1800',
      auto: '350',
      cards: '120',
      student: '200',
      subscriptionSource: 'auto',
      subscriptions: '0',
      others: JSON.stringify(defaultOthers),
    },
    examples: [
      {
        name: 'Wages only',
        values: {
          wages: '6500',
          passiveMode: 'none',
          housingSource: 'amount',
          housing: '1800',
          auto: '350',
          cards: '120',
          student: '200',
          others: JSON.stringify(defaultOthers),
        },
      },
      {
        name: 'With rental income',
        values: {
          wages: '6500',
          passiveMode: 'add',
          passive: JSON.stringify([{ kind: 'rent', amount: '1200' }]),
          housingSource: 'amount',
          housing: '1800',
          auto: '350',
          cards: '120',
          student: '200',
          others: JSON.stringify([{ comment: 'Medical', amount: '80' }]),
        },
      },
    ],
    fields: [
      { key: 'wages', label: 'Wages / month', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Gross pay before tax.' },
      {
        key: 'passiveMode',
        label: 'Passive income',
        kind: 'segment',
        options: [
          { value: 'none', label: 'None' },
          { value: 'add', label: 'Add sources' },
        ],
      },
      {
        key: 'passive',
        label: 'Sources',
        kind: 'lines',
        max: 8,
        addLabel: 'Add source',
        blank: { kind: 'rent', amount: '' },
        showIf: (values) => values.passiveMode === 'add',
        itemNoun: 'source',
        hint: 'Monthly amounts. They are added to wages.',
        columns: [
          { key: 'kind', label: 'Source', type: 'select', options: passiveKinds },
          { key: 'amount', label: 'Monthly', type: 'number', prefix: '$' },
        ],
      },
      {
        key: 'housingSource',
        label: 'Housing',
        kind: 'segment',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'mortgage', label: 'Mortgage' },
          { value: 'rent', label: 'Rent' },
          { value: 'amount', label: 'Amount' },
        ],
        hint: 'Auto copies the monthly payment from Mortgage or Rent after you change that calculator.',
      },
      {
        key: 'housing',
        label: 'Housing / month',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        readOnly: (values) => (values.housingSource || 'auto') !== 'amount' && Boolean(housingLink(values.housingSource || 'auto')),
        displayValue: (values) => {
          if ((values.housingSource || 'auto') === 'amount') return null
          const link = housingLink(values.housingSource || 'auto')
          return link ? String(Math.round(link.amount * 100) / 100) : null
        },
        hint: (values) => {
          const source = values.housingSource || 'auto'
          const link = source === 'amount' ? null : housingLink(source)
          if (link?.from === 'mortgage') return 'Copied from your mortgage payment.'
          if (link?.from === 'rent') return 'Copied from your rent payment.'
          if (source === 'mortgage') return 'The mortgage calculator needs a valid loan before this can copy it.'
          if (source === 'rent') return 'The rent calculator needs a valid lease before this can copy it.'
          return 'Rent or mortgage, including taxes and insurance if you pay them.'
        },
      },
      { key: 'auto', label: 'Auto / month', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'cards', label: 'Credit cards / month', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Minimum payments, not the full balance.' },
      { key: 'student', label: 'Student loans / month', kind: 'number', prefix: '$', min: 0, ...amountMax },
      {
        key: 'subscriptionSource',
        label: 'Subscriptions',
        kind: 'segment',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'amount', label: 'Amount' },
        ],
        hint: 'Auto copies the monthly total after you change Subscriptions.',
      },
      {
        key: 'subscriptions',
        label: 'Subscriptions / month',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        readOnly: (values) => (values.subscriptionSource || 'auto') !== 'amount',
        displayValue: (values) => {
          if ((values.subscriptionSource || 'auto') === 'amount') return null
          const link = subscriptionLink()
          return link ? String(Math.round(link.monthly * 100) / 100) : '0'
        },
        hint: (values) => {
          if ((values.subscriptionSource || 'auto') === 'amount') return 'Type a monthly total.'
          return subscriptionLink() ? 'Copied from Subscriptions.' : 'Change Subscriptions and the monthly total shows up here.'
        },
      },
      {
        key: 'others',
        label: 'Other debts / month',
        kind: 'lines',
        max: 8,
        addLabel: 'Add debt',
        itemNoun: 'debt',
        blank: otherBlank,
        hint: 'Optional comment on each debt. A blank row is left out of the ratio.',
        columns: [
          { key: 'comment', label: 'Comment', type: 'text', placeholder: 'Optional', spellcheck: true, focus: true },
          { key: 'amount', label: 'Monthly', type: 'number', prefix: '$' },
        ],
      },
    ],
    compute: computeDti,
  },
  {
    id: 'mortgage',
    name: 'Mortgage',
    group: 'Borrowing',
    icon: 'home',
    description: 'Housing payment for a standard or VA loan, including principal, interest, taxes, insurance, and HOA.',
    defaults: {
      loanType: 'conventional',
      vaUse: 'first',
      vaFeeMode: 'rolled',
      price: '450000',
      down: '90000',
      annualRate: '6.5',
      years: '30',
      months: '0',
      days: '0',
      tax: '5400',
      insurance: '1800',
      hoa: '0',
      extra: '0',
    },
    examples: [
      {
        name: '30-year home',
        values: {
          price: '450000',
          down: '90000',
          annualRate: '6.5',
          years: '30',
          tax: '5400',
          insurance: '1800',
          hoa: '0',
          extra: '0',
        },
      },
      {
        name: '15-year condo',
        values: {
          price: '320000',
          down: '64000',
          annualRate: '6',
          years: '15',
          tax: '3800',
          insurance: '1400',
          hoa: '350',
          extra: '0',
        },
      },
      {
        name: 'VA loan',
        values: {
          loanType: 'va',
          vaUse: 'first',
          vaFeeMode: 'rolled',
          price: '450000',
          down: '0',
          annualRate: '6.5',
          years: '30',
          tax: '5400',
          insurance: '1800',
          hoa: '0',
          extra: '0',
        },
      },
    ],
    fields: [
      {
        key: 'loanType',
        label: 'Loan',
        kind: 'segment',
        options: [
          { value: 'conventional', label: 'Standard' },
          { value: 'va', label: 'VA' },
        ],
        hint: 'VA loans are for eligible Veterans, service members, and some surviving spouses. They allow $0 down and charge no monthly mortgage insurance.',
      },
      {
        key: 'vaUse',
        label: 'VA funding fee',
        kind: 'segment',
        showIf: (values) => values.loanType === 'va',
        options: [
          { value: 'first', label: 'First use' },
          { value: 'subsequent', label: 'Used before' },
          { value: 'exempt', label: 'Exempt' },
        ],
        hint: 'Purchase funding fee since April 7, 2023. Under 5% down is 2.15% the first time and 3.3% after that. At least 5% down is 1.5%, and at least 10% down is 1.25%. Exempt is $0, including VA disability compensation and an active-duty Purple Heart.',
      },
      {
        key: 'vaFeeMode',
        label: 'Pay funding fee',
        kind: 'segment',
        showIf: (values) => values.loanType === 'va' && values.vaUse !== 'exempt',
        options: [
          { value: 'rolled', label: 'Roll in' },
          { value: 'upfront', label: 'At closing' },
        ],
        hint: 'Roll in adds the fee to the loan. At closing pays it with the down payment. The percent applies to the loan before the fee is added.',
      },
      { key: 'price', label: 'Home price', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true },
      {
        key: 'down',
        label: 'Down payment',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        hint: (values) => values.loanType === 'va'
          ? 'VA loans allow $0 down. 5% down lowers the funding fee to 1.5%, and 10% down lowers it to 1.25%.'
          : '',
      },
      { key: 'annualRate', label: 'Annual rate', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'APR, compounded monthly.' },
      termField('term', 'Term', ['years', 'months', 'days']),
      { key: 'tax', label: 'Property tax / year', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'insurance', label: 'Home insurance / year', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'hoa', label: 'HOA / month', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'extra', label: 'Extra monthly payment', kind: 'number', prefix: '$', min: 0, ...amountMax },
    ],
    compute: computeMortgage,
  },
  {
    id: 'refinance',
    name: 'Refinance',
    group: 'Borrowing',
    icon: 'refresh',
    description: 'Compare the current loan with a new rate, term, and closing costs.',
    defaults: {
      balance: '280000',
      currentRate: '6.5',
      remaining: '27',
      remainingMonths: '0',
      remainingDays: '0',
      newRate: '5.75',
      newYears: '30',
      newMonths: '0',
      newDays: '0',
      costs: '6000',
      costsMode: 'upfront',
    },
    examples: [
      {
        name: 'Lower rate',
        values: {
          balance: '280000',
          currentRate: '6.5',
          remaining: '27',
          newRate: '5.75',
          newYears: '30',
          costs: '6000',
          costsMode: 'upfront',
        },
      },
      {
        name: 'Shorter term',
        values: {
          balance: '280000',
          currentRate: '6.5',
          remaining: '27',
          newRate: '5.5',
          newYears: '15',
          costs: '4500',
          costsMode: 'rolled',
        },
      },
    ],
    fields: [
      { key: 'balance', label: 'Current balance', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true },
      { key: 'currentRate', label: 'Current rate', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'APR, compounded monthly.' },
      termField('currentTerm', 'Remaining', ['remaining', 'remainingMonths', 'remainingDays']),
      { key: 'newRate', label: 'New rate', kind: 'number', suffix: '%', min: 0, max: 100 },
      termField('newTerm', 'New term', ['newYears', 'newMonths', 'newDays']),
      { key: 'costs', label: 'Closing costs', kind: 'number', prefix: '$', min: 0, ...amountMax },
      {
        key: 'costsMode',
        label: 'Closing costs',
        kind: 'segment',
        options: [
          { value: 'upfront', label: 'Upfront' },
          { value: 'rolled', label: 'Roll in' },
        ],
        hint: 'Upfront is paid at closing. Roll in adds the costs to the new balance.',
      },
    ],
    compute: computeRefinance,
  },
  {
    id: 'rent',
    name: 'Rent',
    group: 'Borrowing',
    icon: 'key',
    description: 'Monthly housing cost of a lease, including fees and a rent-free promotion.',
    defaults: {
      rent: '2200',
      years: '1',
      months: '0',
      days: '0',
      promo: 'none',
      freeYears: '0',
      freeMonths: '1',
      freeDays: '0',
      increase: '0',
      insurance: '180',
      utilities: '150',
      parking: '0',
      pet: '0',
      deposit: '2200',
    },
    examples: [
      {
        name: 'One-year apartment',
        values: {
          rent: '2200',
          years: '1',
          increase: '0',
          insurance: '180',
          utilities: '150',
          parking: '0',
          pet: '0',
          deposit: '2200',
        },
      },
      {
        name: 'Two-year house',
        values: {
          rent: '2800',
          years: '2',
          increase: '3',
          insurance: '240',
          utilities: '220',
          parking: '75',
          pet: '50',
          deposit: '2800',
        },
      },
      {
        name: 'One month free',
        values: {
          rent: '2200',
          years: '1',
          promo: 'free',
          freeMonths: '1',
          increase: '0',
          insurance: '180',
          utilities: '150',
          parking: '0',
          pet: '0',
          deposit: '2200',
        },
      },
    ],
    fields: [
      { key: 'rent', label: 'Monthly rent', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true },
      termField('lease', 'Lease length', ['years', 'months', 'days']),
      {
        key: 'promo',
        label: 'Promotion',
        kind: 'segment',
        options: [
          { value: 'none', label: 'None' },
          { value: 'free', label: 'Months free' },
        ],
      },
      termField('freeTerm', 'Rent free', ['freeYears', 'freeMonths', 'freeDays'], {
        showIf: (values) => values.promo === 'free',
        hint: 'Waives base rent for this long at the start of the lease. Other fees are still due. 30 days count as one month.',
      }),
      { key: 'increase', label: 'Annual rent increase', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'Applied to base rent at the start of each year.' },
      { key: 'insurance', label: 'Renter’s insurance / year', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'utilities', label: 'Utilities / month', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'parking', label: 'Parking / month', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'pet', label: 'Pet rent / month', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'deposit', label: 'Security deposit', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Collected up front. It is not part of the monthly payment.' },
    ],
    compute: computeRent,
  },
  {
    id: 'apr',
    name: 'APR',
    group: 'Credit',
    icon: 'score',
    description: 'Estimate an APR and the chance of approval from payment history, credit length, and debt for a mortgage, car, or personal loan. No Social Security number.',
    defaults: {
      source: 'score',
      score: '720',
      payments: 'ontime',
      utilization: 'under30',
      age: '5to9',
      inquiries: 'few',
      mix: 'cards',
      product: 'mortgage30',
      amount: '350000',
      debt: '0',
      income: '0',
    },
    examples: [
      { name: '720 mortgage', values: { source: 'score', score: '720', product: 'mortgage30', amount: '350000' } },
      { name: 'New car at 800', values: { source: 'score', score: '800', product: 'autonew', amount: '35000' } },
      {
        name: 'From payment history',
        values: {
          source: 'history',
          payments: 'ontime',
          utilization: 'under10',
          age: '10plus',
          inquiries: 'none',
          mix: 'both',
          product: 'personal36',
          amount: '10000',
        },
      },
    ],
    fields: [
      {
        key: 'source',
        label: 'Credit',
        kind: 'segment',
        options: [
          { value: 'score', label: 'I have a score' },
          { value: 'history', label: 'From my history' },
        ],
        hint: 'Nothing here asks for a Social Security number or checks a credit report.',
      },
      {
        key: 'score',
        label: 'Credit score',
        kind: 'number',
        min: 300,
        max: 850,
        required: true,
        showIf: (values) => values.source !== 'history',
        hint: 'A score you already have, from 300 to 850.',
      },
      {
        key: 'payments',
        label: 'Payment history',
        kind: 'select',
        hint: 'On-time payments keep the published average. Late payments raise the APR and lower the chance of approval.',
        options: [
          { value: 'ontime', label: 'On time' },
          { value: 'late2y', label: 'A late payment more than a year ago' },
          { value: 'late1y', label: 'A late payment in the last year' },
          { value: 'serious', label: 'Several late payments or a collection' },
        ],
      },
      {
        key: 'utilization',
        label: 'Card balances',
        kind: 'select',
        hint: 'Balances compared with credit limits.',
        options: [
          { value: 'under10', label: 'Under 10%' },
          { value: 'under30', label: '10–29%' },
          { value: 'under50', label: '30–49%' },
          { value: 'over50', label: '50% or more' },
          { value: 'none', label: 'No cards' },
        ],
      },
      {
        key: 'age',
        label: 'Credit length',
        kind: 'select',
        hint: 'How long the oldest account has been open.',
        options: [
          { value: 'under2', label: 'Under 2 years' },
          { value: '2to4', label: '2–4 years' },
          { value: '5to9', label: '5–9 years' },
          { value: '10plus', label: '10 years or more' },
        ],
      },
      {
        key: 'inquiries',
        label: 'Applications in the last year',
        kind: 'select',
        options: [
          { value: 'none', label: 'None' },
          { value: 'few', label: '1 or 2' },
          { value: 'many', label: '3 or more' },
        ],
      },
      {
        key: 'mix',
        label: 'Accounts',
        kind: 'select',
        options: [
          { value: 'both', label: 'Cards and a loan' },
          { value: 'cards', label: 'Cards only' },
          { value: 'thin', label: 'One account, or not sure' },
        ],
      },
      {
        key: 'product',
        label: 'Loan',
        kind: 'select',
        hint: 'The loan you want. Published averages for that loan are adjusted for history, credit length, and debt.',
        options: [
          { value: 'mortgage30', label: '30-year mortgage' },
          { value: 'mortgage15', label: '15-year mortgage' },
          { value: 'autonew', label: 'New car' },
          { value: 'autoused', label: 'Used car' },
          { value: 'personal36', label: '3-year personal loan' },
          { value: 'personal60', label: '5-year personal loan' },
        ],
      },
      {
        key: 'amount',
        label: 'Amount',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        hint: 'Optional. Shows a sample monthly payment at the estimated APR.',
      },
      {
        key: 'debt',
        label: 'Monthly debt',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        hint: 'Cards, loans, and other debts you already pay each month.',
      },
      {
        key: 'income',
        label: 'Monthly income',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        hint: 'Gross pay each month. With the debt and this loan, it sets the chance of approval. Leave it at 0 to leave income out.',
      },
    ],
    compute: computeApr,
  },
  {
    id: 'salestax',
    name: 'Sales tax',
    group: 'Spending',
    icon: 'receipt',
    description: 'Price after sales tax for one item or a list, with an optional comment on the receipt.',
    defaults: {
      entry: 'single',
      price: '49.99',
      quantity: '1',
      comment: '',
      items: JSON.stringify([defaultSaleItem]),
      state: 'CA',
      local: '0',
    },
    examples: [
      { name: 'California purchase', values: { price: '49.99', quantity: '1', state: 'CA', local: '0' } },
      { name: 'Texas with local tax', values: { price: '120', quantity: '2', state: 'TX', local: '2' } },
      {
        name: 'Grocery list',
        values: {
          entry: 'list',
          state: 'TX',
          local: '2',
          items: JSON.stringify([
            { comment: 'Milk', price: '4.29', quantity: '2' },
            { comment: 'Bread', price: '3.50', quantity: '1' },
          ]),
        },
      },
    ],
    fields: [
      {
        key: 'entry',
        label: 'Item price',
        kind: 'segment',
        options: [
          { value: 'single', label: 'One price' },
          { value: 'list', label: 'List' },
        ],
      },
      {
        key: 'price',
        label: 'Item price',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        hint: 'Price before tax.',
        required: true,
        showIf: (values) => values.entry !== 'list',
      },
      {
        key: 'quantity',
        label: 'Quantity',
        kind: 'number',
        min: 0,
        max: 1000000,
        required: true,
        showIf: (values) => values.entry !== 'list',
      },
      {
        key: 'comment',
        label: 'Comment',
        kind: 'text',
        hint: 'Optional. It shows on the receipt and does not change the tax.',
        showIf: (values) => values.entry !== 'list',
      },
      {
        key: 'items',
        label: 'Items',
        kind: 'items',
        hint: 'Each line has its own price. Leave the comment blank to keep the line unnamed.',
        showIf: (values) => values.entry === 'list',
      },
      {
        key: 'state',
        label: 'State',
        kind: 'select',
        options: stateOptions,
        hint: 'Statewide rate as of 2026. California, Utah, and Virginia include the local tax charged everywhere in the state.',
      },
      { key: 'local', label: 'Local tax', kind: 'number', suffix: '%', min: 0, max: 15, hint: 'City or county tax added on top of the state rate.' },
    ],
    compute: computeSalesTax,
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    group: 'Spending',
    icon: 'subs',
    description: 'Monthly total for streaming, music, memberships, and other small subscriptions.',
    defaults: {
      discount: 'full',
      billing: 'monthly',
      services: JSON.stringify([
        { service: 'youtube', name: '', price: '' },
        { service: 'spotify', name: '', price: '' },
      ]),
    },
    examples: [
      {
        name: 'YouTube and Spotify',
        values: {
          discount: 'full',
          billing: 'monthly',
          services: JSON.stringify([
            { service: 'youtube', name: '', price: '' },
            { service: 'spotify', name: '', price: '' },
          ]),
        },
      },
      {
        name: 'First responder',
        values: {
          discount: 'responder',
          billing: 'monthly',
          services: JSON.stringify([
            { service: 'peacock', name: '', price: '' },
            { service: 'youtubetv', name: '', price: '' },
            { service: 'peloton', name: '', price: '' },
          ]),
        },
      },
      {
        name: 'Student streaming',
        values: {
          discount: 'student',
          billing: 'monthly',
          services: JSON.stringify([
            { service: 'spotify', name: '', price: '' },
            { service: 'hulu', name: '', price: '' },
            { service: 'prime', name: '', price: '' },
          ]),
        },
      },
    ],
    fields: [
      {
        key: 'discount',
        label: 'Price',
        kind: 'segment',
        options: [
          { value: 'full', label: 'Full price' },
          { value: 'student', label: 'Student' },
          { value: 'military', label: 'Military' },
          { value: 'responder', label: 'First responder' },
        ],
        hint: 'Student, military, and first responder prices are used when that service publishes one. Otherwise the row stays at full price.',
      },
      {
        key: 'billing',
        label: 'Billing',
        kind: 'segment',
        options: [
          { value: 'monthly', label: 'Monthly' },
          { value: 'annual', label: 'Annual' },
        ],
        hint: 'Annual uses the yearly list price divided by 12 when that plan publishes one.',
      },
      {
        key: 'services',
        label: 'Subscriptions',
        kind: 'lines',
        max: 12,
        addLabel: 'Add subscription',
        itemNoun: 'subscription',
        blank: { service: 'custom', name: '', price: '', comment: '' },
        hint: 'The monthly amount starts at the list price. Type over it when the price changes, or clear it to use the list price again. A comment is your own description.',
        columns: [
          {
            key: 'service',
            label: 'Service',
            type: 'select',
            wide: true,
            options: [
              ...subscriptionCatalog.map((service) => ({ value: service.id, label: `${service.group} · ${service.name}` })),
              { value: 'custom', label: 'Custom' },
            ],
          },
          {
            key: 'comment',
            label: 'Comment',
            type: 'text',
            wide: true,
            placeholder: 'Description',
            spellcheck: true,
          },
          {
            key: 'name',
            label: 'Custom name',
            type: 'text',
            placeholder: 'Name',
            readOnly: (row) => row.service !== 'custom',
            value: (row) => (row.service === 'custom' ? row.name : ''),
          },
          {
            key: 'price',
            label: 'Monthly',
            type: 'number',
            prefix: '$',
            value: (row, rowValues) => {
              if (String(row.price || '').trim()) return row.price
              if (row.service === 'custom') return ''
              const service = subscriptionById(row.service)
              const quote = quoteSubscription(service, rowValues.discount, rowValues.billing)
              if (!quote) return ''
              const rounded = Math.round(quote.monthly * 100) / 100
              return String(rounded)
            },
          },
        ],
      },
    ],
    compute: computeSubscriptions,
  },
  {
    id: 'savings',
    name: 'Savings goal',
    group: 'Planning',
    icon: 'target',
    description: 'Monthly amount to reach a target, or how long a contribution will take.',
    defaults: {
      goal: '15000',
      current: '2500',
      annualRate: '4',
      mode: 'time',
      monthly: '400',
      years: '3',
      months: '0',
      days: '0',
    },
    examples: [
      {
        name: 'Emergency fund',
        values: { goal: '15000', current: '2500', annualRate: '4', mode: 'time', monthly: '400', years: '3' },
      },
      {
        name: 'House down payment',
        values: { goal: '80000', current: '12000', annualRate: '5', mode: 'payment', monthly: '500', years: '6' },
      },
    ],
    fields: [
      { key: 'goal', label: 'Goal', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true },
      { key: 'current', label: 'Already saved', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'annualRate', label: 'Annual return', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'Compounded monthly.' },
      {
        key: 'mode',
        label: 'Solve for',
        kind: 'segment',
        options: [
          { value: 'time', label: 'Time to goal' },
          { value: 'payment', label: 'Monthly amount' },
        ],
      },
      {
        key: 'monthly',
        label: 'Monthly deposit',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        showIf: (values) => values.mode === 'time',
      },
      termField('goalTime', 'Time', ['years', 'months', 'days'], { showIf: (values) => values.mode !== 'time' }),
    ],
    compute: computeSavings,
  },
  {
    id: 'retirement',
    name: 'Retirement',
    group: 'Planning',
    icon: 'sun',
    description: 'Nest egg at retirement and a withdrawal in today’s dollars.',
    defaults: {
      currentAge: '32',
      retireAge: '65',
      savings: '25000',
      monthly: '700',
      annualRate: '7',
      inflation: '2.5',
      withdrawal: '4',
    },
    examples: [
      {
        name: 'Start at 32',
        values: {
          currentAge: '32',
          retireAge: '65',
          savings: '25000',
          monthly: '700',
          annualRate: '7',
          inflation: '2.5',
          withdrawal: '4',
        },
      },
      {
        name: 'Catch-up at 45',
        values: {
          currentAge: '45',
          retireAge: '67',
          savings: '180000',
          monthly: '1500',
          annualRate: '6',
          inflation: '2.5',
          withdrawal: '4',
        },
      },
    ],
    fields: [
      { key: 'currentAge', label: 'Current age', kind: 'number', min: 0, max: 120, required: true },
      { key: 'retireAge', label: 'Retirement age', kind: 'number', min: 0, max: 120, required: true },
      { key: 'savings', label: 'Current savings', kind: 'number', prefix: '$', min: 0, ...amountMax },
      { key: 'monthly', label: 'Monthly deposit', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Stays flat. It is not increased with inflation.' },
      { key: 'annualRate', label: 'Annual return', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'Before inflation.' },
      { key: 'inflation', label: 'Inflation', kind: 'number', suffix: '%', min: 0, max: 50, hint: 'Used to show results in today’s dollars.' },
      { key: 'withdrawal', label: 'Withdrawal rate', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'Percent of the nest egg withdrawn each year.' },
    ],
    compute: computeRetirement,
  },
  {
    id: 'percent',
    name: 'Percentage',
    group: 'Planning',
    icon: 'slide',
    description: 'Yearly total for a percent of hourly, weekly, biweekly, monthly, or annual income.',
    defaults: {
      income: '80000',
      paid: 'annual',
      hours: '40',
      weeks: '52',
      percent: '20',
    },
    examples: [
      { name: 'Twenty percent', values: { income: '80000', paid: 'annual', percent: '20' } },
      { name: 'A third of monthly pay', values: { income: '6000', paid: 'monthly', percent: '30' } },
      { name: 'Ten percent of a weekly paycheck', values: { income: '1000', paid: 'weekly', percent: '10' } },
      { name: 'Twenty percent of an hourly wage', values: { income: '25', paid: 'hourly', hours: '40', weeks: '52', percent: '20' } },
    ],
    fields: [
      {
        key: 'income',
        label: 'Income',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        hint: (values) => (values.paid === 'hourly' ? 'Pay for one hour.' : ''),
      },
      {
        key: 'paid',
        label: 'Paid',
        kind: 'segment',
        options: [
          { value: 'hourly', label: 'Hourly' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'biweekly', label: 'Biweekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'annual', label: 'Annual' },
        ],
        hint: 'How often this income is paid. Hourly is one hour of pay. Biweekly is 26 paychecks a year.',
      },
      {
        key: 'hours',
        label: 'Hours per week',
        kind: 'number',
        min: 0,
        max: 168,
        required: true,
        showIf: (values) => values.paid === 'hourly',
        hint: 'Paid hours in a normal week. 40 is full time.',
      },
      {
        key: 'weeks',
        label: 'Weeks per year',
        kind: 'number',
        min: 0,
        max: 52,
        required: true,
        showIf: (values) => values.paid === 'hourly',
        hint: '52 is a full year. Use fewer for unpaid time off.',
      },
      {
        key: 'percent',
        label: 'Percent of income',
        kind: 'slider',
        min: 0,
        max: 100,
        step: 1,
        suffix: '%',
        hint: 'Drag to choose the share of this income.',
      },
    ],
    compute: computePercent,
  },
  {
    id: 'diminish',
    name: 'Capital diminishing',
    group: 'Net worth',
    icon: 'diminish',
    description: 'Remaining capital of an asset after a fixed depreciation rate is applied to the value left each year.',
    defaults: {
      cost: '30000',
      rate: '20',
      years: '5',
      months: '0',
      days: '0',
      salvage: '0',
    },
    examples: [
      { name: 'Car at 20%', values: { cost: '30000', rate: '20', years: '5', salvage: '0' } },
      { name: 'Equipment with a salvage floor', values: { cost: '30000', rate: '20', years: '5', salvage: '10000' } },
    ],
    fields: [
      { key: 'cost', label: 'Asset cost', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true, hint: 'Capital at the start.' },
      { key: 'rate', label: 'Depreciation rate', kind: 'number', suffix: '%', min: 0, max: 100, required: true, hint: 'Fixed percent of the remaining capital, taken off once a year.' },
      termField('time', 'Time', ['years', 'months', 'days']),
      { key: 'salvage', label: 'Salvage value', kind: 'number', prefix: '$', min: 0, ...amountMax, hint: 'Depreciation stops at this amount. Leave it at 0 to let the capital fall toward nothing.' },
    ],
    compute: computeDiminish,
  },
  {
    id: 'networth',
    name: 'Net worth',
    group: 'Net worth',
    icon: 'scale',
    description: 'Assets minus debts, with monthly bills counted beside the balance.',
    defaults: {
      entries: JSON.stringify([{ ...worthBlank }]),
    },
    examples: [
      {
        name: 'Checking and a bill',
        values: {
          entries: JSON.stringify([
            { kind: 'asset', name: 'Checking', amount: '4200' },
            { kind: 'debt', name: 'Personal loan', amount: '1500' },
            { kind: 'bill', name: 'Electric', amount: '110' },
          ]),
        },
      },
    ],
    fields: [
      {
        key: 'entries',
        label: 'Other balances',
        kind: 'lines',
        max: 12,
        addLabel: 'Add item',
        itemNoun: 'item',
        blank: worthBlank,
        hint: 'Assets and debts are balances. A monthly bill is one month of cost. Savings, retirement, a home, loans, cards, rent, and subscriptions are copied in after you change those calculators. A blank row is left out.',
        columns: [
          {
            key: 'kind',
            label: 'Kind',
            type: 'select',
            options: [
              { value: 'asset', label: 'Asset' },
              { value: 'debt', label: 'Debt' },
              { value: 'bill', label: 'Monthly bill' },
            ],
          },
          { key: 'name', label: 'Name', type: 'text', wide: true, placeholder: 'Optional', spellcheck: true, focus: true },
          { key: 'amount', label: 'Amount', type: 'number', prefix: '$' },
        ],
      },
    ],
    compute: computeNetWorth,
  },
  {
    id: 'exchange',
    name: 'Exchange',
    group: 'Currency',
    icon: 'globe',
    description: 'Convert an amount into another currency, and see it in every other currency.',
    defaults: {
      amount: '100',
      from: 'USD',
      to: 'EUR',
      query: '',
    },
    examples: [
      { name: 'US dollars to euros', values: { amount: '100', from: 'USD', to: 'EUR', query: '' } },
      { name: 'Euros to yen', values: { amount: '250', from: 'EUR', to: 'JPY', query: '' } },
    ],
    fields: [
      { key: 'amount', label: 'Amount', kind: 'number', min: 0, ...amountMax, required: true },
      {
        key: 'from',
        label: 'From',
        kind: 'combo',
        hint: 'Open the list and search by name or code.',
        get options() { return exchangeOptions() },
      },
      {
        key: 'to',
        label: 'To',
        kind: 'combo',
        hint: 'Open the list and search by name or code.',
        get options() { return exchangeOptions() },
      },
      {
        key: 'query',
        label: 'Find currency',
        kind: 'text',
        placeholder: 'Name or code',
        spellcheck: false,
        hint: 'Filters the list below. Leave it blank to see every other currency.',
      },
    ],
    compute: computeExchange,
  },
  {
    id: 'wage',
    name: 'Wage',
    group: 'Pay',
    icon: 'wage',
    description: 'Gross and take-home pay from an hourly rate or a salary. A paystub can be dollars or percents for Social Security, taxes, and retirement.',
    defaults: {
      mode: 'hourly',
      rate: '25',
      salary: '52000',
      hours: '40',
      weeks: '52',
      ...taxDefaults,
    },
    examples: [
      { name: 'Hourly job', values: { mode: 'hourly', rate: '25', hours: '40', weeks: '52' } },
      { name: 'Salary', values: { mode: 'salary', salary: '80000', hours: '40', weeks: '52' } },
    ],
    fields: [
      {
        key: 'mode',
        label: 'Start from',
        kind: 'segment',
        options: [
          { value: 'hourly', label: 'Hourly' },
          { value: 'salary', label: 'Salary' },
        ],
      },
      {
        key: 'rate',
        label: 'Hourly rate',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        showIf: (values) => values.mode !== 'salary',
      },
      {
        key: 'salary',
        label: 'Annual salary',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        showIf: (values) => values.mode === 'salary',
      },
      { key: 'hours', label: 'Hours per week', kind: 'number', min: 0, max: 168, required: true, hint: 'Paid hours in a normal week.' },
      { key: 'weeks', label: 'Weeks per year', kind: 'number', min: 0, max: 52, required: true, hint: '52 is a full year. Use fewer for unpaid time off.' },
      ...taxFields({ includeState: true }),
    ],
    compute: computeWage,
  },
  {
    id: 'payrate',
    name: 'Pay rate',
    group: 'Pay',
    icon: 'clock',
    description: 'Hourly, daily, weekly, and monthly pay from a salary or a wage, with the rate after a raise and at a 40-hour year.',
    defaults: {
      mode: 'salary',
      salary: '80000',
      rate: '25',
      daily: '200',
      weekly: '1000',
      monthly: '5000',
      hoursPerDay: '8',
      daysPerWeek: '5',
      weeks: '52',
      raise: '0',
    },
    examples: [
      { name: '$80,000 salary', values: { mode: 'salary', salary: '80000', hoursPerDay: '8', daysPerWeek: '5', weeks: '52', raise: '0' } },
      { name: '$25 an hour', values: { mode: 'hourly', rate: '25', hoursPerDay: '8', daysPerWeek: '5', weeks: '52', raise: '0' } },
      { name: 'Four-day week', values: { mode: 'salary', salary: '80000', hoursPerDay: '8', daysPerWeek: '4', weeks: '52', raise: '0' } },
      { name: 'With a 5% raise', values: { mode: 'salary', salary: '80000', hoursPerDay: '8', daysPerWeek: '5', weeks: '52', raise: '5' } },
    ],
    fields: [
      {
        key: 'mode',
        label: 'Start from',
        kind: 'segment',
        options: [
          { value: 'salary', label: 'Salary' },
          { value: 'hourly', label: 'Hourly' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
        ],
      },
      {
        key: 'salary',
        label: 'Annual salary',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        showIf: (values) => values.mode === 'salary',
      },
      {
        key: 'rate',
        label: 'Hourly rate',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        showIf: (values) => values.mode === 'hourly',
      },
      {
        key: 'daily',
        label: 'Daily pay',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        showIf: (values) => values.mode === 'daily',
      },
      {
        key: 'weekly',
        label: 'Weekly pay',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        showIf: (values) => values.mode === 'weekly',
      },
      {
        key: 'monthly',
        label: 'Monthly pay',
        kind: 'number',
        prefix: '$',
        min: 0,
        ...amountMax,
        required: true,
        showIf: (values) => values.mode === 'monthly',
      },
      { key: 'hoursPerDay', label: 'Hours per day', kind: 'number', min: 0, max: 24, required: true, hint: 'Paid hours in a workday. Daily pay is the hourly rate times this.' },
      { key: 'daysPerWeek', label: 'Days per week', kind: 'number', min: 0, max: 7, required: true, hint: 'Paid days in a normal week.' },
      { key: 'weeks', label: 'Weeks per year', kind: 'number', min: 0, max: 52, required: true, hint: '52 is a full year. Use fewer for unpaid time off.' },
      { key: 'raise', label: 'Raise', kind: 'number', suffix: '%', min: 0, max: 100, hint: 'Optional. Shows each period after a raise of this size.' },
    ],
    compute: computePayRate,
  },
  {
    id: 'overtime',
    name: 'Overtime',
    group: 'Pay',
    icon: 'overtime',
    description: 'Gross and take-home pay for one workweek, using how that state regulates overtime. A paystub can be dollars or percents.',
    defaults: {
      state: 'CA',
      rate: '20',
      entry: 'days',
      hours: '45',
      h1: '8',
      h2: '8',
      h3: '8',
      h4: '8',
      h5: '10',
      h6: '0',
      h7: '0',
      nevada: 'standard',
      oregon: 'general',
      query: '',
      ...taxDefaults,
      stubPeriod: 'weekly',
    },
    examples: [
      {
        name: 'California week',
        values: { state: 'CA', rate: '20', entry: 'days', h1: '8', h2: '8', h3: '8', h4: '8', h5: '10', h6: '0', h7: '0' },
      },
      {
        name: 'Texas week total',
        values: { state: 'TX', rate: '20', entry: 'week', hours: '45' },
      },
    ],
    fields: [
      { key: 'state', label: 'State', kind: 'select', options: overtimeOptions, hint: 'The schedule lists how all 50 states regulate overtime.' },
      { key: 'rate', label: 'Hourly rate', kind: 'number', prefix: '$', min: 0, ...amountMax, required: true, hint: 'Regular rate before overtime.' },
      {
        key: 'entry',
        label: 'Hours',
        kind: 'segment',
        options: [
          { value: 'week', label: 'Week total' },
          { value: 'days', label: 'Each day' },
        ],
        hint: 'Each day is required for daily overtime and a seventh consecutive day.',
      },
      {
        key: 'hours',
        label: 'Hours this week',
        kind: 'number',
        min: 0,
        max: 168,
        showIf: (values) => values.entry !== 'days',
      },
      ...[1, 2, 3, 4, 5, 6, 7].map((day) => ({
        key: `h${day}`,
        label: `Day ${day} hours`,
        kind: 'number',
        min: 0,
        max: 24,
        showIf: (values) => values.entry === 'days',
        hint: day === 7 ? 'Day 7 is the seventh consecutive day when every day has hours.' : undefined,
      })),
      {
        key: 'nevada',
        label: 'Nevada schedule',
        kind: 'segment',
        showIf: (values) => values.state === 'NV',
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'four', label: '4×10' },
        ],
        hint: 'An agreed 4-day, 10-hour week waives the 8-hour day. Hours past 10 in a day can still be overtime.',
      },
      {
        key: 'oregon',
        label: 'Oregon workplace',
        kind: 'segment',
        showIf: (values) => values.state === 'OR',
        options: [
          { value: 'general', label: 'General' },
          { value: 'manufacturing', label: 'Manufacturing' },
        ],
        hint: 'Manufacturing, mills, factories, and canneries also pay overtime after 10 hours in a day.',
      },
      {
        key: 'query',
        label: 'Find state',
        kind: 'text',
        placeholder: 'Name',
        spellcheck: false,
        hint: 'Filters the state rules below.',
      },
      ...taxFields({ includeState: false }),
    ],
    compute: computeOvertime,
  },
  {
    id: 'calc',
    name: 'Calculator',
    group: 'Tools',
    icon: 'calc',
    description: 'Add, subtract, multiply, and divide.',
    defaults: {
      expression: '40*25+5*37.5',
    },
    examples: [
      { name: 'Weekly pay sketch', values: { expression: '40*25+5*37.5' } },
      { name: 'Split a bill', values: { expression: '(86.40+12)/3' } },
    ],
    fields: [
      { key: 'expression', label: 'Expression', kind: 'keypad' },
    ],
    compute: computeCalc,
  },
  {
    id: 'scientific',
    name: 'Scientific',
    group: 'Scientific',
    icon: 'sci',
    description: 'Sine, roots, powers, and the rest of a scientific keypad.',
    defaults: {
      angle: 'deg',
      expression: 'sin(30)+sqrt(9)',
    },
    examples: [
      { name: 'Sine of 30 degrees', values: { angle: 'deg', expression: 'sin(30)' } },
      { name: 'Quarter turn in radians', values: { angle: 'rad', expression: 'sin(pi/2)' } },
      { name: 'Powers and a factorial', values: { angle: 'deg', expression: '2^10+5!' } },
    ],
    fields: [
      {
        key: 'angle',
        label: 'Angle',
        kind: 'segment',
        options: [
          { value: 'deg', label: 'Degrees' },
          { value: 'rad', label: 'Radians' },
        ],
        hint: 'Sine, cosine, tangent, and their inverses use this.',
      },
      {
        key: 'expression',
        label: 'Expression',
        kind: 'keypad',
        letters: true,
        padClass: 'scientific',
        keys: [
          ['c', 'C', 'op'], ['back', '⌫', 'op'], ['(', '(', 'op'], [')', ')', 'op'], ['/', '÷', 'op'],
          ['sin(', 'sin', 'op'], ['cos(', 'cos', 'op'], ['tan(', 'tan', 'op'], ['log(', 'log', 'op'], ['*', '×', 'op'],
          ['asin(', 'asin', 'op'], ['acos(', 'acos', 'op'], ['atan(', 'atan', 'op'], ['ln(', 'ln', 'op'], ['-', '−', 'op'],
          ['sqrt(', '√', 'op'], ['^2', 'x²', 'op'], ['^', 'xʸ', 'op'], ['!', 'n!', 'op'], ['+', '+', 'op'],
          ['7', '7', ''], ['8', '8', ''], ['9', '9', ''], ['pi', 'π', 'op'], ['%', '%', 'op'],
          ['4', '4', ''], ['5', '5', ''], ['6', '6', ''], ['e', 'e', 'op'], ['^-1', '1/x', 'op'],
          ['1', '1', ''], ['2', '2', ''], ['3', '3', ''], ['0', '0', ''], ['.', '.', ''],
          ['=', '=', 'equals wide'],
        ],
      },
    ],
    compute: computeScientific,
  },
]

const byId = Object.fromEntries(calculators.map((calc) => [calc.id, calc]))

export function isCalcId(value) {
  return Object.prototype.hasOwnProperty.call(byId, value)
}

export function getCalculator(id) {
  const found = byId[id]
  if (!found) throw new Error(`Unknown calculator: ${id}`)
  return found
}

export function visibleFields(calc, values) {
  return calc.fields.filter((field) => !field.showIf || field.showIf(values))
}

function sameStoredValue(left, right) {
  return String(left ?? '') === String(right ?? '')
}

export function fieldsForReport(calc, values, enteredOnly = false) {
  const fields = visibleFields(calc, values)
  if (!enteredOnly) return fields
  return fields.filter((field) => {
    if (field.kind === 'span') {
      return field.parts.some((part) => !sameStoredValue(values[part.key], calc.defaults[part.key]))
    }
    return !sameStoredValue(values[field.key], calc.defaults[field.key])
  })
}

export function defaultInputs() {
  const inputs = {}
  for (const calc of calculators) inputs[calc.id] = { ...calc.defaults }
  return inputs
}

function blankFieldValue(field) {
  if (field.kind === 'number' || field.kind === 'slider' || field.kind === 'text' || field.kind === 'keypad') return ''
  if (field.kind === 'items') return JSON.stringify([{ comment: '', price: '', quantity: '' }])
  if (field.kind === 'lines') {
    const blank = { ...(field.blank || { amount: '' }) }
    for (const key of Object.keys(blank)) {
      if (key === 'kind' || key === 'service') continue
      blank[key] = ''
    }
    return JSON.stringify([blank])
  }
  return null
}

export function blankInputs() {
  const inputs = {}
  for (const calc of calculators) {
    const next = { ...calc.defaults }
    for (const field of calc.fields) {
      if (field.kind === 'span') {
        for (const part of field.parts) next[part.key] = ''
        continue
      }
      const cleared = blankFieldValue(field)
      if (cleared !== null) next[field.key] = cleared
    }
    inputs[calc.id] = next
  }
  return inputs
}

function readNumeric(raw, required) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return required ? { error: 'Enter a number' } : { value: 0 }
  }
  const n = parseLooseNumber(raw)
  if (n === null) return { error: 'Enter a number' }
  return { value: n }
}

function readFields(calc, values) {
  const fieldErrors = {}
  const numbers = {}
  for (const field of visibleFields(calc, values)) {
    if (field.kind === 'span') {
      for (const part of field.parts) {
        const parsed = readNumeric(values[part.key], false)
        if (parsed.error) fieldErrors[part.key] = parsed.error
        else if (parsed.value < 0) fieldErrors[part.key] = 'Must be at least 0'
        else if (part.max !== undefined && parsed.value > part.max) fieldErrors[part.key] = `Must be at most ${part.max}`
        else numbers[part.key] = parsed.value
      }
      continue
    }
    if (field.kind !== 'number' && field.kind !== 'slider') continue
    const parsed = readNumeric(values[field.key], field.required)
    if (parsed.error) fieldErrors[field.key] = parsed.error
    else if (field.min !== undefined && parsed.value < field.min) fieldErrors[field.key] = `Must be at least ${field.min}`
    else if (field.max !== undefined && parsed.value > field.max) fieldErrors[field.key] = field.maxMessage || `Must be at most ${field.max}`
    else numbers[field.key] = parsed.value
  }
  return { fieldErrors, numbers }
}

function fail(fieldErrors, formError) {
  return { ok: false, fieldErrors, formError }
}

function requirePositive(fieldErrors, numbers, key, message) {
  if (!fieldErrors[key] && numbers[key] !== undefined && numbers[key] <= 0) fieldErrors[key] = message
}

function termMonths(fieldErrors, numbers, yearsKey, monthsKey, daysKey, errorKey) {
  if ([yearsKey, monthsKey, daysKey].some((key) => fieldErrors[key] || numbers[key] === undefined)) return null
  let total = numbers[yearsKey] * 12 + numbers[monthsKey] + numbers[daysKey] / 30
  const nearest = Math.round(total)
  if (Math.abs(total - nearest) < 1e-8) total = nearest
  if (!(total > 0)) {
    fieldErrors[errorKey] = 'Enter at least 1 day'
    return null
  }
  if (total > 1200 + 1e-8) {
    fieldErrors[errorKey] = 'Keep the term to 100 years or less'
    return null
  }
  return total
}

function payoffDetail(termMonths, payoffMonths) {
  const date = formatMonthYear(addMonths(new Date(), payoffMonths))
  const early = termMonths - payoffMonths
  if (early > 0) return `Payoff ${date} · ${formatDuration(early)} early`
  return `Payoff ${date}`
}

function loanFormula(principal, annualRate, months, scheduled) {
  if (annualRate === 0) {
    return [
      'Rate is 0, so the payment is the amount divided by the number of months.',
      '',
      `M = P / n`,
      `P = ${money(principal)}`,
      `n = ${months} months`,
      `M = ${money(scheduled)}`,
    ]
  }
  const r = annualRate / 100 / 12
  return [
    'M = P · r(1+r)^n / ((1+r)^n − 1)',
    '',
    `P = ${money(principal)}`,
    `annual rate = ${percentNumber(annualRate)}`,
    `r = ${sig(annualRate / 100)} / 12 = ${sig(r)}`,
    `n = ${months} months`,
    `M = ${money(scheduled)}`,
    '',
    'APR is converted to a monthly rate by dividing by 12.',
  ]
}

function scheduleFromRows(columns, rows) {
  return { columns, rows }
}

function compoundSchedule(rows) {
  return scheduleFromRows(
    [
      { key: 'year', label: 'Year', align: 'left' },
      { key: 'deposit', label: 'Deposits', align: 'right' },
      { key: 'interest', label: 'Interest', align: 'right' },
      { key: 'balance', label: 'Balance', align: 'right' },
    ],
    rows.map((row) => ({
      year: String(row.year),
      deposit: money(row.deposit),
      interest: money(row.interest),
      balance: money(row.balance),
    })),
  )
}

function balanceChart(name, balances, xLabels, guides, label) {
  return {
    label,
    series: [{ name, values: balances }],
    guides,
    xLabels,
  }
}

function computeCompound(values) {
  const calc = getCalculator('compound')
  const { fieldErrors, numbers } = readFields(calc, values)
  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'time')
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)
  const years = months / 12

  const frequency = ['monthly', 'yearly', 'none'].includes(values.contributionFrequency)
    ? values.contributionFrequency
    : 'monthly'
  const compounds = Number(values.compounds)
  const n = [1, 2, 4, 12, 365].includes(compounds) ? compounds : 12
  const contribution = frequency === 'none' ? 0 : numbers.contribution

  const projected = projectCompound({
    principal: numbers.principal,
    annualRatePercent: numbers.annualRate,
    years,
    compoundsPerYear: n,
    contribution,
    contributionFrequency: frequency,
  })
  if (!projected.ok) return fail({}, projected.error)

  const value = projected.value
  const labels = { 1: 'annually', 2: 'semiannually', 4: 'quarterly', 12: 'monthly', 365: 'daily' }
  const series = [{ name: 'Balance', values: value.balances }]
  if (contribution > 0) series.push({ name: 'Contributed', values: value.contributedSeries })

  const rate = numbers.annualRate / 100
  const formula = rate === 0
    ? [
        'Rate is 0, so future value is the starting amount plus deposits.',
        '',
        `Starting amount = ${money(numbers.principal)}`,
        `Deposits = ${money(value.totalContributed - numbers.principal)}`,
        `FV = ${money(value.futureValue)}`,
      ]
    : [
        'FV = P(1 + r/n)^(nt) + deposits at the end of each period',
        '',
        `P = ${money(numbers.principal)}`,
        `deposit = ${money(contribution)} ${frequency === 'none' ? '' : frequency}`.trim(),
        `annual rate = ${percentNumber(numbers.annualRate)}`,
        `n = ${n} (${labels[n]})`,
        `t = ${formatDuration(months)}`,
        `FV = ${money(value.futureValue)}`,
        '',
        'Deposits are added at the end of each period.',
      ]

  return {
    ok: true,
    result: {
      headline: {
        label: 'Future value',
        value: money(value.futureValue),
        detail: `${money(value.interestEarned)} earned on ${money(value.totalContributed)} put in`,
      },
      stats: [
        { label: 'Interest earned', value: money(value.interestEarned), tone: value.interestEarned > 0 ? 'positive' : undefined },
        { label: 'Amount put in', value: money(value.totalContributed) },
        { label: 'Deposits', value: money(value.totalContributed - numbers.principal) },
        { label: 'Compounding', value: labels[n][0].toUpperCase() + labels[n].slice(1) },
      ],
      chart: {
        label: `Balance over ${formatDuration(months)}`,
        series,
        xLabels: ['Now', formatDuration(months)],
      },
      schedule: compoundSchedule(value.rows),
      formula,
      summary: `Future value ${money(value.futureValue)}`,
      raw: {
        futureValue: value.futureValue,
        interestEarned: value.interestEarned,
        totalContributed: value.totalContributed,
      },
    },
  }
}

function computeReturn(values) {
  const calc = getCalculator('return')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'initial', 'Enter a starting value greater than zero')
  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'time')
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)

  const { initial, final } = numbers
  const years = months / 12
  const gain = final - initial
  const simple = gain / initial
  const cagr = (final / initial) ** (1 / years) - 1
  if (!Number.isFinite(cagr)) return fail({}, 'Could not calculate a return for these inputs.')

  const steps = Math.max(1, Math.ceil(years))
  const series = []
  const rows = []
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(years, i)
    const value = i === steps ? final : initial * (1 + cagr) ** t
    series.push(value)
    if (i === 0) continue
    rows.push({
      year: Number.isInteger(t) ? String(t) : plain(t, 1),
      value: money(value),
      gain: money(value - initial),
    })
  }

  const tone = cagr >= 0 ? 'positive' : 'negative'
  return {
    ok: true,
    result: {
      headline: {
        label: 'Annualized return',
        value: percentNumber(cagr * 100),
        detail: `${gain >= 0 ? 'Gain' : 'Loss'} of ${money(Math.abs(gain))} over ${formatDuration(months)}`,
        tone,
      },
      stats: [
        { label: 'Simple return', value: percentNumber(simple * 100), tone },
        { label: 'Gain', value: money(gain), tone },
        { label: 'Starting value', value: money(initial) },
        { label: 'Ending value', value: money(final) },
      ],
      chart: {
        label: `Value over ${formatDuration(months)} at a constant annualized return`,
        series: [{ name: 'Value', values: series }],
        xLabels: ['Start', formatDuration(months)],
      },
      schedule: scheduleFromRows(
        [
          { key: 'year', label: 'Year', align: 'left' },
          { key: 'value', label: 'Value', align: 'right' },
          { key: 'gain', label: 'Gain', align: 'right' },
        ],
        rows,
      ),
      formula: [
        'CAGR = (ending / starting)^(1 / years) − 1',
        '',
        `starting = ${money(initial)}`,
        `ending = ${money(final)}`,
        `time = ${formatDuration(months)}`,
        `simple return = ${percentNumber(simple * 100)}`,
        `CAGR = ${percentNumber(cagr * 100)}`,
      ],
      summary: `Annualized return ${percentNumber(cagr * 100)}`,
      raw: { simpleReturn: simple, cagr, gain },
    },
  }
}

function scheduledPayment(principal, annualRatePercent, months) {
  if (!(principal > 0) || !(months > 0)) return null
  const paid = amortize(principal, annualRatePercent, months, 0)
  return paid.ok ? paid.value.scheduled : null
}

function rememberSuggestion(result, suggestion) {
  if (!suggestion || suggestion.payment == null || !Number.isFinite(suggestion.payment)) return
  result.stats.push({ label: 'Suggested payment', value: money(suggestion.payment) })
  result.formula.push('', suggestion.note)
  result.raw.suggestedPayment = suggestion.payment
}

function installmentSuggestion(principal, annualRate) {
  const payment = scheduledPayment(principal, annualRate, 36)
  if (payment == null) return null
  return {
    payment,
    note: 'Suggested payment clears this balance in 3 years. Credit counselors and the CFPB payoff guidance use three years as the usual target for consumer debt.',
  }
}

function carLoanSuggestion(numbers, salesTax) {
  const down = Math.max(numbers.down, numbers.price * 0.2)
  const amount = numbers.price - down - numbers.trade + numbers.tradeOwed + salesTax + numbers.fees
  const payment = scheduledPayment(amount, numbers.annualRate, 48)
  if (payment == null) return null
  return {
    payment,
    note: 'Suggested payment follows the 20/4/10 rule: at least 20% down, a 4-year term, and a payment at or under 10% of gross monthly income.',
  }
}

function vaFundingRate(down, price, use) {
  if (use === 'exempt' || !(price > 0)) return 0
  const downCents = Math.round(down * 100)
  const priceCents = Math.round(price * 100)
  if (downCents * 10 >= priceCents) return 0.0125
  if (downCents * 20 >= priceCents) return 0.015
  return use === 'subsequent' ? 0.033 : 0.0215
}

function vaFundingReason(down, price, use) {
  if (use === 'exempt') return 'The funding fee is $0 because this borrower is exempt.'
  const downCents = Math.round(down * 100)
  const priceCents = Math.round(price * 100)
  const band = downCents * 10 >= priceCents
    ? 'with 10% or more down'
    : downCents * 20 >= priceCents
      ? 'with 5% or more down'
      : 'with less than 5% down'
  const which = use === 'subsequent' ? 'A later use of a VA loan' : 'The first use of a VA loan'
  return `${which} ${band} uses the VA purchase funding fee in effect since April 7, 2023.`
}

function mortgageSuggestion(numbers, months, escrow, options = {}) {
  const va = options.va === true
  const principal = options.principal
  const twentyDown = numbers.down + 0.005 >= numbers.price * 0.2
  const withinFifteen = months <= 180 + 1e-6
  if ((va || twentyDown) && withinFifteen) {
    const base = scheduledPayment(va ? principal : numbers.price - numbers.down, numbers.annualRate, months)
    if (base == null) return null
    return {
      payment: base * 13 / 12 + escrow,
      note: va
        ? 'Suggested payment adds one extra principal payment a year. A VA loan has no monthly mortgage insurance, so this keeps the down payment you entered.'
        : 'Suggested payment adds one extra principal payment a year. That is a common way to shorten a mortgage that already has 20% down and a term of 15 years or less.',
    }
  }
  if (va) {
    const payment = scheduledPayment(principal, numbers.annualRate, 180)
    if (payment == null) return null
    return {
      payment: payment + escrow,
      note: 'Suggested payment is a 15-year schedule on this VA loan. VA loans do not charge monthly mortgage insurance, so the down payment stays the one you entered.',
    }
  }
  const down = Math.max(numbers.down, numbers.price * 0.2)
  const term = months > 180 ? 180 : months
  const payment = scheduledPayment(numbers.price - down, numbers.annualRate, term)
  if (payment == null) return null
  return {
    payment: payment + escrow,
    note: months > 180
      ? 'Suggested payment is a 15-year schedule with at least 20% down. Twenty percent down is the usual line before mortgage insurance, and 15 years is the common faster fixed term.'
      : 'Suggested payment uses at least 20% down on this term. Lenders generally require mortgage insurance when the loan is more than 80% of the price.',
  }
}

function refinanceSuggestion(principal, annualRate, months) {
  if (months > 180) {
    const payment = scheduledPayment(principal, annualRate, 180)
    if (payment == null) return null
    return {
      payment,
      note: 'Suggested payment is the 15-year payment on the new balance. A 15-year refinance is the common way to turn a lower rate into a much shorter loan.',
    }
  }
  const base = scheduledPayment(principal, annualRate, months)
  if (base == null) return null
  return {
    payment: base * 13 / 12,
    note: 'Suggested payment adds one extra principal payment a year on the new loan.',
  }
}

function loanResult(principal, annualRate, termMonths, extra, headlineLabel) {
  const amortized = amortize(principal, annualRate, termMonths, extra)
  if (!amortized.ok) return fail({}, amortized.error)
  const value = amortized.value
  const monthly = value.scheduled + extra
  const stats = []
  if (extra > 0) {
    stats.push({ label: 'Scheduled payment', value: money(value.scheduled) })
    stats.push({ label: 'Extra payment', value: money(extra) })
  }
  stats.push(
    { label: 'Total interest', value: money(value.totalInterest), tone: 'negative' },
    { label: 'Total paid', value: money(value.totalPaid) },
    { label: 'Payoff', value: formatDuration(value.payoffMonths) },
  )

  return {
    ok: true,
    value,
    monthly,
    result: {
      headline: {
        label: headlineLabel,
        value: money(monthly),
        detail: payoffDetail(termMonths, value.payoffMonths),
      },
      stats,
      chart: balanceChart(
        'Balance',
        value.balances,
        ['Now', formatDuration(value.payoffMonths)],
        undefined,
        'Remaining balance',
      ),
      schedule: scheduleFromRows(
        [
          { key: 'year', label: 'Year', align: 'left' },
          { key: 'payment', label: 'Payment', align: 'right' },
          { key: 'principal', label: 'Principal', align: 'right' },
          { key: 'interest', label: 'Interest', align: 'right' },
          { key: 'balance', label: 'Balance', align: 'right' },
        ],
        value.yearly.map((row) => ({
          year: String(row.year),
          payment: money(row.payment),
          principal: money(row.principal),
          interest: money(row.interest),
          balance: money(row.balance),
        })),
      ),
      formula: loanFormula(principal, annualRate, termMonths, value.scheduled),
      summary: `${headlineLabel} ${money(monthly)}`,
      raw: {
        scheduledPayment: value.scheduled,
        monthlyPayment: monthly,
        totalInterest: value.totalInterest,
        totalPaid: value.totalPaid,
        payoffMonths: value.payoffMonths,
      },
    },
  }
}

function computeLoan(values) {
  const calc = getCalculator('loan')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'amount', 'Enter an amount greater than zero')
  if (values.mode === 'minimum') {
    requirePositive(fieldErrors, numbers, 'minimum', 'Enter a payment greater than zero')
    if (Object.keys(fieldErrors).length) return fail(fieldErrors)
    const paid = payOffCard(numbers.amount, numbers.annualRate, numbers.minimum)
    if (!paid.ok) {
      const message = /interest/i.test(paid.error) ? 'Minimum payment needs to be higher' : paid.error
      return fail(/interest|50 years/i.test(paid.error) ? { minimum: message } : {}, paid.error)
    }
    const value = paid.value
    const end = formatMonthYear(addMonths(new Date(), value.payoffMonths))
    const paidResult = {
      ok: true,
      result: {
        headline: {
          label: 'Time to pay off',
          value: formatDuration(value.payoffMonths),
          detail: `Interest ${money(value.totalInterest)} · through ${end}`,
        },
        stats: [
          { label: 'Minimum payment', value: money(numbers.minimum) },
          { label: 'Total interest', value: money(value.totalInterest), tone: 'negative' },
          { label: 'Total paid', value: money(value.totalPaid) },
        ],
        chart: balanceChart(
          'Balance',
          value.balances,
          ['Now', formatDuration(value.payoffMonths)],
          undefined,
          'Remaining balance',
        ),
        schedule: scheduleFromRows(
          [
            { key: 'year', label: 'Year', align: 'left' },
            { key: 'payment', label: 'Payment', align: 'right' },
            { key: 'principal', label: 'Principal', align: 'right' },
            { key: 'interest', label: 'Interest', align: 'right' },
            { key: 'balance', label: 'Balance', align: 'right' },
          ],
          value.yearly.map((row) => ({
            year: String(row.year),
            payment: money(row.payment),
            principal: money(row.principal),
            interest: money(row.interest),
            balance: money(row.balance),
          })),
        ),
        formula: [
          'Each month, interest is added and the minimum payment is applied until the balance is gone.',
          'Monthly rate = APR / 12',
          '',
          `Balance = ${money(numbers.amount)}`,
          `APR = ${percentNumber(numbers.annualRate)}`,
          `Minimum payment = ${money(numbers.minimum)}`,
          `Payoff = ${formatDuration(value.payoffMonths)}`,
          `Total interest = ${money(value.totalInterest)}`,
        ],
        summary: `Payoff ${formatDuration(value.payoffMonths)}`,
        raw: {
          monthlyPayment: numbers.minimum,
          totalInterest: value.totalInterest,
          totalPaid: value.totalPaid,
          payoffMonths: value.payoffMonths,
        },
      },
    }
    rememberSuggestion(paidResult.result, installmentSuggestion(numbers.amount, numbers.annualRate))
    return paidResult
  }

  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'term')
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)

  const built = loanResult(numbers.amount, numbers.annualRate, months, numbers.extra, 'Monthly payment')
  if (!built.ok) return built
  rememberSuggestion(built.result, installmentSuggestion(numbers.amount, numbers.annualRate))
  return { ok: true, result: built.result }
}

function financedCar(numbers) {
  const taxable = Math.max(0, numbers.price - numbers.trade)
  const salesTax = taxable * numbers.tax / 100
  const amount = numbers.price - numbers.down - numbers.trade + numbers.tradeOwed + salesTax + numbers.fees
  return { taxable, salesTax, amount }
}

function computeCarLoan(values) {
  const calc = getCalculator('carloan')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'price', 'Enter a price greater than zero')
  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'term')
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)

  const { salesTax, amount } = financedCar(numbers)
  if (!(amount > 0)) {
    return fail({ down: 'Down payment and trade-in cover the price, tax, and fees' })
  }
  if (amount > 1e12) return fail({}, 'This is too large to calculate. Try a lower price.')

  const amortized = amortize(amount, numbers.annualRate, months, numbers.extra)
  if (!amortized.ok) return fail({}, amortized.error)
  const value = amortized.value
  const monthly = value.scheduled + numbers.extra
  const equity = numbers.trade - numbers.tradeOwed
  const stats = [
    { label: 'Amount financed', value: money(amount) },
    { label: 'Sales tax', value: money(salesTax) },
    { label: 'Down payment', value: money(numbers.down) },
  ]
  if (numbers.trade > 0 || numbers.tradeOwed > 0) {
    stats.push({ label: 'Trade-in equity', value: money(equity), tone: equity < 0 ? 'negative' : undefined })
  }
  if (numbers.extra > 0) stats.push({ label: 'Extra payment', value: money(numbers.extra) })
  stats.push(
    { label: 'Total interest', value: money(value.totalInterest), tone: 'negative' },
    { label: 'Total of payments', value: money(value.totalPaid) },
    { label: 'Total cost', value: money(numbers.down + value.totalPaid), tone: 'negative' },
  )

  const built = {
    ok: true,
    result: {
      headline: {
        label: 'Monthly payment',
        value: money(monthly),
        detail: `${money(amount)} financed · ${payoffDetail(months, value.payoffMonths)}`,
      },
      stats,
      chart: balanceChart('Balance', value.balances, ['Now', formatDuration(value.payoffMonths)], undefined, 'Remaining balance'),
      schedule: scheduleFromRows(
        [
          { key: 'year', label: 'Year', align: 'left' },
          { key: 'payment', label: 'Payment', align: 'right' },
          { key: 'principal', label: 'Principal', align: 'right' },
          { key: 'interest', label: 'Interest', align: 'right' },
          { key: 'balance', label: 'Balance', align: 'right' },
        ],
        value.yearly.map((row) => ({
          year: String(row.year),
          payment: money(row.payment),
          principal: money(row.principal),
          interest: money(row.interest),
          balance: money(row.balance),
        })),
      ),
      formula: [
        'Sales tax = (vehicle price − trade-in allowance) × tax rate',
        'Amount financed = price − down payment − trade-in + amount owed + sales tax + fees',
        'Monthly payment uses the standard loan formula on the amount financed.',
        'Monthly rate = APR / 12',
        '',
        `Vehicle price = ${money(numbers.price)}`,
        `Down payment = ${money(numbers.down)}`,
        `Trade-in allowance = ${money(numbers.trade)}`,
        `Owed on trade-in = ${money(numbers.tradeOwed)}`,
        `Sales tax = ${money(salesTax)}`,
        `Fees = ${money(numbers.fees)}`,
        `Amount financed = ${money(amount)}`,
        `APR = ${percentNumber(numbers.annualRate)}`,
        `Term = ${formatDuration(months)}`,
        `Monthly payment = ${money(monthly)}`,
        `Total interest = ${money(value.totalInterest)}`,
        '',
        'Tax uses the trade-in allowance as a credit. The payoff on the trade-in is financed and does not reduce the tax.',
      ],
      summary: `Monthly payment ${money(monthly)}`,
      raw: {
        amount,
        salesTax,
        monthly,
        totalInterest: value.totalInterest,
        totalPaid: value.totalPaid,
        totalCost: numbers.down + value.totalPaid,
        months: value.payoffMonths,
      },
    },
  }
  rememberSuggestion(built.result, carLoanSuggestion(numbers, salesTax))
  return built
}

function computeCarLease(values) {
  const calc = getCalculator('carlease')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'msrp', 'Enter an MSRP greater than zero')
  requirePositive(fieldErrors, numbers, 'price', 'Enter a price greater than zero')
  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'term')
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)

  const factor = values.rateKind === 'factor' ? numbers.factor : numbers.annualRate / 2400
  const residualValue = numbers.msrp * numbers.residual / 100
  const netCap = numbers.price - numbers.down - numbers.trade + numbers.tradeOwed + numbers.acquisition
  if (!(netCap > 0)) return fail({ down: 'Down payment and trade-in cover the price and fees' })
  if (netCap > 1e12) return fail({}, 'This is too large to calculate. Try a lower price.')

  const depreciation = (netCap - residualValue) / months
  const finance = (netCap + residualValue) * factor
  const pretax = depreciation + finance
  if (!(pretax >= 0) || !Number.isFinite(pretax)) {
    return fail({ residual: 'Residual is higher than the amount being leased' })
  }
  const monthly = pretax * (1 + numbers.tax / 100)
  if (monthly > 1e12) return fail({}, 'This is too large to calculate. Try a lower price.')
  const due = numbers.down + monthly
  const payments = monthly * months
  const total = due + monthly * (months - 1) + numbers.disposition
  const yearCount = Math.max(1, Math.ceil(months / 12))
  const rows = []
  const remaining = [payments]
  let covered = 0
  let cumulative = 0
  for (let year = 1; year <= yearCount; year += 1) {
    const inYear = Math.min(12, months - covered)
    const paid = monthly * inYear
    cumulative += paid
    remaining.push(payments - cumulative)
    rows.push({
      year: String(year),
      payment: money(monthly),
      paid: money(paid),
      cumulative: money(cumulative),
    })
    covered += inYear
  }

  const leaseResult = {
    ok: true,
    result: {
      headline: {
        label: 'Monthly payment',
        value: money(monthly),
        detail: `Due at signing ${money(due)} · ${formatDuration(months)} · residual ${money(residualValue)}`,
      },
      stats: [
        { label: 'Depreciation', value: money(depreciation) },
        { label: 'Finance charge', value: money(finance) },
        { label: 'Residual value', value: money(residualValue) },
        { label: 'Net cap cost', value: money(netCap) },
        { label: 'Due at signing', value: money(due) },
        { label: 'Disposition fee', value: money(numbers.disposition) },
        { label: 'Total lease cost', value: money(total), tone: 'negative' },
      ],
      chart: balanceChart('Remaining payments', remaining, ['Now', formatDuration(months)], undefined, 'Remaining payments'),
      schedule: scheduleFromRows(
        [
          { key: 'year', label: 'Year', align: 'left' },
          { key: 'payment', label: 'Monthly', align: 'right' },
          { key: 'paid', label: 'Paid', align: 'right' },
          { key: 'cumulative', label: 'Cumulative', align: 'right' },
        ],
        rows,
      ),
      formula: [
        'Residual value = MSRP × residual percent',
        'Net cap cost = negotiated price − down payment − trade-in + amount owed + acquisition fee',
        'Depreciation = (net cap cost − residual) / months',
        'Finance charge = (net cap cost + residual) × money factor',
        'Money factor = APR / 2,400',
        'Monthly payment = (depreciation + finance charge) × (1 + sales tax)',
        '',
        `MSRP = ${money(numbers.msrp)}`,
        `Negotiated price = ${money(numbers.price)}`,
        `Down payment = ${money(numbers.down)}`,
        `Trade-in = ${money(numbers.trade)}`,
        `Owed on trade-in = ${money(numbers.tradeOwed)}`,
        `Acquisition fee = ${money(numbers.acquisition)}`,
        `Net cap cost = ${money(netCap)}`,
        `Residual = ${percentNumber(numbers.residual)} of MSRP = ${money(residualValue)}`,
        `Money factor = ${plain(factor, 6)}`,
        `Depreciation = ${money(depreciation)}`,
        `Finance charge = ${money(finance)}`,
        `Sales tax = ${formatRate(numbers.tax)}`,
        `Monthly payment = ${money(monthly)}`,
        `Due at signing = ${money(due)}`,
        `Disposition fee = ${money(numbers.disposition)}`,
        `Total lease cost = ${money(total)}`,
        '',
        'Due at signing is the down payment plus the first monthly payment. The disposition fee is due when the car is returned.',
      ],
      summary: `Monthly payment ${money(monthly)}`,
      raw: {
        monthly,
        depreciation,
        finance,
        residualValue,
        netCap,
        factor,
        dueAtSigning: due,
        total,
        months,
      },
    },
  }
  rememberSuggestion(leaseResult.result, {
    payment: numbers.msrp * 0.01,
    note: 'Suggested payment is 1% of MSRP, a common target for a reasonable lease payment.',
  })
  return leaseResult
}

function padSeries(values, length) {
  const next = values.slice()
  while (next.length < length) next.push(0)
  return next
}

function computeRefinance(values) {
  const calc = getCalculator('refinance')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'balance', 'Enter a balance greater than zero')
  const remaining = termMonths(fieldErrors, numbers, 'remaining', 'remainingMonths', 'remainingDays', 'currentTerm')
  const nextTerm = termMonths(fieldErrors, numbers, 'newYears', 'newMonths', 'newDays', 'newTerm')
  if (Object.keys(fieldErrors).length || remaining === null || nextTerm === null) return fail(fieldErrors)

  const rolled = values.costsMode === 'rolled'
  const newPrincipal = numbers.balance + (rolled ? numbers.costs : 0)
  const current = amortize(numbers.balance, numbers.currentRate, remaining, 0)
  const next = amortize(newPrincipal, numbers.newRate, nextTerm, 0)
  if (!current.ok) return fail({}, current.error)
  if (!next.ok) return fail({}, next.error)

  const currentPayment = current.value.scheduled
  const newPayment = next.value.scheduled
  const savings = currentPayment - newPayment
  const lifetime = current.value.totalInterest - next.value.totalInterest - numbers.costs
  const breakEven = savings > 0.005 && numbers.costs > 0
    ? Math.ceil(numbers.costs / savings - 1e-9)
    : numbers.costs === 0 && savings > 0.005
      ? 0
      : null
  const longer = Math.max(current.value.balances.length, next.value.balances.length)
  const headline = savings > 0.005
    ? {
        label: 'Monthly savings',
        value: money(savings),
        tone: 'positive',
        detail: `New payment ${money(newPayment)} · current ${money(currentPayment)}`,
      }
    : savings < -0.005
      ? {
          label: 'Monthly increase',
          value: money(-savings),
          tone: 'negative',
          detail: `New payment ${money(newPayment)} · current ${money(currentPayment)}`,
        }
      : {
          label: 'Monthly payment',
          value: money(newPayment),
          detail: 'The new payment matches the current one.',
        }

  const refiResult = {
    ok: true,
    result: {
      headline,
      stats: [
        { label: 'Current payment', value: money(currentPayment) },
        { label: 'New payment', value: money(newPayment) },
        { label: 'Monthly savings', value: money(savings), tone: savings > 0.005 ? 'positive' : savings < -0.005 ? 'negative' : undefined },
        { label: 'Break-even', value: breakEven === null ? 'No monthly savings' : breakEven === 0 ? 'Immediate' : formatDuration(breakEven) },
        { label: 'Closing costs', value: money(numbers.costs) },
        { label: 'Lifetime savings', value: money(lifetime), tone: lifetime > 0.005 ? 'positive' : lifetime < -0.005 ? 'negative' : undefined },
      ],
      chart: {
        label: 'Balance over the longer term',
        series: [
          { name: 'Current', values: padSeries(current.value.balances, longer) },
          { name: 'New', values: padSeries(next.value.balances, longer) },
        ],
        xLabels: ['Now', formatDuration(Math.max(current.value.payoffMonths, next.value.payoffMonths))],
      },
      schedule: scheduleFromRows(
        [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'current', label: 'Current', align: 'right' },
          { key: 'next', label: 'New', align: 'right' },
        ],
        [
          { line: 'Payment', current: money(currentPayment), next: money(newPayment) },
          { line: 'Payoff', current: formatDuration(current.value.payoffMonths), next: formatDuration(next.value.payoffMonths) },
          { line: 'Interest', current: money(current.value.totalInterest), next: money(next.value.totalInterest) },
          {
            line: 'Total paid',
            current: money(current.value.totalPaid),
            next: money(next.value.totalPaid + (rolled ? 0 : numbers.costs)),
          },
        ],
      ),
      formula: [
        'Current payment uses the remaining balance, rate, and term.',
        'New payment uses the new rate and term.',
        rolled ? 'Closing costs are added to the new balance.' : 'Closing costs are paid at closing and are not added to the new balance.',
        'Break-even = closing costs / monthly savings',
        'Lifetime savings = current interest − new interest − closing costs',
        '',
        `Current balance = ${money(numbers.balance)}`,
        `Current payment = ${money(currentPayment)}`,
        `New balance = ${money(newPrincipal)}`,
        `New payment = ${money(newPayment)}`,
        `Monthly savings = ${money(savings)}`,
        `Closing costs = ${money(numbers.costs)}`,
        `Lifetime savings = ${money(lifetime)}`,
      ],
      summary: savings > 0.005 ? `Saves ${money(savings)} / month` : savings < -0.005 ? `Costs ${money(-savings)} more / month` : `Payment stays ${money(newPayment)}`,
      raw: {
        currentPayment,
        newPayment,
        savings,
        breakEvenMonths: breakEven,
        currentInterest: current.value.totalInterest,
        newInterest: next.value.totalInterest,
        lifetime,
        newPrincipal,
      },
    },
  }
  rememberSuggestion(refiResult.result, refinanceSuggestion(newPrincipal, numbers.newRate, nextTerm))
  return refiResult
}

function computeMortgage(values) {
  const calc = getCalculator('mortgage')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'price', 'Enter a home price greater than zero')
  if (!fieldErrors.down && !fieldErrors.price && numbers.down >= numbers.price) {
    fieldErrors.down = numbers.down > numbers.price
      ? 'Down payment is larger than the home price'
      : 'Down payment covers the full price'
  }
  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'term')
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)
  const va = values.loanType === 'va'
  const baseLoan = numbers.price - numbers.down
  const fundingFeeRate = va ? vaFundingRate(numbers.down, numbers.price, values.vaUse) : 0
  const fundingFee = Math.round(baseLoan * fundingFeeRate * 100) / 100
  const rollFee = va && fundingFee > 0 && values.vaFeeMode !== 'upfront'
  const loanAmount = baseLoan + (rollFee ? fundingFee : 0)
  const dueAtClosing = numbers.down + (rollFee ? 0 : fundingFee)

  const built = loanResult(loanAmount, numbers.annualRate, months, numbers.extra, 'Principal and interest')
  if (!built.ok) return built

  const taxMonth = numbers.tax / 12
  const insuranceMonth = numbers.insurance / 12
  const housing = built.monthly + taxMonth + insuranceMonth + numbers.hoa
  const downPercent = numbers.down / numbers.price
  const stats = [
    { label: 'Principal and interest', value: money(built.monthly) },
    { label: 'Property tax', value: money(taxMonth) },
    { label: 'Insurance', value: money(insuranceMonth) },
  ]
  if (numbers.hoa > 0) stats.push({ label: 'HOA', value: money(numbers.hoa) })
  stats.push(
    { label: 'Loan amount', value: money(loanAmount) },
    { label: 'Down payment', value: `${money(numbers.down)} · ${percentNumber(downPercent * 100)}` },
  )
  if (va) {
    stats.push({
      label: 'VA funding fee',
      value: `${money(fundingFee)} · ${percentNumber(fundingFeeRate * 100)}`,
    })
    if (!rollFee && fundingFee > 0) stats.push({ label: 'Due at closing', value: money(dueAtClosing) })
  }
  stats.push(
    { label: 'Total interest', value: money(built.value.totalInterest), tone: 'negative' },
    { label: 'Payoff', value: formatDuration(built.value.payoffMonths) },
  )
  const escrow = taxMonth + insuranceMonth + numbers.hoa
  const suggestion = mortgageSuggestion(numbers, months, escrow, { va, principal: loanAmount })
  if (suggestion) stats.push({ label: 'Suggested payment', value: money(suggestion.payment) })

  const formula = [
    ...built.result.formula,
    '',
    `Home price = ${money(numbers.price)}`,
    `Down payment = ${money(numbers.down)} (${percentNumber(downPercent * 100)})`,
    ...(va
      ? [
          `Loan before funding fee = ${money(baseLoan)}`,
          `VA funding fee = ${money(baseLoan)} × ${percentNumber(fundingFeeRate * 100)} = ${money(fundingFee)}`,
          rollFee
            ? `Loan amount = ${money(baseLoan)} + ${money(fundingFee)} = ${money(loanAmount)}`
            : `Loan amount = ${money(loanAmount)}`,
          vaFundingReason(numbers.down, numbers.price, values.vaUse),
          rollFee
            ? 'The funding fee is financed, so principal and interest include it. VA loans have no monthly mortgage insurance.'
            : fundingFee > 0
              ? 'The funding fee is paid at closing and is not part of the loan. VA loans have no monthly mortgage insurance.'
              : 'No funding fee is added. VA loans have no monthly mortgage insurance.',
        ]
      : [`Loan amount = ${money(loanAmount)}`]),
    `Taxes = ${money(taxMonth)} / month`,
    `Insurance = ${money(insuranceMonth)} / month`,
    `HOA = ${money(numbers.hoa)} / month`,
    `Monthly housing = ${money(housing)}`,
    ...(suggestion ? ['', suggestion.note] : []),
  ]

  return {
    ok: true,
    result: {
      ...built.result,
      headline: {
        label: 'Monthly housing',
        value: money(housing),
        detail: built.result.headline.detail,
      },
      stats,
      formula,
      summary: `Monthly housing ${money(housing)}`,
      raw: {
        ...built.result.raw,
        monthlyHousing: housing,
        loanAmount,
        baseLoan,
        fundingFee,
        fundingFeeRate,
        dueAtClosing,
        suggestedPayment: suggestion ? suggestion.payment : null,
      },
      schedule: {
        ...built.result.schedule,
        columns: built.result.schedule.columns.map((column) =>
          column.key === 'payment' ? { ...column, label: 'P&I' } : column,
        ),
      },
    },
  }
}

function savingsResult({ goal, current, annualRate, months, payment, mode }) {
  if (current >= goal) {
    const headline = mode === 'time'
      ? {
          label: 'Time to goal',
          value: 'Already saved',
          detail: `${money(current)} already covers ${money(goal)}.`,
        }
      : {
          label: 'Monthly deposit',
          value: money(0),
          detail: `${money(current)} already covers ${money(goal)}.`,
        }
    return {
      ok: true,
      result: {
        headline,
        stats: [
          { label: 'Already saved', value: money(current) },
          { label: 'Goal', value: money(goal) },
        ],
        chart: balanceChart('Balance', [current], ['Now', 'Now'], [{ value: goal, label: 'Goal' }], 'Savings'),
        schedule: compoundSchedule([]),
        formula: ['The amount already saved is at least the goal.', '', `Saved = ${money(current)}`, `Goal = ${money(goal)}`],
        summary: headline.value === 'Already saved' ? 'Goal already saved' : 'Monthly deposit $0.00',
        raw: { monthlyPayment: 0, months: 0, futureValue: current },
      },
    }
  }

  const monthlyRate = annualRate / 100 / 12
  const projected = projectMonthly(current, monthlyRate, payment, months)
  if (!projected.ok) return fail({}, projected.error)

  const date = formatMonthYear(addMonths(new Date(), months))
  const deposited = payment * months
  const interest = projected.value.futureValue - current - deposited
  const headline = mode === 'time'
    ? {
        label: 'Time to goal',
        value: formatDuration(months),
        detail: `Reaches ${money(goal)} in ${date}.`,
      }
    : {
        label: 'Monthly deposit',
        value: money(payment),
        detail: payment === 0
          ? `Growth alone reaches the goal within ${formatDuration(months)}.`
          : `Reaches ${money(goal)} in ${formatDuration(months)}.`,
      }

  const formula = annualRate === 0
    ? [
        'Rate is 0, so progress is the current savings plus deposits.',
        '',
        `Goal = ${money(goal)}`,
        `Already saved = ${money(current)}`,
        `Monthly deposit = ${money(payment)}`,
        `Months = ${months}`,
      ]
    : [
        'FV = PV(1 + r)^n + PMT · ((1 + r)^n − 1) / r',
        '',
        `Goal = ${money(goal)}`,
        `PV = ${money(current)}`,
        `r = ${sig(monthlyRate)} per month`,
        `n = ${months} months`,
        `PMT = ${money(payment)}`,
        '',
        'Deposits are added at the end of each month.',
        ...subscriptionFormula(),
      ]

  return {
    ok: true,
    result: {
      headline,
      stats: [
        { label: 'Projected balance', value: money(projected.value.futureValue) },
        { label: 'Deposits', value: money(deposited) },
        { label: 'Interest earned', value: money(interest), tone: interest > 0 ? 'positive' : undefined },
        { label: 'Annual return', value: percentNumber(annualRate) },
        ...subscriptionStat(),
      ],
      chart: {
        label: `Balance toward ${money(goal)}`,
        series: [{ name: 'Balance', values: projected.value.balances }],
        guides: [{ value: goal, label: 'Goal' }],
        xLabels: ['Now', formatDuration(months)],
      },
      schedule: compoundSchedule(projected.value.rows),
      formula,
      summary: mode === 'time' ? `Time to goal ${formatDuration(months)}` : `Monthly deposit ${money(payment)}`,
      raw: { monthlyPayment: payment, months, futureValue: projected.value.futureValue },
    },
  }
}

function computeSavings(values) {
  const calc = getCalculator('savings')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'goal', 'Enter a goal greater than zero')
  const mode = values.mode === 'payment' ? 'payment' : 'time'
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const monthlyRate = numbers.annualRate / 100 / 12
  if (mode === 'time') {
    const months = monthsToGoal(numbers.current, numbers.goal, monthlyRate, numbers.monthly, 1200)
    if (months === null) {
      return fail({}, 'This goal is not reached within 100 years. Increase the deposit or the return.')
    }
    return savingsResult({
      goal: numbers.goal,
      current: numbers.current,
      annualRate: numbers.annualRate,
      months,
      payment: numbers.monthly,
      mode,
    })
  }

  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'goalTime')
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)
  const payment = paymentForTarget(numbers.current, numbers.goal, monthlyRate, months)
  if (payment === null || !Number.isFinite(payment)) {
    return fail({}, 'Could not solve for a monthly deposit with these inputs.')
  }
  return savingsResult({
    goal: numbers.goal,
    current: numbers.current,
    annualRate: numbers.annualRate,
    months,
    payment,
    mode,
  })
}

function computeRetirement(values) {
  const calc = getCalculator('retirement')
  const { fieldErrors, numbers } = readFields(calc, values)
  if (!fieldErrors.retireAge && !fieldErrors.currentAge && numbers.retireAge <= numbers.currentAge) {
    fieldErrors.retireAge = 'Retirement age needs to be later than the current age'
  }
  const years = numbers.retireAge - numbers.currentAge
  if (!fieldErrors.retireAge && !fieldErrors.currentAge && years > 80) {
    fieldErrors.retireAge = 'Keep the horizon to 80 years or less'
  }
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const projected = projectCompound({
    principal: numbers.savings,
    annualRatePercent: numbers.annualRate,
    years,
    compoundsPerYear: 12,
    contribution: numbers.monthly,
    contributionFrequency: numbers.monthly > 0 ? 'monthly' : 'none',
  })
  if (!projected.ok) return fail({}, projected.error)

  const inflation = numbers.inflation / 100
  const realBalances = projected.value.balances.map((balance, index) => balance / (1 + inflation) ** projected.value.times[index])
  const realNestEgg = realBalances[realBalances.length - 1]
  const nominalNestEgg = projected.value.futureValue
  const annualWithdrawal = realNestEgg * (numbers.withdrawal / 100)
  const monthlyIncome = annualWithdrawal / 12
  const deposits = projected.value.totalContributed - numbers.savings

  const rows = projected.value.rows.map((row) => {
    const real = row.balance / (1 + inflation) ** row.elapsed
    return {
      year: String(row.year),
      age: formatAge(numbers.currentAge + row.elapsed),
      deposit: money(row.deposit),
      interest: money(row.interest),
      nominal: money(row.balance),
      real: money(real),
    }
  })

  const today = numbers.inflation > 0
  const stats = [
    { label: 'Monthly income', value: money(monthlyIncome), tone: monthlyIncome > 0 ? 'positive' : undefined },
    { label: 'Annual withdrawal', value: money(annualWithdrawal) },
  ]
  if (today) stats.push({ label: 'Nominal nest egg', value: money(nominalNestEgg) })
  stats.push(
    { label: 'Deposits', value: money(deposits) },
    { label: 'Years', value: formatYears(years) },
    { label: 'Withdrawal rate', value: percentNumber(numbers.withdrawal) },
  )
  const subLink = subscriptionLink()
  if (subLink) {
    const left = monthlyIncome - subLink.monthly
    stats.push({
      label: 'Income after subscriptions',
      value: money(left),
      tone: left >= 0 ? 'positive' : 'negative',
    })
  }

  return {
    ok: true,
    result: {
      headline: {
        label: today ? 'Nest egg in today’s dollars' : 'Nest egg',
        value: money(realNestEgg),
        detail: `${money(monthlyIncome)} per month ${today ? 'in today’s dollars' : 'at retirement'}`,
      },
      stats,
      chart: {
        label: 'Retirement balance in today’s dollars',
        series: [{ name: today ? 'Today’s dollars' : 'Balance', values: realBalances }],
        xLabels: [`Age ${formatAge(numbers.currentAge)}`, `Age ${formatAge(numbers.retireAge)}`],
      },
      schedule: scheduleFromRows(
        [
          { key: 'year', label: 'Year', align: 'left' },
          { key: 'age', label: 'Age', align: 'right' },
          { key: 'deposit', label: 'Deposits', align: 'right' },
          { key: 'interest', label: 'Interest', align: 'right' },
          { key: 'nominal', label: 'Nominal', align: 'right' },
          { key: 'real', label: 'Today’s $', align: 'right' },
        ],
        rows,
      ),
      formula: [
        'Balance compounds monthly at the nominal return.',
        'Today’s dollars = nominal balance / (1 + inflation)^years',
        'Withdrawal = today’s nest egg × withdrawal rate',
        '',
        `Current savings = ${money(numbers.savings)}`,
        `Monthly deposit = ${money(numbers.monthly)}`,
        `Nominal return = ${percentNumber(numbers.annualRate)}`,
        `Inflation = ${percentNumber(numbers.inflation)}`,
        `Years = ${plain(years, Number.isInteger(years) ? 0 : 2)}`,
        `Nest egg today = ${money(realNestEgg)}`,
        `Annual withdrawal = ${money(annualWithdrawal)}`,
        ...subscriptionFormula(),
      ],
      summary: `Nest egg ${money(realNestEgg)}`,
      raw: {
        realNestEgg,
        nominalNestEgg,
        annualWithdrawal,
        monthlyIncome,
      },
    },
  }
}

function openedCalculator(id) {
  if (!inputsDiffer(id)) return null
  const saved = programInputs?.[id]
  if (!saved) return null
  const outcome = getCalculator(id).compute(saved)
  if (!outcome.ok) return null
  return { saved, outcome }
}

function positiveAmount(saved, key) {
  const n = parseLooseNumber(saved?.[key])
  return n !== null && n > 0 ? n : 0
}

function linkedWorthItems() {
  const items = []
  const savings = openedCalculator('savings')
  const savedBalance = savings ? positiveAmount(savings.saved, 'current') : 0
  if (savedBalance > 0) items.push({ name: 'Savings', kind: 'asset', amount: savedBalance, note: 'Already saved' })

  const retirement = openedCalculator('retirement')
  const nest = retirement ? positiveAmount(retirement.saved, 'savings') : 0
  if (nest > 0) items.push({ name: 'Retirement', kind: 'asset', amount: nest, note: 'Current savings' })

  const mortgage = openedCalculator('mortgage')
  if (mortgage) {
    const price = positiveAmount(mortgage.saved, 'price')
    const loan = mortgage.outcome.result.raw.loanAmount
    if (price > 0) items.push({ name: 'Home', kind: 'asset', amount: price, note: 'Home price' })
    if (loan > 0) items.push({ name: 'Mortgage', kind: 'debt', amount: loan, note: 'Loan balance' })
  }

  const car = openedCalculator('carloan')
  if (car) {
    const price = positiveAmount(car.saved, 'price')
    const financed = car.outcome.result.raw.amount
    if (price > 0) items.push({ name: 'Vehicle', kind: 'asset', amount: price, note: 'Vehicle price' })
    if (financed > 0) items.push({ name: 'Car loan', kind: 'debt', amount: financed, note: 'Amount financed' })
  }

  const loan = openedCalculator('loan')
  const loanBalance = loan ? positiveAmount(loan.saved, 'amount') : 0
  if (loanBalance > 0) items.push({ name: 'Loan', kind: 'debt', amount: loanBalance, note: 'Loan amount' })

  const cards = openedCalculator('creditcard')
  if (cards) {
    parseLines(cards.saved.cards, cardBlank).forEach((row, index) => {
      const balance = parseLooseNumber(row.balance)
      if (balance === null || balance <= 0) return
      items.push({
        name: row.name.trim() || `Card ${index + 1}`,
        kind: 'debt',
        amount: balance,
        note: 'Card balance',
      })
    })
  }

  const rent = openedCalculator('rent')
  if (rent) {
    const deposit = positiveAmount(rent.saved, 'deposit')
    const monthly = rent.outcome.result.raw.monthlyHousing
    if (deposit > 0) items.push({ name: 'Security deposit', kind: 'asset', amount: deposit, note: 'Held on the lease' })
    if (monthly > 0) items.push({ name: 'Rent', kind: 'bill', amount: monthly, note: 'Monthly housing' })
  }

  const lease = openedCalculator('carlease')
  const leasePayment = lease ? lease.outcome.result.raw.monthly : 0
  if (leasePayment > 0) items.push({ name: 'Car lease', kind: 'bill', amount: leasePayment, note: 'Monthly payment' })

  const subscriptions = subscriptionLink()
  if (subscriptions && subscriptions.monthly > 0) {
    items.push({ name: 'Subscriptions', kind: 'bill', amount: subscriptions.monthly, note: 'Monthly total' })
  }

  const dti = openedCalculator('dti')
  if (dti) {
    parseLines(dti.saved.others, otherBlank).forEach((row) => {
      const amount = parseLooseNumber(row.amount)
      if (amount === null || amount <= 0) return
      items.push({
        name: row.comment.trim() || 'Other debt',
        kind: 'bill',
        amount,
        note: 'Other debts from Debt to income',
      })
    })
  }

  return items
}

function readWorthEntries(values, fieldErrors) {
  const rows = parseLines(values.entries, worthBlank)
  const items = []
  rows.forEach((row, index) => {
    const name = row.name.trim()
    const raw = String(row.amount ?? '').trim()
    if (!name && !raw) return
    const parsed = readNumeric(row.amount, false)
    const amount = parsed.value
    const key = `entries-${index}-amount`
    if (parsed.error) {
      fieldErrors[key] = parsed.error
      return
    }
    if (amount < 0) {
      fieldErrors[key] = 'Must be at least 0'
      return
    }
    if (amount === 0) return
    const kind = row.kind === 'debt' || row.kind === 'bill' ? row.kind : 'asset'
    items.push({
      name: name || (kind === 'asset' ? 'Asset' : kind === 'debt' ? 'Debt' : 'Bill'),
      kind,
      amount,
      note: 'Added here',
    })
  })
  return items
}

function computeDiminish(values) {
  const calc = getCalculator('diminish')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'cost', 'Enter a cost greater than zero')
  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'time')
  if (!fieldErrors.salvage && numbers.salvage !== undefined && numbers.cost !== undefined && numbers.salvage > numbers.cost) {
    fieldErrors.salvage = 'Salvage value cannot be more than the cost'
  }
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)

  const rate = numbers.rate / 100
  const years = months / 12
  const salvage = numbers.salvage
  const whole = Math.floor(years + 1e-9)
  const fraction = years - whole
  const slices = []
  for (let year = 1; year <= whole; year += 1) slices.push({ label: String(year), length: 1 })
  if (fraction > 1e-8) slices.push({ label: formatDuration(fraction * 12), length: fraction })

  let book = numbers.cost
  const rows = []
  for (const slice of slices) {
    const next = Math.max(salvage, book * (1 - rate) ** slice.length)
    rows.push({
      period: slice.label,
      opening: book,
      depreciation: book - next,
      closing: next,
    })
    book = next
  }
  const remaining = book
  const lost = numbers.cost - remaining
  const balances = [numbers.cost, ...rows.map((row) => row.closing)]
  const reachedSalvage = salvage > 0 && remaining <= salvage + 0.005 && lost + 0.005 < numbers.cost * (1 - (1 - rate) ** years)

  return {
    ok: true,
    result: {
      headline: {
        label: 'Remaining capital',
        value: money(remaining),
        detail: `${money(lost)} depreciated from ${money(numbers.cost)}`,
      },
      stats: [
        { label: 'Depreciation', value: money(lost), tone: lost > 0 ? 'negative' : undefined },
        { label: 'Rate', value: percentNumber(numbers.rate) },
        { label: 'Time', value: formatDuration(months) },
        { label: 'Salvage value', value: money(salvage) },
      ],
      chart: balanceChart(
        'Capital',
        balances,
        ['Start', formatDuration(months)],
        salvage > 0 ? [{ value: salvage, label: 'Salvage' }] : [],
        `Capital over ${formatDuration(months)}`,
      ),
      schedule: scheduleFromRows(
        [
          { key: 'period', label: 'Year', align: 'left' },
          { key: 'opening', label: 'Opening', align: 'right' },
          { key: 'depreciation', label: 'Depreciation', align: 'right' },
          { key: 'closing', label: 'Closing', align: 'right' },
        ],
        rows.map((row) => ({
          period: row.period,
          opening: money(row.opening),
          depreciation: money(row.depreciation),
          closing: money(row.closing),
        })),
      ),
      formula: [
        'Remaining capital = cost × (1 − rate)^years',
        'Depreciation for a full year = capital at the start of that year × rate',
        'A partial year uses the same rate for that fraction of a year.',
        'Remaining capital does not fall below the salvage value.',
        '',
        `Cost = ${money(numbers.cost)}`,
        `Rate = ${percentNumber(numbers.rate)}`,
        `Years = ${plain(years, Number.isInteger(years) ? 0 : 2)}`,
        `Salvage value = ${money(salvage)}`,
        `Remaining capital = ${money(remaining)}`,
        `Depreciation = ${money(lost)}`,
        '',
        'This is the reducing-balance formula. It is not a tax depreciation schedule.',
        ...(reachedSalvage ? ['The salvage value stopped depreciation before the rate alone would have.'] : []),
      ],
      summary: `Remaining capital ${money(remaining)}`,
      raw: { remaining, depreciation: lost, years, rate: numbers.rate },
    },
  }
}

function computeNetWorth(values) {
  const fieldErrors = {}
  const custom = readWorthEntries(values, fieldErrors)
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const items = [...linkedWorthItems(), ...custom]
  const assets = items.filter((item) => item.kind === 'asset').reduce((sum, item) => sum + item.amount, 0)
  const debts = items.filter((item) => item.kind === 'debt').reduce((sum, item) => sum + item.amount, 0)
  const monthly = items.filter((item) => item.kind === 'bill').reduce((sum, item) => sum + item.amount, 0)
  const net = assets - debts
  const afterYear = net - monthly * 12
  const kindLabel = { asset: 'Asset', debt: 'Debt', bill: 'Monthly bill' }
  const ordered = ['asset', 'debt', 'bill'].flatMap((kind) => items.filter((item) => item.kind === kind))
  const rows = ordered.length
    ? ordered.map((item) => ({
        item: item.name,
        kind: kindLabel[item.kind],
        amount: item.kind === 'bill' ? `${money(item.amount)} / month` : money(item.amount),
        note: item.note,
      }))
    : [{ item: 'Nothing counted yet', kind: '—', amount: '—', note: 'Change another calculator, or add a balance here.' }]

  const stats = [
    { label: 'Assets', value: money(assets), tone: assets > 0 ? 'positive' : undefined },
    { label: 'Debts', value: money(debts), tone: debts > 0 ? 'negative' : undefined },
    { label: 'Monthly bills', value: money(monthly), tone: monthly > 0 ? 'negative' : undefined },
  ]
  if (monthly > 0) {
    stats.push({
      label: 'After a year of bills',
      value: money(afterYear),
      tone: afterYear > 0.005 ? 'positive' : afterYear < -0.005 ? 'negative' : undefined,
    })
  }

  const formula = [
    'Net worth = assets − debts',
    'Monthly bills stay beside the balance. One year of those bills is shown on its own.',
    'A home counts as its price, and the mortgage counts as a debt, so the difference is the equity.',
    'A vehicle counts as its price, and the car loan counts as the amount financed.',
    '',
    ...ordered.map((item) => `${item.name} = ${item.kind === 'bill' ? `${money(item.amount)} / month` : money(item.amount)} (${item.note})`),
    '',
    `Assets = ${money(assets)}`,
    `Debts = ${money(debts)}`,
    `Net worth = ${money(net)}`,
    `Monthly bills = ${money(monthly)}`,
    `After a year of bills = ${money(afterYear)}`,
    '',
    'Balances are copied from calculators you have changed. The same dollars entered in two calculators are counted in both.',
  ]

  return {
    ok: true,
    result: {
      headline: {
        label: 'Net worth',
        value: money(net),
        tone: net > 0.005 ? 'positive' : net < -0.005 ? 'negative' : undefined,
        detail: ordered.length
          ? `${money(assets)} in assets · ${money(debts)} owed · ${money(monthly)} a month in bills`
          : 'Change Savings, Retirement, or another calculator and the balance shows up here.',
      },
      stats,
      chart: ordered.length
        ? {
            label: 'Assets down to net worth',
            series: [{ name: 'Balance', values: [assets, net] }],
            xLabels: ['Assets', 'Net worth'],
          }
        : null,
      schedule: scheduleFromRows(
        [
          { key: 'item', label: 'Item', align: 'left' },
          { key: 'kind', label: 'Kind', align: 'left' },
          { key: 'amount', label: 'Amount', align: 'right' },
          { key: 'note', label: 'Note', align: 'left' },
        ],
        rows,
      ),
      formula,
      summary: `Net worth ${money(net)}`,
      raw: { assets, debts, net, monthly, afterYear },
    },
  }
}

function formatFreeMonths(months) {
  const rounded = Math.round(months * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded)
  return rounded === 1 ? '1 month' : `${text} months`
}

function projectLease(rent, months, growth, extras, freeMonths = 0) {
  const rows = []
  const costs = []
  let totalRent = 0
  let totalHousing = 0
  let rentWaived = 0
  let covered = 0
  let freeLeft = freeMonths
  let year = 1
  while (covered < months) {
    const inYear = Math.min(12, months - covered)
    const yearRent = rent * (1 + growth) ** (year - 1)
    const monthly = yearRent + extras
    if (!Number.isFinite(monthly) || monthly > 1e15) return null
    const freeInYear = Math.min(freeLeft, inYear)
    const waived = yearRent * freeInYear
    const rentPaid = yearRent * (inYear - freeInYear)
    const housingPaid = rentPaid + extras * inYear
    totalRent += rentPaid
    totalHousing += housingPaid
    rentWaived += waived
    if (!Number.isFinite(totalHousing) || totalHousing > 1e15) return null
    rows.push({
      year,
      months: inYear,
      freeMonths: freeInYear,
      rent: yearRent,
      monthly,
      paid: housingPaid,
      cumulative: totalHousing,
    })
    costs.push(housingPaid / inYear)
    freeLeft -= freeInYear
    covered += inYear
    year += 1
  }
  return { rows, costs, totalRent, totalHousing, rentWaived }
}

function computeRent(values) {
  const calc = getCalculator('rent')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'rent', 'Enter a rent greater than zero')
  const months = termMonths(fieldErrors, numbers, 'years', 'months', 'days', 'lease')
  let freeMonths = 0
  if (values.promo === 'free') {
    const free = termMonths(fieldErrors, numbers, 'freeYears', 'freeMonths', 'freeDays', 'freeTerm')
    if (free !== null && months !== null && free > months) fieldErrors.freeTerm = 'Free time can’t be longer than the lease'
    else if (free !== null && !fieldErrors.freeTerm) freeMonths = free
  }
  if (Object.keys(fieldErrors).length || months === null) return fail(fieldErrors)

  const extras = numbers.insurance / 12 + numbers.utilities + numbers.parking + numbers.pet
  const projected = projectLease(numbers.rent, months, numbers.increase / 100, extras, freeMonths)
  if (!projected) return fail({}, 'This grows too large to calculate. Try a lower increase or a shorter lease.')

  const monthly = numbers.rent + extras
  const firstMonthRent = numbers.rent * Math.max(0, 1 - freeMonths)
  const moveIn = firstMonthRent + extras + numbers.deposit
  const effective = projected.totalHousing / months
  const finalMonthly = projected.rows[projected.rows.length - 1].monthly
  const end = formatMonthYear(addMonths(new Date(), months))
  const stats = [
    { label: 'Base rent', value: money(numbers.rent) },
    { label: 'Insurance', value: money(numbers.insurance / 12) },
    { label: 'Utilities', value: money(numbers.utilities) },
  ]
  if (numbers.parking > 0) stats.push({ label: 'Parking', value: money(numbers.parking) })
  if (numbers.pet > 0) stats.push({ label: 'Pet rent', value: money(numbers.pet) })
  if (freeMonths > 0) {
    stats.push(
      { label: 'Months rent free', value: formatFreeMonths(freeMonths) },
      { label: 'Rent waived', value: money(projected.rentWaived), tone: 'positive' },
    )
  }
  if (numbers.increase > 0) stats.push({ label: 'Monthly in the final year', value: money(finalMonthly) })
  stats.push(
    { label: 'Security deposit', value: money(numbers.deposit) },
    { label: 'Due at move-in', value: money(moveIn) },
    { label: 'Total over the lease', value: money(projected.totalHousing), tone: 'negative' },
    { label: 'Average monthly', value: money(effective) },
  )

  const scheduleColumns = [
    { key: 'year', label: 'Year', align: 'left' },
    { key: 'rent', label: 'Rent', align: 'right' },
    { key: 'monthly', label: 'Monthly', align: 'right' },
  ]
  if (freeMonths > 0) scheduleColumns.push({ key: 'free', label: 'Free', align: 'right' })
  scheduleColumns.push(
    { key: 'paid', label: 'Paid', align: 'right' },
    { key: 'cumulative', label: 'Cumulative', align: 'right' },
  )

  const formula = [
    'Monthly housing = rent + insurance / 12 + utilities + parking + pet rent',
    'Rent in year k = starting rent × (1 + annual increase)^(k − 1)',
    '',
    `Starting rent = ${money(numbers.rent)} / month`,
    `Insurance = ${money(numbers.insurance / 12)} / month`,
    `Utilities = ${money(numbers.utilities)} / month`,
    `Parking = ${money(numbers.parking)} / month`,
    `Pet rent = ${money(numbers.pet)} / month`,
    `Annual increase = ${formatRate(numbers.increase)}`,
    `Lease = ${formatDuration(months)}`,
    `Monthly housing = ${money(monthly)}`,
    `Due at move-in = ${money(moveIn)}`,
    `Total over the lease = ${money(projected.totalHousing)}`,
  ]
  if (freeMonths > 0) {
    formula.push(
      `Months rent free = ${formatFreeMonths(freeMonths)}`,
      `Rent waived = ${money(projected.rentWaived)}`,
      `Effective monthly = ${money(effective)}`,
      '',
      'Free months waive base rent at the start of the lease. Insurance, utilities, parking, and pet rent are still due.',
    )
  }
  formula.push('', 'The security deposit is due up front and is not included in the monthly housing cost.')

  return {
    ok: true,
    result: {
      headline: freeMonths > 0
        ? {
            label: 'Effective monthly',
            value: money(effective),
            detail: `Due at move-in ${money(moveIn)} · ${formatFreeMonths(freeMonths)} rent free · through ${end}`,
          }
        : {
            label: 'Monthly housing',
            value: money(monthly),
            detail: `Due at move-in ${money(moveIn)} · through ${end}`,
          },
      stats,
      chart: {
        label: 'Monthly housing over the lease',
        series: [{ name: 'Monthly cost', values: projected.costs }],
        xLabels: ['Year 1', projected.rows.length === 1 ? 'Year 1' : `Year ${projected.rows.length}`],
      },
      schedule: scheduleFromRows(
        scheduleColumns,
        projected.rows.map((row) => ({
          year: String(row.year),
          rent: money(row.rent),
          monthly: money(row.monthly),
          free: row.freeMonths > 0 ? formatFreeMonths(row.freeMonths) : '—',
          paid: money(row.paid),
          cumulative: money(row.cumulative),
        })),
      ),
      formula,
      summary: freeMonths > 0 ? `Effective monthly ${money(effective)}` : `Monthly housing ${money(monthly)}`,
      raw: {
        monthlyHousing: monthly,
        totalHousing: projected.totalHousing,
        totalRent: projected.totalRent,
        rentWaived: projected.rentWaived,
        effective,
        moveIn,
        months,
        freeMonths,
      },
    },
  }
}

function readSaleComment(fieldErrors, key, raw) {
  const comment = String(raw || '').trim()
  if (comment.length > 80) fieldErrors[key] = 'Keep the comment under 80 characters'
  return comment
}

function readSaleLine(item, index, fieldErrors) {
  const prefix = `item-${index}`
  const commentText = String(item.comment || '').trim()
  const priceText = String(item.price || '').trim()
  const quantityText = String(item.quantity || '').trim()
  if (!commentText && !priceText && !quantityText) return null
  const comment = readSaleComment(fieldErrors, `${prefix}-comment`, item.comment)
  const price = parseLooseNumber(item.price)
  if (price === null) fieldErrors[`${prefix}-price`] = 'Enter a number'
  else if (price <= 0) fieldErrors[`${prefix}-price`] = 'Enter a price greater than zero'
  else if (price > 1e12) fieldErrors[`${prefix}-price`] = 'Enter a smaller amount'
  const quantity = parseLooseNumber(item.quantity)
  if (quantity === null) fieldErrors[`${prefix}-quantity`] = 'Enter a number'
  else if (quantity <= 0) fieldErrors[`${prefix}-quantity`] = 'Enter a quantity greater than zero'
  else if (quantity > 1000000) fieldErrors[`${prefix}-quantity`] = 'Must be at most 1000000'
  if (fieldErrors[`${prefix}-comment`] || fieldErrors[`${prefix}-price`] || fieldErrors[`${prefix}-quantity`]) return null
  return { comment, price, quantity, amount: price * quantity }
}

function saleLineLabel(line, index, count) {
  const name = line.comment || (count === 1 ? 'Item price' : `Item ${index + 1}`)
  if (line.quantity === 1) return name
  const qty = plain(line.quantity, Number.isInteger(line.quantity) ? 0 : 2)
  return `${name} × ${qty}`
}

function computeSalesTax(values) {
  const calc = getCalculator('salestax')
  const entry = values.entry === 'list' ? 'list' : 'single'
  const { fieldErrors, numbers } = readFields(calc, values)
  let lines = []
  if (entry === 'single') {
    requirePositive(fieldErrors, numbers, 'price', 'Enter a price greater than zero')
    requirePositive(fieldErrors, numbers, 'quantity', 'Enter a quantity greater than zero')
    const comment = readSaleComment(fieldErrors, 'comment', values.comment)
    if (!fieldErrors.price && !fieldErrors.quantity && !fieldErrors.comment && numbers.price !== undefined && numbers.quantity !== undefined) {
      lines = [{ comment, price: numbers.price, quantity: numbers.quantity, amount: numbers.price * numbers.quantity }]
    }
  } else {
    parseSaleItems(values.items).forEach((item, index) => {
      const line = readSaleLine(item, index, fieldErrors)
      if (line) lines.push(line)
    })
  }
  const state = stateSalesTax.find((item) => item.code === values.state)
  if (!state) fieldErrors.state = 'Choose a state'
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0)
  const quantityTotal = lines.reduce((sum, line) => sum + line.quantity, 0)
  if (!Number.isFinite(subtotal) || subtotal > 1e15) return fail({}, 'This is too large to calculate. Try smaller prices.')
  const stateRate = state.rate / 100
  const localRate = numbers.local / 100
  const stateTax = subtotal * stateRate
  const localTax = subtotal * localRate
  const tax = stateTax + localTax
  const total = subtotal + tax
  const combined = state.rate + numbers.local
  const stats = [
    { label: 'Subtotal', value: money(subtotal) },
    { label: `${state.name} tax`, value: `${money(stateTax)} · ${formatRate(state.rate)}` },
  ]
  if (numbers.local > 0) stats.push({ label: 'Local tax', value: `${money(localTax)} · ${formatRate(numbers.local)}` })
  stats.push(
    { label: 'Sales tax', value: money(tax), tone: tax > 0 ? 'negative' : undefined },
    { label: 'Combined rate', value: formatRate(combined) },
  )

  const quantityLabel = quantityTotal === 1 ? '1 item' : `${plain(quantityTotal, Number.isInteger(quantityTotal) ? 0 : 2)} items`
  const note = lines.length === 1 ? lines[0].comment : ''
  const receipt = [
    ...(entry === 'list'
      ? lines.map((line, index) => ({ line: saleLineLabel(line, index, lines.length), amount: money(line.amount) }))
      : [
          { line: lines[0].comment || 'Item price', amount: money(lines[0].price) },
          { line: 'Quantity', amount: plain(lines[0].quantity, Number.isInteger(lines[0].quantity) ? 0 : 2) },
        ]),
    { line: 'Subtotal', amount: money(subtotal) },
    { line: `${state.name} tax`, amount: money(stateTax) },
    ...(numbers.local > 0 ? [{ line: 'Local tax', amount: money(localTax) }] : []),
    { line: 'Total', amount: money(total) },
  ]
  const formula = [
    entry === 'list' ? 'Subtotal = sum of each price × quantity' : 'Subtotal = price × quantity',
    'Tax = subtotal × (state rate + local rate)',
    'Total = subtotal + tax',
    '',
  ]
  if (entry === 'list') {
    lines.forEach((line, index) => {
      formula.push(`${saleLineLabel(line, index, lines.length)} = ${money(line.amount)}`)
    })
  } else {
    formula.push(`Price = ${money(lines[0].price)}`)
    formula.push(`Quantity = ${plain(lines[0].quantity, Number.isInteger(lines[0].quantity) ? 0 : 2)}`)
    if (lines[0].comment) formula.push(`Comment = ${lines[0].comment}`)
  }
  formula.push(
    `Subtotal = ${money(subtotal)}`,
    `${state.name} rate = ${formatRate(state.rate)}`,
    `Local rate = ${formatRate(numbers.local)}`,
    `Sales tax = ${money(tax)}`,
    `Total = ${money(total)}`,
    '',
    'Rates are statewide figures as of January 2026. City and county taxes are extra except where the state rate already includes a local tax charged everywhere.',
    'A comment is a note on the receipt. It is not taxed.',
  )

  return {
    ok: true,
    result: {
      headline: {
        label: 'Total price',
        value: money(total),
        detail: note
          ? `${note} · ${money(tax)} tax on ${quantityLabel} in ${state.name}`
          : `${money(tax)} tax on ${quantityLabel} in ${state.name}`,
      },
      stats,
      schedule: scheduleFromRows(
        [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'amount', label: 'Amount', align: 'right' },
        ],
        receipt,
      ),
      all: salesTaxAll(subtotal, numbers.local, state.code),
      formula,
      summary: `Total ${money(total)} in ${state.name}`,
      raw: {
        subtotal,
        stateTax,
        localTax,
        tax,
        total,
        rate: combined / 100,
        quantity: quantityTotal,
        lines: lines.length,
      },
    },
  }
}

function salesTaxAll(subtotal, localPercent, selectedCode) {
  const rows = stateSalesTax.map((item) => {
    const rate = item.rate + localPercent
    const tax = subtotal * rate / 100
    return {
      code: item.code,
      state: item.name,
      rate: formatRate(rate),
      tax: money(tax),
      total: money(subtotal + tax),
    }
  })
  const ordered = [...rows.filter((row) => row.code === selectedCode), ...rows.filter((row) => row.code !== selectedCode)]
  return scheduleFromRows(
    [
      { key: 'state', label: 'State', align: 'left' },
      { key: 'rate', label: 'Rate', align: 'right' },
      { key: 'tax', label: 'Tax', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
    ],
    ordered.map(({ state, rate, tax, total }) => ({ state, rate, tax, total })),
  )
}

function readCards(values) {
  const cards = []
  const blocking = {}
  const warnings = {}
  let anyRow = false
  parseLines(values.cards, cardBlank).forEach((row, index) => {
    const name = String(row.name || '').trim()
    const balanceText = String(row.balance || '').trim()
    const aprText = String(row.apr || '').trim()
    const minimumText = String(row.minimum || '').trim()
    if (!name && !balanceText && !aprText && !minimumText) return
    anyRow = true
    if (name.length > 40) blocking[`cards-${index}-name`] = 'Keep the name under 40 characters'
    const balanceParsed = readNumeric(row.balance, true)
    const aprParsed = readNumeric(row.apr, false)
    const minimumParsed = readNumeric(row.minimum, false)
    if (balanceParsed.error) blocking[`cards-${index}-balance`] = balanceParsed.error
    else if (balanceParsed.value <= 0) blocking[`cards-${index}-balance`] = 'Enter a balance greater than zero'
    else if (balanceParsed.value > 1e12) blocking[`cards-${index}-balance`] = 'Enter a smaller amount'
    if (aprParsed.error) blocking[`cards-${index}-apr`] = aprParsed.error
    else if (aprParsed.value < 0) blocking[`cards-${index}-apr`] = 'Must be at least 0'
    else if (aprParsed.value > 100) blocking[`cards-${index}-apr`] = 'Must be at most 100'
    if (minimumParsed.error) blocking[`cards-${index}-minimum`] = minimumParsed.error
    else if (minimumParsed.value < 0) blocking[`cards-${index}-minimum`] = 'Must be at least 0'
    else if (minimumParsed.value > 1e12) blocking[`cards-${index}-minimum`] = 'Enter a smaller amount'
    const balance = balanceParsed.value
    const apr = aprParsed.value
    const minimum = minimumParsed.value
    if (blocking[`cards-${index}-name`] || blocking[`cards-${index}-balance`] || blocking[`cards-${index}-apr`] || blocking[`cards-${index}-minimum`]) return
    const monthInterest = balance * apr / 100 / 12
    if (minimum <= 0 || (monthInterest > 0.004 && minimum <= monthInterest + 0.004)) {
      warnings[`cards-${index}-minimum`] = 'Minimum payment needs to be higher'
    }
    cards.push({
      name: name || `Card ${index + 1}`,
      balance,
      apr,
      minimum,
    })
  })
  return { cards, blocking, warnings, anyRow }
}

function paymentClearsWithin(cards, budget, method, months) {
  const paid = payOffCards(cards, budget, method, months)
  return paid.ok && paid.value.paidOff && paid.value.payoffMonths <= months
}

function suggestCardPayment(cards, method) {
  const minimums = cards.reduce((sum, card) => sum + card.minimum, 0)
  const payoffNow = cards.reduce((sum, card) => sum + card.balance * (1 + card.apr / 100 / 12), 0)
  let low = Math.ceil(minimums * 100) / 100
  let high = Math.max(low, Math.ceil(payoffNow * 100) / 100)
  if (!paymentClearsWithin(cards, high, method, 36)) return null
  if (paymentClearsWithin(cards, low, method, 36)) return low
  for (let step = 0; step < 40; step++) {
    const mid = Math.round(((low + high) / 2) * 100) / 100
    if (paymentClearsWithin(cards, mid, method, 36)) high = mid
    else low = mid
  }
  return high
}

function computeCreditCard(values) {
  const calc = getCalculator('creditcard')
  const { fieldErrors, numbers } = readFields(calc, values)
  const method = values.method === 'snowball' || values.method === 'minimums' ? values.method : 'avalanche'
  const { cards, blocking, warnings, anyRow } = readCards(values)
  if (method !== 'minimums') requirePositive(fieldErrors, numbers, 'payment', 'Enter a payment greater than zero')
  if (!cards.length) {
    return fail({
      ...fieldErrors,
      ...blocking,
      ...(anyRow ? {} : { 'cards-0-balance': 'Enter a number' }),
    })
  }
  if (Object.keys(fieldErrors).length) return fail({ ...fieldErrors, ...blocking, ...warnings })

  const minimums = cards.reduce((sum, card) => sum + card.minimum, 0)
  const paymentWarning = {}
  if (method !== 'minimums' && numbers.payment + 0.009 < minimums) {
    paymentWarning.payment = `Minimum payment needs to be higher. At least ${money(minimums)} covers every minimum.`
  }
  const budget = method === 'minimums' ? minimums : numbers.payment
  const paid = payOffCards(cards, budget, method)
  if (!paid.ok) return fail({ ...blocking, ...warnings, ...paymentWarning }, paid.error)
  if (!paid.value.paidOff && method !== 'minimums' && !paymentWarning.payment) {
    paymentWarning.payment = 'Minimum payment needs to be higher'
  }
  const planMethod = method === 'minimums' ? 'avalanche' : method
  const suggested = suggestCardPayment(cards, planMethod)
  const income = suggested == null ? null : suggested / 0.36
  const value = paid.value
  const end = value.paidOff ? formatMonthYear(addMonths(new Date(), value.payoffMonths)) : ''
  const methodName = method === 'snowball' ? 'Snowball' : method === 'minimums' ? 'Minimums' : 'Avalanche'
  const otherMethod = method === 'snowball' ? 'avalanche' : 'snowball'
  const other = method === 'minimums' ? null : payOffCards(cards, budget, otherMethod)
  const warning = paymentWarning.payment || (Object.keys(warnings).length ? 'Minimum payment needs to be higher' : '')
  const stats = [
    { label: 'Total balance', value: money(cards.reduce((sum, card) => sum + card.balance, 0)) },
    { label: 'Combined minimums', value: money(minimums) },
    { label: 'Monthly payment', value: money(budget) },
    { label: 'Total interest', value: money(value.totalInterest), tone: 'negative' },
  ]
  if (suggested != null) {
    stats.push(
      { label: 'Suggested payment', value: money(suggested) },
      { label: 'Income to handle it', value: money(income) },
    )
  }
  if (other?.ok && other.value.paidOff) {
    stats.push({
      label: otherMethod === 'avalanche' ? 'Avalanche interest' : 'Snowball interest',
      value: money(other.value.totalInterest),
    })
  }

  const shownErrors = { ...blocking, ...warnings, ...paymentWarning }
  return {
    ok: true,
    fieldErrors: shownErrors,
    result: {
      headline: {
        label: `${methodName} payoff`,
        value: value.paidOff ? formatDuration(value.payoffMonths) : 'Balance grows',
        tone: value.paidOff ? undefined : 'negative',
        detail: value.paidOff
          ? `Interest ${money(value.totalInterest)} · through ${end}`
          : `Still ${money(value.remaining)} after 50 years · interest ${money(value.totalInterest)}`,
        warning,
      },
      stats,
      chart: balanceChart(
        'Balance',
        value.balances,
        ['Now', value.paidOff ? formatDuration(value.payoffMonths) : '50 years'],
        undefined,
        'Remaining balance',
      ),
      schedule: scheduleFromRows(
        [
          { key: 'card', label: 'Card', align: 'left' },
          { key: 'balance', label: 'Balance', align: 'right' },
          { key: 'apr', label: 'APR', align: 'right' },
          { key: 'payoff', label: 'Payoff', align: 'right' },
          { key: 'interest', label: 'Interest', align: 'right' },
        ],
        value.cards.map((card) => ({
          card: card.name,
          balance: money(card.startingBalance),
          apr: percentNumber(card.apr),
          payoff: card.payoffMonths ? formatDuration(card.payoffMonths) : 'Not paid off',
          interest: money(card.interest),
        })),
      ),
      formula: [
        method === 'avalanche'
          ? 'Avalanche pays every minimum, then sends the rest to the highest APR.'
          : method === 'snowball'
            ? 'Snowball pays every minimum, then sends the rest to the smallest balance.'
            : 'Minimums pay each card’s minimum. A finished card’s payment is not rolled forward.',
        'When a card is paid off, avalanche and snowball roll its minimum into the next card.',
        'A blank card is skipped. A payment below the combined minimums is still projected.',
        'Monthly rate = APR / 12',
        '',
        ...cards.map((card) => `${card.name}: ${money(card.balance)} at ${percentNumber(card.apr)}, minimum ${money(card.minimum)}`),
        `Monthly payment = ${money(budget)}`,
        value.paidOff ? `Payoff = ${formatDuration(value.payoffMonths)}` : `Still owed after 50 years = ${money(value.remaining)}`,
        `Total interest = ${money(value.totalInterest)}`,
        ...(suggested == null
          ? ['A 3-year payoff could not be calculated for these cards.']
          : [
              `Suggested payment = ${money(suggested)} to finish in 3 years${method === 'minimums' ? ' with avalanche' : ''}`,
              `Income to handle it = suggested payment / 36% = ${money(income)}`,
            ]),
        ...(warning ? ['', warning] : []),
        '',
        'The suggested income is the gross monthly income that keeps the 3-year payment at 36% of income, the common lending target.',
      ],
      summary: value.paidOff ? `${methodName} payoff ${formatDuration(value.payoffMonths)}` : `${methodName} balance grows`,
      raw: {
        paidOff: value.paidOff,
        payoffMonths: value.payoffMonths,
        remaining: value.remaining,
        totalInterest: value.totalInterest,
        totalPaid: value.totalPaid,
        suggestedPayment: suggested,
        suggestedIncome: income,
        order: value.cards.map((card) => card.name),
      },
    },
  }
}

function computeDti(values) {
  const calc = getCalculator('dti')
  const { fieldErrors, numbers } = readFields(calc, values)
  const passive = []
  if (values.passiveMode === 'add') {
    const labels = Object.fromEntries(passiveKinds.map((kind) => [kind.value, kind.label]))
    parseLines(values.passive, { kind: 'rent', amount: '' }).forEach((row, index) => {
      if (!labels[row.kind]) fieldErrors[`passive-${index}-kind`] = 'Choose a source'
      const parsed = readNumeric(row.amount, false)
      if (parsed.error) fieldErrors[`passive-${index}-amount`] = parsed.error
      else if (parsed.value < 0) fieldErrors[`passive-${index}-amount`] = 'Must be at least 0'
      else if (parsed.value > 1e12) fieldErrors[`passive-${index}-amount`] = 'Enter a smaller amount'
      else if (parsed.value > 0 && !fieldErrors[`passive-${index}-kind`]) {
        passive.push({ kind: row.kind, label: labels[row.kind], amount: parsed.value })
      }
    })
  }
  const passiveTotal = passive.reduce((sum, row) => sum + row.amount, 0)
  const others = []
  const otherErrors = {}
  let untitled = 0
  parseLines(values.others, otherBlank).forEach((row, index) => {
    const comment = String(row.comment || '').trim()
    const amountText = String(row.amount || '').trim()
    if (!comment && !amountText) return
    if (comment.length > 80) otherErrors[`others-${index}-comment`] = 'Keep the comment under 80 characters'
    const parsed = readNumeric(row.amount, false)
    const amount = parsed.value
    if (parsed.error) otherErrors[`others-${index}-amount`] = parsed.error
    else if (parsed.value < 0) otherErrors[`others-${index}-amount`] = 'Must be at least 0'
    else if (parsed.value > 1e12) otherErrors[`others-${index}-amount`] = 'Enter a smaller amount'
    if (otherErrors[`others-${index}-comment`] || otherErrors[`others-${index}-amount`]) return
    if (!comment) untitled += 1
    others.push({
      label: comment || (untitled === 1 ? 'Other debts' : `Other debts ${untitled}`),
      amount,
    })
  })
  if (!fieldErrors.wages && numbers.wages !== undefined && numbers.wages + passiveTotal <= 0) {
    fieldErrors.wages = 'Enter income greater than zero'
  }
  const source = values.housingSource === 'mortgage' || values.housingSource === 'rent' || values.housingSource === 'amount'
    ? values.housingSource
    : 'auto'
  const link = source === 'amount' ? null : housingLink(source)
  if (link) delete fieldErrors.housing
  if ((source === 'mortgage' || source === 'rent') && !link) {
    fieldErrors.housingSource = source === 'mortgage'
      ? 'Enter a mortgage to use it here'
      : 'Enter a rent amount to use it here'
  }
  const subSource = values.subscriptionSource === 'amount' ? 'amount' : 'auto'
  if (subSource === 'auto') delete fieldErrors.subscriptions
  if (Object.keys(fieldErrors).length) return fail({ ...fieldErrors, ...otherErrors })

  const housing = link ? link.amount : numbers.housing
  const subLink = subSource === 'amount' ? null : subscriptionLink()
  const subscriptionPay = subLink ? subLink.monthly : subSource === 'amount' ? numbers.subscriptions : 0
  const income = numbers.wages + passiveTotal
  const housingLabel = link?.from === 'mortgage' ? 'Housing · Mortgage' : link?.from === 'rent' ? 'Housing · Rent' : 'Housing'
  const debtParts = [
    [housingLabel, housing],
    ['Auto', numbers.auto],
    ['Credit cards', numbers.cards],
    ['Student loans', numbers.student],
    ['Subscriptions', subscriptionPay],
    ...others.map((row) => [row.label, row.amount]),
  ]
  const debts = debtParts.reduce((sum, [, amount]) => sum + amount, 0)
  const ratio = debts / income
  const housingRatio = housing / income
  const tone = ratio <= 0.36 ? 'positive' : ratio > 0.43 ? 'negative' : undefined
  const stats = [
    { label: 'Wages', value: money(numbers.wages) },
  ]
  if (passiveTotal > 0) stats.push({ label: 'Passive income', value: money(passiveTotal), tone: 'positive' })
  stats.push(
    { label: 'Monthly income', value: money(income) },
    { label: 'Debt payments', value: money(debts), tone: debts > 0 ? 'negative' : undefined },
    { label: 'Housing ratio', value: percentNumber(housingRatio * 100) },
    { label: 'Suggested debt payment', value: money(income * 0.36) },
    { label: 'Suggested housing', value: money(income * 0.28) },
  )
  if (link) stats.push({ label: 'Housing from', value: link.from === 'mortgage' ? 'Mortgage' : 'Rent' })
  if (subLink) stats.push({ label: 'Subscriptions from', value: 'Subscriptions' })

  return {
    ok: true,
    result: {
      headline: {
        label: 'Debt-to-income',
        value: percentNumber(ratio * 100),
        detail: `${money(debts)} of monthly debt on ${money(income)} income`,
        tone,
      },
      stats,
      schedule: scheduleFromRows(
        [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'amount', label: 'Monthly', align: 'right' },
        ],
        [
          { line: 'Wages', amount: money(numbers.wages) },
          ...passive.map((row) => ({ line: row.label, amount: money(row.amount) })),
          { line: 'Income', amount: money(income) },
          ...debtParts.map(([label, amount]) => ({ line: label, amount: money(amount) })),
          { line: 'Debt payments', amount: money(debts) },
        ],
      ),
      formula: [
        'Debt-to-income = monthly debt payments / monthly income',
        'Monthly income = wages + passive income',
        'Housing ratio = housing payment / monthly income',
        '',
        `Wages = ${money(numbers.wages)}`,
        `Passive income = ${money(passiveTotal)}`,
        `Monthly income = ${money(income)}`,
        `Housing = ${money(housing)}${link ? ` from ${link.from}` : ''}`,
        `Subscriptions = ${money(subscriptionPay)}${subLink ? ' from Subscriptions' : ''}`,
        ...others.map((row) => `${row.label} = ${money(row.amount)}`),
        `Debt payments = ${money(debts)}`,
        `Debt-to-income = ${percentNumber(ratio * 100)}`,
        `Housing ratio = ${percentNumber(housingRatio * 100)}`,
        '',
        'A back-end ratio under 36% is a common lending target. 43% is a common upper line for a qualified mortgage.',
        `Suggested debt payment = 36% of income = ${money(income * 0.36)}`,
        `Suggested housing = 28% of income = ${money(income * 0.28)}`,
        'The 28% housing and 36% total-debt lines are the usual front-end and back-end lending targets.',
      ],
      summary: `Debt-to-income ${percentNumber(ratio * 100)}`,
      raw: {
        income,
        debts,
        ratio,
        housingRatio,
        housing,
        housingFrom: link?.from || '',
        passive: passiveTotal,
        subscriptions: subscriptionPay,
        subscriptionsFrom: subLink ? 'subscriptions' : '',
        suggestedDebt: income * 0.36,
        suggestedHousing: income * 0.28,
      },
    },
    fieldErrors: otherErrors,
  }
}

function formatIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!match) return iso || ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

function formatMoneyCode(amount, code) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${plain(amount, 2)} ${code}`
  }
}

function formatQuote(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return plain(n, 2)
  if (n >= 1) return plain(n, 4)
  return plain(n, n >= 0.01 ? 4 : 6)
}

function computeExchange(values) {
  const calc = getCalculator('exchange')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'amount', 'Enter an amount greater than zero')
  const snapshot = getExchangeState()
  if (snapshot.status !== 'ready') {
    return fail(fieldErrors, snapshot.status === 'error' ? snapshot.error : 'Loading exchange rates…')
  }
  const from = values.from
  const to = values.to
  if (!snapshot.rates[from]) fieldErrors.from = 'Choose a currency'
  if (!snapshot.rates[to]) fieldErrors.to = 'Choose a currency'
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const rate = snapshot.rates[to] / snapshot.rates[from]
  const converted = numbers.amount * rate
  if (!Number.isFinite(converted) || Math.abs(converted) > 1e15) {
    return fail({}, 'This amount is too large to convert.')
  }

  const query = String(values.query || '').trim().toLowerCase()
  let listed = snapshot.currencies.filter((currency) => currency.code !== from && snapshot.rates[currency.code] > 0)
  if (query) {
    listed = listed.filter((currency) => currency.name.toLowerCase().includes(query) || currency.code.toLowerCase().includes(query))
  }
  listed = [
    ...listed.filter((currency) => currency.code === to),
    ...listed.filter((currency) => currency.code !== to),
  ]
  const rows = listed.length
    ? listed.map((currency) => {
        const pair = snapshot.rates[currency.code] / snapshot.rates[from]
        return {
          currency: `${currency.name} · ${currency.code}`,
          amount: formatMoneyCode(numbers.amount * pair, currency.code),
          rate: formatQuote(pair),
        }
      })
    : [{ currency: 'No matching currencies', amount: '', rate: '' }]

  return {
    ok: true,
    result: {
      headline: {
        label: snapshot.currencies.find((currency) => currency.code === to)?.name || to,
        value: formatMoneyCode(converted, to),
        detail: `1 ${from} = ${formatQuote(rate)} ${to} · ${formatIsoDate(snapshot.date)}`,
      },
      stats: [
        { label: 'Amount', value: `${formatMoneyCode(numbers.amount, from)}` },
        { label: `${from} to ${to}`, value: formatQuote(rate) },
        { label: `${to} to ${from}`, value: formatQuote(rate === 0 ? NaN : 1 / rate) },
        { label: 'Currencies', value: plain(snapshot.currencies.length, 0) },
      ],
      schedule: scheduleFromRows(
        [
          { key: 'pair', label: 'Exchange', align: 'left' },
          { key: 'amount', label: 'Amount', align: 'right' },
          { key: 'rate', label: `Per 1 ${from}`, align: 'right' },
        ],
        [{
          pair: `${snapshot.currencies.find((currency) => currency.code === from)?.name || from} to ${snapshot.currencies.find((currency) => currency.code === to)?.name || to}`,
          amount: formatMoneyCode(converted, to),
          rate: formatQuote(rate),
        }],
      ),
      all: scheduleFromRows(
        [
          { key: 'currency', label: 'Currency', align: 'left' },
          { key: 'amount', label: 'Amount', align: 'right' },
          { key: 'rate', label: `Per 1 ${from}`, align: 'right' },
        ],
        rows,
      ),
      formula: [
        'Converted = amount × (target per USD) / (source per USD)',
        '',
        `Amount = ${formatMoneyCode(numbers.amount, from)}`,
        `${from} per USD = ${formatQuote(snapshot.rates[from])}`,
        `${to} per USD = ${formatQuote(snapshot.rates[to])}`,
        `1 ${from} = ${formatQuote(rate)} ${to}`,
        `Converted = ${formatMoneyCode(converted, to)}`,
        '',
        `Rates are daily mid-market figures for ${formatIsoDate(snapshot.date)}. They refresh while this page is open.`,
      ],
      summary: `${formatMoneyCode(converted, to)}`,
      raw: {
        converted,
        rate,
        amount: numbers.amount,
        listed: listed.length,
      },
    },
  }
}

function payBreakdown(regular, ot, doubleTime, rate) {
  const regularPay = regular * rate
  const otPay = ot * rate * 1.5
  const doublePay = doubleTime * rate * 2
  return {
    regular,
    ot,
    doubleTime,
    regularPay,
    otPay,
    doublePay,
    total: regularPay + otPay + doublePay,
  }
}

function weeklyOvertime(total, threshold = 40) {
  const ot = Math.max(0, total - threshold)
  return payBreakdown(total - ot, ot, 0, 1)
}

function dailyAndWeekly(days, cap) {
  let straight = 0
  let dailyOt = 0
  for (const hours of days) {
    straight += Math.min(hours, cap)
    dailyOt += Math.max(0, hours - cap)
  }
  const weeklyOt = Math.max(0, straight - 40)
  return { regular: straight - weeklyOt, ot: dailyOt + weeklyOt, doubleTime: 0 }
}

function californiaOvertime(days) {
  const workedAll = days.every((hours) => hours > 0)
  let regular = 0
  let ot = 0
  let doubleTime = 0
  days.forEach((hours, index) => {
    if (workedAll && index === 6) {
      ot += Math.min(hours, 8)
      doubleTime += Math.max(0, hours - 8)
      return
    }
    regular += Math.min(hours, 8)
    ot += Math.min(Math.max(0, hours - 8), 4)
    doubleTime += Math.max(0, hours - 12)
  })
  if (regular > 40) {
    ot += regular - 40
    regular = 40
  }
  return { regular, ot, doubleTime }
}

function coloradoOvertime(days) {
  const total = days.reduce((sum, hours) => sum + hours, 0)
  const daily = days.reduce((sum, hours) => sum + Math.max(0, hours - 12), 0)
  const weekly = Math.max(0, total - 40)
  const ot = Math.max(daily, weekly)
  return { regular: total - ot, ot, doubleTime: 0 }
}

function kentuckyOvertime(days) {
  const total = days.reduce((sum, hours) => sum + hours, 0)
  const weekly = Math.max(0, total - 40)
  const seventh = days.every((hours) => hours > 0) && total > 40 ? days[6] : 0
  const ot = Math.max(weekly, seventh)
  return { regular: total - ot, ot, doubleTime: 0 }
}

function paystubLine(raw, { gross, week, period, stubGross, asPercent }) {
  const entered = raw || 0
  if (asPercent) return gross * entered / 100
  if (stubGross > 0) return gross * entered / stubGross
  const perYear = STUB_PERIODS[period] || 1
  const annual = entered * perYear
  return week ? annual / 52 : annual
}

function deductionRates(items, gross) {
  const rate = (amount) => (gross > 0 ? amount / gross : 0)
  return {
    social: rate(items.social),
    medicare: rate(items.medicare),
    federal: rate(items.federal),
    stateTax: rate(items.stateTax),
    payroll: rate(items.payroll),
    traditional: rate(items.traditional),
    roth: rate(items.roth),
    health: rate(items.health),
    vision: rate(items.vision),
    dental: rate(items.dental),
    hsa: rate(items.hsa),
    other: rate(items.other),
  }
}

function payDeductions(values, numbers, gross, fieldErrors, { week, state }) {
  if (!TAX_STATE_CODES.includes(state)) {
    fieldErrors[week ? 'state' : 'taxState'] = 'Choose a state'
    return null
  }
  if (values.taxes === 'custom') {
    const asPercent = values.stubEntry === 'percent'
    const stubGross = asPercent ? 0 : (numbers.stubGross || 0)
    const period = values.stubPeriod || (week ? 'weekly' : 'annual')
    const line = (raw) => paystubLine(raw, { gross, week, period, stubGross, asPercent })
    const items = {
      social: line(asPercent ? numbers.socialRate : numbers.social),
      medicare: line(asPercent ? numbers.medicareRate : numbers.medicare),
      federal: line(asPercent ? numbers.federalRate : numbers.federal),
      stateTax: line(asPercent ? numbers.stateRate : numbers.stateTax),
      payroll: line(asPercent ? numbers.payrollRate : numbers.payroll),
      payrollName: 'State payroll tax',
      traditional: line(asPercent ? numbers.retirementRate : numbers.retirementAmount),
      roth: 0,
      health: line(asPercent ? numbers.healthRate : numbers.healthAmount),
      vision: line(asPercent ? numbers.visionRate : numbers.visionAmount),
      dental: line(asPercent ? numbers.dentalRate : numbers.dentalAmount),
      hsa: line(asPercent ? numbers.hsaRate : numbers.hsaAmount),
      other: line(asPercent ? numbers.otherRate : numbers.otherAmount),
    }
    const sum = items.social + items.medicare + items.federal + items.stateTax + items.payroll
      + items.traditional + items.health + items.vision + items.dental + items.hsa + items.other
    if (sum > gross + 0.004) {
      fieldErrors[asPercent ? 'socialRate' : 'social'] = 'These amounts are larger than pay'
      return null
    }
    return {
      ...items,
      rates: deductionRates(items, gross),
      preTax: items.health + items.vision + items.dental + items.hsa + items.other,
      takeHome: gross - sum,
      capped: false,
      estimated: false,
      fromPercent: asPercent,
      fromStub: stubGross > 0,
      stateLabel: '',
    }
  }

  const monthly = {
    health: numbers.health || 0,
    vision: numbers.vision || 0,
    dental: numbers.dental || 0,
    hsa: numbers.hsa || 0,
    other: numbers.other || 0,
  }
  const annualPreTax = (monthly.health + monthly.vision + monthly.dental + monthly.hsa + monthly.other) * 12
  const annualGross = week ? gross * 52 : gross
  const requested = annualGross * ((numbers.retirement || 0) / 100)
  const allowed = Math.min(requested, RETIREMENT_LIMIT)
  const roth = values.retirementKind === 'roth'
  const figured = figureTaxes({
    gross: annualGross,
    filing: values.filing,
    state,
    preTax: annualPreTax,
    traditional: roth ? 0 : allowed,
    roth: roth ? allowed : 0,
  })
  if (figured.error) {
    fieldErrors[annualPreTax > 0 ? 'health' : 'retirement'] = figured.error
    return null
  }
  const scale = week ? 1 / 52 : 1
  const year = (amount) => amount * 12 * scale
  const items = {
    social: figured.social * scale,
    medicare: figured.medicare * scale,
    federal: figured.federal * scale,
    stateTax: figured.stateTax * scale,
    payroll: figured.payroll * scale,
    traditional: figured.traditional * scale,
    roth: figured.roth * scale,
    health: year(monthly.health),
    vision: year(monthly.vision),
    dental: year(monthly.dental),
    hsa: year(monthly.hsa),
    other: year(monthly.other),
  }
  return {
    ...items,
    rates: deductionRates(items, gross),
    payrollName: figured.payrollName,
    preTax: figured.preTax * scale,
    takeHome: figured.takeHome * scale,
    capped: requested > RETIREMENT_LIMIT + 0.004,
    estimated: true,
    fromPercent: false,
    fromStub: false,
    stateLabel: stateTaxDetail(state),
  }
}

function deductionShare(amount, rate) {
  const pct = (rate || 0) * 100
  const digits = Math.abs(pct - Math.round(pct)) < 0.001 ? 0 : 2
  return `${money(amount)} · ${percentNumber(pct, digits)}`
}

function deductionStats(tax) {
  const rows = [
    ['Social Security', tax.social, 'social'],
    ['Medicare', tax.medicare, 'medicare'],
    ['Federal income tax', tax.federal, 'federal'],
    ['State income tax', tax.stateTax, 'stateTax'],
  ]
  if (tax.payroll > 0.004) rows.push([tax.payrollName || 'State payroll tax', tax.payroll, 'payroll'])
  if (tax.traditional > 0.004) rows.push(['401(k)', tax.traditional, 'traditional'])
  if (tax.roth > 0.004) rows.push(['Roth 401(k)', tax.roth, 'roth'])
  for (const [label, amount, key] of [
    ['Health insurance', tax.health, 'health'],
    ['Vision', tax.vision, 'vision'],
    ['Dental', tax.dental, 'dental'],
    ['HSA', tax.hsa, 'hsa'],
    ['Other', tax.other, 'other'],
  ]) {
    if (amount > 0.004) rows.push([label, amount, key])
  }
  return rows.map(([label, amount, key]) => ({
    label,
    value: amount > 0.004 ? deductionShare(amount, tax.rates?.[key]) : money(amount),
    tone: amount > 0.004 ? 'negative' : undefined,
  }))
}

function deductionLine(label, amount, rate) {
  if (!(amount > 0.004)) return `${label} = ${money(amount)}`
  return `${label} = ${deductionShare(amount, rate)} of gross`
}

function deductionFormula(tax, filingLabel) {
  const lines = [
    tax.estimated
      ? 'Social Security is 6.2% of wages up to $184,500. Medicare is 1.45%, plus 0.9% of wages over $200,000.'
      : tax.fromPercent
        ? 'Percents from the paystub are multiplied by this gross pay.'
        : tax.fromStub
          ? 'Each paystub line is divided by the paystub gross. That percent is applied to this pay.'
          : 'Paystub amounts are scaled to this pay, then shown as a percent of gross.',
    tax.estimated ? 'A traditional 401(k) lowers income tax and stays subject to Social Security and Medicare. Health, vision, dental, HSA, and other pre-tax amounts lower both.' : '',
    tax.estimated ? tax.stateLabel : '',
    tax.estimated ? `Filing status = ${filingLabel}` : '',
    deductionLine('Social Security', tax.social, tax.rates?.social),
    deductionLine('Medicare', tax.medicare, tax.rates?.medicare),
    deductionLine('Federal income tax', tax.federal, tax.rates?.federal),
    deductionLine('State income tax', tax.stateTax, tax.rates?.stateTax),
    tax.payroll > 0.004 ? deductionLine(tax.payrollName || 'State payroll tax', tax.payroll, tax.rates?.payroll) : '',
    tax.traditional > 0.004 ? deductionLine('401(k)', tax.traditional, tax.rates?.traditional) : '',
    tax.roth > 0.004 ? deductionLine('Roth 401(k)', tax.roth, tax.rates?.roth) : '',
    tax.preTax > 0.004 ? deductionLine('Pre-tax benefits', tax.preTax, (tax.rates?.health || 0) + (tax.rates?.vision || 0) + (tax.rates?.dental || 0) + (tax.rates?.hsa || 0) + (tax.rates?.other || 0)) : '',
    `Take-home = ${money(tax.takeHome)}`,
    tax.capped ? `401(k) is capped at ${money(RETIREMENT_LIMIT)} for 2026.` : '',
    tax.estimated ? 'This leaves out local tax, dependent exemptions, credits, and phaseouts. It is a planning estimate.' : '',
  ]
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '')
}

function filingLabel(value) {
  if (value === 'married') return 'Married'
  if (value === 'head') return 'Head of household'
  return 'Single'
}

function subscriptionComment(row, index, fieldErrors) {
  const comment = String(row.comment || '').trim()
  if (comment.length > 80) fieldErrors[`services-${index}-comment`] = 'Keep the comment under 80 characters'
  return comment
}

function readSubscriptionPrice(row, index, fieldErrors) {
  const parsed = readNumeric(row.price, false)
  if (parsed.error) fieldErrors[`services-${index}-price`] = parsed.error
  else if (parsed.value < 0) fieldErrors[`services-${index}-price`] = 'Must be at least 0'
  else if (parsed.value > 1e12) fieldErrors[`services-${index}-price`] = 'Enter a smaller amount'
  return parsed.value
}

function computeSubscriptions(values) {
  const rows = parseLines(values.services, { service: 'custom', name: '', price: '', comment: '' })
  const fieldErrors = {}
  const picked = []
  rows.forEach((row, index) => {
    const comment = subscriptionComment(row, index, fieldErrors)
    if (row.service === 'custom') {
      const name = String(row.name || '').trim()
      const priceText = String(row.price || '').trim()
      if (!name && !priceText && !comment) return
      if (!name) fieldErrors[`services-${index}-name`] = 'Name this subscription'
      else if (name.length > 80) fieldErrors[`services-${index}-name`] = 'Keep the name under 80 characters'
      const price = readSubscriptionPrice(row, index, fieldErrors)
      if (!fieldErrors[`services-${index}-name`] && !fieldErrors[`services-${index}-price`] && !fieldErrors[`services-${index}-comment`]) {
        picked.push({ name, monthly: price, note: comment || 'Custom price' })
      }
      return
    }
    const service = subscriptionById(row.service)
    if (!service) {
      fieldErrors[`services-${index}-service`] = 'Choose a subscription'
      return
    }
    const quote = quoteSubscription(service, values.discount, values.billing)
    const typed = String(row.price || '').trim()
    let monthly = quote.monthly
    let note = comment || quote.note
    if (typed) {
      const price = readSubscriptionPrice(row, index, fieldErrors)
      if (!fieldErrors[`services-${index}-price`]) {
        monthly = price
        note = comment || 'Your price'
      }
    }
    if (!fieldErrors[`services-${index}-price`] && !fieldErrors[`services-${index}-comment`]) {
      picked.push({ name: service.name, monthly, note })
    }
  })
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)
  const monthly = picked.reduce((sum, row) => sum + row.monthly, 0)
  const discountLabel = values.discount === 'student' ? 'Student' : values.discount === 'military' ? 'Military' : values.discount === 'responder' ? 'First responder' : 'Full price'
  return {
    ok: true,
    result: {
      headline: {
        label: 'Monthly total',
        value: money(monthly),
        detail: `${picked.length} ${picked.length === 1 ? 'subscription' : 'subscriptions'} · ${discountLabel}`,
      },
      stats: [
        { label: 'Yearly', value: money(monthly * 12) },
        { label: 'Count', value: String(picked.length) },
      ],
      schedule: scheduleFromRows(
        [
          { key: 'service', label: 'Service', align: 'left' },
          { key: 'monthly', label: 'Price', align: 'right' },
          { key: 'note', label: 'Note', align: 'left' },
        ],
        picked.length
          ? picked.map((row) => ({ service: row.name, monthly: money(row.monthly), note: row.note }))
          : [{ service: 'No subscriptions', monthly: money(0), note: '' }],
      ),
      all: subscriptionAll(values.discount, values.billing),
      formula: [
        'Monthly total = sum of each subscription at the selected price.',
        'A typed price replaces the list price. Clear it to use the list price again.',
        'Annual billing uses the yearly list price divided by 12.',
        '',
        ...picked.map((row) => `${row.name} = ${money(row.monthly)} (${row.note})`),
        `Monthly total = ${money(monthly)}`,
        `Yearly = ${money(monthly * 12)}`,
        '',
        'Prices are US list prices before tax. A service without a student, military, or first responder price stays at full price.',
      ],
      summary: `Subscriptions ${money(monthly)} a month`,
      raw: { monthly, yearly: monthly * 12, count: picked.length },
    },
  }
}

function subscriptionAll(discount, billing) {
  return scheduleFromRows(
    [
      { key: 'service', label: 'Service', align: 'left' },
      { key: 'plan', label: 'Plan', align: 'left' },
      { key: 'price', label: 'Price', align: 'right' },
      { key: 'note', label: 'Note', align: 'left' },
    ],
    subscriptionCatalog.map((service) => {
      const quote = quoteSubscription(service, discount, billing)
      return {
        service: `${service.group} · ${service.name}`,
        plan: service.plan,
        price: money(quote.monthly),
        note: quote.note,
      }
    }),
  )
}

function wageAllStates(values, numbers, annual) {
  if (values.taxes === 'custom') return null
  const annualPreTax = ((numbers.health || 0) + (numbers.vision || 0) + (numbers.dental || 0) + (numbers.hsa || 0) + (numbers.other || 0)) * 12
  const allowed = Math.min(annual * ((numbers.retirement || 0) / 100), RETIREMENT_LIMIT)
  const roth = values.retirementKind === 'roth'
  const listed = stateNames.flatMap(([code, name]) => {
    const figured = figureTaxes({
      gross: annual,
      filing: values.filing,
      state: code,
      preTax: annualPreTax,
      traditional: roth ? 0 : allowed,
      roth: roth ? allowed : 0,
    })
    if (figured.error) return []
    return [{ code, state: name, stateTax: money(figured.stateTax), takeHome: money(figured.takeHome) }]
  })
  const ordered = [...listed.filter((row) => row.code === values.taxState), ...listed.filter((row) => row.code !== values.taxState)]
  return scheduleFromRows(
    [
      { key: 'state', label: 'State', align: 'left' },
      { key: 'stateTax', label: 'State income tax', align: 'right' },
      { key: 'takeHome', label: 'Take-home', align: 'right' },
    ],
    ordered.map(({ state, stateTax, takeHome }) => ({ state, stateTax, takeHome })),
  )
}

const FULL_TIME_HOURS = 8 * 5 * 52

function wageFromAnnual(annual, hoursPerDay, daysPerWeek, weeks) {
  const hoursPerYear = hoursPerDay * daysPerWeek * weeks
  const hourly = annual / hoursPerYear
  const daily = hourly * hoursPerDay
  const weekly = daily * daysPerWeek
  return {
    hoursPerYear,
    workdays: daysPerWeek * weeks,
    hourly,
    daily,
    weekly,
    biweekly: weekly * 2,
    semimonthly: annual / 24,
    monthly: annual / 12,
    annual,
    timeAndHalf: hourly * 1.5,
    doubleTime: hourly * 2,
    fullTimeHourly: annual / FULL_TIME_HOURS,
  }
}

function annualFromPayRate(values, numbers) {
  const hoursPerWeek = numbers.hoursPerDay * numbers.daysPerWeek
  if (values.mode === 'hourly') return numbers.rate * hoursPerWeek * numbers.weeks
  if (values.mode === 'daily') return numbers.daily * numbers.daysPerWeek * numbers.weeks
  if (values.mode === 'weekly') return numbers.weekly * numbers.weeks
  if (values.mode === 'monthly') return numbers.monthly * 12
  return numbers.salary
}

function computePayRate(values) {
  const calc = getCalculator('payrate')
  const { fieldErrors, numbers } = readFields(calc, values)
  const amountKey = { salary: 'salary', hourly: 'rate', daily: 'daily', weekly: 'weekly', monthly: 'monthly' }[values.mode]
  if (!amountKey) return fail(fieldErrors, 'Choose a starting pay.')
  requirePositive(fieldErrors, numbers, amountKey, 'Enter an amount greater than zero')
  if (!fieldErrors.hoursPerDay && numbers.hoursPerDay === 0) fieldErrors.hoursPerDay = 'Enter hours greater than zero'
  if (!fieldErrors.daysPerWeek && numbers.daysPerWeek === 0) fieldErrors.daysPerWeek = 'Enter at least 1 day'
  if (!fieldErrors.weeks && numbers.weeks === 0) fieldErrors.weeks = 'Enter at least 1 week'
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const annual = annualFromPayRate(values, numbers)
  const pay = wageFromAnnual(annual, numbers.hoursPerDay, numbers.daysPerWeek, numbers.weeks)
  if (!Number.isFinite(pay.hourly)) return fail({}, 'Could not convert this pay.')
  const raisedAnnual = annual * (1 + numbers.raise / 100)
  const raised = numbers.raise > 0 ? wageFromAnnual(raisedAnnual, numbers.hoursPerDay, numbers.daysPerWeek, numbers.weeks) : null
  const salaryMode = values.mode === 'salary'
  const periods = [
    ['Hourly', pay.hourly, raised?.hourly],
    ['Daily', pay.daily, raised?.daily],
    ['Weekly', pay.weekly, raised?.weekly],
    ['Biweekly', pay.biweekly, raised?.biweekly],
    ['Semimonthly', pay.semimonthly, raised?.semimonthly],
    ['Monthly', pay.monthly, raised?.monthly],
    ['Annual', pay.annual, raised?.annual],
  ]
  const stats = [
    { label: 'Daily', value: money(pay.daily) },
    { label: 'Weekly', value: money(pay.weekly) },
    { label: 'Monthly', value: money(pay.monthly) },
    { label: salaryMode ? 'Annual' : 'Hourly', value: money(salaryMode ? pay.annual : pay.hourly) },
    { label: 'Workdays a year', value: plain(pay.workdays, Number.isInteger(pay.workdays) ? 0 : 2) },
    { label: 'Hours a year', value: plain(pay.hoursPerYear, Number.isInteger(pay.hoursPerYear) ? 0 : 2) },
    { label: 'Time and a half', value: money(pay.timeAndHalf) },
    { label: 'Double time', value: money(pay.doubleTime) },
  ]
  if (pay.hoursPerYear !== FULL_TIME_HOURS) {
    stats.push({ label: 'Full-time hourly', value: money(pay.fullTimeHourly) })
  }
  if (raised) {
    stats.push({ label: `After a ${plain(numbers.raise, Number.isInteger(numbers.raise) ? 0 : 2)}% raise`, value: money(raised.annual) })
    stats.push({ label: 'Raised hourly', value: money(raised.hourly) })
  }
  const scheduleColumns = [
    { key: 'period', label: 'Period', align: 'left' },
    { key: 'pay', label: 'Pay', align: 'right' },
  ]
  if (raised) scheduleColumns.push({ key: 'raised', label: 'After raise', align: 'right' })
  const formula = [
    values.mode === 'hourly'
      ? 'Annual = hourly × hours per day × days per week × weeks per year'
      : values.mode === 'daily'
        ? 'Annual = daily pay × days per week × weeks per year'
        : values.mode === 'weekly'
          ? 'Annual = weekly pay × weeks per year'
          : values.mode === 'monthly'
            ? 'Annual = monthly pay × 12'
            : 'The salary is the annual pay.',
    'Hourly = annual / (hours per day × days per week × weeks per year)',
    'Daily = hourly × hours per day',
    'Weekly = daily × days per week',
    'Biweekly = weekly × 2',
    'Semimonthly = annual / 24',
    'Monthly = annual / 12',
    'Time and a half = hourly × 1.5. Double time = hourly × 2. These are comparisons, not a state overtime rule.',
    '',
    `Annual = ${money(pay.annual)}`,
    `Hours a year = ${plain(pay.hoursPerYear, Number.isInteger(pay.hoursPerYear) ? 0 : 2)}`,
    `Hourly = ${money(pay.hourly)}`,
    `Daily = ${money(pay.daily)}`,
    `Weekly = ${money(pay.weekly)}`,
    `Monthly = ${money(pay.monthly)}`,
  ]
  if (pay.hoursPerYear === FULL_TIME_HOURS) {
    formula.push('This schedule is 2,080 hours, the usual full-time year of 8 hours, 5 days, and 52 weeks.')
  } else {
    formula.push(`The same annual pay over a 2,080-hour year is ${money(pay.fullTimeHourly)} an hour.`)
  }
  if (raised) formula.push(`A ${plain(numbers.raise, Number.isInteger(numbers.raise) ? 0 : 2)}% raise makes annual pay ${money(raised.annual)} and hourly pay ${money(raised.hourly)}.`)

  return {
    ok: true,
    result: {
      headline: {
        label: salaryMode ? 'Hourly' : 'Annual salary',
        value: money(salaryMode ? pay.hourly : pay.annual),
        detail: `${plain(numbers.hoursPerDay, Number.isInteger(numbers.hoursPerDay) ? 0 : 2)} hours a day · ${plain(numbers.daysPerWeek, Number.isInteger(numbers.daysPerWeek) ? 0 : 2)} days a week · ${plain(numbers.weeks, Number.isInteger(numbers.weeks) ? 0 : 2)} weeks`,
      },
      stats,
      schedule: scheduleFromRows(
        scheduleColumns,
        periods.map(([period, amount, raisedAmount]) => ({
          period,
          pay: money(amount),
          raised: raised ? money(raisedAmount) : '',
        })),
      ),
      formula,
      summary: salaryMode ? `Hourly ${money(pay.hourly)}` : `Annual salary ${money(pay.annual)}`,
      raw: {
        ...pay,
        raise: numbers.raise,
        raisedAnnual: raised?.annual ?? null,
        raisedHourly: raised?.hourly ?? null,
      },
    },
  }
}

function computeWage(values) {
  const calc = getCalculator('wage')
  const { fieldErrors, numbers } = readFields(calc, values)
  const salaryMode = values.mode === 'salary'
  if (salaryMode) requirePositive(fieldErrors, numbers, 'salary', 'Enter a salary greater than zero')
  else requirePositive(fieldErrors, numbers, 'rate', 'Enter a rate greater than zero')
  if (!fieldErrors.hours && numbers.hours === 0) fieldErrors.hours = 'Enter hours greater than zero'
  if (!fieldErrors.weeks && numbers.weeks === 0) fieldErrors.weeks = 'Enter weeks greater than zero'
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const annual = salaryMode ? numbers.salary : numbers.rate * numbers.hours * numbers.weeks
  const hourly = annual / (numbers.hours * numbers.weeks)
  const weekly = hourly * numbers.hours
  const tax = payDeductions(values, numbers, annual, fieldErrors, {
    week: false,
    state: values.taxes === 'custom' ? 'TX' : values.taxState,
  })
  if (!tax) return fail(fieldErrors)
  const share = annual > 0 ? tax.takeHome / annual : 0
  const periods = [
    ['Hourly', hourly],
    ['Weekly', weekly],
    ['Biweekly', weekly * 2],
    ['Semimonthly', annual / 24],
    ['Monthly', annual / 12],
    ['Annual', annual],
  ]
  const where = values.taxes === 'custom' ? 'Amounts you entered' : `${overtimeState(values.taxState).name} · ${filingLabel(values.filing)}`
  return {
    ok: true,
    result: {
      headline: {
        label: 'Take-home pay',
        value: money(tax.takeHome),
        detail: `${money(annual)} gross · ${where}`,
        warning: tax.capped ? `401(k) is capped at ${money(RETIREMENT_LIMIT)} for 2026.` : undefined,
      },
      stats: [
        { label: 'Gross pay', value: money(annual) },
        { label: salaryMode ? 'Hourly gross' : 'Hourly', value: money(hourly) },
        ...deductionStats(tax),
        ...wageSubscriptionStats(tax.takeHome),
      ],
      schedule: scheduleFromRows(
        [
          { key: 'period', label: 'Period', align: 'left' },
          { key: 'gross', label: 'Gross pay', align: 'right' },
          { key: 'net', label: 'Take-home', align: 'right' },
        ],
        periods.map(([period, amount]) => ({ period, gross: money(amount), net: money(amount * share) })),
      ),
      all: wageAllStates(values, numbers, annual),
      formula: [
        salaryMode
          ? 'Hourly = annual salary / (hours per week × weeks per year)'
          : 'Annual = hourly rate × hours per week × weeks per year',
        'Weekly = hourly × hours per week',
        'Biweekly = weekly × 2',
        'Semimonthly = annual / 24',
        'Monthly = annual / 12',
        '',
        `Gross pay = ${money(annual)}`,
        ...deductionFormula(tax, filingLabel(values.filing)),
        ...subscriptionFormula(),
      ],
      summary: `Take-home ${money(tax.takeHome)}`,
      raw: {
        hourly,
        weekly,
        annual,
        takeHome: tax.takeHome,
        social: tax.social,
        medicare: tax.medicare,
        federal: tax.federal,
        stateTax: tax.stateTax,
        payroll: tax.payroll,
        traditional: tax.traditional,
        socialRate: tax.rates.social,
        medicareRate: tax.rates.medicare,
        federalRate: tax.rates.federal,
        stateRate: tax.rates.stateTax,
        retirementRate: tax.rates.traditional,
        afterSubscriptions: subscriptionLink() ? tax.takeHome / 12 - subscriptionLink().monthly : null,
      },
    },
  }
}

function overtimeState(code) {
  return overtimeStates.find((state) => state.code === code) || overtimeStates.find((state) => state.code === 'CA')
}

function computeOvertime(values) {
  const calc = getCalculator('overtime')
  const { fieldErrors, numbers } = readFields(calc, values)
  requirePositive(fieldErrors, numbers, 'rate', 'Enter a rate greater than zero')
  const state = overtimeState(values.state)
  if (!overtimeStates.some((item) => item.code === values.state)) fieldErrors.state = 'Choose a state'
  const byDay = values.entry === 'days'
  const days = byDay ? [1, 2, 3, 4, 5, 6, 7].map((day) => numbers[`h${day}`]).filter((hours) => hours !== undefined) : []
  if (byDay && days.length !== 7) return fail(fieldErrors)
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const totalHours = byDay ? days.reduce((sum, hours) => sum + hours, 0) : numbers.hours
  let parts
  let dailyApplied = byDay
  if (!byDay || state.kind === 'weekly') {
    parts = weeklyOvertime(totalHours, 40)
    dailyApplied = false
  } else if (state.kind === 'daily8') {
    parts = dailyAndWeekly(days, 8)
  } else if (state.kind === 'california') {
    parts = californiaOvertime(days)
  } else if (state.kind === 'colorado') {
    parts = coloradoOvertime(days)
  } else if (state.kind === 'kentucky') {
    parts = kentuckyOvertime(days)
  } else if (state.kind === 'nevada') {
    const daily = numbers.rate < NEVADA_DAILY_RATE
    if (!daily) parts = weeklyOvertime(totalHours, 40)
    else parts = dailyAndWeekly(days, values.nevada === 'four' ? 10 : 8)
    dailyApplied = daily
  } else if (state.kind === 'oregon') {
    parts = values.oregon === 'manufacturing' ? dailyAndWeekly(days, 10) : weeklyOvertime(totalHours, 40)
    dailyApplied = values.oregon === 'manufacturing'
  } else {
    parts = weeklyOvertime(totalHours, 40)
    dailyApplied = false
  }

  const paid = payBreakdown(parts.regular, parts.ot, parts.doubleTime, numbers.rate)
  const tax = payDeductions(values, numbers, paid.total, fieldErrors, { week: true, state: state.code })
  if (!tax) return fail(fieldErrors)
  const query = String(values.query || '').trim().toLowerCase()
  let listed = overtimeStates.filter((item) => !query || item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query))
  listed = [...listed.filter((item) => item.code === state.code), ...listed.filter((item) => item.code !== state.code)]
  const stats = [
    { label: 'Regular pay', value: money(paid.regularPay) },
    { label: 'Overtime pay', value: money(paid.otPay), tone: paid.otPay > 0 ? 'negative' : undefined },
  ]
  if (paid.doublePay > 0) stats.push({ label: 'Double-time pay', value: money(paid.doublePay), tone: 'negative' })
  stats.push(
    { label: 'Regular hours', value: plain(paid.regular, Number.isInteger(paid.regular) ? 0 : 2) },
    { label: 'Overtime hours', value: plain(paid.ot, Number.isInteger(paid.ot) ? 0 : 2) },
  )
  if (paid.doubleTime > 0) stats.push({ label: 'Double-time hours', value: plain(paid.doubleTime, Number.isInteger(paid.doubleTime) ? 0 : 2) })
  stats.unshift({ label: 'Gross pay', value: money(paid.total) })
  stats.push(...deductionStats(tax))

  return {
    ok: true,
    result: {
      headline: {
        label: 'Take-home pay',
        value: money(tax.takeHome),
        detail: `${state.name}: ${state.summary}`,
        warning: tax.capped ? `401(k) is capped at ${money(RETIREMENT_LIMIT)} for 2026.` : undefined,
      },
      stats,
      schedule: scheduleFromRows(
        [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'hours', label: 'Hours', align: 'right' },
          { key: 'rate', label: 'Rate', align: 'right' },
          { key: 'pay', label: 'Pay', align: 'right' },
        ],
        [
          { line: 'Regular', hours: plain(paid.regular, Number.isInteger(paid.regular) ? 0 : 2), rate: money(numbers.rate), pay: money(paid.regularPay) },
          { line: 'Overtime', hours: plain(paid.ot, Number.isInteger(paid.ot) ? 0 : 2), rate: money(numbers.rate * 1.5), pay: money(paid.otPay) },
          ...(paid.doubleTime > 0 ? [{ line: 'Double-time', hours: plain(paid.doubleTime, Number.isInteger(paid.doubleTime) ? 0 : 2), rate: money(numbers.rate * 2), pay: money(paid.doublePay) }] : []),
          { line: 'Gross pay', hours: plain(totalHours, Number.isInteger(totalHours) ? 0 : 2), rate: '', pay: money(paid.total) },
          { line: 'Take-home', hours: '', rate: '', pay: money(tax.takeHome) },
        ],
      ),
      all: scheduleFromRows(
        [
          { key: 'state', label: 'State', align: 'left' },
          { key: 'rule', label: 'Overtime rule', align: 'left' },
        ],
        listed.length
          ? listed.map((item) => ({ state: item.name, rule: item.summary }))
          : [{ state: 'No matching states', rule: '' }],
      ),
      formula: [
        state.detail,
        '',
        `State = ${state.name}`,
        `Hourly rate = ${money(numbers.rate)}`,
        `Hours = ${plain(totalHours, Number.isInteger(totalHours) ? 0 : 2)}`,
        `Regular hours = ${plain(paid.regular, Number.isInteger(paid.regular) ? 0 : 2)} × ${money(numbers.rate)} = ${money(paid.regularPay)}`,
        `Overtime hours = ${plain(paid.ot, Number.isInteger(paid.ot) ? 0 : 2)} × ${money(numbers.rate * 1.5)} = ${money(paid.otPay)}`,
        ...(paid.doubleTime > 0 ? [`Double-time hours = ${plain(paid.doubleTime, Number.isInteger(paid.doubleTime) ? 0 : 2)} × ${money(numbers.rate * 2)} = ${money(paid.doublePay)}`] : []),
        `Gross pay = ${money(paid.total)}`,
        '',
        ...(tax.estimated ? ['Income tax treats this week as if it were repeated for 52 weeks, then keeps one week of that tax.'] : []),
        ...deductionFormula(tax, filingLabel(values.filing)),
        '',
        !byDay && state.kind !== 'weekly'
          ? 'This uses the weekly hours only. Enter each day to apply daily or seventh-day overtime.'
          : state.kind === 'nevada' && numbers.rate < NEVADA_DAILY_RATE
            ? `Daily overtime applies because ${money(numbers.rate)} is under ${money(NEVADA_DAILY_RATE)}.`
            : state.kind === 'nevada'
              ? `Daily overtime does not apply because ${money(numbers.rate)} is at least ${money(NEVADA_DAILY_RATE)}.`
              : 'Overtime here is gross pay for non-exempt work. Some jobs are exempt, and a contract can require more.',
        dailyApplied ? '' : '',
      ].filter((line, index, lines) => line !== '' || lines[index - 1] !== ''),
      summary: `Take-home ${money(tax.takeHome)}`,
      raw: {
        total: paid.total,
        takeHome: tax.takeHome,
        regular: paid.regular,
        ot: paid.ot,
        doubleTime: paid.doubleTime,
        state: state.code,
        dailyApplied,
        listed: listed.length,
        social: tax.social,
        federal: tax.federal,
        traditional: tax.traditional,
        socialRate: tax.rates.social,
        federalRate: tax.rates.federal,
        retirementRate: tax.rates.traditional,
        stateTax: tax.stateTax,
      },
    },
  }
}

const SCI_FUNCTIONS = ['asin', 'acos', 'atan', 'sqrt', 'sin', 'cos', 'tan', 'log', 'ln']

function tokenizeExpression(source) {
  const text = String(source || '')
    .replaceAll('×', '*')
    .replaceAll('÷', '/')
    .replaceAll('−', '-')
    .replaceAll('π', 'pi')
    .replaceAll('√', 'sqrt')
  const tokens = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === ' ') {
      index += 1
      continue
    }
    if ('+-*/()%^!'.includes(char)) {
      tokens.push(char)
      index += 1
      continue
    }
    if (/[a-z]/i.test(char)) {
      const name = /^[a-z]+/i.exec(text.slice(index))
      tokens.push(name[0].toLowerCase())
      index += name[0].length
      continue
    }
    const match = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(index))
    if (!match) return null
    tokens.push(match[1])
    index += match[1].length
  }
  return tokens
}

function domainError() {
  const error = new Error('domain')
  error.domain = true
  throw error
}

function factorial(value) {
  if (!Number.isInteger(value) || value < 0 || value > 170) domainError()
  let result = 1
  for (let n = 2; n <= value; n += 1) result *= n
  return result
}

function evaluateTokens(tokens, angle) {
  let index = 0
  const peek = () => tokens[index]
  const eat = (token) => {
    if (tokens[index] !== token) return false
    index += 1
    return true
  }
  const degrees = angle === 'deg'
  function applyFn(name, value) {
    if (name === 'sin' || name === 'cos' || name === 'tan') {
      if (name === 'tan' && degrees) {
        const turned = Math.abs(value % 180)
        if (Math.abs(turned - 90) < 1e-8) domainError()
      }
      const radians = degrees ? value * Math.PI / 180 : value
      const result = name === 'sin' ? Math.sin(radians) : name === 'cos' ? Math.cos(radians) : Math.tan(radians)
      if (!Number.isFinite(result)) domainError()
      return result
    }
    if (name === 'asin' || name === 'acos' || name === 'atan') {
      if ((name === 'asin' || name === 'acos') && Math.abs(value) > 1) domainError()
      const radians = name === 'asin' ? Math.asin(value) : name === 'acos' ? Math.acos(value) : Math.atan(value)
      return degrees ? radians * 180 / Math.PI : radians
    }
    if (name === 'log' || name === 'ln') {
      if (!(value > 0)) domainError()
      return name === 'log' ? Math.log10(value) : Math.log(value)
    }
    if (name === 'sqrt') {
      if (value < 0) domainError()
      return Math.sqrt(value)
    }
    throw new Error('bad')
  }
  function parseExpression() {
    let left = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = tokens[index]
      index += 1
      const right = parseTerm()
      left = op === '+' ? left + right : left - right
    }
    return left
  }
  function parseTerm() {
    let left = parseUnary()
    while (peek() === '*' || peek() === '/' || startsValue(peek())) {
      const op = peek() === '/' ? '/' : '*'
      if (peek() === '*' || peek() === '/') index += 1
      const right = parseUnary()
      if (op === '/' && right === 0) {
        const error = new Error('divide')
        error.divide = true
        throw error
      }
      left = op === '*' ? left * right : left / right
    }
    return left
  }
  function startsValue(token) {
    if (token == null) return false
    return token === '(' || /^[\d.]/.test(token) || token === 'pi' || token === 'e' || SCI_FUNCTIONS.includes(token)
  }
  function parseUnary() {
    if (eat('-')) return -parsePower()
    if (eat('+')) return parsePower()
    return parsePower()
  }
  function parsePower() {
    const left = parsePrimary()
    if (!eat('^')) return left
    const right = parseUnary()
    const value = left ** right
    if (!Number.isFinite(value)) domainError()
    return value
  }
  function finish(value) {
    if (eat('%')) value /= 100
    while (eat('!')) value = factorial(value)
    return value
  }
  function parsePrimary() {
    if (eat('(')) {
      const value = parseExpression()
      if (!eat(')')) throw new Error('bad')
      return finish(value)
    }
    const token = peek()
    if (SCI_FUNCTIONS.includes(token)) {
      index += 1
      if (!eat('(')) throw new Error('bad')
      const arg = parseExpression()
      if (!eat(')')) throw new Error('bad')
      return finish(applyFn(token, arg))
    }
    if (token === 'pi' || token === 'e') {
      index += 1
      return finish(token === 'pi' ? Math.PI : Math.E)
    }
    if (token == null || !/^[\d.]/.test(token)) throw new Error('bad')
    index += 1
    return finish(Number(token))
  }
  const value = parseExpression()
  if (index !== tokens.length || !Number.isFinite(value)) throw new Error('bad')
  return value
}

export function evaluateExpression(source, angle = 'rad') {
  const tokens = tokenizeExpression(source)
  if (!tokens) return { ok: false, error: 'Use numbers and + − × ÷.' }
  if (!tokens.length) return { ok: true, value: 0 }
  try {
    const value = evaluateTokens(tokens, angle)
    if (Math.abs(value) > 1e15) return { ok: false, error: 'This result is too large.' }
    return { ok: true, value }
  } catch (error) {
    if (error.divide) return { ok: false, error: 'Cannot divide by zero.' }
    if (error.domain) return { ok: false, error: 'That value is outside the function.' }
    return { ok: false, error: 'Finish the expression.' }
  }
}

function previewExpression(source, angle) {
  let text = String(source || '').trim()
  const full = evaluateExpression(text, angle)
  if (full.ok || full.error === 'Cannot divide by zero.' || full.error === 'This result is too large.' || full.error === 'That value is outside the function.') return full
  while (/([+\-*/^(]|asin|acos|atan|sqrt|sin|cos|tan|log|ln)$/.test(text)) {
    text = text.replace(/([+\-*/^(]|asin|acos|atan|sqrt|sin|cos|tan|log|ln)$/, '').trim()
  }
  if (!text) return { ok: true, value: 0 }
  return evaluateExpression(text, angle)
}

function formatCalcNumber(value) {
  const rounded = Math.round(value * 1e10) / 1e10
  return String(rounded)
}

function expressionResult(expression, angle) {
  const evaluated = expression ? previewExpression(expression, angle) : { ok: true, value: 0 }
  if (!evaluated.ok) return fail({ expression: evaluated.error })
  const shown = formatCalcNumber(evaluated.value)
  return { ok: true, shown, value: evaluated.value }
}

// Published averages, not offers. Mortgage and personal-loan rows are FICO
// points from Curinos via Experian (mortgages October 2026, personal loans
// September 2026). Auto rows are VantageScore bands from Experian's
// Automotive Finance Market report, second quarter of 2026.
const aprProducts = {
  mortgage30: {
    kind: 'mortgage',
    label: '30-year mortgage',
    months: 360,
    model: 'fico',
    floor: 'Published conventional mortgage averages start at a score of 620.',
    source: 'Curinos, October 2026, via Experian. A score between two published scores sits on a straight line between them. 780 through 850 uses the 780 average.',
    points: [[620, 8.15], [640, 8.05], [660, 7.96], [680, 7.87], [700, 7.78], [720, 7.74], [740, 7.62], [760, 7.54], [780, 7.46], [850, 7.46]],
  },
  mortgage15: {
    kind: 'mortgage',
    label: '15-year mortgage',
    months: 180,
    model: 'fico',
    floor: 'Published conventional mortgage averages start at a score of 620.',
    source: 'Curinos, October 2026, via Experian. A score between two published scores sits on a straight line between them. 780 through 850 uses the 780 average.',
    points: [[620, 6.88], [640, 6.87], [660, 6.86], [680, 6.88], [700, 6.86], [720, 6.86], [740, 6.85], [760, 6.85], [780, 6.84], [850, 6.84]],
  },
  personal36: {
    kind: 'personal',
    label: '3-year personal loan',
    months: 36,
    model: 'fico',
    floor: 'Published personal loan averages start at a score of 620.',
    source: 'Curinos, September 2026, via Experian. The table runs from 620 to 740. A higher score uses the 740 average.',
    points: [[620, 17.97], [640, 17.21], [660, 16.12], [680, 14.76], [700, 13.19], [720, 11.97], [740, 10.82]],
  },
  personal60: {
    kind: 'personal',
    label: '5-year personal loan',
    months: 60,
    model: 'fico',
    floor: 'Published personal loan averages start at a score of 620.',
    source: 'Curinos, September 2026, via Experian. The table runs from 620 to 740. A higher score uses the 740 average.',
    points: [[620, 18.74], [640, 17.89], [660, 17.36], [680, 15.99], [700, 14.29], [720, 13.04], [740, 11.69]],
  },
  autonew: {
    kind: 'auto',
    label: 'New car',
    months: 60,
    model: 'vantage',
    floor: 'Published new-car averages cover scores from 300 to 850.',
    source: 'Experian Automotive Finance Market, second quarter of 2026. Each VantageScore band has one average. A FICO score with the same number can fall in a different band. The sample payment uses a 5-year term.',
    bands: [
      { low: 300, high: 500, name: 'Deep subprime', apr: 16.11 },
      { low: 501, high: 600, name: 'Subprime', apr: 13.52 },
      { low: 601, high: 660, name: 'Nonprime', apr: 9.71 },
      { low: 661, high: 780, name: 'Prime', apr: 6.15 },
      { low: 781, high: 850, name: 'Superprime', apr: 4.41 },
    ],
  },
  autoused: {
    kind: 'auto',
    label: 'Used car',
    months: 60,
    model: 'vantage',
    floor: 'Published used-car averages cover scores from 300 to 850.',
    source: 'Experian Automotive Finance Market, second quarter of 2026. Each VantageScore band has one average. A FICO score with the same number can fall in a different band. The sample payment uses a 5-year term.',
    bands: [
      { low: 300, high: 500, name: 'Deep subprime', apr: 21.62 },
      { low: 501, high: 600, name: 'Subprime', apr: 19.10 },
      { low: 601, high: 660, name: 'Nonprime', apr: 13.93 },
      { low: 661, high: 780, name: 'Prime', apr: 8.81 },
      { low: 781, high: 850, name: 'Superprime', apr: 6.29 },
    ],
  },
}

const aprAdjustments = {
  payments: { ontime: 40, late2y: -35, late1y: -80, serious: -150 },
  utilization: { under10: 35, under30: 5, under50: -25, over50: -70, none: -15 },
  age: { under2: -35, '2to4': -10, '5to9': 15, '10plus': 30 },
  inquiries: { none: 10, few: 0, many: -25 },
  mix: { both: 15, cards: 0, thin: -20 },
}

const aprFactorLabels = {
  payments: 'Payment history',
  utilization: 'Card balances',
  age: 'Credit length',
  inquiries: 'Applications in the last year',
  mix: 'Accounts',
}

// APR points and approval points relative to a typical file. On-time payments
// and 5–9 years of credit are the baseline, so they do not move a published average.
const aprCreditEffect = {
  payments: { ontime: [0, 0], late2y: [0.35, -8], late1y: [0.85, -16], serious: [1.75, -28] },
  utilization: { under10: [-0.1, 3], under30: [0, 0], under50: [0.25, -4], over50: [0.6, -10], none: [0.15, -2] },
  age: { under2: [0.45, -12], '2to4': [0.2, -5], '5to9': [0, 0], '10plus': [-0.15, 4] },
  inquiries: { none: [-0.05, 2], few: [0, 0], many: [0.3, -8] },
  mix: { both: [-0.05, 2], cards: [0, 0], thin: [0.15, -4] },
}

function approvalBase(kind, score) {
  const bands = kind === 'mortgage'
    ? [[760, 88], [700, 74], [660, 58], [620, 36], [0, 12]]
    : kind === 'auto'
      ? [[781, 92], [661, 78], [601, 52], [501, 28], [0, 14]]
      : [[740, 84], [680, 66], [620, 40], [0, 16]]
  return bands.find(([floor]) => score >= floor)[1]
}

function debtEffect(kind, obligations, paymentShare) {
  if (kind === 'mortgage') {
    if (obligations <= 0.36) return { apr: 0, approval: 6, note: 'Existing debt plus this payment is within 36% of monthly income.' }
    if (obligations <= 0.43) return { apr: 0.25, approval: 0, note: 'Existing debt plus this payment is between 36% and 43% of monthly income. Many conventional loans use 43% as a review line.' }
    if (obligations <= 0.5) return { apr: 0.75, approval: -12, note: 'Existing debt plus this payment is between 43% and 50% of monthly income.' }
    return { apr: 1.5, approval: -22, note: 'Existing debt plus this payment is over 50% of monthly income.' }
  }
  let apr = 0
  let approval = 0
  const notes = []
  if (paymentShare <= 0.1) {
    approval += 6
    notes.push('This payment is within 10% of monthly income.')
  } else if (paymentShare <= 0.15) {
    notes.push('This payment is between 10% and 15% of monthly income.')
  } else if (paymentShare <= 0.2) {
    apr += 0.5
    approval -= 10
    notes.push('This payment is between 15% and 20% of monthly income.')
  } else {
    apr += 1.25
    approval -= 20
    notes.push('This payment is over 20% of monthly income.')
  }
  if (obligations > 0.45) {
    apr += 0.5
    approval -= 10
    notes.push('Existing debt plus this payment is over 45% of monthly income.')
  }
  return { apr, approval, note: notes.join(' ') }
}

function creditEffects(values) {
  const lines = []
  let apr = 0
  let approval = 0
  for (const key of Object.keys(aprCreditEffect)) {
    const pair = aprCreditEffect[key][values[key]]
    if (!pair) return null
    const [aprPoints, approvalPoints] = pair
    apr += aprPoints
    approval += approvalPoints
    if (aprPoints !== 0 || approvalPoints !== 0) {
      const aprSign = aprPoints > 0 ? `+${plain(aprPoints, 2)}` : plain(aprPoints, 2)
      const approvalSign = approvalPoints > 0 ? `+${approvalPoints}` : String(approvalPoints)
      lines.push(`${aprFactorLabels[key]} moves the APR by ${aprSign} points and approval by ${approvalSign}.`)
    }
  }
  return { apr, approval, lines }
}

function ficoBand(score) {
  if (score >= 800) return 'Exceptional'
  if (score >= 740) return 'Very good'
  if (score >= 670) return 'Good'
  if (score >= 580) return 'Fair'
  return 'Poor'
}

function aprChoiceLabel(calc, key, value) {
  const field = calc.fields.find((item) => item.key === key)
  return field?.options?.find((option) => option.value === value)?.label || value
}

function rateFromPoints(points, score) {
  const last = points[points.length - 1][0]
  if (score < points[0][0]) return { apr: null, below: true, capped: false }
  if (score > last) return { apr: points[points.length - 1][1], below: false, capped: true }
  for (let i = 0; i < points.length - 1; i++) {
    const [left, leftRate] = points[i]
    const [right, rightRate] = points[i + 1]
    if (score < left || score > right) continue
    const share = right === left ? 0 : (score - left) / (right - left)
    return { apr: leftRate + (rightRate - leftRate) * share, below: false, capped: false }
  }
  return { apr: points[points.length - 1][1], below: false, capped: false }
}

function rateFromBands(bands, score) {
  const band = bands.find((item) => score >= item.low && score <= item.high)
  if (!band) return { apr: null, below: true, capped: false, band: null }
  return { apr: band.apr, below: false, capped: false, band }
}

function aprSchedule(product, score, lookup, shownApr) {
  const columns = [
    { key: 'score', label: 'Score', align: 'left' },
    { key: 'apr', label: 'Average APR', align: 'right' },
  ]
  if (product.bands) {
    return scheduleFromRows(columns, product.bands.map((band) => {
      const yours = score >= band.low && score <= band.high
      return {
        score: `${band.low}–${band.high}${yours ? ' · you' : ''}`,
        apr: percentNumber(band.apr),
      }
    }))
  }
  const rows = []
  let placed = lookup.below || lookup.capped
  for (const [point, apr] of product.points) {
    if (!placed && score < point) {
      rows.push({ score: `${score} · you`, apr: percentNumber(shownApr ?? lookup.apr) })
      placed = true
    }
    const edge = lookup.capped && point === product.points[product.points.length - 1][0]
    const yours = score === point || edge
    rows.push({
      score: yours ? `${edge ? `${point} and above` : point} · you` : String(point),
      apr: percentNumber(yours && shownApr != null ? shownApr : apr),
    })
    if (score === point) placed = true
  }
  return scheduleFromRows(columns, rows)
}

function sketchScore(calc, values) {
  const factors = ['payments', 'utilization', 'age', 'inquiries', 'mix']
  let score = 700
  const lines = ['Start at 700.']
  for (const key of factors) {
    const choice = values[key]
    const delta = aprAdjustments[key]?.[choice]
    if (delta === undefined) return null
    score += delta
    const sign = delta > 0 ? `+${delta}` : String(delta)
    lines.push(`${aprFactorLabels[key]}: ${aprChoiceLabel(calc, key, choice)}, ${sign}.`)
  }
  const clamped = Math.min(850, Math.max(300, score))
  if (clamped !== score) lines.push(`Held at ${clamped}.`)
  lines.push('Payment history moves this sketch more than new applications, in line with the public FICO category weights. The points are fixed so the estimate can be read. They are not a bureau score.')
  return { score: clamped, lines }
}

function computeApr(values) {
  const calc = getCalculator('apr')
  const { fieldErrors, numbers } = readFields(calc, values)
  const product = aprProducts[values.product]
  if (!product) return fail(fieldErrors, 'Choose a loan.')
  let score
  let sketch = null
  if (values.source === 'history') {
    sketch = sketchScore(calc, values)
    if (!sketch) return fail(fieldErrors, 'Choose each part of the credit history.')
    score = sketch.score
  } else {
    if (fieldErrors.score) return fail(fieldErrors)
    score = Math.round(numbers.score)
    if (score < 300 || score > 850) {
      fieldErrors.score = 'Enter a score from 300 to 850'
      return fail(fieldErrors)
    }
  }
  if (Object.keys(fieldErrors).length) return fail(fieldErrors)

  const effects = creditEffects(values)
  if (!effects) return fail(fieldErrors, 'Choose each part of the credit history.')
  const lookup = product.bands ? rateFromBands(product.bands, score) : rateFromPoints(product.points, score)
  const rating = product.model === 'vantage' ? lookup.band?.name || '—' : ficoBand(score)
  const amount = numbers.amount || 0
  const debt = numbers.debt || 0
  const income = numbers.income || 0
  const creditApr = sketch ? 0 : effects.apr
  const priced = lookup.apr == null ? null : Math.max(0, lookup.apr + creditApr)
  const preview = priced != null && amount > 0 ? amortize(amount, priced, product.months, 0) : null
  const previewPayment = preview?.ok ? preview.value.scheduled : 0
  let debtBump = { apr: 0, approval: 0, note: '' }
  if (income > 0 && priced != null) {
    const obligations = (debt + previewPayment) / income
    const paymentShare = previewPayment / income
    debtBump = debtEffect(product.kind, obligations, paymentShare)
  }
  const apr = priced == null ? null : Math.max(0, priced + debtBump.apr)
  const paid = apr != null && amount > 0 ? amortize(amount, apr, product.months, 0) : null
  const payment = paid?.ok ? paid.value.scheduled : null
  let approval = approvalBase(product.kind, score)
  if (!sketch) approval += effects.approval
  if (income > 0 && priced != null) approval += debtBump.approval
  approval = Math.min(95, Math.max(5, Math.round(approval)))
  const approvalTone = approval >= 70 ? 'positive' : approval < 40 ? 'negative' : undefined
  const stats = [
    { label: sketch ? 'Estimated score' : 'Score', value: String(score) },
    { label: 'Rating', value: rating },
    { label: 'Chance of approval', value: percentNumber(approval, 0), tone: approvalTone },
  ]
  if (payment != null) {
    stats.push({ label: 'Sample payment', value: money(payment) })
    stats.push({ label: 'Sample term', value: formatDuration(product.months) })
    stats.push({ label: 'Interest', value: money(paid.value.totalInterest), tone: 'negative' })
  }
  const formula = [
    'The APR starts from a published average for this score and loan. Payment history, credit length, card balances, recent applications, and the mix of accounts move that average when you enter a score. Debt and income then move it again. A score sketched from history already includes those credit factors, so they are not applied twice.',
    'The chance of approval is a sketch for this kind of loan. It is not a lender decision, and it does not use a Social Security number or a credit report.',
    '',
  ]
  if (sketch) formula.push(...sketch.lines, '')
  formula.push(
    `${sketch ? 'Estimated score' : 'Score'} ${score} · ${rating}`,
    product.label,
    product.source,
  )
  if (lookup.apr != null && creditApr !== 0) formula.push(`Published average ${percentNumber(lookup.apr)}. Credit factors move it by ${creditApr > 0 ? '+' : ''}${plain(creditApr, 2)} points.`, ...effects.lines)
  if (income > 0 && priced != null) formula.push(debtBump.note)
  else formula.push('Monthly income is 0, so debt is not part of the APR or the chance of approval.')
  if (lookup.below) formula.push('', product.floor)
  if (lookup.capped) formula.push('', `Scores above ${product.points[product.points.length - 1][0]} use the last published average.`)
  formula.push(`Chance of approval = ${percentNumber(approval, 0)}`)
  if (payment != null) {
    formula.push('')
    formula.push(...loanFormula(amount, apr, product.months, payment))
  }

  return {
    ok: true,
    result: {
      headline: {
        label: 'Estimated APR',
        value: apr == null ? 'No published average' : percentNumber(apr),
        detail: lookup.below
          ? product.floor
          : `${sketch ? 'Estimated score' : 'Score'} ${score} · ${rating} · ${product.label} · ${percentNumber(approval, 0)} likely`,
        warning: lookup.capped
          ? `Published averages stop at ${product.points[product.points.length - 1][0]}. This uses that rate.`
          : undefined,
      },
      stats,
      schedule: aprSchedule(product, score, lookup, apr),
      formula,
      summary: apr == null ? 'No published average' : `Estimated APR ${percentNumber(apr)}`,
      raw: {
        score,
        estimated: Boolean(sketch),
        rating,
        apr,
        baseApr: lookup.apr,
        approval,
        capped: lookup.capped,
        below: lookup.below,
        payment,
        months: product.months,
        amount,
        debt,
        income,
        product: values.product,
      },
    },
  }
}

const incomePay = {
  hourly: { when: 'an hour', slice: 'Each hour', column: 'Hourly' },
  weekly: { perYear: 52, when: 'a week', slice: 'Each week', column: 'Weekly' },
  biweekly: { perYear: 26, when: 'every two weeks', slice: 'Each paycheck', column: 'Biweekly' },
  monthly: { perYear: 12, when: 'a month', slice: 'Each month', column: 'Monthly' },
  annual: { perYear: 1, when: 'a year', slice: 'Each year', column: 'Annual' },
}

function percentSchedule(income, perYear, percent, column) {
  const marks = [10, 20, 30, 50]
  if (!marks.includes(percent)) marks.push(percent)
  marks.sort((a, b) => a - b)
  const columns = [{ key: 'percent', label: 'Percent', align: 'left' }]
  if (perYear !== 1) columns.push({ key: 'pay', label: column, align: 'right' })
  columns.push({ key: 'year', label: 'Per year', align: 'right' })
  return scheduleFromRows(
    columns,
    marks.map((mark) => {
      const slice = income * mark / 100
      return {
        percent: `${Number.isInteger(mark) ? String(mark) : plain(mark, 2)}%${mark === percent ? ' · you' : ''}`,
        pay: money(slice),
        year: money(slice * perYear),
      }
    }),
  )
}

function computePercent(values) {
  const calc = getCalculator('percent')
  const { fieldErrors, numbers } = readFields(calc, values)
  const hourly = values.paid === 'hourly'
  requirePositive(fieldErrors, numbers, 'income', 'Enter an income greater than zero')
  if (hourly) {
    requirePositive(fieldErrors, numbers, 'hours', 'Enter hours greater than zero')
    requirePositive(fieldErrors, numbers, 'weeks', 'Enter weeks greater than zero')
  }
  if (Object.keys(fieldErrors).length || numbers.percent === undefined) return fail(fieldErrors)

  const paid = incomePay[values.paid] || incomePay.annual
  const perYear = hourly ? numbers.hours * numbers.weeks : paid.perYear
  const slice = numbers.income * numbers.percent / 100
  const annualShare = slice * perYear
  const annualIncome = numbers.income * perYear
  const percentLabel = percentNumber(numbers.percent, Number.isInteger(numbers.percent) ? 0 : 2)
  const stats = []
  if (hourly) {
    stats.push(
      { label: 'Each hour', value: money(slice) },
      { label: 'Each week', value: money(slice * numbers.hours) },
      { label: 'Left over each week', value: money((numbers.income - slice) * numbers.hours) },
    )
  } else if (perYear !== 1) stats.push({ label: paid.slice, value: money(slice) })
  else stats.push({ label: 'Each month', value: money(annualShare / 12) })
  if (!hourly) stats.push({ label: perYear === 1 ? 'Left over' : 'Left over this pay', value: money(numbers.income - slice) })
  stats.push({ label: 'Left over a year', value: money(annualIncome - annualShare) })
  const formula = hourly
    ? [
        'Share = hourly rate × percent / 100',
        'Annual total = share × hours per week × weeks per year',
        '',
        `hourly rate = ${money(numbers.income)}`,
        `percent = ${percentLabel}`,
        `share = ${money(slice)} an hour`,
        `hours per week = ${plain(numbers.hours, Number.isInteger(numbers.hours) ? 0 : 2)}`,
        `weeks per year = ${plain(numbers.weeks, Number.isInteger(numbers.weeks) ? 0 : 2)}`,
        `annual total = ${money(annualShare)}`,
      ]
    : [
        'Share = income × percent / 100',
        'Annual total = share × paychecks in a year',
        'Weekly uses 52, biweekly uses 26, monthly uses 12, and annual uses 1.',
        '',
        `income = ${money(numbers.income)} ${paid.when}`,
        `percent = ${percentLabel}`,
        `share = ${money(slice)}`,
        `paychecks = ${perYear}`,
        `annual total = ${money(annualShare)}`,
      ]
  return {
    ok: true,
    result: {
      headline: {
        label: 'Annual total',
        value: money(annualShare),
        detail: `${percentLabel} of ${money(numbers.income)} ${paid.when}`,
      },
      stats,
      schedule: percentSchedule(numbers.income, perYear, numbers.percent, paid.column),
      formula,
      summary: `${percentLabel} totals ${money(annualShare)} a year`,
      raw: {
        percent: numbers.percent,
        perYear,
        paycheckShare: slice,
        annualIncome,
        annualShare,
        remaining: numbers.income - slice,
        remainingAnnual: annualIncome - annualShare,
        ...(hourly ? { hours: numbers.hours, weeks: numbers.weeks, weeklyShare: slice * numbers.hours } : {}),
      },
    },
  }
}

function computeCalc(values) {
  const expression = String(values.expression || '').trim()
  const solved = expressionResult(expression)
  if (!solved.ok) return solved
  return {
    ok: true,
    result: {
      headline: { label: 'Result', value: solved.shown, detail: expression || '0' },
      stats: [
        { label: 'Expression', value: expression || '0' },
      ],
      schedule: scheduleFromRows(
        [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'value', label: 'Value', align: 'right' },
        ],
        [{ line: expression || '0', value: solved.shown }],
      ),
      formula: [
        '× and ÷ happen before + and −. Parentheses go first.',
        'A percent sign divides that number by 100.',
        '',
        `${expression || '0'} = ${solved.shown}`,
      ],
      summary: solved.shown,
      raw: { value: solved.value, text: solved.shown },
    },
  }
}

function computeScientific(values) {
  const expression = String(values.expression || '').trim()
  const angle = values.angle === 'rad' ? 'rad' : 'deg'
  const solved = expressionResult(expression, angle)
  if (!solved.ok) return solved
  const angleLabel = angle === 'deg' ? 'Degrees' : 'Radians'
  return {
    ok: true,
    result: {
      headline: { label: 'Result', value: solved.shown, detail: `${expression || '0'} · ${angleLabel}` },
      stats: [
        { label: 'Expression', value: expression || '0' },
        { label: 'Angle', value: angleLabel },
      ],
      schedule: scheduleFromRows(
        [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'value', label: 'Value', align: 'right' },
        ],
        [{ line: expression || '0', value: solved.shown }],
      ),
      formula: [
        'Powers and roots happen before × and ÷, which happen before + and −.',
        'sin, cos, tan, asin, acos, and atan use the selected angle.',
        'log is base 10. ln is natural log. n! is a factorial of a whole number.',
        'π is pi and e is the base of the natural log. A percent sign divides that number by 100.',
        '',
        `${expression || '0'} = ${solved.shown}`,
        `Angle = ${angleLabel}`,
      ],
      summary: solved.shown,
      raw: { value: solved.value, text: solved.shown, angle },
    },
  }
}
