// pikachoose.js
// Select layers on the current page that match properties of the current selection.
//
// Requires disableCocoaScriptPreprocessor: true (see manifest.json).
// Uses AppKit (NSAlert, NSButton, NSPopUpButton, NSTextField) for the dialog UI.

/* global NSAlert, NSView, NSButton, NSTextField, NSPopUpButton */

function selectMatching(context)        { _selectMatching(context, false) }
function selectMatchingInFrame(context) { _selectMatching(context, true) }

function _selectMatching(context, frameScope) {
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

  const source    = selection[0]
  const page      = doc.selectedPage
  const container = frameScope ? getContainingFrame(source) : page
  if (frameScope && !container) {
    UI.message('Pikachoose: source layer is not inside a frame.')
    return
  }

  // ── Gather source properties ──────────────────────────────────────────────
  const srcFill      = getFirstEnabledFill(source)
  const srcBorder    = getFirstEnabledBorder(source)
  const srcRadius    = getCornerRadius(source)
  const srcType      = getEffectiveType(source)
  const srcSize      = getLayerSize(source)
  const srcOpacity   = getOpacity(source)
  const srcBlendMode = getBlendMode(source)

  // Build the informative subtitle shown in the dialog
  const scopeNote = frameScope ? '   [in: ' + container.name + ']' : ''
  const details = ['Type: ' + srcType]
  if (srcFill)   details.push('Fill: ' + srcFill.color)
  if (srcBorder) details.push('Border: ' + srcBorder.color + ' ' + srcBorder.thickness + 'px')
  if (srcRadius.length > 0) details.push('Radius: ' + (new Set(srcRadius).size === 1 ? srcRadius[0] : srcRadius.join('/')) + 'px')
  details.push('Size: ' + srcSize.width + '×' + srcSize.height)
  if (srcOpacity < 1)           details.push('Opacity: ' + Math.round(srcOpacity * 100) + '%')
  if (srcBlendMode !== 'Normal') details.push('Blend: ' + srcBlendMode)
  const subtitle = '"' + source.name + '"' + scopeNote + '\n' + details.join('   ·   ')

  // ── Build the NSAlert dialog ──────────────────────────────────────────────
  const alert = NSAlert.new()
  alert.setMessageText(frameScope ? 'Pikachoose (in frame)' : 'Pikachoose')
  alert.setInformativeText(subtitle)
  alert.addButtonWithTitle('Select')    // index 0 → returns 1000
  alert.addButtonWithTitle('Cancel')   // index 1 → returns 1001

  // Custom view: 8 criteria checkboxes + 1 include-source checkbox
  const W       = 310
  const ROW_H   = 22
  const STEP    = 30   // ROW_H + 8px gap
  const VIEW_H  = STEP * 8 + ROW_H + 4  // 8 steps down + last row + padding

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
  const cbSize      = addCheckbox('Same size (' + srcSize.width + '×' + srcSize.height + ')', false)
  const cbType      = addCheckbox('Same object type (' + srcType + ')', false)
  const cbOpacity   = addCheckbox('Same opacity (' + Math.round(srcOpacity * 100) + '%)', false)
  const cbBlendMode = addCheckbox('Same blend mode (' + srcBlendMode + ')', false)
  const cbIncludeSource = addCheckbox('Include source in selection', true)

  alert.setAccessoryView(view)

  // ── Run the modal ─────────────────────────────────────────────────────────
  const response = alert.runModal()
  if (response !== 1000) return  // 1000 = NSAlertFirstButtonReturn

  // ── Read the UI state ─────────────────────────────────────────────────────
  const opts = {
    fill:          cbFill.state()      === 1,
    border:        cbBorder.state()    === 1,
    thickness:     cbThickness.state() === 1,
    radius:        cbRadius.state()    === 1,
    size:          cbSize.state()      === 1,
    type:          cbType.state()      === 1,
    opacity:       cbOpacity.state()   === 1,
    blendMode:     cbBlendMode.state() === 1,
    includeSource: cbIncludeSource.state() === 1
  }

  if (!opts.fill && !opts.border && !opts.thickness && !opts.radius && !opts.size && !opts.type && !opts.opacity && !opts.blendMode) {
    UI.alert('Pikachoose', 'Tick at least one matching criterion.')
    return
  }

  // ── Find matching layers ──────────────────────────────────────────────────
  const sourceIds = new Set(selection.map(l => l.id))
  const all       = sketch.find('*', container)

  const matches = all.filter(layer => {
    if (sourceIds.has(layer.id)) return false
    const needsStyle = opts.fill || opts.border || opts.thickness || opts.radius || opts.opacity || opts.blendMode
    if (needsStyle && !layer.style) return false

    if (opts.fill      && !matchFill(layer, srcFill))              return false
    if (opts.border    && !matchBorderColor(layer, srcBorder))     return false
    if (opts.thickness && !matchBorderThickness(layer, srcBorder)) return false
    if (opts.radius    && !matchRadius(layer, srcRadius))          return false
    if (opts.size      && !matchSize(layer, srcSize))              return false
    if (opts.type      && !matchType(layer, srcType))              return false
    if (opts.opacity   && !matchOpacity(layer, srcOpacity))        return false
    if (opts.blendMode && !matchBlendMode(layer, srcBlendMode))    return false

    return true
  })

  const finalSelection = opts.includeSource ? [...selection, ...matches] : matches

  if (finalSelection.length === 0) {
    UI.message('Pikachoose: no matching ' + typeLabel(srcType, 2) + ' found.')
    return
  }

  doc.selectedLayers = finalSelection
  UI.message('Pikachoose: selected ' + finalSelection.length + ' ' + typeLabel(srcType, finalSelection.length) + '.')
}


