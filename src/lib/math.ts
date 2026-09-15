import type { CompiledExpr, Expression, View, Waveform } from '../types'

const MATH: Record<string, number | ((...args: number[]) => number)> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  exp: Math.exp,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  min: Math.min,
  max: Math.max,
  hypot: Math.hypot,
  pow: Math.pow,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  mod: (a: number, b: number) => {
    if (!b) return a
    return ((a % b) + b) % b
  },
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
}

const FN_NAMES = new Set(Object.keys(MATH))

export const COLORS = [
  '#e24a4a',
  '#3b82f6',
  '#22a06b',
  '#8b5cf6',
  '#f59e0b',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
]

export function nextId(): string {
  return crypto.randomUUID()
}

export function blankExpression(index: number): Expression {
  return {
    id: nextId(),
    kind: 'cartesian',
    expr: '',
    exprX: 'cos(t)',
    exprY: 'sin(t)',
    tMin: '0',
    tMax: '2pi',
    color: COLORS[index % COLORS.length],
    visible: true,
    inSong: true,
    part: 'sequence',
    pitch: 0,
    speed: 1,
    beats: 2,
    error: null,
  }
}

export function preprocess(raw: string): string {
  let s = raw.trim()
  if (!s) return ''
  s = s.replace(/^\s*[yr]\s*=\s*/i, '')
  s = s.replace(/π/g, 'pi')
  s = s.replace(/θ|ϑ/g, 'theta')
  s = s.replace(/[×·]/g, '*')
  s = s.replace(/\|([^|]+)\|/g, 'abs($1)')
  s = s.replace(/\^/g, '**')
  s = s.replace(/(\d+\.?\d*)[eE]([+-]?\d+)/g, '($1*10**($2))')
  s = s.replace(/(?<![A-Za-z0-9_.])(\d+(?:\.\d*)?|\.\d+)(\s*)(?=[A-Za-z(])/g, '$1*')
  s = s.replace(/(\))(\s*)(?=[A-Za-z(])/g, '$1*')
  s = s.replace(/\b(pi|e|theta|x|t)\b(\s*)(?=[A-Za-z(])/g, '$1*')
  return s
}

function assertSafe(processed: string, vars: string[]): void {
  if (/[;`$]|=>|new\b|constructor/i.test(processed)) {
    throw new Error('Invalid expression')
  }
  const allowed = new Set([...vars, ...FN_NAMES])
  const ids = processed.match(/[A-Za-z_]\w*/g) ?? []
  for (const id of ids) {
    if (!allowed.has(id)) throw new Error(`Unknown "${id}"`)
  }
}

export type CompileExtra = Record<string, number | ((...args: number[]) => number)>

export function compileFn(
  source: string,
  vars: string[],
  extra: CompileExtra = {},
): (scope: Record<string, number>) => number {
  const processed = preprocess(source)
  if (!processed) throw new Error('Empty')
  const extraKeys = Object.keys(extra)
  assertSafe(processed, [...vars, ...extraKeys])
  const keys = Object.keys(MATH)
  let fn: (...args: unknown[]) => unknown
  try {
    fn = new Function(
      ...vars,
      ...keys,
      ...extraKeys,
      `"use strict"; return (${processed});`,
    ) as (...args: unknown[]) => unknown
  } catch {
    throw new Error('Invalid expression')
  }
  const values = Object.values(MATH)
  const extraVals = extraKeys.map((key) => extra[key])
  return (scope) => {
    try {
      const n = fn(...vars.map((v) => scope[v]), ...values, ...extraVals)
      return typeof n === 'number' ? n : NaN
    } catch {
      return NaN
    }
  }
}

function compileBound(source: string, fallback: number): number {
  try {
    const f = compileFn(source, [])
    const n = f({})
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

export function parseTokenNote(raw: string): number | null {
  const tok = raw.trim()
  if (!tok) return null
  if (/^[+-]?\d+(\.\d+)?$/.test(tok)) {
    const n = Number(tok)
    if (!Number.isFinite(n) || Math.abs(n) > 72) return null
    return n
  }
  const m = tok.match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)$/)
  if (!m) return null
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let pc = base[m[1].toUpperCase()] ?? 0
  if (m[2] === '#' || m[2] === '♯') pc += 1
  if (m[2] === 'b' || m[2] === '♭') pc -= 1
  const midi = (Number(m[3]) + 1) * 12 + ((pc % 12) + 12) % 12
  return midi - 69
}

export function parseTonePatch(raw: string): { notes: number[]; detune: number } {
  let s = raw.trim()
  if (!s) return { notes: [], detune: 1 }
  let detune = 1
  const extra = s.match(/(?:(?:\||;|,)\s*a\s*=|\|)\s*([0-9]*\.?[0-9]+)\s*$/i)
  if (extra?.index !== undefined) {
    const parsed = Number(extra[1])
    if (Number.isFinite(parsed) && parsed > 0) detune = parsed
    s = s.slice(0, extra.index).replace(/[\s,;|]+$/, '')
  }
  s = s.replace(/^tone\s*\(/i, '').replace(/\)\s*$/, '')
  s = s.replace(/^\[/, '').replace(/\]$/, '')
  const notes = s
    .split(/[,\s]+/)
    .map(parseTokenNote)
    .filter((n): n is number => n !== null)
  return { notes, detune }
}

export function formatToneExpr(notes: number[], detune = 1): string {
  const names = [...notes]
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .slice(0, 12)
    .map((n) => freqToNote(toneFreq(n)))
  const body = names.join(' ')
  return detune !== 1 ? `${body} | ${detune}` : body
}

function formatCoeff(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 10000) / 10000)
}

/**
 * A single note as real math. Every note travels at the same speed, so a chord
 * keeps its shape as t grows — and the drawing matches the pitch you hear.
 */
export function noteWaveTerm(n: number, detune = 1, wave: Waveform = 'sine'): string {
  const pow = `2^(${formatCoeff(n)}/12)`
  const ratio = detune === 1 ? pow : `${formatCoeff(detune)}*${pow}`
  const arg = n === 0 && detune === 1 ? 'x - t' : `${ratio}*(x - t)`
  if (wave === 'square') return `sign(sin(${arg}))`
  if (wave === 'triangle') return `(2/pi)*asin(sin(${arg}))`
  if (wave === 'sawtooth') return `2*((${arg})/(2*pi)-floor((${arg})/(2*pi)))-1`
  return `sin(${arg})`
}

export function parseListDef(source: string): { name: string; notes: number[] } | null {
  const m = source.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!m) return null
  const name = m[1]
  let rhs = m[2].trim()
  if (/^(x|y|r|t|theta|pi|e)$/i.test(name)) return null
  if (/\b(sin|cos|tan|abs|sqrt|tone|log|asin|atan|mod)\b/i.test(rhs)) return null
  const detuneTail = rhs.match(/^(.*?)\s*\|\s*[0-9]*\.?[0-9]+\s*$/)
  if (detuneTail) rhs = detuneTail[1].trim()
  if (/[+\-*/^(){}]/.test(rhs) && !/^[-+]?\d/.test(rhs.split(/[,\s]+/)[0] ?? '')) return null
  const tokens = rhs ? rhs.replace(/^\[/, '').replace(/\]$/, '').split(/[,\s]+/).filter((tok) => tok && tok !== '|') : []
  if (tokens.length === 0) return { name, notes: [] }
  if (tokens.length === 1 && /^[+-]?\d+(\.\d+)?$/.test(tokens[0])) return null
  const notes = tokens.map(parseTokenNote).filter((n): n is number => n !== null)
  if (notes.length === 0) return null
  return { name, notes }
}

export function parseNumberDef(source: string): { name: string; value: number } | null {
  const m = source.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/)
  if (!m) return null
  const name = m[1]
  const rhs = m[2].trim()
  if (/^(x|y|r|t|theta|pi|e)$/i.test(name)) return null
  if (parseListDef(source)) return null
  if (/\btone\b/i.test(rhs)) return null
  try {
    const n = compileFn(rhs, [])({})
    if (!Number.isFinite(n)) return null
    return { name, value: n }
  } catch {
    return null
  }
}

export function collectLists(expressions: Expression[]): Record<string, number[]> {
  const lists: Record<string, number[]> = {}
  for (const expr of expressions) {
    const def = parseListDef(expr.expr)
    if (def) lists[def.name] = def.notes
  }
  return lists
}

export function collectNumbers(expressions: Expression[]): Record<string, number> {
  const numbers: Record<string, number> = {}
  for (const expr of expressions) {
    const def = parseNumberDef(expr.expr)
    if (def) numbers[def.name] = def.value
  }
  return numbers
}

export function clampSpeed(value: number | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(8, Math.max(0.25, n))
}

export function clampBeats(value: number | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 2
  return Math.min(8, Math.max(0.5, n))
}

export function clampPitch(value: number | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(48, Math.max(-48, Math.round(n)))
}

/** Rate raises pitch by the same factor it scrolls the graph. */
export function pitchToFreq(semitones: number, rate = 1): number {
  const hz = 440 * 2 ** (clampPitch(semitones) / 12) * clampSpeed(rate)
  return Math.min(8000, Math.max(20, hz))
}

/** The notes named by the first argument of tone(...). Hertz forms return none. */
export function resolveToneInner(inner: string, lists: Record<string, number[]>): number[] {
  const first = (splitTopLevel(inner, ',')[0] ?? '').trim()
  if (!first) return []
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(first)) {
    // A defined list wins; otherwise a lone name like A4 or C#5 is that note.
    const list = lists[first]
    if (list) return list
    const note = parseTokenNote(first)
    return note === null ? [] : [note]
  }
  // Arithmetic or a bare number means hertz, like Desmos. Only names are notes.
  if (/[*+/^()]/.test(first)) return []
  if (/(?:^|[\s,])[+-]?\d/.test(first)) return []
  return parseTonePatch(first).notes
}

export function findToneCalls(source: string): Array<{ start: number; end: number; inner: string }> {
  const out: Array<{ start: number; end: number; inner: string }> = []
  const re = /\btone\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    const open = match.index + match[0].length - 1
    let depth = 1
    let i = open + 1
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) break
    out.push({ start: match.index, end: i + 1, inner: source.slice(open + 1, i) })
    re.lastIndex = i + 1
  }
  return out
}

export function extractToneInners(source: string): string[] {
  return findToneCalls(source).map((call) => call.inner)
}

function splitTopLevel(source: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(' || ch === '{') depth += 1
    else if (ch === ')' || ch === '}') depth -= 1
    else if (ch === sep && depth === 0) {
      parts.push(source.slice(start, i))
      start = i + sep.length
    }
  }
  parts.push(source.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

function topLevelIndex(source: string, sep: string): number {
  let depth = 0
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(' || ch === '{') depth += 1
    else if (ch === ')' || ch === '}') depth -= 1
    else if (source.startsWith(sep, i) && depth === 0) return i
  }
  return -1
}

function condToJs(cond: string): string {
  const s = cond.replace(/≤/g, '<=').replace(/≥/g, '>=').trim()
  const chained = s.match(/^(.+?)\s*(<=|<|>=|>)\s*([A-Za-z]\w*)\s*(<=|<|>=|>)\s*(.+)$/)
  if (chained) return `(${chained[1]} ${chained[2]} ${chained[3]}) && (${chained[3]} ${chained[4]} ${chained[5]})`
  return s
}

function wrapDomain(
  fn: (scope: Record<string, number>) => number,
  condSource: string | null,
  vars: string[],
  extra: CompileExtra,
): (scope: Record<string, number>) => number {
  if (!condSource) return fn
  try {
    const pred = compileFn(`(${condToJs(condSource)}) ? 1 : 0`, vars, extra)
    return (scope) => (pred(scope) > 0.5 ? fn(scope) : NaN)
  } catch {
    return fn
  }
}

function compileDesmosFn(source: string, vars: string[], extra: CompileExtra = {}): (scope: Record<string, number>) => number {
  const trimmed = source.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes(':')) {
    const parts = splitTopLevel(trimmed.slice(1, -1), ',')
    let js = '0'
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i]
      const colon = topLevelIndex(part, ':')
      if (colon < 0) {
        js = `(${part})`
        continue
      }
      const cond = condToJs(part.slice(0, colon).trim())
      const value = part.slice(colon + 1).trim()
      js = `((${cond}) ? (${value}) : (${js}))`
    }
    return compileFn(js, vars, extra)
  }
  const restricted = trimmed.match(/^(.*)\{([^{}]+)\}\s*$/)
  if (restricted && !restricted[2].includes(':')) {
    const body = compileFn(restricted[1].trim() || '0', vars, extra)
    return wrapDomain(body, restricted[2], vars, extra)
  }
  return compileFn(trimmed, vars, extra)
}

function toggleNote(notes: number[], note: number): number[] {
  return notes.includes(note) ? notes.filter((n) => n !== note) : [...notes, note].sort((a, b) => a - b)
}

export type PianoEdit = {
  expr: string
  listUpdate?: { name: string; notes: number[] }
}

export function togglePianoOnEquation(source: string, note: number, lists: Record<string, number[]>): PianoEdit {
  const trimmed = source.trim()
  const def = parseListDef(trimmed)
  if (def) {
    const notes = toggleNote(def.notes, note)
    return { expr: `${def.name} = ${formatToneExpr(notes)}` }
  }
  if (parseNumberDef(trimmed)) return { expr: trimmed }
  if (isChordOnlyEquation(trimmed) && notesInEquation(trimmed).length > 0) {
    const notes = toggleNote(notesInEquation(trimmed), note)
    return { expr: notes.length ? formatChordEquation(notes) : '' }
  }
  const call = findToneCalls(trimmed)[0]
  if (call) {
    const inner = call.inner.trim()
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(inner)) {
      return { expr: trimmed, listUpdate: { name: inner, notes: toggleNote(lists[inner] ?? [], note) } }
    }
    const notes = toggleNote(parseTonePatch(inner).notes, note)
    return { expr: notes.length ? formatChordEquation(notes) : '' }
  }
  if (!trimmed) return { expr: formatChordEquation([note]) }
  return { expr: `${trimmed} + ${noteWaveTerm(note)}` }
}

export function applyListUpdate(expressions: Expression[], name: string, notes: number[]): Expression[] {
  const line = `${name} = ${formatToneExpr(notes)}`
  let found = false
  const next = expressions.map((expr) => {
    const def = parseListDef(expr.expr)
    if (def?.name !== name) return expr
    found = true
    return { ...expr, expr: line, error: null }
  })
  if (found) return next
  return [...next, { ...blankExpression(expressions.length), expr: line, error: null }]
}

export function formatChordEquation(notes: number[], detune = 1, wave: Waveform = 'sine'): string {
  if (notes.length === 0) return ''
  return [...notes]
    .sort((a, b) => a - b)
    .map((n) => noteWaveTerm(n, detune, wave))
    .join(' + ')
}

function termVariants(n: number, detune = 1): string[] {
  const waves: Waveform[] = ['sine', 'square', 'triangle', 'sawtooth']
  const current = waves.map((wave) => noteWaveTerm(n, detune, wave))
  const legacy = [`sin(2^(${formatCoeff(n)}/12)*x)`, ...(n === 0 && detune === 1 ? ['sin(x)'] : [])]
  return [...new Set([...current, ...legacy])]
}

export function stripNoteTerm(source: string, n: number, detune = 1): string {
  let s = source.trim()
  for (const term of termVariants(n, detune)) {
    if (s === term) return ''
    const needles = [` + ${term}`, `${term} + `, `+${term}`, `${term}+`]
    for (const find of needles) {
      const idx = s.indexOf(find)
      if (idx < 0) continue
      s = `${s.slice(0, idx)}${s.slice(idx + find.length)}`.trim()
      return s.replace(/^\+\s*/, '').replace(/\s*\+$/, '').trim()
    }
  }
  return s
}

export function notesInEquation(source: string): number[] {
  const found = new Set<number>()
  const re = /2\^\(\s*(-?\d+(?:\.\d+)?)\s*\/\s*12\s*\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) found.add(Number(match[1]))
  if (/(?:^|\+)\s*sin\(\s*x\s*-\s*t\s*\)(?=\s*(?:\+|$))/.test(source.trim())) found.add(0)
  return [...found].sort((a, b) => a - b)
}

export function isChordOnlyEquation(source: string): boolean {
  const notes = notesInEquation(source)
  if (notes.length === 0) return false
  let leftover = source.trim()
  for (const n of notes) leftover = stripNoteTerm(leftover, n)
  return leftover.replace(/[+\s]/g, '') === ''
}

export function usesTimeParam(source: string): boolean {
  const stripped = source.replace(/\btone\s*\([^)]*\)/gi, ' ')
  return /(?<![A-Za-z_])t(?![A-Za-z0-9_])/.test(stripped)
}

/** True when the drawing actually changes as t grows. Used for the row badge. */
export function movesWithTime(expr: Expression): boolean {
  if (expr.kind === 'tones') return parseTonePatch(expr.expr).notes.length > 0
  // In a parametric row t is the parameter being swept, not the clock.
  if (expr.kind === 'parametric') return false
  if (expr.kind === 'polar') return usesTimeParam(expr.expr)
  if (parseListDef(expr.expr) || parseNumberDef(expr.expr)) return false
  return usesTimeParam(expr.expr) || findToneCalls(expr.expr).length > 0
}

/** A row is a whole tone() call or a bare sum of note terms — an exact chord. */
export function isPureVoiceRow(source: string): boolean {
  const trimmed = source.trim()
  if (/^tone\s*\(/i.test(trimmed)) {
    const call = findToneCalls(trimmed)[0]
    if (call && call.start === 0 && call.end === trimmed.length) return true
  }
  return isChordOnlyEquation(trimmed)
}

/** An expression that needs no variable is a flat line, and a flat line is silent. */
export function isConstantExpr(source: string): boolean {
  if (!source.trim()) return true
  // Anything that reads x, t or theta varies, so skip compiling it.
  if (/(?<![A-Za-z_])(theta|x|t)(?![A-Za-z0-9_])/i.test(source)) return false
  try {
    return Number.isFinite(compileFn(source, [])({}))
  } catch {
    return false
  }
}

/**
 * What a row sounds like.
 *  notes  — an exact chord, one oscillator per note
 *  hertz  — tone(f), a single frequency
 *  curve  — anything else that draws: the shape itself becomes the waveform
 *  silent — definitions, constants, empty and broken rows
 */
export type RowVoice = 'notes' | 'hertz' | 'curve' | 'silent'

export type RowSound = {
  kind: RowVoice
  notes: number[]
  freq: number | null
  gain: number
  /** Desmos a₄ — multiplies every frequency in this row. */
  detune: number
  pitch: number
  rate: number
}

export function rowPlayback(
  expr: Expression,
  lists: Record<string, number[]> = {},
  numbers: Record<string, number> = {},
): RowSound {
  const base = {
    notes: [] as number[],
    freq: null as number | null,
    gain: 1,
    detune: 1,
    pitch: clampPitch(expr.pitch),
    rate: clampSpeed(expr.speed),
  }
  if (expr.error) return { ...base, kind: 'silent' }

  if (expr.kind === 'tones') {
    const patch = parseTonePatch(expr.expr)
    return {
      ...base,
      kind: patch.notes.length ? 'notes' : 'silent',
      notes: patch.notes,
      detune: patch.detune,
    }
  }

  if (expr.kind === 'cartesian') {
    const src = expr.expr.trim()
    // A definition line (A = C4 E4 G4, f = 440) names something. It does not sound.
    if (!src || parseListDef(src) || parseNumberDef(src) || isConstantExpr(src)) {
      return { ...base, kind: 'silent' }
    }
    const gain = toneGain(src, numbers)
    if (isPureVoiceRow(src)) {
      const notes = expressionNotes(expr, lists)
      if (notes.length) return { ...base, kind: 'notes', notes, gain }
      const hz = constantToneHz(src, lists, numbers)
      // tone(Now) with an empty list is a rest.
      return hz == null ? { ...base, kind: 'silent' } : { ...base, kind: 'hertz', freq: hz, gain }
    }
    return { ...base, kind: 'curve', gain }
  }

  if (expr.kind === 'polar') {
    const src = expr.expr.trim()
    return { ...base, kind: isConstantExpr(src) ? 'silent' : 'curve' }
  }

  // Parametric: the y component is the one you hear.
  if (!expr.exprX.trim() || isConstantExpr(expr.exprY)) return { ...base, kind: 'silent' }
  return { ...base, kind: 'curve' }
}

export function rowIsSilent(expr: Expression, lists: Record<string, number[]> = {}, numbers: Record<string, number> = {}): boolean {
  return rowPlayback(expr, lists, numbers).kind === 'silent'
}

/**
 * One cycle of a row's own curve, as Fourier coefficients for a custom
 * oscillator. Cartesian rows are read over x in [0, 2pi], so sin(x) gives one
 * cycle and sin(3x) gives three — the same rule the note terms follow. Polar
 * and parametric rows are read across their own parameter range.
 */
export type WaveTable = { real: Float32Array; imag: Float32Array; gain: number }

export function rowWaveTable(
  expr: Expression,
  wave: Waveform = 'sine',
  lists: Record<string, number[]> = {},
  numbers: Record<string, number> = {},
  samples = 1024,
  harmonics = 128,
): WaveTable | null {
  let compiled: CompiledExpr
  try {
    compiled = compileExpression(expr, wave, lists, numbers)
  } catch {
    return null
  }
  const n = Math.max(64, samples)
  let read: ((i: number) => number) | null = null
  if ((expr.kind === 'cartesian' || expr.kind === 'tones') && compiled.f) {
    const f = compiled.f
    read = (i) => f((i / n) * Math.PI * 2, 0)
  } else if (expr.kind === 'polar' && compiled.r) {
    const r = compiled.r
    const span = compiled.t1 - compiled.t0
    read = (i) => r(compiled.t0 + (i / n) * span, 0)
  } else if (expr.kind === 'parametric' && compiled.fy) {
    const fy = compiled.fy
    const span = compiled.t1 - compiled.t0
    read = (i) => fy(compiled.t0 + (i / n) * span)
  }
  if (!read) return null

  const data = new Float32Array(n)
  let mean = 0
  for (let i = 0; i < n; i++) {
    const v = read(i)
    data[i] = Number.isFinite(v) ? v : 0
    mean += data[i]
  }
  mean /= n
  let peak = 0
  for (let i = 0; i < n; i++) {
    data[i] -= mean
    peak = Math.max(peak, Math.abs(data[i]))
  }
  if (!(peak > 1e-4)) return null
  for (let i = 0; i < n; i++) data[i] /= peak

  const { real, imag } = fourierFromSamples(data, harmonics)
  // Same rule as tone(hz, gain): an amplitude under 1 plays quieter.
  return { real, imag, gain: Math.min(1, peak) }
}

/** Harmonic amplitudes of one cycle, in the layout createPeriodicWave wants. */
export function fourierFromSamples(
  data: Float32Array,
  harmonics = 128,
): { real: Float32Array; imag: Float32Array } {
  const n = data.length
  const cosTable = new Float32Array(n)
  const sinTable = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n
    cosTable[i] = Math.cos(angle)
    sinTable[i] = Math.sin(angle)
  }
  const count = Math.max(1, Math.min(harmonics, Math.floor(n / 2) - 1))
  const real = new Float32Array(count + 1)
  const imag = new Float32Array(count + 1)
  for (let k = 1; k <= count; k++) {
    let re = 0
    let im = 0
    for (let i = 0, j = 0; i < n; i++) {
      re += data[i] * cosTable[j]
      im += data[i] * sinTable[j]
      j += k
      if (j >= n) j -= n
    }
    real[k] = (2 * re) / n
    imag[k] = (2 * im) / n
  }
  return { real, imag }
}

export function sequenceHits(
  expressions: Expression[],
  lists: Record<string, number[]>,
  numbers: Record<string, number>,
  bpm: number,
): Array<{ time: number; notes: number[]; id: string; dur: number }> {
  const hits: Array<{ time: number; notes: number[]; id: string; dur: number }> = []
  let time = 0
  const secondsPerBeat = 60 / Math.max(40, Math.min(240, bpm))
  for (const expr of expressions) {
    if (expr.error || !expr.inSong || expr.part !== 'sequence') continue
    const sound = rowPlayback(expr, lists, numbers)
    if (sound.kind === 'silent') continue
    const dur = clampBeats(expr.beats) * secondsPerBeat
    hits.push({ time, notes: sound.notes, id: expr.id, dur })
    time += dur
  }
  return hits
}

function constantToneHz(
  source: string,
  lists: Record<string, number[]>,
  numbers: Record<string, number>,
): number | null {
  const call = findToneCalls(source)[0]
  if (!call) return null
  const freqSrc = splitTopLevel(call.inner, ',')[0] ?? ''
  if (!freqSrc || resolveToneInner(freqSrc, lists).length) return null
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(freqSrc.trim()) && numbers[freqSrc.trim()] == null) return null
  try {
    const hz = compileFn(freqSrc, ['x', 't'], numbers)({ x: 0, t: 0 })
    if (!Number.isFinite(hz) || hz < 20 || hz > 20000) return null
    return hz
  } catch {
    return null
  }
}

/** The gain argument of tone(hz, gain), so what you hear matches the picture. */
function toneGain(source: string, numbers: Record<string, number>): number {
  const call = findToneCalls(source)[0]
  if (!call) return 1
  const gainSrc = splitTopLevel(call.inner, ',')[1]
  if (!gainSrc) return 1
  try {
    const g = compileFn(gainSrc, ['x', 't'], numbers)({ x: 0, t: 0 })
    if (!Number.isFinite(g)) return 1
    return Math.min(1, Math.max(0, g))
  } catch {
    return 1
  }
}

export function expressionNotes(expr: Expression, lists: Record<string, number[]> = {}): number[] {
  if (expr.kind === 'tones') return parseTonePatch(expr.expr).notes
  if (expr.kind !== 'cartesian') return []
  const def = parseListDef(expr.expr)
  if (def) return def.notes
  const fromTone = extractToneInners(expr.expr).flatMap((inner) => resolveToneInner(inner, lists))
  if (fromTone.length > 0) return [...new Set(fromTone)].sort((a, b) => a - b)
  return notesInEquation(expr.expr)
}

export function oscillator(phase: number, wave: Waveform = 'sine'): number {
  if (wave === 'square') {
    const s = Math.sin(phase)
    return s > 0 ? 1 : s < 0 ? -1 : 0
  }
  if (wave === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase))
  if (wave === 'sawtooth') {
    const tau = Math.PI * 2
    const wrapped = ((phase % tau) + tau) % tau
    return (2 * wrapped) / tau - 1
  }
  return Math.sin(phase)
}

export function toneY(notes: number[], detune: number, x: number, wave: Waveform = 'sine', t = 0): number {
  let y = 0
  for (const n of notes) {
    const k = 2 ** (n / 12) * detune
    y += oscillator(k * (x - t), wave)
  }
  return y
}

export function toneFreq(n: number, detune = 1, rootHz = 440): number {
  return Math.min(4186, Math.max(27.5, rootHz * 2 ** (n / 12) * detune))
}

export function compileWithTone(
  source: string,
  wave: Waveform,
  lists: Record<string, number[]>,
  numbers: Record<string, number> = {},
): (x: number, t: number) => number {
  const extra: CompileExtra = { ...numbers }
  let rewritten = source
  const calls = findToneCalls(source)
  for (let c = calls.length - 1; c >= 0; c -= 1) {
    const call = calls[c]
    const name = `__tone${calls.length - 1 - c}`
    const parts = splitTopLevel(call.inner, ',')
    const freqSrc = parts[0] ?? '440'
    const gainSrc = parts[1]
    const notes = resolveToneInner(freqSrc, lists)
    const listName = /^[A-Za-z][A-Za-z0-9_]*$/.test(freqSrc.trim())
    const gainFn = gainSrc ? compileDesmosFn(gainSrc, ['x', 't'], extra) : null
    const gainAt = (x: number, time: number) =>
      gainFn ? Math.min(1, Math.max(0, gainFn({ x, t: time }))) : 1
    if (notes.length || (listName && numbers[freqSrc.trim()] == null)) {
      extra[name] = (x: number, time: number) => gainAt(x, time) * toneY(notes, 1, x, wave, time)
    } else {
      const freqFn = compileDesmosFn(freqSrc, ['x', 't'], extra)
      extra[name] = (x: number, time: number) => {
        const hz = Math.min(5000, Math.max(20, freqFn({ x, t: time })))
        const k = hz / 440
        return gainAt(x, time) * oscillator(k * (x - time), wave)
      }
    }
    rewritten = `${rewritten.slice(0, call.start)}${name}(x,t)${rewritten.slice(call.end)}`
  }
  const fn = compileDesmosFn(rewritten, ['x', 't'], extra)
  return (x, t) => fn({ x, t })
}

export function compileExpression(
  expr: Expression,
  wave: Waveform = 'sine',
  lists: Record<string, number[]> = {},
  numbers: Record<string, number> = {},
): CompiledExpr {
  const compiled: CompiledExpr = {
    id: expr.id,
    color: expr.color,
    kind: expr.kind,
    f: null,
    r: null,
    fx: null,
    fy: null,
    t0: 0,
    t1: Math.PI * 2,
    notes: null,
    detune: 1,
    speed: clampSpeed(expr.speed),
  }

  if (expr.kind === 'polar' || expr.kind === 'parametric') {
    compiled.t0 = compileBound(expr.tMin, 0)
    compiled.t1 = compileBound(expr.tMax, Math.PI * 2)
    if (compiled.t1 <= compiled.t0) compiled.t1 = compiled.t0 + Math.PI * 2
  }

  if (expr.kind === 'cartesian') {
    if (!expr.expr.trim()) return compiled
    if (parseNumberDef(expr.expr)) return compiled
    const def = parseListDef(expr.expr)
    if (def) {
      compiled.notes = def.notes
      compiled.f = (x, time) => toneY(def.notes, 1, x, wave, time)
      return compiled
    }
    if (/^[A-Za-z][A-Za-z0-9_]*\s*=/.test(expr.expr.trim())) {
      compiled.notes = []
      return compiled
    }
    compiled.notes = extractToneInners(expr.expr).flatMap((inner) => resolveToneInner(inner, lists))
    if (!compiled.notes.length) compiled.notes = notesInEquation(expr.expr)
    try {
      compiled.f = compileWithTone(expr.expr, wave, lists, numbers)
    } catch {
      compiled.f = null
    }
    return compiled
  }

  if (expr.kind === 'polar') {
    if (!expr.expr.trim()) return compiled
    const fn = compileDesmosFn(expr.expr, ['theta', 't'], numbers)
    compiled.r = (theta, t) => fn({ theta, t })
    return compiled
  }

  if (expr.kind === 'tones') {
    const patch = parseTonePatch(expr.expr)
    compiled.notes = patch.notes
    compiled.detune = patch.detune
    compiled.f = (x, time) => toneY(patch.notes, patch.detune, x, wave, time)
    return compiled
  }

  if (!expr.exprX.trim() || !expr.exprY.trim()) return compiled
  const gx = compileDesmosFn(expr.exprX, ['t'], numbers)
  const gy = compileDesmosFn(expr.exprY, ['t'], numbers)
  compiled.fx = (t) => gx({ t })
  compiled.fy = (t) => gy({ t })
  return compiled
}

export function validateExpression(
  expr: Expression,
  lists: Record<string, number[]> = {},
  numbers: Record<string, number> = {},
): string | null {
  try {
    if (expr.kind === 'cartesian') {
      if (!expr.expr.trim()) return null
      if (parseListDef(expr.expr) || parseNumberDef(expr.expr)) return null
      compileWithTone(expr.expr, 'sine', lists, numbers)
      return null
    }
    if (expr.kind === 'polar') {
      if (!expr.expr.trim()) return null
      compileDesmosFn(expr.expr, ['theta', 't'], numbers)
      compileFn(expr.tMin || '0', [])
      compileFn(expr.tMax || '2pi', [])
      return null
    }
    if (expr.kind === 'tones') {
      if (!expr.expr.trim()) return null
      const patch = parseTonePatch(expr.expr)
      if (patch.notes.length === 0) return 'Type notes like C4 E4 G4, or click the piano'
      return null
    }
    if (!expr.exprX.trim() && !expr.exprY.trim()) return null
    compileDesmosFn(expr.exprX, ['t'], numbers)
    compileDesmosFn(expr.exprY, ['t'], numbers)
    compileFn(expr.tMin || '0', [])
    compileFn(expr.tMax || '2pi', [])
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid expression'
  }
}

export type WorldBounds = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export function boundsFromView(view: View, width: number, height: number): WorldBounds {
  const hw = width / (2 * view.scale)
  const hh = height / (2 * view.scale)
  return {
    xMin: view.cx - hw,
    xMax: view.cx + hw,
    yMin: view.cy - hh,
    yMax: view.cy + hh,
  }
}

export function freqToNote(freq: number): string {
  if (!Number.isFinite(freq) || freq <= 0) return 'A4'
  const midi = 69 + 12 * Math.log2(freq / 440)
  if (!Number.isFinite(midi)) return 'A4'
  const rounded = Math.round(midi)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const name = names[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}`
}

export function formatToneChord(notes: number[], detune = 1): string {
  if (notes.length === 0) return 'empty'
  const chord = notes.map((n) => freqToNote(toneFreq(n))).join(' · ')
  return detune !== 1 ? `${chord}  (detune ${detune})` : chord
}

export function niceStep(range: number, target = 8): number {
  const raw = Math.abs(range) / target
  if (!Number.isFinite(raw) || raw === 0) return 1
  const exp = 10 ** Math.floor(Math.log10(raw))
  const m = raw / exp
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10
  return nice * exp
}

export const DEFAULT_VIEW: View = { cx: 0, cy: 0, scale: 44 }
