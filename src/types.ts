export type ExprKind = 'cartesian' | 'polar' | 'parametric' | 'tones'
export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth'

/** How an armed row joins Play: one chord at a time, or held under everything. */
export type Part = 'sequence' | 'sustain'

export type View = {
  cx: number
  cy: number
  scale: number
}

export type Expression = {
  id: string
  kind: ExprKind
  expr: string
  exprX: string
  exprY: string
  tMin: string
  tMax: string
  color: string
  visible: boolean
  inSong: boolean
  part: Part
  /** Pitch of this row's voice, in semitones from A4. Set it from the piano. */
  pitch: number
  /**
   * How fast this row runs. It scrolls the graph and multiplies the pitch by
   * the same number, so 2x is one octave up and the picture keeps up with it.
   */
  speed: number
  /** Beats this row holds when it plays in sequence. */
  beats: number
  error: string | null
}

export type CompiledExpr = {
  id: string
  color: string
  kind: ExprKind
  f: ((x: number, t: number) => number) | null
  r: ((theta: number, t: number) => number) | null
  fx: ((t: number) => number) | null
  fy: ((t: number) => number) | null
  t0: number
  t1: number
  notes: number[] | null
  detune: number
  speed: number
}