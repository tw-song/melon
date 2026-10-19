export function money(n) {
  const value = Math.abs(n) < 0.005 ? 0 : n
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function compactMoney(n) {
  const abs = Math.abs(n)
  if (abs >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n)
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function plain(n, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n)
}

export function percentNumber(n, digits = 2) {
  return `${plain(n, digits)}%`
}

export function sig(n) {
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(n)
}

export function parseLooseNumber(raw) {
  const cleaned = String(raw ?? '').trim().replace(/[$,%\s]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null
  const normalized = cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned
  if (normalized === '' || normalized === '-') return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function formatDuration(months) {
  if (!Number.isFinite(months) || months <= 0) return '0 months'
  let whole = Math.floor(months + 1e-9)
  let days = Math.round((months - whole) * 30)
  if (days >= 30) {
    whole += 1
    days = 0
  }
  const years = Math.floor(whole / 12)
  const rest = whole % 12
  const parts = []
  if (years) parts.push(years === 1 ? '1 year' : `${years} years`)
  if (rest) parts.push(rest === 1 ? '1 month' : `${rest} months`)
  if (days) parts.push(days === 1 ? '1 day' : `${days} days`)
  return parts.join(' ') || '0 months'
}

export function formatYears(years) {
  if (Math.abs(years - 1) < 1e-9) return '1 year'
  const digits = Number.isInteger(years) ? 0 : 1
  return `${plain(years, digits)} years`
}

export function formatAge(age) {
  const rounded = Math.round(age * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : plain(rounded, 1)
}

export function addMonths(start, months) {
  const date = new Date(start.getTime())
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return date
}

export function formatMonthYear(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function timeAgo(ts) {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
