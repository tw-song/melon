import { renderChart } from './chart.js'
import { fieldsForReport, parseLines, parseSaleItems } from './calculators.js'
import { displayRaw, formatNumber, lineIsBlank, optionLabel, spanText } from './fields.js'
import { escapeHtml } from './html.js'

function fieldText(field, values) {
  if (field.kind === 'number' || field.kind === 'slider') return formatNumber(field, displayRaw(field, values))
  if (field.kind === 'segment' || field.kind === 'select' || field.kind === 'combo') return optionLabel(field, values[field.key], '—')
  if (field.kind === 'keypad') {
    const text = String(values[field.key] || '').trim()
    return text ? text.replaceAll('*', '×').replaceAll('/', '÷').replaceAll('-', '−') : '—'
  }
  if (field.kind === 'text') return String(values[field.key] || '').trim() || '—'
  if (field.kind === 'span') return spanText(field, values)
  return ''
}

function dataTable(columns, rows) {
  const head = columns.map((column) => `<th class="${column.align || 'left'}">${escapeHtml(column.label)}</th>`).join('')
  const body = rows.map((row) => `
    <tr>${columns.map((column) => `<td class="${column.align || 'left'}">${escapeHtml(row[column.key] ?? '')}</td>`).join('')}</tr>
  `).join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function lineCell(column, row, values) {
  const shown = typeof column.value === 'function' ? column.value(row, values) : row[column.key]
  if (column.type === 'select') return optionLabel(column, row[column.key], '—')
  if (column.type === 'number') return formatNumber(column, shown)
  return String(shown ?? '').trim() || '—'
}

function linesBlock(field, values) {
  const rows = parseLines(values[field.key], field.blank).filter((row) => !lineIsBlank(field, row))
  if (!rows.length) return '<p class="empty">None</p>'
  const columns = field.columns.map((column) => ({
    key: column.key,
    label: column.label,
    align: column.type === 'number' ? 'right' : 'left',
  }))
  const body = rows.map((row) => {
    const next = {}
    for (const column of field.columns) next[column.key] = lineCell(column, row, values)
    return next
  })
  return dataTable(columns, body)
}

function itemsBlock(field, values) {
  const items = parseSaleItems(values[field.key])
  return dataTable(
    [
      { key: 'comment', label: 'Comment', align: 'left' },
      { key: 'price', label: 'Price', align: 'right' },
      { key: 'quantity', label: 'Qty', align: 'right' },
    ],
    items.map((item) => ({
      comment: item.comment.trim() || '—',
      price: formatNumber({ prefix: '$' }, item.price),
      quantity: formatNumber({}, item.quantity),
    })),
  )
}

function inputsMarkup(calc, values, enteredOnly) {
  const fields = fieldsForReport(calc, values, enteredOnly)
  if (!fields.length) return '<p class="empty">No entered inputs.</p>'
  const blocks = fields.map((field) => {
    if (field.kind === 'lines') return `<h4>${escapeHtml(field.label)}</h4>${linesBlock(field, values)}`
    if (field.kind === 'items') return `<h4>${escapeHtml(field.label)}</h4>${itemsBlock(field, values)}`
    return ''
  }).join('')
  const rows = fields
    .filter((field) => field.kind !== 'lines' && field.kind !== 'items')
    .map((field) => `<tr><th>${escapeHtml(field.label)}</th><td>${escapeHtml(fieldText(field, values))}</td></tr>`)
    .join('')
  const table = rows ? `<table class="fields"><tbody>${rows}</tbody></table>` : ''
  return `${table}${blocks}`
}

function reportOptions(options = {}) {
  return {
    inputs: options.inputs !== false,
    result: options.result !== false,
    schedule: options.schedule !== false,
    formula: options.formula !== false,
    enteredOnly: options.enteredOnly === true,
  }
}

function resultMarkup(outcome, options) {
  if (!outcome?.ok) {
    return options.result
      ? `<p class="error">${escapeHtml(outcome?.formError || 'This calculation could not be completed.')}</p>`
      : ''
  }
  const { headline, stats, chart, schedule, formula } = outcome.result
  const parts = []
  if (options.result) {
    const statRows = (stats || []).map((stat) => `<tr><th>${escapeHtml(stat.label)}</th><td>${escapeHtml(stat.value)}</td></tr>`).join('')
    const chartMarkup = chart ? renderChart(chart, { print: true }) : ''
    parts.push(`
      <p class="result-label">${escapeHtml(headline.label)}</p>
      <p class="headline">${escapeHtml(headline.value)}</p>
      ${headline.detail ? `<p class="detail">${escapeHtml(headline.detail)}</p>` : ''}
      ${headline.warning ? `<p class="error">${escapeHtml(headline.warning)}</p>` : ''}
      ${statRows ? `<h3>Outputs</h3><table class="fields"><tbody>${statRows}</tbody></table>` : ''}
      ${chartMarkup}
    `)
  }
  if (options.schedule) {
    const scheduleMarkup = schedule?.rows?.length ? dataTable(schedule.columns, schedule.rows) : '<p class="empty">No schedule.</p>'
    parts.push(`<h3>Schedule</h3>${scheduleMarkup}`)
  }
  if (options.formula && Array.isArray(formula) && formula.length) {
    parts.push(`<h3>Formula</h3><pre>${escapeHtml(formula.join('\n'))}</pre>`)
  }
  return parts.join('')
}

function savedWhen(savedAt) {
  return new Date(savedAt).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function reportDocument(entries, title, options) {
  const chosen = reportOptions(options)
  const sheets = entries.map((entry) => {
    const result = resultMarkup(entry.outcome, chosen)
    return `
    <article class="sheet">
      <p class="eyebrow">${escapeHtml(entry.calc.group)}</p>
      <h2>${escapeHtml(entry.calc.name)}</h2>
      <p class="when">Saved ${escapeHtml(savedWhen(entry.savedAt))}</p>
      ${chosen.inputs ? `<h3>Inputs</h3>${inputsMarkup(entry.calc, entry.values, chosen.enteredOnly)}` : ''}
      ${result ? `<h3>Result</h3>${result}` : ''}
    </article>
  `
  }).join('')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1a1a1a; font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; }
    h2 { margin: 0; font-size: 18px; font-weight: 600; }
    h3 { margin: 18px 0 6px; font-size: 13px; font-weight: 600; }
    h4 { margin: 12px 0 4px; font-size: 12px; font-weight: 600; }
    p { margin: 0 0 6px; }
    .cover { margin-bottom: 18px; }
    .eyebrow { margin: 0; color: #666; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
    .when, .detail, .empty { color: #444; }
    .result-label { color: #666; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    .headline { font-size: 22px; font-weight: 600; }
    .error { color: #8a3030; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 8px; }
    th, td { padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { font-weight: 500; text-align: left; }
    td.right, th.right { text-align: right; }
    .fields th { width: 46%; color: #333; }
    pre { margin: 0; white-space: pre-wrap; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .chart-block { margin: 8px 0 12px; max-width: 420px; }
    .chart-block svg { width: 100%; height: auto; }
    .chart-x, .legend { display: flex; justify-content: space-between; gap: 8px; color: #555; font-size: 10px; }
    .legend { justify-content: flex-start; flex-wrap: wrap; margin-top: 4px; }
    .legend-item { display: inline-flex; align-items: center; gap: 4px; }
    .legend-item i { width: 10px; height: 2px; background: #1a1a1a; display: inline-block; }
    .sheet { break-after: page; }
    .sheet:last-child { break-after: auto; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <header class="cover">
    <p class="eyebrow">Melon</p>
    <h1>${escapeHtml(title.replace(/^Melon — /, ''))}</h1>
    <p class="when">${escapeHtml(savedWhen(Date.now()))}</p>
  </header>
  ${sheets}
</body>
</html>`
}
