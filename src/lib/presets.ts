import type { Expression, Part, View, Waveform } from '../types'
import {
  clampPitch,
  COLORS,
  collectLists,
  collectNumbers,
  formatChordEquation,
  nextId,
  parseTokenNote,
  validateExpression,
} from './math'

export type PresetGroup = 'sounds' | 'shapes' | 'mixes'

type PresetSeed = {
  name: string
  hint: string
  group: PresetGroup
  view: View
  duration?: number
  waveform?: Waveform
  bpm?: number
  expressions: Array<Partial<Expression> & { kind: Expression['kind'] }>
}

export type Preset = {
  name: string
  hint: string
  group: PresetGroup
  view: View
  duration: number
  waveform: Waveform
  bpm: number
  expressions: Expression[]
}

export type MixFile = {
  name?: string
  hint?: string
  group?: PresetGroup
  view?: Partial<View>
  duration?: number
  waveform?: Waveform
  bpm?: number
  volume?: number
  expressions?: Array<Partial<Expression> & { kind?: Expression['kind'] }>
}

function fill(partial: Partial<Expression> & { kind: Expression['kind'] }, index: number): Expression {
  const expr: Expression = {
    id: nextId(),
    kind: partial.kind,
    expr: partial.expr ?? '',
    exprX: partial.exprX ?? 'cos(t)',
    exprY: partial.exprY ?? 'sin(t)',
    tMin: partial.tMin ?? '0',
    tMax: partial.tMax ?? '2pi',
    color: partial.color ?? COLORS[index % COLORS.length],
    visible: partial.visible !== false,
    inSong: partial.inSong !== false,
    part: partial.part === 'sustain' ? 'sustain' : 'sequence',
    pitch: clampPitch(partial.pitch),
    speed: typeof partial.speed === 'number' ? partial.speed : 1,
    beats: typeof partial.beats === 'number' ? partial.beats : 2,
    error: null,
  }
  return expr
}

function finalizeExpressions(list: Expression[]): Expression[] {
  const lists = collectLists(list)
  const numbers = collectNumbers(list)
  return list.map((expr) => ({ ...expr, error: validateExpression(expr, lists, numbers) }))
}

export function cloneExpressions(list: Expression[]): Expression[] {
  return finalizeExpressions(
    list.map((expr) => ({
      ...expr,
      id: nextId(),
      part: expr.part ?? 'sequence',
      pitch: clampPitch(expr.pitch),
      speed: expr.speed ?? 1,
      beats: expr.beats ?? 2,
      error: null,
    })),
  )
}

function namedChord(...names: string[]): string {
  return formatChordEquation(names.map((name) => parseTokenNote(name)).filter((n): n is number => n !== null))
}

function chordRow(notes: string, beats: number, color: number, visible = true): Partial<Expression> & { kind: Expression['kind'] } {
  return { kind: 'cartesian', expr: `tone(${notes})`, beats, color: COLORS[color % COLORS.length], visible }
}

