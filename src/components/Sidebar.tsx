import { useRef } from 'react'
import type { ExprKind, Expression, Waveform } from '../types'
import type { Preset, PresetGroup } from '../lib/presets'
import {
  clampBeats,
  clampSpeed,
  expressionNotes,
  formatChordEquation,
  formatToneChord,
  freqToNote,
  movesWithTime,
  parseListDef,
  parseNumberDef,
  parseTonePatch,
  pitchToFreq,
  rowPlayback,
} from '../lib/math'
import { Piano } from './Piano'

type Props = {
  expressions: Expression[]
  selectedId: string
  playing: boolean
  liveIds: string[]
  lists: Record<string, number[]>
  numbers: Record<string, number>
  waveform: Waveform
  volume: number
  bpm: number
  noteLabel: string | null
  importError: string | null
  message: string | null
  midiName: string | null
  presets: Preset[]
  onSelect: (id: string) => void
  onChange: (id: string, patch: Partial<Expression>) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onPlay: () => void
  onPlayRow: (id: string) => void
  onToggleNote: (note: number) => void
  onWaveform: (wave: Waveform) => void
  onVolume: (value: number) => void
  onBpm: (value: number) => void
  onPresetPlay: (preset: Preset) => void
  onPresetAdd: (preset: Preset) => void
  onImport: (file: File) => void
  onExport: () => void
}

const GROUPS: { id: PresetGroup; label: string }[] = [
  { id: 'mixes', label: 'Songs' },
  { id: 'sounds', label: 'Sounds' },
  { id: 'shapes', label: 'Shapes' },
]

const SPEEDS = [0.5, 1, 2, 4]
const HOLDS = [1, 2, 4]

const KINDS: { id: ExprKind; label: string }[] = [
  { id: 'cartesian', label: 'y =' },
  { id: 'polar', label: 'r =' },
  { id: 'parametric', label: 'x,y' },
  { id: 'tones', label: 'notes' },
]

function PresetRow({
  preset,
  onPlay,
  onAdd,
}: {
  preset: Preset
  onPlay: (preset: Preset) => void
  onAdd: (preset: Preset) => void
}) {
  return (
    <div className="preset-chip">
      <button type="button" className="preset-play" title={preset.hint} onClick={() => onPlay(preset)}>
        ▶ {preset.name}
      </button>
      <button type="button" className="preset-add" title="Add to what you have" onClick={() => onAdd(preset)}>
        +
      </button>
    </div>
  )
}