// ─── Quick-select commands ────────────────────────────────────────────────────

// Page-wide
function selectSameFill(context)            { quickSelect(context, 'fill') }
function selectSameBorderColour(context)    { quickSelect(context, 'border') }
function selectSameBorderThickness(context) { quickSelect(context, 'thickness') }
function selectSameBorderRadius(context)    { quickSelect(context, 'radius') }
function selectSameSize(context)            { quickSelect(context, 'size') }
function selectSameType(context)            { quickSelect(context, 'type') }
function selectSameOpacity(context)         { quickSelect(context, 'opacity') }
function selectSameBlendMode(context)       { quickSelect(context, 'blendMode') }
function selectSameTextStyle(context)       { quickSelect(context, 'textStyle') }
function selectSameFont(context)            { quickSelect(context, 'font') }
function selectSameFontSize(context)        { quickSelect(context, 'fontSize') }
function selectSameSymbol(context)          { quickSelect(context, 'symbol') }

// Frame-scoped
function selectSameFillInFrame(context)            { quickSelect(context, 'fill',      true) }
function selectSameBorderColourInFrame(context)    { quickSelect(context, 'border',    true) }
function selectSameBorderThicknessInFrame(context) { quickSelect(context, 'thickness', true) }
function selectSameBorderRadiusInFrame(context)    { quickSelect(context, 'radius',    true) }
function selectSameSizeInFrame(context)            { quickSelect(context, 'size',      true) }
function selectSameTypeInFrame(context)            { quickSelect(context, 'type',      true) }
function selectSameOpacityInFrame(context)         { quickSelect(context, 'opacity',   true) }
function selectSameBlendModeInFrame(context)       { quickSelect(context, 'blendMode', true) }
function selectSameTextStyleInFrame(context)       { quickSelect(context, 'textStyle', true) }
function selectSameFontInFrame(context)            { quickSelect(context, 'font',      true) }
function selectSameFontSizeInFrame(context)        { quickSelect(context, 'fontSize',  true) }
function selectSameSymbolInFrame(context)          { quickSelect(context, 'symbol',    true) }

function quickSelect(context, criterion, frameScope) {
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
  const srcType   = getEffectiveType(source)
  const srcSize   = getLayerSize(source)
  const srcOpacity   = getOpacity(source)
  const srcBlendMode = getBlendMode(source)

  // Warn if the source doesn't have the property being matched
  if (criterion === 'fill' && !srcFill) {
    UI.message('Pikachoose: source layer has no fill.')
    return
  }
  if ((criterion === 'border' || criterion === 'thickness') && !srcBorder) {
    UI.message('Pikachoose: source layer has no border.')
    return
  }
  if ((criterion === 'textStyle' || criterion === 'font' || criterion === 'fontSize') && source.type !== 'Text') {
    UI.message('Pikachoose: source layer is not a Text layer.')
    return
  }
  if (criterion === 'textStyle' && !getTextStyleId(source)) {
    UI.message('Pikachoose: source layer has no shared text style.')
    return
  }
  if (criterion === 'symbol' && source.type !== 'SymbolInstance') {
    UI.message('Pikachoose: source layer is not a Symbol instance.')
    return
  }

  const page      = doc.selectedPage
  const container = frameScope ? getContainingFrame(source) : page
  if (frameScope && !container) {
    UI.message('Pikachoose: source layer is not inside a frame.')
    return
  }

  const srcTextStyleId = getTextStyleId(source)
  const srcFontFamily  = getFontFamily(source)
  const srcFontSize    = getFontSize(source)
  const srcSymbolId    = source.symbolId || null

  const sourceIds = new Set(selection.map(l => l.id))
  const all       = sketch.find('*', container)

  const noStyleCriteria = ['type', 'size', 'textStyle', 'symbol']
  const matches = all.filter(layer => {
    if (sourceIds.has(layer.id)) return false
    if (!noStyleCriteria.includes(criterion) && !layer.style) return false
    if (criterion === 'fill'      && !matchFill(layer, srcFill))                  return false
    if (criterion === 'border'    && !matchBorderColor(layer, srcBorder))         return false
    if (criterion === 'thickness' && !matchBorderThickness(layer, srcBorder))     return false
    if (criterion === 'radius'    && !matchRadius(layer, srcRadius))              return false
    if (criterion === 'size'      && !matchSize(layer, srcSize))                  return false
    if (criterion === 'type'      && !matchType(layer, srcType))                  return false
    if (criterion === 'opacity'   && !matchOpacity(layer, srcOpacity))            return false
    if (criterion === 'blendMode' && !matchBlendMode(layer, srcBlendMode))        return false
    if (criterion === 'textStyle' && !matchTextStyle(layer, srcTextStyleId))      return false
    if (criterion === 'font'      && !matchFont(layer, srcFontFamily))            return false
    if (criterion === 'fontSize'  && !matchFontSize(layer, srcFontSize))          return false
    if (criterion === 'symbol'    && !matchSymbol(layer, srcSymbolId))            return false
    return true
  })

  const finalSelection = [...selection, ...matches]
  doc.selectedLayers = finalSelection

  if (matches.length === 0) {
    UI.message('Pikachoose: no additional matching ' + typeLabel(srcType, 2) + ' found.')
  } else {
    UI.message('Pikachoose: selected ' + finalSelection.length + ' ' + typeLabel(srcType, finalSelection.length) + '.')
  }
}