const SEEDS: PresetSeed[] = [
  {
    name: 'Sine',
    hint: 'A440, written as math. The − t is what makes it travel',
    group: 'sounds',
    view: { cx: 0, cy: 0, scale: 48 },
    expressions: [{ kind: 'cartesian', expr: 'sin(x - t)', part: 'sustain' }],
  },
  {
    name: 'Still sine',
    hint: 'No t, so the graph holds still — and it still plays A440',
    group: 'sounds',
    view: { cx: 0, cy: 0, scale: 48 },
    expressions: [{ kind: 'cartesian', expr: 'tone(440)', part: 'sustain' }],
  },
  {
    name: 'Rate stack',
    hint: 'One shape at ½×, 1× and 2× — the graph speeds match the octaves',
    group: 'sounds',
    view: { cx: 0, cy: 0, scale: 30 },
    expressions: [
      { kind: 'cartesian', expr: 'sin(x - t) + sin(2*(x - t))/2', color: COLORS[0], part: 'sustain', speed: 0.5 },
      { kind: 'cartesian', expr: 'sin(x - t) + sin(2*(x - t))/2 + 3', color: COLORS[1], part: 'sustain', speed: 1 },
      { kind: 'cartesian', expr: 'sin(x - t) + sin(2*(x - t))/2 - 3', color: COLORS[2], part: 'sustain', speed: 2 },
    ],
  },
  {
    name: 'Heart',
    hint: 'The classic parametric heart. Its y curve is the waveform — warm and hollow',
    group: 'shapes',
    view: { cx: 0, cy: 2, scale: 22 },
    expressions: [
      {
        kind: 'parametric',
        exprX: '16sin(t)^3',
        exprY: '13cos(t) - 5cos(2t) - 2cos(3t) - cos(4t)',
        tMin: '0',
        tMax: '2pi',
        color: COLORS[0],
        part: 'sustain',
        pitch: -12,
      },
    ],
  },
  {
    name: 'Lissajous',
    hint: '3:4 bow curve. Four cycles of y per loop, so it sounds two octaves up',
    group: 'shapes',
    view: { cx: 0, cy: 0, scale: 90 },
    expressions: [
      {
        kind: 'parametric',
        exprX: 'sin(3t)',
        exprY: 'sin(4t)',
        tMin: '0',
        tMax: '2pi',
        part: 'sustain',
        pitch: -24,
      },
    ],
  },
  {
    name: 'Rose',
    hint: 'r = cos(4θ). Four petals, four cycles, a clean two octaves up',
    group: 'shapes',
    view: { cx: 0, cy: 0, scale: 90 },
    expressions: [{ kind: 'polar', expr: 'cos(4theta)', tMin: '0', tMax: '2pi', part: 'sustain', pitch: -24 }],
  },
  {
    name: 'Cardioid',
    hint: 'A polar apple. One smooth bump per turn, so it sounds like a soft sine',
    group: 'shapes',
    view: { cx: 0.4, cy: 0, scale: 70 },
    expressions: [{ kind: 'polar', expr: '1 + cos(theta)', tMin: '0', tMax: '2pi', part: 'sustain', pitch: -12 }],
  },
  {
    name: 'Spiral',
    hint: 'Archimedes, going out. A rising radius is a ramp, so this one buzzes like a saw',
    group: 'shapes',
    view: { cx: 0, cy: 0, scale: 28 },
    expressions: [{ kind: 'polar', expr: 'theta / 6', tMin: '0', tMax: '12pi', part: 'sustain', pitch: -12 }],
  },
  {
    name: 'Butterfly',
    hint: 'Fay’s butterfly. Six turns of a jagged radius — messy harmonics, on purpose',
    group: 'shapes',
    view: { cx: 0, cy: 0, scale: 48 },
    expressions: [
      {
        kind: 'polar',
        expr: 'exp(sin(theta)) - 2cos(4theta) + sin((2theta - pi) / 24)^5',
        tMin: '0',
        tMax: '12pi',
        part: 'sustain',
        pitch: -24,
      },
    ],
  },
  {
    name: 'Spirograph',
    hint: 'Hypotrochoid doodle. Two speeds at once, so you hear two pitches at once',
    group: 'shapes',
    view: { cx: 0, cy: 0, scale: 55 },
    expressions: [
      {
        kind: 'parametric',
        exprX: '2*cos(t) + 5*cos(2t/3)',
        exprY: '2*sin(t) - 5*sin(2t/3)',
        tMin: '0',
        tMax: '6pi',
        color: COLORS[3],
        part: 'sustain',
        pitch: -24,
      },
    ],
  },
  {
    name: 'Flower',
    hint: 'A 5-petal bloom over half a turn — the loop does not close, so it bites',
    group: 'shapes',
    view: { cx: 0, cy: 0, scale: 80 },
    expressions: [
      { kind: 'polar', expr: 'cos(5theta)', tMin: '0', tMax: 'pi', color: COLORS[6], part: 'sustain', pitch: -24 },
    ],
  },
  {
    name: 'Boring Stuff',
    hint: 'Desmos A1 pad ticker: stacked voicings, two lone E5s, then a4 detune into a single A3',
    group: 'mixes',
    duration: 68,
    waveform: 'sine',
    bpm: 60,
    view: { cx: 0, cy: 0, scale: 28 },
    expressions: [
      { kind: 'cartesian', expr: 'A1 = -5 5 7 11 14', color: COLORS[7], inSong: false, visible: false },
      { kind: 'cartesian', expr: 'A2 =', color: COLORS[7], inSong: false, visible: false },
      { kind: 'tones', expr: '12, 16', color: COLORS[0], beats: 4 },
      { kind: 'tones', expr: '-3, 12, 16', color: COLORS[1], beats: 4 },
      { kind: 'tones', expr: '-3, 7, 12, 16', color: COLORS[2], beats: 4 },
      { kind: 'tones', expr: '-3, 5, 7, 12, 16', color: COLORS[3], beats: 4 },
      { kind: 'tones', expr: '-5, 5, 7, 12, 16', color: COLORS[4], beats: 4 },
      { kind: 'tones', expr: '-5, 5, 7, 11, 14', color: COLORS[5], beats: 4 },
      { kind: 'tones', expr: '-8, 4, 11, 12, 19', color: COLORS[6], beats: 4 },
      { kind: 'tones', expr: '12', color: COLORS[0], beats: 2 },
      { kind: 'tones', expr: '-20, -8, -1, 11, 14, 16, 26', color: COLORS[1], beats: 4 },
      { kind: 'tones', expr: '-20, -8, -1, 8, 11, 14, 16, 24', color: COLORS[2], beats: 4 },
      { kind: 'tones', expr: '12', color: COLORS[0], beats: 2 },
      { kind: 'tones', expr: '-19, -7, 5, 7, 12, 16, 23, 24, 28 | 1.004', color: COLORS[3], beats: 4 },
      { kind: 'tones', expr: '-17, -5, 5, 11, 16, 28 | 1.007', color: COLORS[4], beats: 4 },
      { kind: 'tones', expr: '-17, -5, 5, 11, 16, 28, 31 | 1.014', color: COLORS[5], beats: 4 },
      { kind: 'tones', expr: '-12, 3.9, 7, 12, 24 | 1.003', color: COLORS[6], beats: 4 },
      { kind: 'tones', expr: '-12, 3.9, 7, 12 | 1.003', color: COLORS[0], beats: 4 },
      { kind: 'tones', expr: '-12, 3.9 | 1.00', color: COLORS[1], beats: 4 },
      { kind: 'tones', expr: '-12 | 1.00', color: COLORS[2], beats: 4 },
    ],
  },
  {
    name: 'Small hours',
    hint: 'Am–F–C–G twice over a held A bass. Eight chord rows, one bass row',
    group: 'mixes',
    duration: 24,
    waveform: 'sine',
    bpm: 78,
    view: { cx: 0, cy: 0, scale: 34 },
    expressions: [
      { kind: 'cartesian', expr: 'tone(A2, 0.5)', part: 'sustain', color: COLORS[5], speed: 0.5 },
      chordRow('A3 C4 E4', 4, 0),
      chordRow('F3 A3 C4', 4, 1),
      chordRow('C4 E4 G4', 4, 2),
      chordRow('G3 B3 D4', 4, 3),
      chordRow('A3 D4 F4', 4, 4, false),
      chordRow('F3 A3 C4', 2, 1, false),
      chordRow('C4 E4 G4', 2, 2, false),
      chordRow('G3 B3 D4', 4, 3, false),
    ],
  },
  {
    name: 'Easy chords',
    hint: 'C, Am, F, G written out as sine sums — the long way round',
    group: 'mixes',
    duration: 32,
    waveform: 'sine',
    bpm: 84,
    view: { cx: 0, cy: 0, scale: 36 },
    expressions: [
      { kind: 'cartesian', expr: namedChord('C3', 'G3', 'C4', 'E4'), color: COLORS[0], beats: 4 },
      { kind: 'cartesian', expr: namedChord('A2', 'E3', 'A3', 'C4'), color: COLORS[1], beats: 4 },
      { kind: 'cartesian', expr: namedChord('F2', 'C3', 'F3', 'A3'), color: COLORS[2], beats: 4 },
      { kind: 'cartesian', expr: namedChord('G2', 'D3', 'G3', 'B3'), color: COLORS[4], beats: 4 },
    ],
  },
  {
    name: 'Major triad',
    hint: 'C major as a sine sum',
    group: 'mixes',
    duration: 24,
    view: { cx: 0, cy: 0, scale: 36 },
    expressions: [{ kind: 'cartesian', expr: namedChord('C4', 'E4', 'G4'), color: COLORS[0] }],
  },
  {
    name: 'Minor triad',
    hint: 'A minor as a sine sum',
    group: 'mixes',
    duration: 24,
    view: { cx: 0, cy: 0, scale: 36 },
    expressions: [{ kind: 'cartesian', expr: namedChord('A3', 'C4', 'E4'), color: COLORS[3] }],
  },
  {
    name: 'Power chord',
    hint: 'Root, fifth, octave',
    group: 'mixes',
    duration: 24,
    waveform: 'sine',
    view: { cx: 0, cy: 0, scale: 36 },
    expressions: [{ kind: 'cartesian', expr: namedChord('C3', 'G3', 'C4'), color: COLORS[0] }],
  },
]

