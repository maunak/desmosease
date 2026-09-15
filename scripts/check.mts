/**
 * Invariant checks for the sound/graph model. Run: node --experimental-strip-types scripts/check.mts
 */
import { readdirSync, readFileSync } from 'node:fs'
import {
  blankExpression,
  collectLists,
  collectNumbers,
  compileExpression,
  formatChordEquation,
  movesWithTime,
  parseTokenNote,
  pitchToFreq,
  rowPlayback,
  rowWaveTable,
  sequenceHits,
  toneFreq,
  validateExpression,
} from '../src/lib/math.ts'
import { parseMixFile, PRESETS } from '../src/lib/presets.ts'
import type { Expression } from '../src/types.ts'

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) return
  failures += 1
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

function row(expr: string, patch: Partial<Expression> = {}): Expression {
  return { ...blankExpression(0), expr, ...patch, error: null }
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps
}

// 1. A row with no t is frozen: f(x, t) must not depend on t.
{
  const still = compileExpression(row('sin(x)'))
  check('sin(x) ignores t', still.f != null && near(still.f(1.3, 0), still.f(1.3, 7.5)))
  const moving = compileExpression(row('sin(x - t)'))
  check('sin(x - t) follows t', moving.f != null && !near(moving.f(1.3, 0), moving.f(1.3, 0.7)))
  check('movesWithTime(sin(x)) is false', !movesWithTime(row('sin(x)')))
  check('movesWithTime(sin(x - t)) is true', movesWithTime(row('sin(x - t)')))
  check('movesWithTime(tone(A4)) is true', movesWithTime(row('tone(A4)')))
}

// 2. tone(list) and the written-out chord draw the same curve.
{
  const notes = ['C4', 'E4', 'G4'].map((n) => parseTokenNote(n)!)
  const written = compileExpression(row(formatChordEquation(notes)))
  const called = compileExpression(row('tone(C4 E4 G4)'))
  let worst = 0
  for (let i = 0; i <= 40; i++) {
    const x = -4 + i * 0.2
    const t = i * 0.03
    worst = Math.max(worst, Math.abs((written.f?.(x, t) ?? NaN) - (called.f?.(x, t) ?? NaN)))
  }
  check('chord equation matches tone(list)', worst < 1e-9, `worst diff ${worst}`)
}

// 3. A chord keeps its shape: every note travels at the same speed.
{
  const chord = compileExpression(row('tone(C4 E4 G4)'))
  let worst = 0
  for (let i = 0; i <= 60; i++) {
    const x = -3 + i * 0.1
    worst = Math.max(worst, Math.abs((chord.f?.(x + 0.37, 0.37) ?? NaN) - (chord.f?.(x, 0) ?? NaN)))
  }
  check('chord translates rigidly', worst < 1e-9, `worst diff ${worst}`)
}

// 4. Every curve is a voice; only definitions and flat lines are silent.
{
  check('sin(x - t) is an exact chord', rowPlayback(row('sin(x - t)')).kind === 'notes')
  check('sin(x - t) sounds A440', rowPlayback(row('sin(x - t)')).notes.length === 1)
  check('x^2 is a curve voice', rowPlayback(row('x^2')).kind === 'curve')
  check('cos(2x - 3t) is a curve voice', rowPlayback(row('cos(2x - 3t)')).kind === 'curve')
  check('a spiral is a curve voice', rowPlayback(row('theta / 6', { kind: 'polar' })).kind === 'curve')
  check('a circle of constant r is silent', rowPlayback(row('5', { kind: 'polar' })).kind === 'silent')
  check('a flat cartesian line is silent', rowPlayback(row('3')).kind === 'silent')
  check('an empty row is silent', rowPlayback(row('')).kind === 'silent')
  check(
    'a parametric heart is a curve voice',
    rowPlayback(row('', { kind: 'parametric', exprX: '16sin(t)^3', exprY: '13cos(t) - 5cos(2t)' })).kind === 'curve',
  )
  check('tone(440) is 440 Hz', near(rowPlayback(row('tone(440)')).freq ?? 0, 440))
  check('tone(440) is a hertz voice', rowPlayback(row('tone(440)')).kind === 'hertz')
  check('tone(60) is 60 Hz, not a note', near(rowPlayback(row('tone(60)')).freq ?? 0, 60))
  check('tone(A2, 0.5) keeps its gain', rowPlayback(row('tone(A2, 0.5)')).gain === 0.5)
  check('tone(A4) is one note', rowPlayback(row('tone(A4)')).notes.length === 1)
  check('tone(A4) is 440 Hz', near(toneFreq(rowPlayback(row('tone(A4)')).notes[0] ?? NaN), 440))
  check('tone(C#5) parses the sharp', rowPlayback(row('tone(C#5)')).notes.length === 1)
  check('tone(A2, 0.5) still names a note', rowPlayback(row('tone(A2, 0.5)')).notes.length === 1)
  check('tone(Now) with no list stays silent', rowPlayback(row('tone(Now)')).notes.length === 0)
  check('A = C4 E4 G4 is a silent definition', rowPlayback(row('A = C4 E4 G4')).notes.length === 0)
  check('f = 440 is a silent definition', rowPlayback(row('f = 440')).freq == null)
}

