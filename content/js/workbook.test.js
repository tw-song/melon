import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCalculator } from './calculators.js'
import { sheetsForEntries, workbookFile } from './workbook.js'

test('an excel workbook stores inputs, the result, and outputs', () => {
  const calc = getCalculator('mortgage')
  const values = { ...calc.defaults }
  const outcome = calc.compute(values)
  const loan = getCalculator('loan')
  const sheets = sheetsForEntries([
    { calc, values, savedAt: Date.UTC(2026, 9, 18, 22, 0), outcome },
    { calc: loan, values: { ...loan.defaults, extra: '' }, savedAt: Date.UTC(2026, 9, 18, 22, 5), outcome: loan.compute({ ...loan.defaults, extra: '' }) },
  ])
  const bytes = workbookFile(sheets)
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  const text = new TextDecoder().decode(bytes)
  assert.match(text, /Home price/)
  assert.match(text, />450000</)
  assert.match(text, /Monthly housing/)
  assert.match(text, /Suggested payment/)
  assert.equal(text.includes('>All<'), false)
  assert.match(text, /sheet name="Mortgage"/)
  assert.match(text, /sheet name="Loan"/)
  assert.match(text, /xl\/worksheets\/sheet2.xml/)
})
