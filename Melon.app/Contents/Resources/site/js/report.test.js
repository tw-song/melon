import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCalculator, setProgramContext } from './calculators.js'
import { reportDocument } from './report.js'

function entry(id, overrides = {}, savedAt = Date.UTC(2026, 9, 18, 16)) {
  const calc = getCalculator(id)
  const values = { ...calc.defaults, ...overrides }
  return { calc, values, savedAt, outcome: calc.compute(values) }
}

test('a saved report prints inputs, the result, outputs, and the schedule', () => {
  setProgramContext(null)
  const mortgage = entry('mortgage')
  assert.equal(mortgage.outcome.ok, true)
  const html = reportDocument([mortgage], 'Melon — Mortgage')
  assert.match(html, /<h1>Mortgage<\/h1>/)
  assert.match(html, /<h3>Inputs<\/h3>/)
  assert.match(html, /Home price/)
  assert.match(html, /\$450,000\.00/)
  assert.match(html, /<h3>Result<\/h3>/)
  assert.match(html, /Monthly housing/)
  assert.match(html, /<h3>Outputs<\/h3>/)
  assert.match(html, /Principal and interest/)
  assert.match(html, /<h3>Schedule<\/h3>/)
  assert.match(html, /<h3>Formula<\/h3>/)
  assert.match(html, /30 years, 0 months, 0 days/)
})

test('a saved report keeps line items and skips a blank row', () => {
  setProgramContext(null)
  const worth = entry('networth', {
    entries: JSON.stringify([
      { kind: 'asset', name: 'Checking', amount: '50' },
      { kind: 'bill', name: 'Phone', amount: '20' },
      { kind: 'asset', name: '', amount: '' },
    ]),
  })
  const html = reportDocument([worth], 'Melon — Net worth')
  assert.match(html, /Checking/)
  assert.match(html, /\$50\.00/)
  assert.match(html, /Phone/)
  assert.match(html, /\$20\.00 \/ month/)
  assert.equal((html.match(/<article class="sheet">/g) || []).length, 1)
  const both = reportDocument([worth, entry('loan')], 'Melon — Saved calculations')
  assert.equal((both.match(/<article class="sheet">/g) || []).length, 2)
  assert.match(both, /<h1>Saved calculations<\/h1>/)
})

test('a saved report leaves out the full reference list', () => {
  setProgramContext(null)
  const tax = entry('salestax')
  assert.ok(tax.outcome.result.all.rows.length > 40)
  const html = reportDocument([tax], 'Melon — Sales tax')
  assert.equal(html.includes('<h3>All</h3>'), false)
  assert.equal(html.includes('Alabama'), false)
  assert.match(html, /California/)
  assert.match(html, /<h3>Schedule<\/h3>/)
})

test('a master report can keep entered inputs and drop sections', () => {
  setProgramContext(null)
  const mortgage = entry('mortgage', { price: '500000', loanType: 'va' })
  const html = reportDocument([mortgage], 'Melon — Master file', {
    enteredOnly: true,
    schedule: false,
    formula: false,
  })
  assert.match(html, /<h1>Master file<\/h1>/)
  const inputs = html.split('<h3>Result</h3>')[0]
  assert.match(inputs, /Home price/)
  assert.match(inputs, /\$500,000\.00/)
  assert.match(inputs, />VA</)
  assert.equal(inputs.includes('Down payment'), false)
  assert.equal(inputs.includes('Property tax'), false)
  assert.equal(html.includes('<h3>Schedule</h3>'), false)
  assert.equal(html.includes('<h3>Formula</h3>'), false)
  assert.match(html, /Monthly housing/)
})