// ─── Select by Name command ───────────────────────────────────────────────────

function selectByName(context)        { _selectByName(context, false) }
function selectByNameInFrame(context) { _selectByName(context, true) }

function _selectByName(context, frameScope) {
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
  const srcType   = getEffectiveType(source)
  const page      = doc.selectedPage
  const container = frameScope ? getContainingFrame(source) : page
  if (frameScope && !container) {
    UI.message('Pikachoose: source layer is not inside a frame.')
    return
  }

  // ── Build dialog ──────────────────────────────────────────────────────────
  const scopeNote = frameScope ? ' [in: ' + container.name + ']' : ''
  const alert = NSAlert.new()
  alert.setMessageText('Select by Name' + scopeNote)
  alert.setInformativeText('Source: "' + source.name + '"')
  alert.addButtonWithTitle('Select')
  alert.addButtonWithTitle('Cancel')

  const W      = 310
  const ROW_H  = 22
  const TF_H   = 26
  const GAP    = 8
  // Layout (AppKit y = bottom-up):
  //   top 4px padding
  //   text field (TF_H)
  //   GAP
  //   match-type row (ROW_H)
  //   GAP
  //   include-source checkbox at y=0 (ROW_H)
  const VIEW_H = 4 + TF_H + GAP + ROW_H + GAP + ROW_H

  const view = NSView.alloc().initWithFrame(NSMakeRect(0, 0, W, VIEW_H))

  // Text field (top) — pre-populated with the source layer's name
  const tfY = VIEW_H - 4 - TF_H
  const tf = NSTextField.alloc().initWithFrame(NSMakeRect(0, tfY, W, TF_H))
  tf.setStringValue(source.name)
  tf.setPlaceholderString('Layer name…')
  view.addSubview(tf)

  // Match-type row (middle)
  const rowY = tfY - GAP - ROW_H
  const lbl = NSTextField.alloc().initWithFrame(NSMakeRect(0, rowY + 2, 90, ROW_H - 2))
  lbl.setStringValue('Match type:')
  lbl.setBezeled(false)
  lbl.setDrawsBackground(false)
  lbl.setEditable(false)
  lbl.setSelectable(false)
  view.addSubview(lbl)

  const popup = NSPopUpButton.alloc().initWithFrame(NSMakeRect(95, rowY, W - 95, ROW_H))
  popup.addItemWithTitle('Exact')
  popup.addItemWithTitle('Contains')
  popup.addItemWithTitle('Starts with')
  popup.addItemWithTitle('Ends with')
  popup.addItemWithTitle('Regex (case-insensitive)')
  view.addSubview(popup)

  // Include-source checkbox (bottom)
  const cbInclude = NSButton.alloc().initWithFrame(NSMakeRect(0, 0, W, ROW_H))
  cbInclude.setButtonType(3)
  cbInclude.setTitle('Include source in selection')
  cbInclude.setState(1)
  view.addSubview(cbInclude)

  alert.setAccessoryView(view)

  const response = alert.runModal()
  if (response !== 1000) return

  const namePattern   = String(tf.stringValue())
  const nameTypeMap   = ['exact', 'contains', 'startsWith', 'endsWith', 'regex']
  const nameType      = nameTypeMap[popup.indexOfSelectedItem()] || 'exact'
  const includeSource = cbInclude.state() === 1

  if (!namePattern.trim()) {
    UI.alert('Pikachoose', 'Enter a name to match against.')
    return
  }

  const sourceIds = new Set(selection.map(l => l.id))
  const all       = sketch.find('*', container)

  const matches = all.filter(layer => {
    if (sourceIds.has(layer.id)) return false
    return matchName(layer.name, namePattern, nameType)
  })

  const finalSelection = includeSource ? [...selection, ...matches] : matches

  if (finalSelection.length === 0) {
    UI.message('Pikachoose: no matching ' + typeLabel(srcType, 2) + ' found.')
    return
  }

  doc.selectedLayers = finalSelection
  UI.message('Pikachoose: selected ' + finalSelection.length + ' ' + typeLabel(srcType, finalSelection.length) + '.')
}


