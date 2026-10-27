import { renderChart } from './chart.js'
import { MAX_SALE_ITEMS, blankInputs, calculators, defaultInputs, getCalculator, getExchangeState, isCalcId, normalizePassiveSources, noteDtiEdit, parseLines, parseSaleItems, setExchangeRates, setProgramContext, visibleFields } from './calculators.js'
import { timeAgo } from './format.js'
import { escapeHtml } from './html.js'
import { icon } from './icons.js'
import { reportDocument } from './report.js'
import { sheetsForEntries, workbookFile } from './workbook.js'

const STORAGE_KEY = 'finance.v1'
const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'

const state = {
  activeId: 'compound',
  inputs: defaultInputs(),
  snapshots: [],
  sidebarOpen: true,
  panelOpen: true,
  resultsOpen: true,
  activity: 'calculators',
  panelTab: 'schedule',
  panelHeight: 248,
  historyQuery: '',
  paletteOpen: false,
  paletteQuery: '',
  paletteIndex: 0,
  paletteCommands: [],
  examplesOpen: false,
  masterOpen: false,
  masterIds: [],
  masterEnteredOnly: false,
  masterParts: { inputs: true, result: true, schedule: true, formula: true },
  copyLabel: 'Copy',
  saveLabel: 'Save',
  editedAt: {},
  comboKey: '',
  comboQuery: '',
  comboIndex: 0,
}

function isSnapshot(value) {
  return Boolean(
    value
    && typeof value.id === 'string'
    && isCalcId(value.calcId)
    && value.inputs
    && typeof value.inputs === 'object'
    && typeof value.title === 'string'
    && typeof value.summary === 'string'
    && typeof value.savedAt === 'number',
  )
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (isCalcId(parsed.activeId)) state.activeId = parsed.activeId
    if (parsed.sidebarOpen === false) state.sidebarOpen = false
    if (parsed.panelOpen === false) state.panelOpen = false
    if (parsed.resultsOpen === false) state.resultsOpen = false
    if (parsed.inputs && typeof parsed.inputs === 'object') {
      for (const calc of calculators) {
        const saved = parsed.inputs[calc.id]
        if (!saved || typeof saved !== 'object') continue
        const next = { ...calc.defaults }
        for (const field of calc.fields) {
          if (field.kind === 'span') {
            for (const part of field.parts) {
              if (typeof saved[part.key] === 'string') next[part.key] = saved[part.key]
            }
          } else if (typeof saved[field.key] === 'string') next[field.key] = saved[field.key]
        }
        if (['rent', 'carloan', 'carlease'].includes(calc.id) && typeof saved.termUnit === 'string') {
          if (saved.termUnit === 'months') {
            next.years = '0'
            next.days = '0'
            if (typeof saved.months === 'string') next.months = saved.months
          } else {
            next.months = '0'
            next.days = '0'
            if (typeof saved.years === 'string') next.years = saved.years
          }
        }
        if (calc.id === 'dti' && typeof saved.other === 'string' && typeof saved.others !== 'string') {
          next.others = JSON.stringify([{ comment: '', amount: saved.other }])
        }
        if (calc.id === 'dti' && typeof next.passive === 'string') next.passive = normalizePassiveSources(next.passive)
        if (calc.id === 'percent' && typeof saved.paid !== 'string' && saved.period === 'monthly') next.paid = 'monthly'
        state.inputs[calc.id] = next
      }
    }
    if (parsed.editedAt && typeof parsed.editedAt === 'object') {
      for (const id of ['mortgage', 'rent']) {
        if (typeof parsed.editedAt[id] === 'number') state.editedAt[id] = parsed.editedAt[id]
      }
    }
    if (Array.isArray(parsed.snapshots)) state.snapshots = parsed.snapshots.filter(isSnapshot).slice(0, 30)
  } catch {
    // Keep the built-in examples when storage can't be read.
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      activeId: state.activeId,
      inputs: state.inputs,
      snapshots: state.snapshots,
      sidebarOpen: state.sidebarOpen,
      panelOpen: state.panelOpen,
      resultsOpen: state.resultsOpen,
      editedAt: state.editedAt,
    }))
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function computeCurrent() {
  setProgramContext(state.inputs, state.editedAt)
  return getCalculator(state.activeId).compute(state.inputs[state.activeId])
}

function markEdited() {
  if (state.activeId === 'mortgage' || state.activeId === 'rent') {
    state.editedAt[state.activeId] = Date.now()
  }
}

function hintText(field, values) {
  if (typeof field.hint === 'function') return field.hint(values) || ''
  return field.hint || ''
}

function setPressed(action, pressed) {
  document.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-pressed', String(pressed))
}

function renderChrome() {
  const calc = getCalculator(state.activeId)
  document.getElementById('crumb').innerHTML = `<span>${escapeHtml(calc.group)}</span><span class="crumb-sep">/</span><span>${escapeHtml(calc.name)}</span>`
  document.title = `${calc.name} — Melon`
  setPressed('toggle-sidebar', state.sidebarOpen)
  setPressed('toggle-panel', state.panelOpen)
  setPressed('toggle-results', state.resultsOpen)
  document.getElementById('sidebar').hidden = !state.sidebarOpen
  document.getElementById('results').hidden = !state.resultsOpen
  document.getElementById('panel').hidden = !state.panelOpen
  if (state.panelOpen) document.getElementById('panel').style.height = `${state.panelHeight}px`
}

function renderActivity() {
  const items = [
    ['calculators', 'grid', 'Calculators'],
    ['history', 'clock', 'Saved'],
  ]
  document.getElementById('activity').innerHTML = items.map(([name, glyph, label]) => `
    <button type="button" class="activity-btn" data-action="set-activity" data-name="${name}" aria-pressed="${state.activity === name}" title="${label}">
      ${icon(glyph, 18)}
    </button>
  `).join('')
}

function renderCalcList() {
  return ['Growth', 'Borrowing', 'Credit', 'Spending', 'Pay', 'Planning', 'Net worth', 'Currency', 'Scientific', 'Tools'].map((group) => {
    const items = calculators.filter((calc) => calc.group === group).map((calc) => `
      <button type="button" class="nav-item" id="calc-${calc.id}" data-action="select-calc" data-id="${calc.id}" ${calc.id === state.activeId ? 'aria-current="true"' : ''}>
        ${icon(calc.icon, 15)}
        <span>${escapeHtml(calc.name)}</span>
      </button>
    `).join('')
    return `<div class="group-label">${group}</div>${items}`
  }).join('')
}

function renderHistoryShell() {
  return `
    <div class="group-label history-label">
      <span>Saved <span class="count">${state.snapshots.length}</span></span>
      ${state.snapshots.length ? `<span class="history-actions"><button type="button" class="history-pdf" data-action="open-master" title="Choose what goes in one PDF or Excel file">File</button></span>` : ''}
    </div>
    ${state.snapshots.length ? `<input id="history-filter" class="sidebar-search" placeholder="Filter saved" aria-label="Filter saved calculations" value="${escapeHtml(state.historyQuery)}" />` : ''}
    <div id="history-list"></div>
  `
}

function renderHistoryList() {
  const list = document.getElementById('history-list')
  if (!list) return
  const query = state.historyQuery.trim().toLowerCase()
  const items = state.snapshots.filter((snap) => {
    if (!query) return true
    return snap.title.toLowerCase().includes(query) || snap.summary.toLowerCase().includes(query)
  })
  if (state.snapshots.length === 0) {
    list.innerHTML = `<div class="empty"><p>No saved calculations</p><p class="empty-hint">Save a result, then choose what goes in one PDF or Excel file.</p></div>`
    return
  }
  if (items.length === 0) {
    list.innerHTML = `<div class="empty"><p>No matches</p></div>`
    return
  }
  list.innerHTML = items.map((snap) => `
    <div class="history-item">
      <button type="button" class="history-main" data-action="restore" data-id="${snap.id}">
        <span class="history-title"><span>${escapeHtml(snap.title)}</span><span class="history-time">${escapeHtml(timeAgo(snap.savedAt))}</span></span>
        <span class="history-summary">${escapeHtml(snap.summary)}</span>
      </button>
      <button type="button" class="history-download" data-action="download-snapshot" data-id="${snap.id}" aria-label="Download ${escapeHtml(snap.title)} PDF" title="Download PDF">${icon('download', 14)}</button>
      <button type="button" class="history-excel" data-action="download-snapshot-excel" data-id="${snap.id}" aria-label="Download ${escapeHtml(snap.title)} Excel" title="Download Excel">${icon('sheet', 14)}</button>
      <button type="button" class="history-delete" data-action="delete-snapshot" data-id="${snap.id}" aria-label="Delete snapshot">×</button>
    </div>
  `).join('')
}

