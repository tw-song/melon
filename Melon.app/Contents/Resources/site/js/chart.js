import { compactMoney } from './format.js'
import { escapeHtml } from './html.js'

const seriesColors = ['#e4e4e4', '#6d6d6d', '#8aa4c4']
const printColors = ['#1a1a1a', '#5c5c5c', '#3d5a80']

export function renderChart(chart, options = {}) {
  if (!chart?.series?.length || !chart.series[0].values?.length) return ''
  const print = Boolean(options.print)
  const colors = print ? printColors : seriesColors
  const gridStroke = print ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.06)'
  const labelFill = print ? '#555' : '#737373'
  const areaFill = print ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)'
  const guideStroke = print ? '#3d5a80' : 'rgba(128,176,255,0.8)'
  const values = chart.series.flatMap((series) => series.values)
  if (chart.guides) values.push(...chart.guides.map((guide) => guide.value))
  if (values.some((value) => !Number.isFinite(value))) return ''

  const width = 360
  const height = 148
  const padL = 4
  const padR = 48
  const padT = 12
  const padB = 8
  const plotW = width - padL - padR
  const plotH = height - padT - padB
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  let min = dataMin >= 0 ? 0 : dataMin
  let max = dataMax
  if (max === min) max = min + 1
  max += (max - min) * 0.08

  const yAt = (value) => padT + ((max - value) / (max - min)) * plotH
  const xAt = (index, count) => (count === 1 ? padL + plotW / 2 : padL + (index / (count - 1)) * plotW)

  const grid = [0, 0.5, 1].map((t) => {
    const y = padT + t * plotH
    const label = compactMoney(max - t * (max - min))
    return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${gridStroke}" />
      <text x="${width - 4}" y="${y + 3}" text-anchor="end" fill="${labelFill}" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeHtml(label)}</text>`
  }).join('')

  const seriesMarkup = chart.series.map((series, seriesIndex) => {
    const coords = series.values.map((value, index) => [xAt(index, series.values.length), yAt(value)])
    const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join(' ')
    const color = colors[seriesIndex] || colors[0]
    const last = coords[coords.length - 1]
    let area = ''
    if (seriesIndex === 0 && coords.length > 1) {
      const base = yAt(min)
      area = `<path d="${line} L${last[0].toFixed(2)} ${base.toFixed(2)} L${coords[0][0].toFixed(2)} ${base.toFixed(2)} Z" fill="${areaFill}" />`
    }
    return `${area}<path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="${last[0].toFixed(2)}" cy="${last[1].toFixed(2)}" r="2.4" fill="${color}" />`
  }).join('')

  const guides = (chart.guides || []).map((guide) => {
    const y = yAt(guide.value)
    return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${guideStroke}" stroke-dasharray="3 3" />`
  }).join('')

  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.label || 'Chart')}">${grid}${seriesMarkup}${guides}</svg>`
  const legend = [
    ...chart.series.map((series, index) => `<span class="legend-item"><i style="background:${colors[index] || colors[0]}"></i>${escapeHtml(series.name)}</span>`),
    ...(chart.guides || []).map((guide) => `<span class="legend-item"><i class="dashed"></i>${escapeHtml(guide.label)}</span>`),
  ].join('')
  const axis = chart.xLabels
    ? `<div class="chart-x"><span>${escapeHtml(chart.xLabels[0])}</span><span>${escapeHtml(chart.xLabels[1])}</span></div>`
    : ''
  return `<div class="chart-block">${svg}${axis}<div class="legend">${legend}</div></div>`
}
