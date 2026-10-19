import { money, parseLooseNumber, plain } from './format.js'

export function optionLabel(field, raw, empty = '') {
  const option = (field.options || []).find((item) => item.value === raw)
  return option?.label || (raw ? String(raw) : empty)
}

export function shownNumber(field, raw) {
  const blank = raw === undefined || raw === null || String(raw).trim() === ''
  if (blank) return field.required ? null : 0
  return parseLooseNumber(raw)
}

export function numberDigits(n) {
  return Number.isInteger(n) ? 0 : 2
}

export function formatNumber(field, raw, empty = '—') {
  const n = shownNumber(field, raw)
  if (n === null) return raw ? String(raw) : empty
  if (field.prefix === '$') return money(n)
  return `${plain(n, numberDigits(n))}${field.suffix || ''}`
}

export function displayRaw(field, values) {
  if (field.kind === 'number' && typeof field.displayValue === 'function' && field.displayValue(values) != null) {
    return field.displayValue(values)
  }
  return values[field.key]
}

export function spanText(field, values) {
  return field.parts.map((part) => {
    const n = parseLooseNumber(values[part.key])
    const shown = n === null ? '0' : plain(n, numberDigits(n))
    return `${shown} ${part.label.toLowerCase()}`
  }).join(', ')
}

export function lineIsBlank(field, row) {
  const writable = field.columns.filter((column) => column.type !== 'select')
  if (!writable.length) return false
  return writable.every((column) => !String(row[column.key] ?? '').trim())
}