// ─── Style accessors ──────────────────────────────────────────────────────────

// Walks up the parent chain and returns the nearest Frame/Graphic ancestor,
// or null if the layer is directly on the page with no frame container.
function getContainingFrame(layer) {
  let current = layer.parent
  while (current) {
    if (!current.type || current.type === 'Page') return null
    if (current.isFrame) return current
    current = current.parent
  }
  return null
}

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

// Returns { width, height } rounded to 2 decimal places for the layer.
function getLayerSize(layer) {
  const f = layer.frame
  return {
    width:  Math.round((f.width  || 0) * 100) / 100,
    height: Math.round((f.height || 0) * 100) / 100
  }
}

// Returns opacity as a 0–1 number (defaults to 1 if not set).
function getOpacity(layer) {
  const o = layer.style && layer.style.opacity
  return (typeof o === 'number') ? o : 1
}

// Returns the blending mode string (defaults to 'Normal' if not set).
function getBlendMode(layer) {
  return (layer.style && layer.style.blendingMode) || 'Normal'
}

// Returns the shared text/layer style ID string, or null if none.
function getTextStyleId(layer) {
  return layer.sharedStyleId || null
}

// Returns the font family name for a Text layer, or null if unavailable.
function getFontFamily(layer) {
  return (layer.style && layer.style.fontFamily) || null
}

// Returns the font size (number) for a Text layer, or null if unavailable.
function getFontSize(layer) {
  const size = layer.style && layer.style.fontSize
  return (typeof size === 'number') ? size : null
}

// Maps Sketch layer types to human-readable labels.
// Distinguishes Frame/Graphic from plain Group (isFrame / isGraphicFrame flags).
// Collapses ShapePath + Shape → 'Shape', SymbolInstance + SymbolMaster → 'Symbol'.
function getEffectiveType(layer) {
  if (layer.type === 'Group') {
    if (layer.isGraphicFrame) return 'Graphic'
    if (layer.isFrame)        return 'Frame'
    return 'Group'
  }
  if (layer.type === 'Artboard') return 'Frame'  // canvas-level frames report as Artboard in the API
  if (layer.type === 'ShapePath' || layer.type === 'Shape') return 'Shape'
  if (layer.type === 'SymbolInstance' || layer.type === 'SymbolMaster') return 'Symbol'
  return layer.type || 'Unknown'
}

function normalizeHex(color) {
  // Colors come back as '#rrggbbaa' strings; normalise to lowercase for comparison
  return color ? String(color).toLowerCase().trim() : ''
}

function typeLabel(type, count) {
  const plurals = {
    Shape: 'Shapes', Frame: 'Frames', Graphic: 'Graphics',
    Group: 'Groups', Symbol: 'Symbols', Image: 'Images',
    Text: 'Text', HotSpot: 'HotSpots', Slice: 'Slices'
  }
  return count === 1 ? type : (plurals[type] || type + 's')
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
    case 'startsWith':
      return name.toLowerCase().startsWith(ref.toLowerCase())
    case 'endsWith':
      return name.toLowerCase().endsWith(ref.toLowerCase())
    case 'regex':
      try { return new RegExp(ref, 'i').test(name) } catch (e) { return false }
    default:
      return false
  }
}

function matchSize(layer, refSize) {
  const s = getLayerSize(layer)
  return s.width === refSize.width && s.height === refSize.height
}

function matchOpacity(layer, refOpacity) {
  return getOpacity(layer) === refOpacity
}

function matchBlendMode(layer, refBlendMode) {
  return getBlendMode(layer) === refBlendMode
}

function matchTextStyle(layer, refStyleId) {
  return getTextStyleId(layer) === refStyleId
}

function matchFont(layer, refFont) {
  return getFontFamily(layer) === refFont
}

function matchFontSize(layer, refFontSize) {
  return getFontSize(layer) === refFontSize
}

function matchSymbol(layer, refSymbolId) {
  return layer.type === 'SymbolInstance' && layer.symbolId === refSymbolId
}

function matchType(layer, refType) {
  return getEffectiveType(layer) === refType
}