// 4b. Desmos numeric lists and a₄ detune stay exact — 3.9 is not rounded to 4.
{
  const pad = row('-12, 3.9, 7, 12 | 1.003', { kind: 'tones' })
  const sound = rowPlayback(pad)
  check('numeric pad is notes', sound.kind === 'notes')
  check('3.9 stays fractional', sound.notes.some((n) => near(n, 3.9)))
  check('a4 detune is 1.003', near(sound.detune, 1.003))
  const hz = toneFreq(3.9, 1.003)
  const rounded = toneFreq(4, 1)
  check('3.9 with a4 is not C#5', Math.abs(hz - rounded) > 0.5)
}

// 5. tone(hz, gain) scales the drawing by the same gain it scales the sound by.
{
  const full = compileExpression(row('tone(A2)'))
  const half = compileExpression(row('tone(A2, 0.5)'))
  let worst = 0
  for (let i = 0; i <= 30; i++) {
    const x = i * 0.21
    worst = Math.max(worst, Math.abs((half.f?.(x, 0.4) ?? NaN) - 0.5 * (full.f?.(x, 0.4) ?? NaN)))
  }
  check('gain scales the curve too', worst < 1e-9, `worst diff ${worst}`)
}

// 6. Named lists resolve, and tone(list) sounds those notes.
{
  const rows = [row('A = C4 E4 G4'), row('tone(A)'), row('f = 220'), row('tone(f)')]
  const lists = collectLists(rows)
  const numbers = collectNumbers(rows)
  check('list A collected', (lists.A ?? []).length === 3)
  check('number f collected', numbers.f === 220)
  check('tone(A) plays the list', rowPlayback(rows[1], lists, numbers).notes.length === 3)
  check('tone(f) plays 220 Hz', near(rowPlayback(rows[3], lists, numbers).freq ?? 0, 220))
  check('no row errors', rows.every((r) => validateExpression(r, lists, numbers) == null))
}

// 7. Sequence timing comes from beats and tempo only.
{
  const rows = [
    row('tone(C4 E4 G4)', { beats: 4 }),
    row('tone(A3 C4 E4)', { beats: 2, speed: 4 }),
    row('3', { beats: 4 }),
    row('A = C4 E4', { beats: 4 }),
    row('tone(F3 A3 C4)', { beats: 4, part: 'sustain' }),
  ]
  const hits = sequenceHits(rows, collectLists(rows), collectNumbers(rows), 120)
  check('only sounding sequence rows get a turn', hits.length === 2, `got ${hits.length}`)
  check('4 beats at 120bpm is 2s', near(hits[0]?.dur ?? 0, 2))
  check('row speed does not change timing', near(hits[1]?.dur ?? 0, 1))
  check('hits are back to back', near(hits[1]?.time ?? -1, 2))
}

// 7b. Rate raises pitch by exactly the factor it scrolls the graph by.
{
  check('rate 1 leaves A4 alone', near(pitchToFreq(0, 1), 440))
  check('rate 2 is an octave up', near(pitchToFreq(0, 2), 880))
  check('rate ½ is an octave down', near(pitchToFreq(0, 0.5), 220))
  check('a lower pitch cancels a higher rate', near(pitchToFreq(-12, 2), 440))
  check('rate reaches the row sound', rowPlayback(row('sin(x)', { speed: 2 })).rate === 2)
}

