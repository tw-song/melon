import { fieldsForReport, parseLines, parseSaleItems } from './calculators.js'
import { displayRaw, lineIsBlank, optionLabel, shownNumber, spanText } from './fields.js'

function numericCell(field, raw) {
  const blank = raw === undefined || raw === null || String(raw).trim() === ''
  const n = shownNumber(field, raw)
  if (n === null) return blank && field.required ? '' : String(raw ?? '')
  if (field.prefix === '$') return { n, z: 'money' }
  if (field.suffix === '%') return { n: n / 100, z: 'percent' }
  return { n, z: 'number' }
}

function textCell(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '—') return raw === '—' ? raw : ''
  if (/^\$[\d,]+(?:\.\d+)?$/.test(raw)) return { n: Number(raw.replace(/[$,]/g, '')), z: 'money' }
  if (/^-\$[\d,]+(?:\.\d+)?$/.test(raw)) return { n: -Number(raw.replace(/[-$,]/g, '')), z: 'money' }
  if (/^[\d,]+(?:\.\d+)?%$/.test(raw)) return { n: Number(raw.replace(/[%,]/g, '')) / 100, z: 'percent' }
  if (/^-[\d,]+(?:\.\d+)?%$/.test(raw)) return { n: -Number(raw.slice(1).replace(/[%,]/g, '')) / 100, z: 'percent' }
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return { n: Number(raw), z: 'number' }
  return raw
}

