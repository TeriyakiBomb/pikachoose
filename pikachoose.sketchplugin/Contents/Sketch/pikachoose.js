// pikachoose.js
// Select layers on the current page that match properties of the current selection.
//
// Requires disableCocoaScriptPreprocessor: true (see manifest.json).
// Uses AppKit (NSAlert, NSButton, NSPopUpButton, NSTextField) for the dialog UI.

/* global NSAlert, NSView, NSButton, NSTextField, NSPopUpButton */

function selectMatching(context) {
  const sketch = require('sketch')
  const UI     = require('sketch/ui')

  const doc = sketch.getSelectedDocument()
  if (!doc) {
    UI.alert('Pikachoose', 'No document is open.')
    return
  }

  const selection = doc.selectedLayers.layers
  if (!selection || selection.length === 0) {
    UI.alert('Pikachoose', 'Select at least one layer first.')
    return
  }

  const source = selection[0]

  // ── Gather source properties ──────────────────────────────────────────────
  const srcFill      = getFirstEnabledFill(source)
  const srcBorder    = getFirstEnabledBorder(source)
  const srcRadius    = getCornerRadius(source)

  // Build the informative subtitle shown in the dialog
  const details = []
  if (srcFill)   details.push('Fill: ' + srcFill.color)
  if (srcBorder) details.push('Border: ' + srcBorder.color + ' ' + srcBorder.thickness + 'px')
  if (srcRadius.length > 0) details.push('Radius: ' + (new Set(srcRadius).size === 1 ? srcRadius[0] : srcRadius.join('/')) + 'px')
  const subtitle = '"' + source.name + '"' + (details.length ? '\n' + details.join('   ·   ') : '')

  // ── Build the NSAlert dialog ──────────────────────────────────────────────
  const alert = NSAlert.new()
  alert.setMessageText('Pikachoose')
  alert.setInformativeText(subtitle)
  alert.addButtonWithTitle('Select')    // index 0 → returns 1000
  alert.addButtonWithTitle('Cancel')   // index 1 → returns 1001

  // Custom view: 5 criteria checkboxes + 1 name-type row + 1 include-source checkbox
  const W       = 310
  const ROW_H   = 22
  const STEP    = 30   // ROW_H + 8px gap
  const VIEW_H  = STEP * 6 + ROW_H + 4  // 6 steps down + last row + padding
  const INDENT  = 20

  const view = NSView.alloc().initWithFrame(NSMakeRect(0, 0, W, VIEW_H))

  // y tracks current row from top; AppKit y is bottom-up so we convert
  let rowFromTop = 4  // start 4px from top

  function nextY() {
    const appkitY = VIEW_H - rowFromTop - ROW_H
    rowFromTop += STEP
    return appkitY
  }

  function addCheckbox(title, checked) {
    const y   = nextY()
    const btn = NSButton.alloc().initWithFrame(NSMakeRect(0, y, W, ROW_H))
    btn.setButtonType(3)   // 3 = NSSwitchButton (checkbox)
    btn.setTitle(title)
    btn.setState(checked ? 1 : 0)
    view.addSubview(btn)
    return btn
  }

  // Pre-tick whichever criteria the source layer actually has
  const cbFill      = addCheckbox('Same fill colour',      !!srcFill)
  const cbBorder    = addCheckbox('Same border colour',    !!srcBorder)
  const cbThickness = addCheckbox('Same border thickness', false)
  const cbRadius    = addCheckbox('Same border radius',    false)
  const cbName      = addCheckbox('Same name',             false)

  // ── Name-match type row (indented, below the name checkbox) ───────────────
  const nameY = nextY()

  const lbl = NSTextField.alloc().initWithFrame(NSMakeRect(INDENT, nameY + 2, 90, ROW_H - 2))
  lbl.setStringValue('Match type:')
  lbl.setBezeled(false)
  lbl.setDrawsBackground(false)
  lbl.setEditable(false)
  lbl.setSelectable(false)
  view.addSubview(lbl)

  const popup = NSPopUpButton.alloc().initWithFrame(NSMakeRect(INDENT + 95, nameY, 175, ROW_H))
  popup.addItemWithTitle('Exact')
  popup.addItemWithTitle('Contains (partial, case-insensitive)')
  popup.addItemWithTitle('Regex (case-insensitive)')
  view.addSubview(popup)

  const cbIncludeSource = addCheckbox('Include source in selection', true)

  alert.setAccessoryView(view)

  // ── Run the modal ─────────────────────────────────────────────────────────
  const response = alert.runModal()
  if (response !== 1000) return  // 1000 = NSAlertFirstButtonReturn

  // ── Read the UI state ─────────────────────────────────────────────────────
  const opts = {
    fill:      cbFill.state()      === 1,
    border:    cbBorder.state()    === 1,
    thickness: cbThickness.state() === 1,
    radius:    cbRadius.state()    === 1,
    name:      cbName.state()      === 1,
    nameType:       (['exact', 'contains', 'regex'])[popup.indexOfSelectedItem()] || 'exact',
    includeSource:  cbIncludeSource.state() === 1
  }

  if (!opts.fill && !opts.border && !opts.thickness && !opts.radius && !opts.name) {
    UI.alert('Pikachoose', 'Tick at least one matching criterion.')
    return
  }

  // ── Find matching layers on the current page ──────────────────────────────
  const page      = doc.selectedPage
  const sourceIds = new Set(selection.map(l => l.id))
  const all       = sketch.find('*', page)

  const matches = all.filter(layer => {
    if (sourceIds.has(layer.id)) return false   // skip the source layers themselves
    if (!layer.style)            return false   // skip layers with no style (e.g. some groups)

    if (opts.fill      && !matchFill(layer, srcFill))              return false
    if (opts.border    && !matchBorderColor(layer, srcBorder))     return false
    if (opts.thickness && !matchBorderThickness(layer, srcBorder)) return false
    if (opts.radius    && !matchRadius(layer, srcRadius))          return false
    if (opts.name      && !matchName(layer.name, source.name, opts.nameType)) return false

    return true
  })

  const finalSelection = opts.includeSource ? [...selection, ...matches] : matches

  if (finalSelection.length === 0) {
    UI.message('Pikachoose: no matching layers found.')
    return
  }

  doc.selectedLayers = finalSelection
  UI.message('Pikachoose: selected ' + finalSelection.length + ' layer' + (finalSelection.length !== 1 ? 's' : '') + '.')
}