export function Sidebar({
  expressions,
  selectedId,
  playing,
  liveIds,
  lists,
  numbers,
  waveform,
  volume,
  bpm,
  noteLabel,
  importError,
  message,
  midiName,
  presets,
  onSelect,
  onChange,
  onAdd,
  onRemove,
  onPlay,
  onPlayRow,
  onToggleNote,
  onWaveform,
  onVolume,
  onBpm,
  onPresetPlay,
  onPresetAdd,
  onImport,
  onExport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const selected = expressions.find((expr) => expr.id === selectedId)
  const selectedIsTone = selected?.kind === 'tones'
  const selectedSound = selected ? rowPlayback(selected, lists, numbers) : null
  const selectedIsCurve = selectedSound?.kind === 'curve'
  const selectedNotes = selected ? expressionNotes(selected, lists) : []
  const audibleCount = expressions.filter(
    (expr) => expr.inSong && rowPlayback(expr, lists, numbers).kind !== 'silent',
  ).length

  return (
    <aside
      className="sidebar"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const file = e.dataTransfer.files[0]
        if (file) onImport(file)
      }}
    >
      <ol className="howto">
        <li>
          Tap the piano — it writes the math, like <strong>sin(2^(-9/12)*(x - t)) + sin(x - t)</strong>.
        </li>
        <li>
          Or type Desmos music: <strong>tone(440)</strong>, <strong>A = C4 E4 G4</strong> then <strong>tone(A)</strong>,{' '}
          <strong>sin(x){'{0<=x<=2}'}</strong>, <strong>f = 440</strong>.
        </li>
        <li>
          Any curve is a voice: its shape is the waveform, its pitch is the piano note on the row. A spiral buzzes, a
          cardioid is smooth.
        </li>
        <li>
          <strong>Rate</strong> runs a row faster — the graph scrolls and the pitch rises by the same factor, so 2× is
          one octave up. Nothing moves unless <strong>t</strong> is in the equation, and t only runs while sound is on.
        </li>
      </ol>

      <div className="expr-list">
        {expressions.map((expr, index) => {
          const patch = expr.kind === 'tones' ? parseTonePatch(expr.expr) : null
          const eqNotes = expr.kind === 'cartesian' ? expressionNotes(expr, lists) : []
          const listDef = expr.kind === 'cartesian' ? parseListDef(expr.expr) : null
          const numberDef = expr.kind === 'cartesian' ? parseNumberDef(expr.expr) : null
          const sound = rowPlayback(expr, lists, numbers)
          const audible = sound.kind !== 'silent'
          const moves = movesWithTime(expr)
          return (
            <article
              key={expr.id}
              className={`expr ${expr.id === selectedId ? 'selected' : ''} ${expr.error ? 'invalid' : ''} ${expr.visible ? '' : 'muted'} ${expr.inSong ? 'armed' : 'unarmed'} ${liveIds.includes(expr.id) ? 'live' : ''}`}
              onClick={() => onSelect(expr.id)}
            >
              <div className="expr-rail">
                {audible ? (
                  <button
                    type="button"
                    className={`track-play ${playing && liveIds.includes(expr.id) ? 'stop' : ''}`}
                    aria-label={playing && liveIds.includes(expr.id) ? 'Drop this row' : 'Sound this row'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPlayRow(expr.id)
                    }}
                  >
                    {playing && liveIds.includes(expr.id) ? '■' : '▶'}
                  </button>
                ) : (
                  <span className="track-play silent" title="A definition or a flat line: nothing to hear">
                    ∅
                  </span>
                )}
                {audible && (
                  <label className="track-arm" title="Include when playing everything" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={expr.inSong}
                      onChange={() => onChange(expr.id, { inSong: !expr.inSong })}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="swatch"
                  style={{ background: expr.visible ? expr.color : '#c5bdb0' }}
                  aria-label={expr.visible ? 'Hide on graph' : 'Show on graph'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(expr.id, { visible: !expr.visible })
                  }}
                />
              </div>
              <div className="expr-body">
                <div className="expr-top">
                  <span className="expr-index">{index + 1}</span>
                  <div className="kind-toggle">
                    {KINDS.map((kind) => (
                      <button
                        key={kind.id}
                        type="button"
                        className={expr.kind === kind.id ? 'on' : ''}
                        onClick={(e) => {
                          e.stopPropagation()
                          onChange(expr.id, { kind: kind.id, error: null })
                        }}
                      >
                        {kind.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(expr.id)
                    }}
                  >
                    ×
                  </button>
                </div>
                {expr.kind === 'tones' ? (
                  <>
                    <label className="field">
                      <span>{patch && patch.notes.length ? formatToneChord(patch.notes, patch.detune) : 'Notes'}</span>
                      <input
                        value={expr.expr}
                        spellCheck={false}
                        placeholder="C4 E4 G4"
                        onChange={(e) => onChange(expr.id, { expr: e.target.value })}
                      />
                    </label>
                    {patch && patch.notes.length > 0 && (
                      <>
                        <label className="field">
                          <span>equation</span>
                          <p className="chord-eq">{formatChordEquation(patch.notes, patch.detune)}</p>
                        </label>
                        <button
                          type="button"
                          className="linkish"
                          onClick={(e) => {
                            e.stopPropagation()
                            onChange(expr.id, {
                              kind: 'cartesian',
                              expr: formatChordEquation(patch.notes, patch.detune),
                              error: null,
                            })
                          }}
                        >
                          Use as equation
                        </button>
                      </>
                    )}
                  </>
                ) : expr.kind === 'parametric' ? (
                  <>
                    <label className="field">
                      <span>x(t)</span>
                      <input value={expr.exprX} spellCheck={false} onChange={(e) => onChange(expr.id, { exprX: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>y(t)</span>
                      <input value={expr.exprY} spellCheck={false} onChange={(e) => onChange(expr.id, { exprY: e.target.value })} />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span>{expr.kind === 'polar' ? 'r' : 'f(x)'}</span>
                      <input
                        value={expr.expr}
                        spellCheck={false}
                        placeholder={expr.kind === 'polar' ? '1 + cos(theta)' : 'tap piano, or sin(x), tone(440), A = C4 E4 G4'}
                        onChange={(e) => onChange(expr.id, { expr: e.target.value })}
                      />
                    </label>
                    {expr.kind === 'cartesian' && eqNotes.length > 0 && (
                      <p className="mix-lead">
                        {listDef ? `List ${listDef.name}` : 'Chord'}: {formatToneChord(eqNotes)}
                      </p>
                    )}
                    {expr.kind === 'cartesian' && numberDef && (
                      <p className="mix-lead">
                        Number {numberDef.name} = {numberDef.value}
                      </p>
                    )}
                  </>
                )}
                <p className="row-tags">
                  {listDef || numberDef ? (
                    <span className="tag">definition</span>
                  ) : sound.kind === 'notes' ? (
                    <span className="tag tag-sound">
                      {sound.notes.length} note{sound.notes.length > 1 ? 's' : ''}
                    </span>
                  ) : sound.kind === 'hertz' ? (
                    <span className="tag tag-sound">{Math.round(Math.min(8000, (sound.freq ?? 0) * sound.rate))} Hz</span>
                  ) : sound.kind === 'curve' ? (
                    <span className="tag tag-sound" title="This curve is the waveform">
                      wave · {freqToNote(pitchToFreq(sound.pitch, sound.rate))} ·{' '}
                      {Math.round(pitchToFreq(sound.pitch, sound.rate))} Hz
                    </span>
                  ) : (
                    <span className="tag">silent</span>
                  )}
                  {sound.gain !== 1 && <span className="tag">gain {Math.round(sound.gain * 100) / 100}</span>}
                  {moves ? <span className="tag tag-move">moves with t</span> : <span className="tag">still</span>}
                </p>
                {audible && (
                  <div className="row-timing" onClick={(e) => e.stopPropagation()}>
                    <span>Play</span>
                    <button
                      type="button"
                      className={expr.part !== 'sustain' ? 'on' : ''}
                      title="Take a turn in the sequence"
                      onClick={() => onChange(expr.id, { part: 'sequence' })}
                    >
                      in turn
                    </button>
                    <button
                      type="button"
                      className={expr.part === 'sustain' ? 'on' : ''}
                      title="Hold under everything else"
                      onClick={() => onChange(expr.id, { part: 'sustain' })}
                    >
                      hold
                    </button>
                    {expr.part !== 'sustain' && (
                      <>
                        <span>Beats</span>
                        {HOLDS.map((beats) => (
                          <button
                            key={beats}
                            type="button"
                            className={clampBeats(expr.beats) === beats ? 'on' : ''}
                            onClick={() => onChange(expr.id, { beats })}
                          >
                            {beats}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
                {audible && (
                  <div className="row-timing" onClick={(e) => e.stopPropagation()}>
                    <span title="Runs this row faster: the graph scrolls and the pitch rises by the same factor">
                      Rate
                    </span>
                    {SPEEDS.map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        title={speed === 1 ? 'As written' : `${speed}× · ${Math.round(12 * Math.log2(speed))} semitones`}
                        className={clampSpeed(expr.speed) === speed ? 'on' : ''}
                        onClick={() => onChange(expr.id, { speed })}
                      >
                        {speed === 0.5 ? '½×' : `${speed}×`}
                      </button>
                    ))}
                  </div>
                )}
                {expr.kind !== 'cartesian' && expr.kind !== 'tones' && (
                  <div className="range-row">
                    <label className="field compact">
                      <span>{expr.kind === 'polar' ? 'θ₀' : 't₀'}</span>
                      <input value={expr.tMin} spellCheck={false} onChange={(e) => onChange(expr.id, { tMin: e.target.value })} />
                    </label>
                    <label className="field compact">
                      <span>{expr.kind === 'polar' ? 'θ₁' : 't₁'}</span>
                      <input value={expr.tMax} spellCheck={false} onChange={(e) => onChange(expr.id, { tMax: e.target.value })} />
                    </label>
                  </div>
                )}
                {expr.error && <p className="expr-error">{expr.error}</p>}
              </div>
            </article>
          )
        })}
        <button type="button" className="add-expr" onClick={onAdd}>
          + add equation
        </button>
      </div>

      {selected && (
        <div className="piano-wrap">
          <p className="mix-lead">
            {selectedIsCurve && selectedSound
              ? `Tap a key to set this row’s pitch · now ${freqToNote(pitchToFreq(selectedSound.pitch, selectedSound.rate))}`
              : selectedIsTone
                ? `Tap keys to build this chord: ${selectedNotes.length ? formatToneChord(selectedNotes) : 'empty'}`
                : `Tap keys to write this row’s equation${selectedNotes.length ? ` · ${formatToneChord(selectedNotes)}` : ''}`}
          </p>
          <Piano
            selected={selectedIsCurve && selectedSound ? [selectedSound.pitch] : selectedNotes}
            onToggle={onToggleNote}
          />
        </div>
      )}

      <section className="player">
        <button type="button" className={`play-btn ${playing ? 'stop' : ''}`} onClick={onPlay}>
          <span className="play-icon">{playing ? '■' : '▶'}</span>
          {playing
            ? 'Stop'
            : midiName
              ? `Play ${midiName}`
              : audibleCount > 1
                ? `Play ${audibleCount} rows`
                : 'Play'}
        </button>
        {noteLabel && <p className="now-playing">{noteLabel}</p>}
        {message && <p className="expr-error">{message}</p>}
        <label className="slider">
          <span>Tempo {bpm} BPM</span>
          <input type="range" min={50} max={180} step={1} value={bpm} onChange={(e) => onBpm(Number(e.target.value))} />
        </label>
        <label className="slider">
          <span>Volume</span>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => onVolume(Number(e.target.value))} />
        </label>
        <label className="select-row">
          <span>Sound</span>
          <select value={waveform} onChange={(e) => onWaveform(e.target.value as Waveform)}>
            <option value="sine">Pad</option>
            <option value="triangle">Soft</option>
            <option value="square">Reed</option>
            <option value="sawtooth">Bright</option>
          </select>
        </label>
      </section>

      <section className="presets">
        <div className="preset-toolbar">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.mid,.midi,application/json,audio/midi"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onImport(file)
              e.target.value = ''
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import MIDI / JSON
          </button>
          <button type="button" onClick={onExport}>
            Save mix
          </button>
        </div>
        {importError && <p className="expr-error">{importError}</p>}
        <p className="mix-lead">▶ loads and plays · + adds it to your list · drop a .mid or JSON on this app (not a new browser tab)</p>
        {GROUPS.map((group) => (
          <div key={group.id}>
            <h2>{group.label}</h2>
            <div className="preset-grid">
              {presets
                .filter((preset) => preset.group === group.id)
                .map((preset) => (
                  <PresetRow key={preset.name} preset={preset} onPlay={onPresetPlay} onAdd={onPresetAdd} />
                ))}
            </div>
          </div>
        ))}
      </section>
    </aside>
  )
}