export const PRESETS: Preset[] = SEEDS.map((seed) => ({
  name: seed.name,
  hint: seed.hint,
  group: seed.group,
  view: seed.view,
  duration: seed.duration ?? 24,
  waveform: seed.waveform ?? 'sine',
  bpm: seed.bpm ?? 96,
  expressions: finalizeExpressions(seed.expressions.map((item, i) => fill(item, i))),
}))

function stripRuntime(expr: Expression) {
  return {
    kind: expr.kind,
    expr: expr.expr,
    exprX: expr.exprX,
    exprY: expr.exprY,
    tMin: expr.tMin,
    tMax: expr.tMax,
    color: expr.color,
    visible: expr.visible,
    inSong: expr.inSong,
    part: expr.part,
    pitch: expr.pitch,
    speed: expr.speed,
    beats: expr.beats,
  }
}

export function serializeCurrentMix(opts: {
  name: string
  view: View
  duration: number
  waveform: Waveform
  bpm: number
  volume: number
  expressions: Expression[]
}): MixFile {
  return {
    name: opts.name,
    hint: 'Exported from dmos',
    group: 'mixes',
    view: opts.view,
    duration: opts.duration,
    waveform: opts.waveform,
    bpm: opts.bpm,
    volume: opts.volume,
    expressions: opts.expressions.map(stripRuntime),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asKind(value: unknown): Expression['kind'] {
  return value === 'polar' || value === 'parametric' || value === 'tones' ? value : 'cartesian'
}

function asWave(value: unknown): Waveform {
  return value === 'triangle' || value === 'square' || value === 'sawtooth' ? value : 'sine'
}

function asPart(value: unknown): Part {
  return value === 'sustain' ? 'sustain' : 'sequence'
}

function fromLatex(source: string): string {
  return source
    .replace(/\\left|\\right/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\theta/gi, 'theta')
    .replace(/\\pi/gi, 'pi')
    .replace(/\\sin/gi, 'sin')
    .replace(/\\cos/gi, 'cos')
    .replace(/\\tan/gi, 'tan')
    .replace(/\\abs/gi, 'abs')
    .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\\\/g, '')
    .replace(/\\/g, '')
}

function expressionList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!isRecord(raw)) return []
  if (Array.isArray(raw.expressions)) return raw.expressions
  if (isRecord(raw.expressions) && Array.isArray(raw.expressions.list)) return raw.expressions.list
  if (Array.isArray(raw.equations)) return raw.equations
  if (isRecord(raw.graph) && isRecord(raw.graph.expressions) && Array.isArray(raw.graph.expressions.list)) {
    return raw.graph.expressions.list
  }
  return []
}