// ─── Quick-select commands ────────────────────────────────────────────────────

function selectSameFill(context)            { quickSelect(context, 'fill') }
function selectSameBorderColour(context)    { quickSelect(context, 'border') }
function selectSameBorderThickness(context) { quickSelect(context, 'thickness') }
function selectSameBorderRadius(context)    { quickSelect(context, 'radius') }

function quickSelect(context, criterion) {
  const sketch = require('sketch')
  const UI     = require('sketch/ui')

  const doc = sketch.getSelectedDocument()
  if (!doc) { UI.alert('Pikachoose', 'No document is open.'); return }

  const selection = doc.selectedLayers.layers
  if (!selection || selection.length === 0) {
    UI.alert('Pikachoose', 'Select at least one layer first.')
    return
  }

  const source    = selection[0]
  const srcFill   = getFirstEnabledFill(source)
  const srcBorder = getFirstEnabledBorder(source)
  const srcRadius = getCornerRadius(source)

  // Warn if the source doesn't have the property being matched
  if (criterion === 'fill' && !srcFill) {
    UI.message('Pikachoose: source layer has no fill.')
    return
  }
  if ((criterion === 'border' || criterion === 'thickness') && !srcBorder) {
    UI.message('Pikachoose: source layer has no border.')
    return
  }

  const page      = doc.selectedPage
  const sourceIds = new Set(selection.map(l => l.id))
  const all       = sketch.find('*', page)

  const matches = all.filter(layer => {
    if (sourceIds.has(layer.id)) return false
    if (!layer.style)            return false
    if (criterion === 'fill'      && !matchFill(layer, srcFill))              return false
    if (criterion === 'border'    && !matchBorderColor(layer, srcBorder))     return false
    if (criterion === 'thickness' && !matchBorderThickness(layer, srcBorder)) return false
    if (criterion === 'radius'    && !matchRadius(layer, srcRadius))          return false
    return true
  })

  const finalSelection = [...selection, ...matches]
  doc.selectedLayers = finalSelection

  if (matches.length === 0) {
    UI.message('Pikachoose: no additional matching layers found.')
  } else {
    UI.message('Pikachoose: selected ' + finalSelection.length + ' layer' + (finalSelection.length !== 1 ? 's' : '') + '.')
  }
}


// ─── Style accessors ──────────────────────────────────────────────────────────

function getFirstEnabledFill(layer) {
  const fills = layer.style && layer.style.fills
  if (!fills || !fills.length) return null
  return fills.find(f => f.enabled !== false) || null
}

function getFirstEnabledBorder(layer) {
  const borders = layer.style && layer.style.borders
  if (!borders || !borders.length) return null
  return borders.find(b => b.enabled !== false) || null
}

// Returns the corners.radii array for the layer.
// NOTE: layer.cornerRadius is unreliable on layers returned by sketch.find()
// (it reads as undefined). style.corners.radii is the persistent source of truth.
// Returns [] for layers with no corner radius set.
function getCornerRadius(layer) {
  const corners = layer.style && layer.style.corners
  return (corners && corners.radii) ? corners.radii : []
}

function normalizeHex(color) {
  // Colors come back as '#rrggbbaa' strings; normalise to lowercase for comparison
  return color ? String(color).toLowerCase().trim() : ''
}


// ─── Matchers ────────────────────────────────────────────────────────────────

// Fill: match type first, then colour for flat fills.
// Gradient/pattern fills are matched by type alone (v1 — good enough for most cases).
function matchFill(layer, refFill) {
  const fill = getFirstEnabledFill(layer)
  if (!refFill && !fill) return true   // both have no fill
  if (!refFill || !fill) return false  // one has fill, the other doesn't
  if (fill.fillType !== refFill.fillType) return false
  if (fill.fillType === 'Color') {
    return normalizeHex(fill.color) === normalizeHex(refFill.color)
  }
  return true  // gradient or pattern: matched by type above
}

function matchBorderColor(layer, refBorder) {
  const border = getFirstEnabledBorder(layer)
  if (!refBorder && !border) return true
  if (!refBorder || !border) return false
  return normalizeHex(border.color) === normalizeHex(refBorder.color)
}

function matchBorderThickness(layer, refBorder) {
  const border = getFirstEnabledBorder(layer)
  if (!refBorder && !border) return true
  if (!refBorder || !border) return false
  return border.thickness === refBorder.thickness
}

function matchRadius(layer, refRadii) {
  const r = getCornerRadius(layer)
  if (refRadii.length === 0 && r.length === 0) return true
  if (refRadii.length !== r.length) return false
  return JSON.stringify(r) === JSON.stringify(refRadii)
}

function matchName(name, ref, type) {
  switch (type) {
    case 'exact':
      return name === ref
    case 'contains':
      return name.toLowerCase().includes(ref.toLowerCase())
    case 'regex':
      try { return new RegExp(ref, 'i').test(name) } catch (e) { return false }
    default:
      return false
  }
}