function fieldValue(field, values) {
  if (field.kind === 'number' || field.kind === 'slider') return numericCell(field, displayRaw(field, values))
  if (field.kind === 'segment' || field.kind === 'select' || field.kind === 'combo') return optionLabel(field, values[field.key])
  if (field.kind === 'keypad' || field.kind === 'text') return String(values[field.key] || '').trim()
  if (field.kind === 'span') return spanText(field, values)
  return ''
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

function pushTable(rows, columns, body) {
  rows.push(columns.map((column) => ({ v: column.label, bold: true })))
  for (const row of body) {
    rows.push(columns.map((column) => {
      const value = row[column.key]
      if (value && typeof value === 'object') return value
      return textCell(value ?? '')
    }))
  }
}

function workbookOptions(options = {}) {
  return {
    inputs: options.inputs !== false,
    result: options.result !== false,
    schedule: options.schedule !== false,
    formula: options.formula !== false,
    enteredOnly: options.enteredOnly === true,
  }
}

export function sheetsForEntries(entries, options) {
  const chosen = workbookOptions(options)
  return entries.map((entry) => {
    const rows = [
      [{ v: entry.calc.name, bold: true }],
      ['Group', entry.calc.group],
      ['Saved', savedWhen(entry.savedAt)],
    ]
    const fields = chosen.inputs ? fieldsForReport(entry.calc, entry.values, chosen.enteredOnly) : []
    if (chosen.inputs) {
      rows.push([])
      rows.push([{ v: 'Inputs', bold: true }])
      if (!fields.length) rows.push(['No entered inputs.'])
    }
    const scalar = fields.filter((field) => field.kind !== 'lines' && field.kind !== 'items')
    if (scalar.length) {
      rows.push([{ v: 'Field', bold: true }, { v: 'Value', bold: true }])
      for (const field of scalar) rows.push([field.label, fieldValue(field, entry.values)])
    }
    for (const field of fields) {
      if (field.kind === 'lines') {
        const body = parseLines(entry.values[field.key], field.blank).filter((row) => !lineIsBlank(field, row))
        rows.push([])
        rows.push([{ v: field.label, bold: true }])
        if (!body.length) {
          rows.push(['None'])
          continue
        }
        pushTable(
          rows,
          field.columns.map((column) => ({ key: column.key, label: column.label })),
          body.map((row) => {
            const next = {}
            for (const column of field.columns) {
              const shown = typeof column.value === 'function' ? column.value(row, entry.values) : row[column.key]
              if (column.type === 'select') next[column.key] = optionLabel(column, row[column.key])
              else if (column.type === 'number') next[column.key] = numericCell(column, shown)
              else next[column.key] = String(shown ?? '').trim()
            }
            return next
          }),
        )
        continue
      }
      if (field.kind === 'items') {
        const items = parseSaleItems(entry.values[field.key])
        rows.push([])
        rows.push([{ v: field.label, bold: true }])
        pushTable(
          rows,
          [
            { key: 'comment', label: 'Comment' },
            { key: 'price', label: 'Price' },
            { key: 'quantity', label: 'Qty' },
          ],
          items.map((item) => ({
            comment: item.comment.trim(),
            price: numericCell({ prefix: '$' }, item.price),
            quantity: numericCell({}, item.quantity),
          })),
        )
      }
    }

    const outcome = entry.outcome
    const includeResult = chosen.result || chosen.schedule || chosen.formula
    if (includeResult) {
      rows.push([])
      rows.push([{ v: 'Result', bold: true }])
    }
    if (!outcome?.ok) {
      if (chosen.result) rows.push([outcome?.formError || 'This calculation could not be completed.'])
      return { name: entry.calc.name, rows }
    }
    const { headline, stats, schedule, formula } = outcome.result
    if (chosen.result) {
      rows.push([headline.label, textCell(headline.value)])
      if (headline.detail) rows.push([headline.detail])
      if (headline.warning) rows.push([headline.warning])
      if (stats?.length) {
        rows.push([])
        rows.push([{ v: 'Outputs', bold: true }])
        rows.push([{ v: 'Label', bold: true }, { v: 'Value', bold: true }])
        for (const stat of stats) rows.push([stat.label, textCell(stat.value)])
      }
    }
    if (chosen.schedule && schedule?.rows?.length) {
      rows.push([])
      rows.push([{ v: 'Schedule', bold: true }])
      pushTable(rows, schedule.columns, schedule.rows)
    }
    if (chosen.formula && Array.isArray(formula) && formula.length) {
      rows.push([])
      rows.push([{ v: 'Formula', bold: true }])
      for (const line of formula) rows.push([line])
    }
    return { name: entry.calc.name, rows }
  })
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function colName(index) {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function cellXml(ref, cell) {
  if (cell == null || cell === '') return ''
  if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
  if (typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'n')) {
    const style = cell.z === 'money' ? 2 : cell.z === 'percent' ? 3 : 0
    return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${cell.n}</v></c>`
  }
  const value = typeof cell === 'object' ? cell.v : cell
  const bold = typeof cell === 'object' && cell.bold
  if (value == null || value === '') return ''
  return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
}

function sheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const cells = (row || []).map((cell, column) => cellXml(`${colName(column)}${rowIndex + 1}`, cell)).filter(Boolean).join('')
    return cells ? `<row r="${rowIndex + 1}">${cells}</row>` : `<row r="${rowIndex + 1}"/>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="8" width="22" customWidth="1"/></cols>
  <sheetData>${body}</sheetData>
</worksheet>`
}

function sheetName(name, used) {
  const cleaned = String(name || 'Sheet').replace(/[\\/*?:[\]]/g, ' ').trim() || 'Sheet'
  const base = cleaned.slice(0, 31)
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let n = 2; n < 100; n += 1) {
    const suffix = ` (${n})`
    const next = `${base.slice(0, 31 - suffix.length)}${suffix}`
    if (!used.has(next)) {
      used.add(next)
      return next
    }
  }
  return base
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u16(n) {
  return Uint8Array.of(n & 0xff, (n >> 8) & 0xff)
}

function u32(n) {
  return Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff)
}

function zipStore(files) {
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    const data = new TextEncoder().encode(file.text)
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ])
    locals.push(local)
    centrals.push(concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]))
    offset += local.length
  }
  const central = concat(centrals)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return concat([...locals, central, end])
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="$#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.00%"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`

export function workbookFile(sheets) {
  const used = new Set()
  const named = sheets.map((sheet, index) => ({
    name: sheetName(sheet.name, used),
    file: `xl/worksheets/sheet${index + 1}.xml`,
    text: sheetXml(sheet.rows),
  }))
  const overrides = named.map((sheet) => (
    `<Override PartName="/${sheet.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('')
  const workbookSheets = named.map((sheet, index) => (
    `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('')
  const workbookRels = [
    ...named.map((sheet, index) => (
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )),
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ].join('')
  const files = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overrides}
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`,
    },
    { name: 'xl/styles.xml', text: STYLES },
    ...named.map((sheet) => ({ name: sheet.file, text: sheet.text })),
  ]
  return zipStore(files)
}