// 7c. A drawn curve becomes its own waveform, and the count of cycles is the pitch.
{
  const dominant = (table: { real: Float32Array; imag: Float32Array }): number => {
    let best = 0
    let bestMag = -1
    for (let k = 1; k < table.real.length; k++) {
      const mag = Math.hypot(table.real[k], table.imag[k])
      if (mag > bestMag) {
        bestMag = mag
        best = k
      }
    }
    return best
  }
  const one = rowWaveTable(row('sin(x)'))
  const three = rowWaveTable(row('sin(3x)'))
  const spiral = rowWaveTable(row('theta / 6', { kind: 'polar', tMax: '12pi' }))
  const flat = rowWaveTable(row('3'))
  const quiet = rowWaveTable(row('0.5*sin(x)'))
  check('sin(x) is one cycle', one != null && dominant(one) === 1, one ? `got ${dominant(one)}` : 'null')
  check('sin(3x) is three cycles', three != null && dominant(three) === 3, three ? `got ${dominant(three)}` : 'null')
  check('a spiral has a table', spiral != null)
  check('a spiral is saw-like', spiral != null && dominant(spiral) === 1)
  check('a flat line has no table', flat === null)
  check('half amplitude plays half as loud', quiet != null && Math.abs(quiet.gain - 0.5) < 0.01)
  // The curve path and the note path must agree on pitch for the same picture.
  const curveHz = pitchToFreq(rowPlayback(row('sin(x)')).pitch, 1)
  const noteHz = toneFreq(rowPlayback(row('sin(x - t)')).notes[0] ?? NaN)
  check('a drawn sine and a note sine agree', near(curveHz, noteHz), `${curveHz} vs ${noteHz}`)
}

// 8. Pitch table sanity.
{
  check('A4 is 440 Hz', near(toneFreq(parseTokenNote('A4')!), 440))
  check('A3 is 220 Hz', near(toneFreq(parseTokenNote('A3')!), 220, 1e-9))
  check('C4 is about 261.6 Hz', Math.abs(toneFreq(parseTokenNote('C4')!) - 261.6256) < 0.001)
}

// 9. Every shipped JSON preset loads and actually makes sound.
const presetDir = 'public/presets'
for (const entry of readdirSync(presetDir).sort()) {
  if (!entry.endsWith('.json') || entry === 'index.json') continue
  const file = entry.replace(/\.json$/, '')
  const raw: unknown = JSON.parse(readFileSync(`${presetDir}/${entry}`, 'utf8'))
  const preset = parseMixFile(raw)
  const lists = collectLists(preset.expressions)
  const numbers = collectNumbers(preset.expressions)
  const bad = preset.expressions.filter((expr) => expr.error)
  check(`${file}: no broken rows`, bad.length === 0, bad.map((b) => `${b.expr} → ${b.error}`).join('; '))
  const audible = preset.expressions.filter((expr) => rowPlayback(expr, lists, numbers).kind !== 'silent')
  check(`${file}: makes sound`, audible.length > 0)
  const hits = sequenceHits(preset.expressions, lists, numbers, preset.bpm)
  const seconds = hits.reduce((sum, hit) => sum + hit.dur, 0)
  const sustained = preset.expressions.filter((expr) => expr.part === 'sustain').length
  console.log(
    `${file.padEnd(18)} rows ${String(preset.expressions.length).padStart(2)}  sounding ${String(audible.length).padStart(2)}  held ${sustained}  sequence ${String(hits.length).padStart(2)} hits / ${seconds.toFixed(1)}s at ${preset.bpm} bpm`,
  )
}

// 10. Every built-in preset in the app loads clean too.
for (const preset of PRESETS) {
  const broken = preset.expressions.filter((expr) => expr.error)
  check(`preset "${preset.name}": no broken rows`, broken.length === 0, broken.map((b) => `${b.expr} → ${b.error}`).join('; '))
}

console.log(failures === 0 ? '\nall invariants hold' : `\n${failures} failing check(s)`)
process.exit(failures === 0 ? 0 : 1)