function skipDesmosItem(item: Record<string, unknown>): boolean {
  const type = item.type
  return type === 'folder' || type === 'text' || type === 'image' || type === 'table'
}

export function parseMixFile(raw: unknown): Preset {
  const list = expressionList(raw)
  if (list.length === 0) {
    throw new Error('This file has no equations. Save a mix from dmos, or export a Desmos graph JSON.')
  }

  const expressions = finalizeExpressions(
    list.flatMap((item, i) => {
      if (!isRecord(item)) throw new Error(`Equation ${i + 1} is invalid`)
      if (skipDesmosItem(item)) return []
      const latex = typeof item.latex === 'string' ? fromLatex(item.latex) : ''
      const expr = typeof item.expr === 'string' && item.expr.trim() ? item.expr : latex
      const exprX = typeof item.exprX === 'string' ? item.exprX : typeof item.parametricX === 'string' ? item.parametricX : 'cos(t)'
      const exprY = typeof item.exprY === 'string' ? item.exprY : typeof item.parametricY === 'string' ? item.parametricY : 'sin(t)'
      if (!expr.trim() && exprX === 'cos(t)' && exprY === 'sin(t)' && item.kind !== 'parametric') return []
      let kind = asKind(item.kind)
      if (!item.kind && /^\s*r\s*=/i.test(expr)) kind = 'polar'
      if (!item.kind && (item.type === 'expression' || latex)) kind = 'cartesian'
      return [
        fill(
          {
            kind,
            expr,
            exprX,
            exprY,
            tMin: typeof item.tMin === 'string' ? item.tMin : '0',
            tMax: typeof item.tMax === 'string' ? item.tMax : '2pi',
            color: typeof item.color === 'string' ? item.color : undefined,
            visible: item.visible !== false && item.hidden !== true,
            inSong: item.inSong !== false,
            part: asPart(item.part),
            pitch: typeof item.pitch === 'number' ? item.pitch : typeof item.pitch === 'string' ? (parseTokenNote(item.pitch) ?? 0) : 0,
            speed: typeof item.speed === 'number' ? item.speed : 1,
            beats: typeof item.beats === 'number' ? item.beats : 2,
          },
          i,
        ),
      ]
    }),
  )

  if (expressions.length === 0) {
    throw new Error('This file has no playable equations.')
  }

  const root = isRecord(raw) ? raw : {}
  const viewRaw = isRecord(root.view) ? root.view : isRecord(root.graph) && isRecord(root.graph.viewport) ? root.graph.viewport : {}
  const view: View = {
    cx: typeof viewRaw.cx === 'number' ? viewRaw.cx : typeof viewRaw.x === 'number' ? viewRaw.x : 0,
    cy: typeof viewRaw.cy === 'number' ? viewRaw.cy : typeof viewRaw.y === 'number' ? viewRaw.y : 0,
    scale: typeof viewRaw.scale === 'number' ? viewRaw.scale : 44,
  }

  const bpm = typeof root.bpm === 'number' && Number.isFinite(root.bpm) ? root.bpm : 96
  return {
    name: typeof root.name === 'string' ? root.name : 'Imported mix',
    hint: typeof root.hint === 'string' ? root.hint : 'Loaded from a JSON file',
    group: root.group === 'sounds' || root.group === 'shapes' ? root.group : 'mixes',
    view,
    duration: typeof root.duration === 'number' ? root.duration : 24,
    waveform: asWave(root.waveform),
    bpm: Math.min(240, Math.max(40, Math.round(bpm))),
    expressions,
  }
}