function renderSidebar() {
  const sidebar = document.getElementById('sidebar')
  if (state.activity === 'history') {
    sidebar.innerHTML = renderHistoryShell()
    renderHistoryList()
    return
  }
  sidebar.innerHTML = renderCalcList()
}

function fieldMessage(field, error, values) {
  const text = error || hintText(field, values) || ''
  return `<div class="${error ? 'field-error' : 'field-hint'}" data-msg="${field.key}" ${text ? '' : 'hidden'}>${escapeHtml(text)}</div>`
}

function itemMessage(key, error) {
  return `<div class="${error ? 'field-error' : 'field-hint'}" data-msg="${key}" ${error ? '' : 'hidden'}>${escapeHtml(error || '')}</div>`
}

function applyFieldMessage(control, msg, error, hint) {
  control?.classList.toggle('invalid', Boolean(error))
  if (!msg) return
  const text = error || hint || ''
  msg.textContent = text
  msg.className = error ? 'field-error' : 'field-hint'
  msg.hidden = !text
}

function renderField(field, values, errors) {
  const value = values[field.key] ?? ''
  const error = errors[field.key] || ''
  if (field.kind === 'span') {
    const partError = field.parts.map((part) => errors[part.key]).find(Boolean) || error
    const message = partError || hintText(field, values)
    return `
      <div class="field">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="span-row">
          ${field.parts.map((part) => `
            <label>
              <span class="field-label">${escapeHtml(part.label)}</span>
              <span class="control${errors[part.key] || (field.required && error) ? ' invalid' : ''}" data-field="${part.key}">
                <input name="${part.key}" class="no-prefix" inputmode="decimal" spellcheck="false" aria-label="${escapeHtml(`${field.label} ${part.label}`)}" value="${escapeHtml(values[part.key] ?? '')}" />
              </span>
            </label>
          `).join('')}
        </div>
        <div class="${partError ? 'field-error' : 'field-hint'}" data-msg="${field.key}" ${message ? '' : 'hidden'}>${escapeHtml(message)}</div>
      </div>
    `
  }
  if (field.kind === 'segment') {
    return `
      <div class="field">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="segment" role="group" aria-label="${escapeHtml(field.label)}">
          ${field.options.map((option) => `
            <button type="button" data-action="set-option" data-key="${field.key}" data-value="${option.value}" aria-pressed="${value === option.value}">${escapeHtml(option.label)}</button>
          `).join('')}
        </div>
        ${fieldMessage(field, error, values)}
      </div>
    `
  }
  if (field.kind === 'text') {
    return `
      <label class="field">
        <span class="field-label">${escapeHtml(field.label)}</span>
        <span class="control${error ? ' invalid' : ''}" data-field="${field.key}">
          <input name="${field.key}" class="no-prefix" placeholder="${escapeHtml(field.placeholder || 'Optional')}" spellcheck="${field.spellcheck === false ? 'false' : 'true'}" value="${escapeHtml(value)}" />
        </span>
        ${fieldMessage(field, error, values)}
      </label>
    `
  }
  if (field.kind === 'items') {
    const items = parseSaleItems(value)
    return `
      <div class="field">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="item-list">
          ${items.map((item, index) => `
            <div class="item-card">
              <label class="item-comment">
                <span class="field-label">Comment</span>
                <span class="control${errors[`item-${index}-comment`] ? ' invalid' : ''}" data-field="item-${index}-comment">
                  <input class="no-prefix" placeholder="Optional" spellcheck="true" data-item-index="${index}" data-item-key="comment" aria-label="Comment for item ${index + 1}" value="${escapeHtml(item.comment)}" />
                </span>
                ${itemMessage(`item-${index}-comment`, errors[`item-${index}-comment`])}
              </label>
              <div class="item-amounts">
                <label>
                  <span class="field-label">Price</span>
                  <span class="control${errors[`item-${index}-price`] ? ' invalid' : ''}" data-field="item-${index}-price">
                    <span class="affix">$</span>
                    <input inputmode="decimal" spellcheck="false" data-item-index="${index}" data-item-key="price" aria-label="Price for item ${index + 1}" value="${escapeHtml(item.price)}" />
                  </span>
                  ${itemMessage(`item-${index}-price`, errors[`item-${index}-price`])}
                </label>
                <label>
                  <span class="field-label">Qty</span>
                  <span class="control${errors[`item-${index}-quantity`] ? ' invalid' : ''}" data-field="item-${index}-quantity">
                    <input class="no-prefix" inputmode="decimal" spellcheck="false" data-item-index="${index}" data-item-key="quantity" aria-label="Quantity for item ${index + 1}" value="${escapeHtml(item.quantity)}" />
                  </span>
                  ${itemMessage(`item-${index}-quantity`, errors[`item-${index}-quantity`])}
                </label>
                ${items.length > 1 ? `
                  <div class="item-remove-wrap">
                    <span class="field-label" aria-hidden="true">Remove</span>
                    <button type="button" class="item-remove" data-action="remove-item" data-index="${index}" aria-label="Remove item ${index + 1}">×</button>
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('')}
          <button type="button" class="btn item-add" data-action="add-item" ${items.length >= MAX_SALE_ITEMS ? 'disabled' : ''}>Add item</button>
        </div>
        ${fieldMessage(field, error, values)}
      </div>
    `
  }
  if (field.kind === 'lines') {
    const rows = parseLines(value, field.blank)
    const limit = field.max || 8
    const noun = field.itemNoun || 'item'
    const wide = field.columns.filter((column) => column.wide)
    const compact = field.columns.filter((column) => !column.wide)
    const lineControl = (column, row, index) => {
      const key = `${field.key}-${index}-${column.key}`
      const label = `${column.label} for ${noun} ${index + 1}`
      const locked = typeof column.readOnly === 'function' ? column.readOnly(row, values) : false
      const shown = typeof column.value === 'function' ? column.value(row, values) : row[column.key]
      if (column.type === 'select') {
        return `
          <span class="control${errors[key] ? ' invalid' : ''}" data-field="${key}">
            <select data-line-field="${field.key}" data-line-index="${index}" data-line-key="${column.key}" aria-label="${escapeHtml(label)}">
              ${column.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === row[column.key] ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
            </select>
            <span class="chevron">${icon('chevron', 14)}</span>
          </span>
        `
      }
      if (column.type === 'text') {
        return `
          <span class="control${errors[key] ? ' invalid' : ''}${locked ? ' locked' : ''}" data-field="${key}">
            <input class="no-prefix" placeholder="${escapeHtml(column.placeholder || '')}" spellcheck="${column.spellcheck ? 'true' : 'false'}" ${locked ? 'readonly' : ''} data-line-field="${field.key}" data-line-index="${index}" data-line-key="${column.key}" aria-label="${escapeHtml(label)}" value="${escapeHtml(shown ?? '')}" />
          </span>
        `
      }
      return `
        <span class="control${errors[key] ? ' invalid' : ''}${locked ? ' locked' : ''}" data-field="${key}">
          ${column.prefix ? `<span class="affix">${escapeHtml(column.prefix)}</span>` : ''}
          <input class="${column.prefix ? '' : 'no-prefix'}" inputmode="decimal" spellcheck="false" ${locked ? 'readonly' : ''} data-line-field="${field.key}" data-line-index="${index}" data-line-key="${column.key}" aria-label="${escapeHtml(label)}" value="${escapeHtml(shown ?? '')}" />
          ${column.suffix ? `<span class="affix">${escapeHtml(column.suffix)}</span>` : ''}
        </span>
      `
    }
    const lineField = (column, row, index) => `
      <label>
        <span class="field-label">${escapeHtml(column.label)}</span>
        ${lineControl(column, row, index)}
        ${itemMessage(`${field.key}-${index}-${column.key}`, errors[`${field.key}-${index}-${column.key}`])}
      </label>
    `
    const removeButton = (index) => rows.length < 2 ? '' : `
      <div class="item-remove-wrap">
        <span class="field-label" aria-hidden="true">Remove</span>
        <button type="button" class="item-remove" data-action="remove-line" data-field="${field.key}" data-index="${index}" aria-label="Remove ${escapeHtml(noun)} ${index + 1}">×</button>
      </div>
    `
    return `
      <div class="field">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="item-list">
          ${rows.map((row, index) => wide.length ? `
            <div class="item-card">
              ${wide.map((column) => lineField(column, row, index)).join('')}
              <div class="line-amounts card-figures${compact.length <= 2 ? ' card-figures-short' : ''}">
                ${compact.map((column) => lineField(column, row, index)).join('')}
                ${removeButton(index)}
              </div>
            </div>
          ` : `
            <div class="line-amounts">
              ${field.columns.map((column) => lineField(column, row, index)).join('')}
              ${removeButton(index)}
            </div>
          `).join('')}
          <button type="button" class="btn item-add" data-action="add-line" data-field="${field.key}" ${rows.length >= limit ? 'disabled' : ''}>${escapeHtml(field.addLabel || 'Add')}</button>
        </div>
        ${fieldMessage(field, error, values)}
      </div>
    `
  }
  if (field.kind === 'keypad') {
    const keys = field.keys || [
      ['c', 'C', 'op'], ['back', '⌫', 'op'], ['%', '%', 'op'], ['/', '÷', 'op'],
      ['7', '7', ''], ['8', '8', ''], ['9', '9', ''], ['*', '×', 'op'],
      ['4', '4', ''], ['5', '5', ''], ['6', '6', ''], ['-', '−', 'op'],
      ['1', '1', ''], ['2', '2', ''], ['3', '3', ''], ['+', '+', 'op'],
      ['(', '(', ''], ['0', '0', ''], ['.', '.', ''], [')', ')', ''],
      ['=', '=', 'equals wide'],
    ]
    return `
      <div class="field">
        <span class="field-label">${escapeHtml(field.label)}</span>
        <div class="calc-pad${field.padClass ? ` ${field.padClass}` : ''}${error ? ' invalid' : ''}" data-field="${field.key}">
          <div class="calc-display" data-calc-display>${escapeHtml(displayExpression(value))}</div>
          <div class="calc-keys">
            ${keys.map(([key, label, cls]) => `<button type="button" class="calc-key ${cls}" data-action="key" data-key="${key}" aria-label="${key === 'back' ? 'Backspace' : key === 'c' ? 'Clear' : label}">${escapeHtml(label)}</button>`).join('')}
          </div>
        </div>
        ${fieldMessage(field, error, values)}
      </div>
    `
  }
  if (field.kind === 'combo') {
    const open = state.comboKey === field.key
    const selected = (field.options || []).find((option) => option.value === value)
    const label = selected?.label || value || 'Choose'
    return `
      <div class="field combo">
        <span class="field-label">${escapeHtml(field.label)}</span>
        <button type="button" class="control combo-button${error ? ' invalid' : ''}" data-field="${field.key}" data-action="toggle-combo" data-key="${field.key}" data-combo-button="${field.key}" aria-expanded="${open}" aria-haspopup="listbox">
          <span>${escapeHtml(label)}</span>
          <span class="chevron">${icon('chevron', 14)}</span>
        </button>
        <div class="combo-menu" data-combo-menu="${field.key}" role="listbox" aria-label="${escapeHtml(field.label)}" ${open ? '' : 'hidden'}>
          <input class="combo-search" data-combo-search="${field.key}" placeholder="Name or code" spellcheck="false" aria-label="Filter ${escapeHtml(field.label)}" value="${escapeHtml(open ? state.comboQuery : '')}" />
          <div class="combo-options" data-combo-options="${field.key}"></div>
        </div>
        ${fieldMessage(field, error, values)}
      </div>
    `
  }
  if (field.kind === 'slider') {
    const min = field.min ?? 0
    const max = field.max ?? 100
    const step = field.step ?? 1
    const current = value === '' ? String(min) : value
    return `
      <div class="field">
        <div class="range-row">
          <span class="field-label">${escapeHtml(field.label)}</span>
          <span class="range-readout" data-slider-value="${field.key}">${escapeHtml(current)}${escapeHtml(field.suffix || '')}</span>
        </div>
        <input class="range" type="range" name="${field.key}" min="${min}" max="${max}" step="${step}" value="${escapeHtml(current)}" aria-label="${escapeHtml(field.label)}" aria-valuetext="${escapeHtml(current)}${escapeHtml(field.suffix || '')}" />
        ${fieldMessage(field, error, values)}
      </div>
    `
  }
  if (field.kind === 'select') {
    return `
      <label class="field">
        <span class="field-label">${escapeHtml(field.label)}</span>
        <span class="control${error ? ' invalid' : ''}" data-field="${field.key}">
          <select name="${field.key}">
            ${field.options.map((option) => `<option value="${option.value}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
          <span class="chevron">${icon('chevron', 14)}</span>
        </span>
        ${fieldMessage(field, error, values)}
      </label>
    `
  }
  const shown = typeof field.displayValue === 'function' && field.displayValue(values) != null ? field.displayValue(values) : value
  const locked = typeof field.readOnly === 'function' ? field.readOnly(values) : Boolean(field.readOnly)
  return `
    <label class="field">
      <span class="field-label">${escapeHtml(field.label)}</span>
      <span class="control${error ? ' invalid' : ''}${locked ? ' locked' : ''}" data-field="${field.key}">
        ${field.prefix ? `<span class="affix">${escapeHtml(field.prefix)}</span>` : ''}
        <input name="${field.key}" class="${field.prefix ? '' : 'no-prefix'}" inputmode="decimal" spellcheck="false" autocapitalize="off" autocorrect="off" ${locked ? 'readonly' : ''} value="${escapeHtml(shown)}" />
        ${field.suffix ? `<span class="affix">${escapeHtml(field.suffix)}</span>` : ''}
      </span>
      ${fieldMessage(field, error, values)}
    </label>
  `
}

function renderEditorHeader() {
  const calc = getCalculator(state.activeId)
  const outcome = computeCurrent()
  const menu = state.examplesOpen ? `
    <div class="menu" role="menu">
      ${calc.examples.map((example, index) => `<button type="button" role="menuitem" data-action="load-example" data-index="${index}">${escapeHtml(example.name)}</button>`).join('')}
    </div>
  ` : ''
  document.getElementById('editor-header').innerHTML = `
    <div class="editor-heading">
      <div class="eyebrow">${escapeHtml(calc.group)}</div>
      <h1>${escapeHtml(calc.name)}</h1>
    </div>
    <div class="editor-actions">
      <button type="button" class="btn" data-action="toggle-examples" aria-expanded="${state.examplesOpen}">Examples</button>
      ${menu}
      <button type="button" class="btn" data-action="reset">Reset</button>
      <button type="button" class="btn" data-action="reset-all">Reset all</button>
      <button type="button" class="btn" data-action="save" ${outcome.ok ? '' : 'disabled'}>${escapeHtml(state.saveLabel)}</button>
    </div>
  `
}

function renderForm() {
  const calc = getCalculator(state.activeId)
  const values = state.inputs[state.activeId]
  const outcome = computeCurrent()
  const errors = outcome.fieldErrors || {}
  document.getElementById('editor-body').innerHTML = `
    <p class="lede">${escapeHtml(calc.description)}</p>
    <div id="form-error" class="form-error" ${outcome.ok || !outcome.formError ? 'hidden' : ''}>${escapeHtml(outcome.formError || '')}</div>
    <form id="calc-form" class="form" autocomplete="off">
      ${visibleFields(calc, values).map((field) => renderField(field, values, errors)).join('')}
    </form>
  `
  if (state.comboKey) {
    paintComboOptions(state.comboKey)
    placeCombo(state.comboKey)
  }
}

function renderEditor() {
  renderEditorHeader()
  renderForm()
}

function syncErrors(outcome) {
  const banner = document.getElementById('form-error')
  if (banner) {
    const message = !outcome.ok && outcome.formError ? outcome.formError : ''
    banner.hidden = !message
    banner.textContent = message
  }
  const calc = getCalculator(state.activeId)
  const errors = outcome.fieldErrors || {}
  const editor = document.getElementById('editor')
  const handled = new Set()
  const values = state.inputs[state.activeId]
  for (const field of calc.fields) {
    if (field.kind === 'segment') continue
    if (field.kind === 'span') {
      handled.add(field.key)
      let partError = ''
      for (const part of field.parts) {
        handled.add(part.key)
        if (errors[part.key]) partError = partError || errors[part.key]
        const partInvalid = Boolean(errors[part.key] || (field.required && errors[field.key]))
        editor.querySelector(`[data-field="${part.key}"]`)?.classList.toggle('invalid', partInvalid)
      }
      applyFieldMessage(null, editor.querySelector(`[data-msg="${field.key}"]`), partError || errors[field.key] || '', hintText(field, values))
      continue
    }
    handled.add(field.key)
    const control = editor.querySelector(`[data-field="${field.key}"]`)
    const msg = editor.querySelector(`[data-msg="${field.key}"]`)
    if (!control && !msg) continue
    applyFieldMessage(control, msg, errors[field.key] || '', hintText(field, values))
  }
  for (const msg of editor.querySelectorAll('[data-msg]')) {
    const key = msg.dataset.msg
    if (handled.has(key)) continue
    applyFieldMessage(editor.querySelector(`[data-field="${key}"]`), msg, errors[key] || '', '')
  }
  const save = document.querySelector('[data-action="save"]')
  if (save) save.disabled = !outcome.ok
}

function renderResults(outcome) {
  const results = document.getElementById('results')
  if (!outcome.ok) {
    results.innerHTML = `
      <div class="results-bar"><span class="eyebrow">Result</span></div>
      <div class="results-body"><p class="results-empty">${escapeHtml(outcome.formError || 'Enter valid inputs to calculate.')}</p></div>
    `
    return
  }
  const { headline, stats, chart } = outcome.result
  results.innerHTML = `
    <div class="results-bar">
      <span class="eyebrow">Result</span>
      <button type="button" class="btn" data-action="copy">${escapeHtml(state.copyLabel)}</button>
    </div>
    <div class="results-body">
      <div class="eyebrow">${escapeHtml(headline.label)}</div>
      <div class="headline-value ${headline.tone || ''}">${escapeHtml(headline.value)}</div>
      ${headline.detail ? `<p class="headline-detail">${escapeHtml(headline.detail)}</p>` : ''}
      ${headline.warning ? `<p class="headline-warning">${escapeHtml(headline.warning)}</p>` : ''}
      ${chart ? renderChart(chart) : ''}
      <dl class="stats">
        ${stats.map((stat) => `
          <div class="stat ${stat.tone || ''}">
            <dt>${escapeHtml(stat.label)}</dt>
            <dd>${escapeHtml(stat.value)}</dd>
          </div>
        `).join('')}
      </dl>
      <p class="disclaimer">Estimate for planning. Not financial advice.</p>
    </div>
  `
}

function scheduleTable(schedule) {
  if (!schedule?.rows?.length) return `<div class="panel-empty">No schedule for this result.</div>`
  const head = schedule.columns.map((column) => `<th class="${column.align}">${escapeHtml(column.label)}</th>`).join('')
  const body = schedule.rows.map((row) => `
    <tr>${schedule.columns.map((column) => `<td class="${column.align}">${escapeHtml(row[column.key] ?? '')}</td>`).join('')}</tr>
  `).join('')
  return `<table class="schedule"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function renderPanel(outcome) {
  const panel = document.getElementById('panel')
  panel.hidden = !state.panelOpen
  if (!state.panelOpen) return
  panel.style.height = `${state.panelHeight}px`
  const allTable = outcome.ok ? outcome.result.all : null
  const tab = state.panelTab === 'all' && allTable ? 'all' : state.panelTab === 'formula' ? 'formula' : 'schedule'
  const body = !outcome.ok
    ? `<div class="panel-empty">${escapeHtml(outcome.formError || 'Fix the inputs to see the schedule.')}</div>`
    : tab === 'formula'
      ? `<pre class="formula">${escapeHtml(outcome.result.formula.join('\n'))}</pre>`
      : scheduleTable(tab === 'all' ? allTable : outcome.result.schedule)
  document.getElementById('panel-inner').innerHTML = `
    <div class="panel-tabs">
      <button type="button" data-action="panel-tab" data-tab="schedule" aria-selected="${tab === 'schedule'}">Schedule</button>
      ${allTable ? `<button type="button" data-action="panel-tab" data-tab="all" aria-selected="${tab === 'all'}">All</button>` : ''}
      <button type="button" data-action="panel-tab" data-tab="formula" aria-selected="${tab === 'formula'}">Formula</button>
    </div>
    <div class="panel-scroll">${body}</div>
  `
}

function renderStatus(outcome) {
  const summary = outcome.ok ? outcome.result.summary : (outcome.formError || 'Incomplete inputs')
  document.getElementById('statusbar').innerHTML = `
    <div class="status-left">
      <span class="dot ${outcome.ok ? 'ok' : 'bad'}"></span>
      <span>Live</span>
      <span class="status-gap"></span>
      <span class="status-summary">${escapeHtml(summary)}</span>
    </div>
    <div class="status-right">
      <span><kbd>${mod}B</kbd> Sidebar</span>
      <span><kbd>${mod}J</kbd> Schedule</span>
      <span><kbd>${mod}K</kbd> Search</span>
    </div>
  `
  document.getElementById('live').textContent = summary
}

function updateOutput() {
  const outcome = computeCurrent()
  renderResults(outcome)
  renderPanel(outcome)
  renderStatus(outcome)
  syncErrors(outcome)
}

function selectCalculator(id, { force = false } = {}) {
  if (!isCalcId(id)) return
  if (id === state.activeId && !force) return
  state.activeId = id
  state.comboKey = ''
  state.comboQuery = ''
  if (id === 'exchange') loadExchangeRates()
  state.examplesOpen = false
  history.replaceState(null, '', `#${id}`)
  document.getElementById('editor').scrollTop = 0
  renderSidebar()
  renderEditor()
  updateOutput()
  renderChrome()
  persist()
}

function setActivity(name) {
  if (state.activity === name) return
  state.activity = name
  renderActivity()
  renderSidebar()
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen
  renderChrome()
  persist()
}

function togglePanel() {
  state.panelOpen = !state.panelOpen
  renderChrome()
  renderPanel(computeCurrent())
  persist()
}

function toggleResults() {
  state.resultsOpen = !state.resultsOpen
  renderChrome()
  if (state.resultsOpen) renderResults(computeCurrent())
  persist()
}

function saveSnapshot() {
  const outcome = computeCurrent()
  if (!outcome.ok) return
  const calc = getCalculator(state.activeId)
  state.snapshots.unshift({
    id: crypto.randomUUID(),
    calcId: calc.id,
    title: calc.name,
    summary: outcome.result.summary,
    inputs: { ...state.inputs[calc.id] },
    savedAt: Date.now(),
    report: {
      headline: outcome.result.headline,
      stats: outcome.result.stats || [],
      summary: outcome.result.summary,
      formula: outcome.result.formula || [],
      schedule: outcome.result.schedule || null,
      all: outcome.result.all || null,
      chart: outcome.result.chart || null,
    },
  })
  state.snapshots = state.snapshots.slice(0, 30)
  state.saveLabel = 'Saved'
  persist()
  renderEditorHeader()
  if (state.activity === 'history') renderSidebar()
  window.setTimeout(() => {
    state.saveLabel = 'Save'
    renderEditorHeader()
  }, 1200)
}

function resetActive() {
  const calc = getCalculator(state.activeId)
  state.examplesOpen = false
  state.comboKey = ''
  state.inputs[calc.id] = blankInputs()[calc.id]
  delete state.editedAt[calc.id]
  renderEditor()
  updateOutput()
  persist()
}

function resetAll() {
  state.examplesOpen = false
  state.comboKey = ''
  state.inputs = blankInputs()
  state.editedAt = {}
  renderEditor()
  updateOutput()
  persist()
}

function loadExample(index) {
  const calc = getCalculator(state.activeId)
  const example = calc.examples[Number(index)]
  if (!example) return
  state.inputs[calc.id] = { ...calc.defaults, ...example.values }
  selectCalculator(calc.id, { force: true })
}

function restoreSnapshot(id) {
  const snap = state.snapshots.find((item) => item.id === id)
  if (!snap) return
  state.inputs[snap.calcId] = { ...getCalculator(snap.calcId).defaults, ...snap.inputs }
  selectCalculator(snap.calcId, { force: true })
}

function listedSnapshots() {
  const query = state.historyQuery.trim().toLowerCase()
  return state.snapshots.filter((snap) => {
    if (!query) return true
    return snap.title.toLowerCase().includes(query) || snap.summary.toLowerCase().includes(query)
  })
}

function categorySnapshots() {
  const group = getCalculator(state.activeId).group
  return listedSnapshots().filter((snap) => getCalculator(snap.calcId).group === group)
}

function snapshotValues(snap) {
  return { ...getCalculator(snap.calcId).defaults, ...snap.inputs }
}

function snapshotOutcome(snap) {
  if (snap.report?.headline && snap.report?.schedule) return { ok: true, result: snap.report }
  setProgramContext(state.inputs, state.editedAt)
  return getCalculator(snap.calcId).compute(snapshotValues(snap))
}

function nativeHandlers() {
  return window.webkit?.messageHandlers
}

function printReport(html, title) {
  const print = nativeHandlers()?.melonPrint
  if (print) {
    print.postMessage({ html, title })
    return
  }
  const frame = document.createElement('iframe')
  frame.title = title
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(html)
  doc.close()
  const win = frame.contentWindow
  const cleanup = () => frame.remove()
  win.addEventListener('afterprint', cleanup)
  window.setTimeout(() => {
    win.focus()
    win.print()
  }, 50)
  window.setTimeout(cleanup, 60000)
}

function downloadBytes(bytes, filename) {
  const save = nativeHandlers()?.melonSave
  if (save) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < data.length; i += chunk) {
      binary += String.fromCharCode(...data.subarray(i, i + chunk))
    }
    save.postMessage({ filename, base64: btoa(binary) })
    return
  }
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadSnapshots(snaps, format = 'pdf', options) {
  if (!snaps.length) return
  const entries = snaps.map((snap) => ({
    calc: getCalculator(snap.calcId),
    values: snapshotValues(snap),
    savedAt: snap.savedAt,
    outcome: snapshotOutcome(snap),
  }))
  const master = snaps.length > 1
  if (format === 'excel') {
    const title = master ? 'Melon - Master file' : `Melon - ${snaps[0].title}`
    downloadBytes(workbookFile(sheetsForEntries(entries, options)), `${title.replace(/[\\/:*?"<>|]/g, '')}.xlsx`)
    return
  }
  const title = master ? 'Melon — Master file' : `Melon — ${snaps[0].title}`
  printReport(reportDocument(entries, title, options), title)
}

function masterSelection() {
  const ids = new Set(state.masterIds)
  return state.snapshots.filter((snap) => ids.has(snap.id))
}

function masterReady() {
  return masterSelection().length > 0 && Object.values(state.masterParts).some(Boolean)
}

function renderMaster() {
  const root = document.getElementById('master')
  const body = document.getElementById('master-body')
  if (!root || !body) return
  root.hidden = !state.masterOpen
  if (!state.masterOpen) return
  const scroll = body.querySelector('.master-list')?.scrollTop || 0
  const selected = new Set(state.masterIds)
  const parts = state.masterParts
  const chip = (key, label) => `
    <button type="button" class="master-chip" data-action="toggle-master-part" data-part="${key}" aria-pressed="${parts[key]}">${label}</button>
  `
  const groupOrder = []
  for (const calc of calculators) {
    if (!groupOrder.includes(calc.group)) groupOrder.push(calc.group)
  }
  const grouped = groupOrder.map((name) => ({
    name,
    items: state.snapshots.filter((snap) => getCalculator(snap.calcId).group === name),
  })).filter((group) => group.items.length)
  const rows = grouped.map((group) => `
    <div class="master-group">${escapeHtml(group.name)}</div>
    ${group.items.map((snap) => `
      <button type="button" class="master-row" data-action="toggle-master-id" data-id="${snap.id}" aria-pressed="${selected.has(snap.id)}">
        <span class="master-check" aria-hidden="true"></span>
        <span class="master-row-text">
          <span class="master-row-title">${escapeHtml(snap.title)}</span>
          <span class="master-row-summary">${escapeHtml(snap.summary)}</span>
        </span>
      </button>
    `).join('')}
  `).join('')
  body.innerHTML = `
    <div class="master-head">
      <h2 id="master-title">Master file</h2>
      <p>Choose the saved calculations in the file, and what each one includes.</p>
    </div>
    <div class="master-section">
      <button type="button" class="master-option" data-action="toggle-master-entered" aria-pressed="${state.masterEnteredOnly}">
        <span class="master-check" aria-hidden="true"></span>
        <span class="master-copy">
          <strong>Only entered inputs</strong>
          <span>Each tab leaves out fields that are still at their starting value.</span>
        </span>
      </button>
    </div>
    <div class="master-section">
      <p class="master-label">Include</p>
      <div class="master-chips">
        ${chip('inputs', 'Inputs')}
        ${chip('result', 'Result')}
        ${chip('schedule', 'Schedule')}
        ${chip('formula', 'Formula')}
      </div>
    </div>
    <div class="master-section">
      <div class="master-tools">
        <button type="button" class="history-pdf" data-action="master-all">All</button>
        <button type="button" class="history-pdf" data-action="master-none">None</button>
      </div>
    </div>
    <div class="master-list">${rows || '<div class="empty"><p>No saved calculations</p></div>'}</div>
    <div class="master-foot">
      <button type="button" class="btn" data-action="close-master">Cancel</button>
      <button type="button" class="btn" data-action="master-excel" ${masterReady() ? '' : 'disabled'}>Excel</button>
      <button type="button" class="btn btn-strong" data-action="master-pdf" ${masterReady() ? '' : 'disabled'}>PDF</button>
    </div>
  `
  const list = body.querySelector('.master-list')
  if (list) list.scrollTop = scroll
}

function openMaster() {
  const preferred = categorySnapshots()
  const source = preferred.length ? preferred : state.snapshots
  state.masterIds = source.map((snap) => snap.id)
  state.masterOpen = true
  renderMaster()
}

function closeMaster() {
  state.masterOpen = false
  const root = document.getElementById('master')
  if (root) root.hidden = true
}

function downloadMaster(format) {
  if (!masterReady()) return
  downloadSnapshots(masterSelection(), format, {
    ...state.masterParts,
    enteredOnly: state.masterEnteredOnly,
  })
  closeMaster()
}

function deleteSnapshot(id) {
  state.snapshots = state.snapshots.filter((item) => item.id !== id)
  persist()
  if (state.activity === 'history') renderSidebar()
}

function commandScore(cmd, query) {
  const title = cmd.title.toLowerCase()
  const subtitle = (cmd.subtitle || '').toLowerCase()
  if (title.startsWith(query)) return 3
  if (title.includes(query)) return 2
  if (subtitle.includes(query) || cmd.group.toLowerCase().includes(query)) return 1
  return 0
}

function buildCommands() {
  return [
    ...calculators.map((calc) => ({
      group: 'Calculators',
      title: calc.name,
      subtitle: calc.group,
      run: () => selectCalculator(calc.id),
    })),
    ...calculators.flatMap((calc) => calc.examples.map((example) => ({
      group: 'Examples',
      title: example.name,
      subtitle: calc.name,
      run: () => {
        state.inputs[calc.id] = { ...calc.defaults, ...example.values }
        selectCalculator(calc.id, { force: true })
      },
    }))),
    { group: 'Actions', title: 'Save snapshot', run: () => saveSnapshot() },
    { group: 'Actions', title: 'Master file', subtitle: 'Choose a PDF or Excel download', run: () => { setActivity('history'); openMaster() } },
    { group: 'Actions', title: 'Reset inputs', run: () => resetActive() },
    { group: 'Actions', title: 'Reset all inputs', subtitle: 'Every calculator', run: () => resetAll() },
    {
      group: 'Actions',
      title: state.sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
      shortcut: `${mod}B`,
      run: () => toggleSidebar(),
    },
    {
      group: 'Actions',
      title: state.panelOpen ? 'Hide schedule' : 'Show schedule',
      shortcut: `${mod}J`,
      run: () => togglePanel(),
    },
    {
      group: 'Actions',
      title: state.resultsOpen ? 'Hide result' : 'Show result',
      run: () => toggleResults(),
    },
    { group: 'Actions', title: 'Show saved calculations', run: () => setActivity('history') },
    { group: 'Actions', title: `Download saved ${getCalculator(state.activeId).group} PDF`, run: () => downloadSnapshots(categorySnapshots()) },
    { group: 'Actions', title: `Download saved ${getCalculator(state.activeId).group} Excel`, run: () => downloadSnapshots(categorySnapshots(), 'excel') },
    { group: 'Actions', title: 'Show calculators', run: () => setActivity('calculators') },
  ]
}

function filteredCommands() {
  const commands = buildCommands()
  const query = state.paletteQuery.trim().toLowerCase()
  if (!query) return commands
  return commands
    .map((cmd, index) => ({ cmd, index, score: commandScore(cmd, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.cmd)
}

function highlightPalette() {
  document.querySelectorAll('.palette-item').forEach((item) => {
    item.setAttribute('aria-selected', String(Number(item.dataset.index) === state.paletteIndex))
  })
}

function renderPaletteList() {
  const commands = filteredCommands()
  state.paletteCommands = commands
  if (state.paletteIndex >= commands.length) state.paletteIndex = 0
  const list = document.getElementById('palette-list')
  if (commands.length === 0) {
    list.innerHTML = `<div class="palette-empty">No matching commands</div>`
    return
  }
  const showGroups = state.paletteQuery.trim() === ''
  let html = ''
  let lastGroup = ''
  commands.forEach((cmd, index) => {
    if (showGroups && cmd.group !== lastGroup) {
      html += `<div class="palette-group">${escapeHtml(cmd.group)}</div>`
      lastGroup = cmd.group
    }
    html += `
      <button type="button" class="palette-item" id="cmd-${index}" data-action="run-command" data-index="${index}" aria-selected="${index === state.paletteIndex}">
        <span class="palette-title">${escapeHtml(cmd.title)}</span>
        ${cmd.subtitle ? `<span class="palette-sub">${escapeHtml(cmd.subtitle)}</span>` : ''}
        ${cmd.shortcut ? `<kbd>${escapeHtml(cmd.shortcut)}</kbd>` : ''}
      </button>
    `
  })
  list.innerHTML = html
  list.querySelector(`[data-index="${state.paletteIndex}"]`)?.scrollIntoView({ block: 'nearest' })
}

function openPalette() {
  state.paletteOpen = true
  state.paletteQuery = ''
  state.paletteIndex = 0
  const input = document.getElementById('palette-input')
  input.value = ''
  document.getElementById('palette').hidden = false
  renderPaletteList()
  input.focus()
}

function closePalette() {
  state.paletteOpen = false
  document.getElementById('palette').hidden = true
}

function runPaletteIndex(index) {
  const cmd = state.paletteCommands[index]
  if (!cmd) return
  closePalette()
  cmd.run()
}

function writeSaleItems(items) {
  state.inputs[state.activeId].items = JSON.stringify(items)
  updateOutput()
  persist()
}

function seedSaleList(values) {
  const items = parseSaleItems(values.items)
  const untouched = items.length === 1 && items[0].comment === '' && items[0].price === '49.99' && items[0].quantity === '1'
  if (!untouched) return
  values.items = JSON.stringify([{
    comment: values.comment || '',
    price: values.price || '',
    quantity: values.quantity || '1',
  }])
}

function addLine(fieldKey) {
  const field = getCalculator(state.activeId).fields.find((item) => item.key === fieldKey && item.kind === 'lines')
  if (!field) return
  const rows = parseLines(state.inputs[state.activeId][fieldKey], field.blank)
  if (rows.length >= (field.max || 8)) return
  rows.push({ ...field.blank })
  state.inputs[state.activeId][fieldKey] = JSON.stringify(rows)
  markEdited()
  renderForm()
  updateOutput()
  persist()
  const focusKey = field.columns.find((column) => column.focus)?.key
    || field.columns.find((column) => column.key === 'balance' || column.key === 'amount')?.key
    || field.columns[0]?.key
  if (focusKey) document.querySelector(`[data-line-field="${fieldKey}"][data-line-index="${rows.length - 1}"][data-line-key="${focusKey}"]`)?.focus()
}

function removeLine(fieldKey, index) {
  const field = getCalculator(state.activeId).fields.find((item) => item.key === fieldKey && item.kind === 'lines')
  if (!field) return
  const rows = parseLines(state.inputs[state.activeId][fieldKey], field.blank)
  if (rows.length < 2) return
  rows.splice(index, 1)
  state.inputs[state.activeId][fieldKey] = JSON.stringify(rows)
  markEdited()
  renderForm()
  updateOutput()
  persist()
}

function addSaleItem() {
  const items = parseSaleItems(state.inputs[state.activeId].items)
  if (items.length >= MAX_SALE_ITEMS) return
  items.push({ comment: '', price: '', quantity: '1' })
  state.inputs[state.activeId].items = JSON.stringify(items)
  renderForm()
  updateOutput()
  persist()
  document.querySelector(`[data-item-index="${items.length - 1}"][data-item-key="price"]`)?.focus()
}

function removeSaleItem(index) {
  const items = parseSaleItems(state.inputs[state.activeId].items)
  if (items.length < 2) return
  items.splice(index, 1)
  state.inputs[state.activeId].items = JSON.stringify(items)
  renderForm()
  updateOutput()
  persist()
}

function comboField(key) {
  return getCalculator(state.activeId).fields.find((field) => field.key === key && field.kind === 'combo')
}

function comboChoices(field, query) {
  const q = String(query || '').trim().toLowerCase()
  const options = field?.options || []
  if (!q) return options
  return options.filter((option) => option.label.toLowerCase().includes(q) || String(option.value).toLowerCase().includes(q))
}

function paintComboOptions(key) {
  const field = comboField(key)
  const list = document.querySelector(`[data-combo-options="${key}"]`)
  if (!field || !list) return
  const choices = comboChoices(field, state.comboQuery)
  if (state.comboIndex >= choices.length) state.comboIndex = 0
  list.innerHTML = choices.length
    ? choices.map((option, index) => `
        <button type="button" class="combo-option" role="option" data-action="pick-combo" data-key="${escapeHtml(key)}" data-value="${escapeHtml(option.value)}" aria-selected="${index === state.comboIndex}">${escapeHtml(option.label)}</button>
      `).join('')
    : `<div class="combo-empty">No matching currencies</div>`
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
}

function placeCombo(key) {
  const button = document.querySelector(`[data-combo-button="${key}"]`)
  const menu = document.querySelector(`[data-combo-menu="${key}"]`)
  if (!button || !menu) return
  const rect = button.getBoundingClientRect()
  const width = Math.max(rect.width, 240)
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  const below = window.innerHeight - rect.bottom - 12
  const openUp = below < 180 && rect.top > below
  const maxHeight = Math.min(280, Math.max(140, openUp ? rect.top - 12 : below))
  menu.style.left = `${left}px`
  menu.style.width = `${width}px`
  menu.style.maxHeight = `${maxHeight}px`
  menu.style.top = openUp ? `${Math.max(8, rect.top - 4 - maxHeight)}px` : `${rect.bottom + 4}px`
}

function pickCombo(key, value) {
  state.inputs[state.activeId][key] = value
  state.comboKey = ''
  state.comboQuery = ''
  renderForm()
  updateOutput()
  persist()
}

function blankMeansZero(el) {
  const calc = getCalculator(state.activeId)
  if (el.dataset.itemKey) return false
  if (el.dataset.lineField && el.dataset.lineKey) {
    const field = calc.fields.find((item) => item.key === el.dataset.lineField)
    const column = field?.columns?.find((item) => item.key === el.dataset.lineKey)
    if (!column || column.type !== 'number' || column.required) return false
    if (el.dataset.lineField === 'services' && el.dataset.lineKey === 'price') return false
    const rows = parseLines(state.inputs[state.activeId][field.key], field.blank || {})
    const row = rows[Number(el.dataset.lineIndex)]
    if (!row) return false
    return field.columns.some((item) => (
      item.key !== column.key && item.type !== 'select' && String(row[item.key] ?? '').trim()
    ))
  }
  if (!el.name) return false
  for (const field of calc.fields) {
    if (field.kind === 'span' && field.parts?.some((part) => part.key === el.name)) return true
    if (field.key === el.name && field.kind === 'number' && !field.required) return true
  }
  return false
}

function onFieldBlur(event) {
  const el = event.target
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.dataset.comboSearch) return
  if (String(el.value).trim() !== '') return
  if (state.activeId === 'subscriptions' && el.dataset.lineField === 'services' && el.dataset.lineKey === 'price') {
    renderForm()
    return
  }
  if (!blankMeansZero(el)) return
  el.value = '0'
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function onFieldInput(event) {
  const el = event.target
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return
  if (el.dataset.comboSearch) {
    state.comboQuery = el.value
    state.comboIndex = 0
    paintComboOptions(el.dataset.comboSearch)
    return
  }
  if (el.dataset.lineField && el.dataset.lineKey) {
    const field = getCalculator(state.activeId).fields.find((item) => item.key === el.dataset.lineField)
    const rows = parseLines(state.inputs[state.activeId][el.dataset.lineField], field?.blank || {})
    const index = Number(el.dataset.lineIndex)
    if (!rows[index]) return
    rows[index][el.dataset.lineKey] = el.value
    if (state.activeId === 'subscriptions' && el.dataset.lineKey === 'service') rows[index].price = ''
    state.inputs[state.activeId][el.dataset.lineField] = JSON.stringify(rows)
    markEdited()
    if (state.activeId === 'subscriptions' && el.dataset.lineKey === 'service') renderForm()
    updateOutput()
    persist()
    return
  }
  if (el.dataset.itemIndex !== undefined && el.dataset.itemKey) {
    const items = parseSaleItems(state.inputs[state.activeId].items)
    const index = Number(el.dataset.itemIndex)
    if (!items[index]) return
    items[index][el.dataset.itemKey] = el.value
    writeSaleItems(items)
    return
  }
  if (!el.name || el.readOnly) return
  state.inputs[state.activeId][el.name] = el.value
  if (state.activeId === 'dti' && ['wages', 'housing', 'auto', 'cards', 'subscriptions'].includes(el.name)) {
    noteDtiEdit(state.inputs.dti, el.name, el.value)
  }
  if (el.type === 'range') {
    const readout = document.querySelector(`[data-slider-value="${el.name}"]`)
    const suffix = getCalculator(state.activeId).fields.find((field) => field.key === el.name)?.suffix || ''
    if (readout) readout.textContent = `${el.value}${suffix}`
    el.setAttribute('aria-valuetext', `${el.value}${suffix}`)
  }
  markEdited()
  updateOutput()
  persist()
}

function displayExpression(expr) {
  return String(expr || '')
    .replaceAll('sqrt', '√')
    .replaceAll('pi', 'π')
    .replaceAll('*', '×')
    .replaceAll('/', '÷')
    .replaceAll('-', '−') || '0'
}

function keypadField() {
  return getCalculator(state.activeId).fields.find((field) => field.kind === 'keypad')
}

function pressKey(key) {
  const field = keypadField()
  if (!field) return
  const values = state.inputs[state.activeId]
  let expr = String(values[field.key] || '')
  if (key === 'c') expr = ''
  else if (key === 'back') {
    const trimmed = expr.replace(/(asin|acos|atan|sqrt|sin|cos|tan|log|ln|pi)$/, '')
    expr = trimmed === expr ? expr.slice(0, -1) : trimmed
  } else if (key === '=') {
    const outcome = getCalculator(state.activeId).compute(values)
    if (outcome.ok) expr = outcome.result.raw.text
  } else {
    if (key === '.') {
      const last = expr.split(/[+\-*/()%^!a-z]/i).pop()
      if (last.includes('.')) return
    }
    if (expr.length >= 300) return
    expr += key
  }
  values[field.key] = expr
  const display = document.querySelector('[data-calc-display]')
  if (display) display.textContent = displayExpression(expr)
  markEdited()
  updateOutput()
  persist()
}

function setBrandMenu(open) {
  const menu = document.getElementById('brand-menu')
  const button = document.getElementById('brand-button')
  if (!menu || !button) return
  menu.hidden = !open
  button.classList.toggle('is-open', open)
  button.setAttribute('aria-expanded', String(open))
}

function onClick(event) {
  const inBrand = event.target instanceof Element && event.target.closest('.brand-wrap')
  if (!inBrand) setBrandMenu(false)
  const btn = event.target.closest('[data-action]')
  if (!btn || btn.disabled) return
  const action = btn.dataset.action
  if (action === 'toggle-brand') setBrandMenu(document.getElementById('brand-menu').hidden)
  else if (action === 'toggle-sidebar') toggleSidebar()
  else if (action === 'toggle-panel') togglePanel()
  else if (action === 'toggle-results') toggleResults()
  else if (action === 'open-palette') openPalette()
  else if (action === 'close-palette') closePalette()
  else if (action === 'set-activity') setActivity(btn.dataset.name)
  else if (action === 'select-calc') selectCalculator(btn.dataset.id)
  else if (action === 'toggle-examples') {
    state.examplesOpen = !state.examplesOpen
    renderEditorHeader()
  } else if (action === 'load-example') loadExample(btn.dataset.index)
  else if (action === 'reset') resetActive()
  else if (action === 'reset-all') resetAll()
  else if (action === 'save') saveSnapshot()
  else if (action === 'copy') copyResult()
  else if (action === 'restore') restoreSnapshot(btn.dataset.id)
  else if (action === 'delete-snapshot') deleteSnapshot(btn.dataset.id)
  else if (action === 'download-snapshot') downloadSnapshots(state.snapshots.filter((snap) => snap.id === btn.dataset.id))
  else if (action === 'download-snapshot-excel') downloadSnapshots(state.snapshots.filter((snap) => snap.id === btn.dataset.id), 'excel')
  else if (action === 'open-master') openMaster()
  else if (action === 'close-master') closeMaster()
  else if (action === 'toggle-master-entered') {
    state.masterEnteredOnly = !state.masterEnteredOnly
    renderMaster()
  } else if (action === 'toggle-master-part') {
    const part = btn.dataset.part
    if (part in state.masterParts) state.masterParts[part] = !state.masterParts[part]
    renderMaster()
  } else if (action === 'toggle-master-id') {
    const id = btn.dataset.id
    state.masterIds = state.masterIds.includes(id)
      ? state.masterIds.filter((item) => item !== id)
      : [...state.masterIds, id]
    renderMaster()
  } else if (action === 'master-all') {
    state.masterIds = state.snapshots.map((snap) => snap.id)
    renderMaster()
  } else if (action === 'master-none') {
    state.masterIds = []
    renderMaster()
  } else if (action === 'master-pdf') downloadMaster('pdf')
  else if (action === 'master-excel') downloadMaster('excel')
  else if (action === 'panel-tab') {
    state.panelTab = btn.dataset.tab
    renderPanel(computeCurrent())
  } else if (action === 'add-item') addSaleItem()
  else if (action === 'remove-item') removeSaleItem(Number(btn.dataset.index))
  else if (action === 'add-line') addLine(btn.dataset.field)
  else if (action === 'remove-line') removeLine(btn.dataset.field, Number(btn.dataset.index))
  else if (action === 'toggle-combo') {
    const key = btn.dataset.key
    if (state.comboKey === key) {
      state.comboKey = ''
      renderForm()
    } else {
      state.comboKey = key
      state.comboQuery = ''
      const choices = comboChoices(comboField(key), '')
      const found = choices.findIndex((option) => option.value === state.inputs[state.activeId][key])
      state.comboIndex = found >= 0 ? found : 0
      renderForm()
      document.querySelector(`[data-combo-search="${key}"]`)?.focus()
    }
  } else if (action === 'pick-combo') {
    pickCombo(btn.dataset.key, btn.dataset.value)
  } else if (action === 'set-option') {
    const values = state.inputs[state.activeId]
    values[btn.dataset.key] = btn.dataset.value
    markEdited()
    if (state.activeId === 'salestax' && btn.dataset.key === 'entry' && btn.dataset.value === 'list') seedSaleList(values)
    renderForm()
    updateOutput()
    persist()
  } else if (action === 'key') pressKey(btn.dataset.key)
  else if (action === 'run-command') runPaletteIndex(Number(btn.dataset.index))
}

async function copyResult() {
  const outcome = computeCurrent()
  if (!outcome.ok) return
  const { headline, stats } = outcome.result
  const text = [headline.label + ': ' + headline.value, headline.detail || '', ...stats.map((stat) => `${stat.label}: ${stat.value}`)]
    .filter(Boolean)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    state.copyLabel = 'Copied'
  } catch {
    state.copyLabel = 'Unable'
  }
  renderResults(outcome)
  window.setTimeout(() => {
    state.copyLabel = 'Copy'
    renderResults(computeCurrent())
  }, 1200)
}

function onKeyDown(event) {
  const meta = event.metaKey || event.ctrlKey
  if (event.key === 'Escape') {
    setBrandMenu(false)
    if (state.masterOpen) {
      closeMaster()
      return
    }
    if (state.paletteOpen) closePalette()
    if (state.comboKey) {
      state.comboKey = ''
      renderForm()
    }
    if (state.examplesOpen) {
      state.examplesOpen = false
      renderEditorHeader()
    }
    return
  }
  if (state.comboKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter')) {
    const choices = comboChoices(comboField(state.comboKey), state.comboQuery)
    if (event.key === 'Enter') {
      event.preventDefault()
      const choice = choices[state.comboIndex]
      if (choice) pickCombo(state.comboKey, choice.value)
      return
    }
    event.preventDefault()
    if (!choices.length) return
    state.comboIndex = event.key === 'ArrowDown'
      ? Math.min(choices.length - 1, state.comboIndex + 1)
      : Math.max(0, state.comboIndex - 1)
    paintComboOptions(state.comboKey)
    return
  }
  if (state.paletteOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    const count = state.paletteCommands.length
    if (!count) return
    state.paletteIndex = event.key === 'ArrowDown'
      ? (state.paletteIndex + 1) % count
      : (state.paletteIndex - 1 + count) % count
    highlightPalette()
    document.getElementById(`cmd-${state.paletteIndex}`)?.scrollIntoView({ block: 'nearest' })
    return
  }
  if (state.paletteOpen && event.key === 'Enter') {
    event.preventDefault()
    runPaletteIndex(state.paletteIndex)
    return
  }
  const pad = keypadField()
  if (pad && !state.paletteOpen && !state.comboKey && !meta && !event.altKey) {
    const target = event.target
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    if (!typing) {
      let key = ''
      if (event.key === 'Enter' || event.key === '=') key = '='
      else if (event.key === 'Backspace') key = 'back'
      else if (event.key === 'Delete') key = 'c'
      else if (!pad.letters && (event.key === 'c' || event.key === 'C')) key = 'c'
      else if (event.key === 'x' || event.key === 'X') key = '*'
      else if ('0123456789.+-*/%()'.includes(event.key)) key = event.key
      else if (pad.letters && (event.key === '^' || event.key === '!')) key = event.key
      else if (pad.letters && /^[a-z]$/i.test(event.key)) key = event.key.toLowerCase()
      if (key) {
        event.preventDefault()
        pressKey(key)
        return
      }
    }
  }
  if (event.target instanceof HTMLInputElement && event.key === 'Enter' && event.target.form?.id === 'calc-form') {
    event.preventDefault()
    const controls = [...event.target.form.querySelectorAll('input, select')]
    const next = controls[controls.indexOf(event.target) + 1]
    if (next) next.focus()
    else event.target.blur()
    return
  }
  if (!meta || event.repeat) return
  const key = event.key.toLowerCase()
  if (key === 'k') {
    event.preventDefault()
    if (state.paletteOpen) closePalette()
    else openPalette()
  } else if (key === 'b' && !event.altKey) {
    event.preventDefault()
    toggleSidebar()
  } else if (key === 'j' && !event.shiftKey) {
    event.preventDefault()
    togglePanel()
  }
}

function bind() {
  document.body.addEventListener('click', onClick)
  document.getElementById('editor').addEventListener('input', onFieldInput)
  document.getElementById('editor').addEventListener('focusout', onFieldBlur)
  document.getElementById('editor').addEventListener('change', onFieldInput)
  document.getElementById('editor').addEventListener('scroll', () => {
    if (state.comboKey) placeCombo(state.comboKey)
  }, { passive: true })
  document.getElementById('editor').addEventListener('submit', (event) => event.preventDefault())
  document.getElementById('sidebar').addEventListener('input', (event) => {
    if (event.target.id !== 'history-filter') return
    state.historyQuery = event.target.value
    renderHistoryList()
  })
  document.getElementById('palette-input').addEventListener('input', (event) => {
    state.paletteQuery = event.target.value
    state.paletteIndex = 0
    renderPaletteList()
  })
  document.getElementById('palette-list').addEventListener('pointermove', (event) => {
    const item = event.target.closest('.palette-item')
    if (!item) return
    const index = Number(item.dataset.index)
    if (index === state.paletteIndex) return
    state.paletteIndex = index
    highlightPalette()
  })
  document.addEventListener('pointerdown', (event) => {
    if (state.comboKey && (!(event.target instanceof Element) || !event.target.closest('.combo'))) {
      state.comboKey = ''
      renderForm()
    }
    if (!state.examplesOpen) return
    if (event.target instanceof Element && event.target.closest('.editor-actions')) return
    state.examplesOpen = false
    renderEditorHeader()
  })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace(/^#/, '')
    if (isCalcId(id)) selectCalculator(id)
  })

  const handle = document.getElementById('panel-resize')
  handle.addEventListener('pointerdown', (event) => {
    if (!state.panelOpen) return
    event.preventDefault()
    const startY = event.clientY
    const startH = state.panelHeight
    function move(ev) {
      state.panelHeight = Math.min(560, Math.max(140, startH + startY - ev.clientY))
      document.getElementById('panel').style.height = `${state.panelHeight}px`
    }
    function stop() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  })
  handle.addEventListener('dblclick', () => {
    state.panelHeight = 248
    document.getElementById('panel').style.height = '248px'
  })

  document.querySelector('[data-action="toggle-sidebar"]').title = `Toggle sidebar (${mod}B)`
  document.querySelector('[data-action="toggle-panel"]').title = `Toggle schedule (${mod}J)`
  document.querySelector('[data-action="toggle-results"]').title = 'Toggle result'
  document.getElementById('search-kbd').textContent = `${mod}K`
}

const RATE_TTL = 30 * 60 * 1000
let exchangeRequest = null

async function loadExchangeRates({ force = false } = {}) {
  const current = getExchangeState()
  if (!force && current.status === 'ready' && Date.now() - current.fetchedAt < RATE_TTL) return
  if (exchangeRequest) return exchangeRequest
  exchangeRequest = (async () => {
    try {
      const [listRes, rateRes] = await Promise.all([
        fetch('https://api.frankfurter.dev/v2/currencies'),
        fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json'),
      ])
      if (!listRes.ok || !rateRes.ok) throw new Error('status')
      const list = await listRes.json()
      const payload = await rateRes.json()
      const raw = payload.usd || {}
      const rates = { USD: 1 }
      const currencies = []
      for (const item of list) {
        const code = item.iso_code
        const value = code === 'USD' ? 1 : Number(raw[String(code).toLowerCase()])
        if (!(value > 0) || !Number.isFinite(value)) continue
        rates[code] = value
        currencies.push({ code, name: item.name })
      }
      currencies.sort((a, b) => a.name.localeCompare(b.name))
      if (!currencies.length) throw new Error('empty')
      setExchangeRates({ status: 'ready', date: payload.date || '', rates, currencies, error: '', fetchedAt: Date.now() })
    } catch {
      if (getExchangeState().status !== 'ready') {
        setExchangeRates({
          status: 'error',
          date: '',
          rates: {},
          currencies: [],
          error: 'Exchange rates are unavailable right now.',
          fetchedAt: 0,
        })
      }
    } finally {
      exchangeRequest = null
      if (state.activeId === 'exchange') {
        renderForm()
        updateOutput()
      }
    }
  })()
  return exchangeRequest
}

function preventAccidentalSelection() {
  if (!document.documentElement.classList.contains('melon-app')) return
  document.addEventListener('selectstart', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('input, textarea')) return
    event.preventDefault()
  })
}

function boot() {
  preventAccidentalSelection()
  load()
  const hash = location.hash.replace(/^#/, '')
  if (isCalcId(hash)) state.activeId = hash
  else history.replaceState(null, '', `#${state.activeId}`)
  bind()
  renderActivity()
  renderSidebar()
  renderEditor()
  loadExchangeRates()
  window.setInterval(() => loadExchangeRates(), RATE_TTL)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadExchangeRates()
  })
  updateOutput()
  renderChrome()
}

boot()
