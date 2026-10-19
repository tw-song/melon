// 2026 employee withholding estimate. Federal brackets and the standard deduction
// are from IRS Rev. Proc. 2025-32. Social Security and Medicare are from IRS
// Publication 15 for 2026. State brackets, deductions, and exemptions are the
// Tax Foundation tables as of January 1, 2026. Local tax and dependent
// exemptions are not included.

const SOCIAL_SECURITY_RATE = 0.062
const SOCIAL_SECURITY_BASE = 184500
const MEDICARE_RATE = 0.0145
const ADDITIONAL_MEDICARE_RATE = 0.009
const ADDITIONAL_MEDICARE_WAGE = 200000
export const RETIREMENT_LIMIT = 24500

const FEDERAL = {
  single: {
    deduction: 16100,
    brackets: [[0, 0.1], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
  },
  head: {
    deduction: 24150,
    brackets: [[0, 0.1], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201750, 0.32], [256200, 0.35], [640600, 0.37]],
  },
  married: {
    deduction: 32200,
    brackets: [[0, 0.1], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
  },
}

function rule(std, exempt, credit, brackets) {
  return { std, exempt, credit, brackets }
}

const STATE_INCOME = {
  AL: { kind: 'brackets', single: rule(3000, 1500, 0, [[0, 0.02], [500, 0.04], [3000, 0.05]]), joint: rule(8500, 3000, 0, [[0, 0.02], [1000, 0.04], [6000, 0.05]]) },
  AK: { kind: 'none' },
  AZ: { kind: 'brackets', single: rule(8350, 0, 0, [[0, 0.025]]), joint: rule(16700, 0, 0, [[0, 0.025]]) },
  AR: { kind: 'brackets', single: rule(2470, 0, 29, [[0, 0.02], [4600, 0.039]]), joint: rule(4940, 0, 58, [[0, 0.02], [4600, 0.039]]) },
  CA: { kind: 'brackets', payroll: 0.013, payrollName: 'California SDI', single: rule(5540, 0, 153, [[0, 0.01], [11079, 0.02], [26264, 0.04], [41452, 0.06], [57542, 0.08], [72724, 0.093], [371479, 0.103], [445771, 0.113], [742953, 0.123], [1000000, 0.133]]), joint: rule(11080, 0, 306, [[0, 0.01], [22158, 0.02], [52528, 0.04], [82904, 0.06], [115084, 0.08], [145448, 0.093], [742958, 0.103], [891542, 0.113], [1000000, 0.123], [1485906, 0.133]]) },
  CO: { kind: 'brackets', single: rule(16100, 0, 0, [[0, 0.044]]), joint: rule(32200, 0, 0, [[0, 0.044]]) },
  CT: { kind: 'brackets', single: rule(0, 15000, 0, [[0, 0.02], [10000, 0.045], [50000, 0.055], [100000, 0.06], [200000, 0.065], [250000, 0.069], [500000, 0.0699]]), joint: rule(0, 24000, 0, [[0, 0.02], [20000, 0.045], [100000, 0.055], [200000, 0.06], [400000, 0.065], [500000, 0.069], [1000000, 0.0699]]) },
  DE: { kind: 'brackets', single: rule(3250, 0, 110, [[2000, 0.022], [5000, 0.039], [10000, 0.048], [20000, 0.052], [25000, 0.0555], [60000, 0.066]]), joint: rule(6500, 0, 220, [[2000, 0.022], [5000, 0.039], [10000, 0.048], [20000, 0.052], [25000, 0.0555], [60000, 0.066]]) },
  FL: { kind: 'none' },
  GA: { kind: 'brackets', single: rule(12000, 0, 0, [[0, 0.0519]]), joint: rule(24000, 0, 0, [[0, 0.0519]]) },
  HI: { kind: 'brackets', single: rule(4400, 1144, 0, [[0, 0.014], [9600, 0.032], [14400, 0.055], [19200, 0.064], [24000, 0.068], [36000, 0.072], [48000, 0.076], [125000, 0.079], [175000, 0.0825], [225000, 0.09], [275000, 0.1], [325000, 0.11]]), joint: rule(8800, 2288, 0, [[0, 0.014], [19200, 0.032], [28800, 0.055], [38400, 0.064], [48000, 0.068], [72000, 0.072], [96000, 0.076], [250000, 0.079], [350000, 0.0825], [450000, 0.09], [550000, 0.1], [650000, 0.11]]) },
  ID: { kind: 'brackets', single: rule(16100, 0, 0, [[4811, 0.053]]), joint: rule(32200, 0, 0, [[9622, 0.053]]) },
  IL: { kind: 'brackets', single: rule(0, 2925, 0, [[0, 0.0495]]), joint: rule(0, 5850, 0, [[0, 0.0495]]) },
  IN: { kind: 'brackets', single: rule(0, 1000, 0, [[0, 0.0295]]), joint: rule(0, 2000, 0, [[0, 0.0295]]) },
  IA: { kind: 'brackets', single: rule(16100, 0, 40, [[0, 0.038]]), joint: rule(32200, 0, 80, [[0, 0.038]]) },
  KS: { kind: 'brackets', single: rule(3605, 9160, 0, [[0, 0.052], [23000, 0.0558]]), joint: rule(8240, 18320, 0, [[0, 0.052], [46000, 0.0558]]) },
  KY: { kind: 'brackets', single: rule(3360, 0, 0, [[0, 0.035]]), joint: rule(3360, 0, 0, [[0, 0.035]]) },
  LA: { kind: 'brackets', single: rule(12875, 0, 0, [[0, 0.03]]), joint: rule(25750, 0, 0, [[0, 0.03]]) },
  ME: { kind: 'brackets', single: rule(8350, 5300, 0, [[0, 0.058], [27399, 0.0675], [64849, 0.0715]]), joint: rule(16700, 10600, 0, [[0, 0.058], [54849, 0.0675], [129749, 0.0715]]) },
  MD: { kind: 'brackets', single: rule(3350, 3200, 0, [[0, 0.02], [1000, 0.03], [2000, 0.04], [3000, 0.0475], [100000, 0.05], [125000, 0.0525], [150000, 0.055], [250000, 0.0575], [500000, 0.0625], [1000000, 0.065]]), joint: rule(6700, 6400, 0, [[0, 0.02], [1000, 0.03], [2000, 0.04], [3000, 0.0475], [150000, 0.05], [175000, 0.0525], [225000, 0.055], [300000, 0.0575], [600000, 0.0625], [1200000, 0.065]]) },
  MA: { kind: 'brackets', payroll: 0.0046, payrollName: 'Paid family leave', single: rule(0, 4400, 0, [[0, 0.05], [1083150, 0.09]]), joint: rule(0, 8800, 0, [[0, 0.05], [1083150, 0.09]]) },
  MI: { kind: 'brackets', single: rule(0, 5900, 0, [[0, 0.0425]]), joint: rule(0, 11800, 0, [[0, 0.0425]]) },
  MN: { kind: 'brackets', single: rule(15300, 0, 0, [[0, 0.0535], [33310, 0.068], [109430, 0.0785], [203150, 0.0985]]), joint: rule(30600, 0, 0, [[0, 0.0535], [48700, 0.068], [193480, 0.0785], [337930, 0.0985]]) },
  MS: { kind: 'brackets', single: rule(2300, 6000, 0, [[10000, 0.04]]), joint: rule(4600, 12000, 0, [[10000, 0.04]]) },
  MO: { kind: 'brackets', single: rule(16100, 0, 0, [[1348, 0.02], [2696, 0.025], [4044, 0.03], [5392, 0.035], [6740, 0.04], [8088, 0.045], [9436, 0.047]]), joint: rule(32200, 0, 0, [[1348, 0.02], [2696, 0.025], [4044, 0.03], [5392, 0.035], [6740, 0.04], [8088, 0.045], [9436, 0.047]]) },
  MT: { kind: 'brackets', single: rule(16100, 0, 0, [[0, 0.047], [47500, 0.0565]]), joint: rule(32200, 0, 0, [[0, 0.047], [95000, 0.0565]]) },
  NE: { kind: 'brackets', single: rule(8850, 0, 176, [[0, 0.0246], [4130, 0.0351], [24760, 0.0455]]), joint: rule(17700, 0, 352, [[0, 0.0246], [8250, 0.0351], [49530, 0.0455]]) },
  NV: { kind: 'none' },
  NH: { kind: 'none' },
  NJ: { kind: 'brackets', single: rule(0, 1000, 0, [[0, 0.014], [20000, 0.0175], [35000, 0.035], [40000, 0.0553], [75000, 0.0637], [500000, 0.0897], [1000000, 0.1075]]), joint: rule(0, 2000, 0, [[0, 0.014], [20000, 0.0175], [50000, 0.0245], [70000, 0.035], [80000, 0.0553], [150000, 0.0637], [500000, 0.0897], [1000000, 0.1075]]) },
  NM: { kind: 'brackets', single: rule(16100, 0, 0, [[0, 0.015], [5500, 0.032], [16500, 0.043], [33500, 0.047], [66500, 0.049], [210000, 0.059]]), joint: rule(32200, 0, 0, [[0, 0.015], [8000, 0.032], [25000, 0.043], [50000, 0.047], [100000, 0.049], [315000, 0.059]]) },
  NY: { kind: 'brackets', single: rule(8000, 0, 0, [[0, 0.039], [8500, 0.044], [11700, 0.0515], [13900, 0.054], [80650, 0.059], [215400, 0.0685], [1077550, 0.0965], [5000000, 0.103], [25000000, 0.109]]), joint: rule(16050, 0, 0, [[0, 0.039], [17150, 0.044], [23600, 0.0515], [27900, 0.054], [161550, 0.059], [323200, 0.0685], [2155350, 0.0965], [5000000, 0.103], [25000000, 0.109]]) },
  NC: { kind: 'brackets', single: rule(12750, 0, 0, [[0, 0.0399]]), joint: rule(25500, 0, 0, [[0, 0.0399]]) },
  ND: { kind: 'brackets', single: rule(16100, 0, 0, [[48475, 0.0195], [244825, 0.025]]), joint: rule(32200, 0, 0, [[80975, 0.0195], [298075, 0.025]]) },
  OH: { kind: 'ohio', brackets: [[26050, 0.0275]] },
  OK: { kind: 'brackets', single: rule(6350, 1000, 0, [[3750, 0.025], [4900, 0.035], [7200, 0.045]]), joint: rule(12700, 2000, 0, [[7500, 0.025], [9800, 0.035], [14400, 0.045]]) },
  OR: { kind: 'brackets', single: rule(2910, 0, 256, [[0, 0.0475], [4550, 0.0675], [11400, 0.0875], [125000, 0.099]]), joint: rule(5820, 0, 512, [[0, 0.0475], [9100, 0.0675], [22800, 0.0875], [250000, 0.099]]) },
  PA: { kind: 'brackets', single: rule(0, 0, 0, [[0, 0.0307]]), joint: rule(0, 0, 0, [[0, 0.0307]]) },
  RI: { kind: 'brackets', single: rule(11200, 5250, 0, [[0, 0.0375], [82050, 0.0475], [186450, 0.0599]]), joint: rule(22400, 10500, 0, [[0, 0.0375], [82050, 0.0475], [186450, 0.0599]]) },
  SC: { kind: 'brackets', single: rule(8350, 0, 0, [[0, 0], [3640, 0.03], [18230, 0.06]]), joint: rule(16700, 0, 0, [[0, 0], [3640, 0.03], [18230, 0.06]]) },
  SD: { kind: 'none' },
  TN: { kind: 'none' },
  TX: { kind: 'none' },
  UT: { kind: 'utah', rate: 0.045, single: 966, joint: 1932 },
  VT: { kind: 'brackets', single: rule(7650, 5300, 0, [[0, 0.0335], [49400, 0.066], [119700, 0.076], [249700, 0.0875]]), joint: rule(15300, 10600, 0, [[0, 0.0335], [82500, 0.066], [199450, 0.076], [304000, 0.0875]]) },
  VA: { kind: 'brackets', single: rule(8750, 930, 0, [[0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]]), joint: rule(17500, 1860, 0, [[0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]]) },
  WA: { kind: 'none', payroll: 0.0058, payrollName: 'WA Cares' },
  WV: { kind: 'brackets', single: rule(0, 2000, 0, [[0, 0.0222], [10000, 0.0296], [25000, 0.0333], [40000, 0.0444], [60000, 0.0482]]), joint: rule(0, 4000, 0, [[0, 0.0222], [10000, 0.0296], [25000, 0.0333], [40000, 0.0444], [60000, 0.0482]]) },
  WI: { kind: 'brackets', single: rule(13960, 700, 0, [[0, 0.035], [15110, 0.044], [51950, 0.053], [332720, 0.0765]]), joint: rule(25840, 1400, 0, [[0, 0.035], [20150, 0.044], [69260, 0.053], [443630, 0.0765]]) },
  WY: { kind: 'none' },
}

export const TAX_STATE_CODES = Object.keys(STATE_INCOME)

function taxFromBrackets(taxable, brackets) {
  if (taxable <= 0 || !brackets?.length) return 0
  let tax = 0
  for (let i = 0; i < brackets.length; i += 1) {
    const start = brackets[i][0]
    const rate = brackets[i][1]
    const end = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity
    if (taxable > start) tax += (Math.min(taxable, end) - start) * rate
  }
  return tax
}

function federalTax(income, filing) {
  const table = FEDERAL[filing] || FEDERAL.single
  return taxFromBrackets(Math.max(0, income - table.deduction), table.brackets)
}

function stateRow(spec, married, income) {
  if (spec.kind === 'ohio') {
    const one = income <= 40000 ? 2400 : income <= 80000 ? 2150 : income < 500000 ? 1900 : 0
    return { std: 0, exempt: married ? one * 2 : one, credit: 0, brackets: spec.brackets }
  }
  return married ? spec.joint : spec.single
}

export function stateTaxDetail(code) {
  const spec = STATE_INCOME[code]
  if (!spec || spec.kind === 'none') {
    return spec?.payrollName
      ? `No state income tax on wages. ${spec.payrollName} is withheld at ${plainRate(spec.payroll)}.`
      : 'No state income tax on wages.'
  }
  const row = spec.kind === 'utah'
    ? { brackets: [[0, spec.rate]] }
    : spec.kind === 'ohio'
      ? { brackets: spec.brackets }
      : spec.single
  const top = row.brackets[row.brackets.length - 1][1]
  const payroll = spec.payrollName ? ` ${spec.payrollName} adds ${plainRate(spec.payroll)}.` : ''
  return `State income tax uses 2026 brackets, with a top rate of ${plainRate(top)}.${payroll}`
}

function plainRate(rate) {
  const percent = Math.round(rate * 10000) / 100
  return `${percent}%`
}

function stateIncomeTax(income, filing, code) {
  const spec = STATE_INCOME[code]
  const married = filing === 'married'
  if (!spec || spec.kind === 'none') {
    return { tax: 0, payrollRate: spec?.payroll || 0, payrollName: spec?.payrollName || '' }
  }
  if (spec.kind === 'utah') {
    const credit = married ? spec.joint : spec.single
    return { tax: Math.max(0, income * spec.rate - credit), payrollRate: 0, payrollName: '' }
  }
  const row = stateRow(spec, married, income)
  const taxable = Math.max(0, income - (row.std || 0) - (row.exempt || 0))
  const tax = Math.max(0, taxFromBrackets(taxable, row.brackets) - (row.credit || 0))
  return { tax, payrollRate: spec.payroll || 0, payrollName: spec.payrollName || '' }
}

export function figureTaxes({ gross, filing = 'single', state = 'TX', preTax = 0, traditional = 0, roth = 0 }) {
  const pay = Math.max(0, gross)
  const benefits = Math.max(0, preTax)
  const deferred = Math.max(0, traditional) + Math.max(0, roth)
  if (benefits + deferred > pay + 0.004) return { error: 'Deductions are larger than pay' }
  const ficaWages = Math.max(0, pay - benefits)
  const incomeWages = Math.max(0, ficaWages - Math.max(0, traditional))
  const social = Math.min(ficaWages, SOCIAL_SECURITY_BASE) * SOCIAL_SECURITY_RATE
  const medicare = ficaWages * MEDICARE_RATE + Math.max(0, ficaWages - ADDITIONAL_MEDICARE_WAGE) * ADDITIONAL_MEDICARE_RATE
  const federal = federalTax(incomeWages, filing === 'head' ? 'head' : filing === 'married' ? 'married' : 'single')
  const stateResult = stateIncomeTax(incomeWages, filing, state)
  const payroll = ficaWages * stateResult.payrollRate
  const takeHome = pay - social - medicare - federal - stateResult.tax - payroll - deferred - benefits
  return {
    social,
    medicare,
    federal,
    stateTax: stateResult.tax,
    payroll,
    payrollName: stateResult.payrollName,
    traditional: Math.max(0, traditional),
    roth: Math.max(0, roth),
    preTax: benefits,
    takeHome,
  }
}
