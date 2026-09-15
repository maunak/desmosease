import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Graph } from './components/Graph'
import { Sidebar } from './components/Sidebar'
import { EquationPlayer, type VoiceSpec } from './lib/audio'
import {
  applyListUpdate,
  blankExpression,
  collectLists,
  collectNumbers,
  compileExpression,
  DEFAULT_VIEW,
  expressionNotes,
  formatChordEquation,
  formatToneChord,
  formatToneExpr,
  freqToNote,
  parseListDef,
  parseTonePatch,
  pitchToFreq,
  rowIsSilent,
  rowPlayback,
  rowWaveTable,
  sequenceHits,
  togglePianoOnEquation,
  toneFreq,
  validateExpression,
  type WaveTable,
} from './lib/math'
import { frequentMidiChords, parseMidi, type MidiSong } from './lib/midi'
import { cloneExpressions, parseMixFile, PRESETS, serializeCurrentMix, type Preset } from './lib/presets'
import type { CompiledExpr, Expression, View, Waveform } from './types'

const MUSIC_VIEW: View = { cx: 10, cy: 0, scale: 30 }

function starterWave(): Expression {
  const expr = { ...blankExpression(0), expr: 'sin(x - t)' }
  return { ...expr, error: validateExpression(expr) }
}

const starter = [starterWave()]

function silentCompiled(expr: Expression): CompiledExpr {
  return {
    id: expr.id,
    color: expr.color,
    kind: expr.kind,
    f: null,
    r: null,
    fx: null,
    fy: null,
    t0: 0,
    t1: 0,
    notes: null,
    detune: 1,
    speed: 1,
  }
}

export default function App() {
  const [expressions, setExpressions] = useState<Expression[]>(starter)
  const [selectedId, setSelectedId] = useState(starter[0].id)
  const [view, setView] = useState<View>(DEFAULT_VIEW)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(32)
  const [waveform, setWaveform] = useState<Waveform>('sine')
  const [volume, setVolume] = useState(0.7)
  const [hz, setHz] = useState<number | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [liveIds, setLiveIds] = useState<string[]>([])
  const [bpm, setBpm] = useState(96)
  const [midiSong, setMidiSong] = useState<MidiSong | null>(null)
  const [midiName, setMidiName] = useState<string | null>(null)

  const playerRef = useRef(new EquationPlayer())
  const playingRef = useRef(false)
  const liveIdsRef = useRef<string[]>([])
  const seqTimer = useRef(0)
  const pendingPlayRef = useRef(false)
  const expressionsRef = useRef(expressions)
  const bpmRef = useRef(bpm)
  const midiRef = useRef<MidiSong | null>(null)
  const importFileRef = useRef<(file: File) => Promise<void>>(async () => {})
  const waveCacheRef = useRef(new Map<string, WaveTable | null>())

  useEffect(() => {
    expressionsRef.current = expressions
  }, [expressions])

  useEffect(() => {
    bpmRef.current = bpm
  }, [bpm])

  useEffect(() => {
    midiRef.current = midiSong
  }, [midiSong])

  useEffect(() => {
    liveIdsRef.current = liveIds
  }, [liveIds])

  useEffect(() => {
    playerRef.current.setDuration(duration)
  }, [duration])

  const lists = useMemo(() => collectLists(expressions), [expressions])
  const numbers = useMemo(() => collectNumbers(expressions), [expressions])

  const compiled = useMemo(
    () =>
      expressions
        .filter((expr) => expr.visible && !expr.error)
        .map((item) => {
          try {
            return compileExpression(item, waveform, lists, numbers)
          } catch {
            return silentCompiled(item)
          }
        })
        .filter((item) => item.f || item.r || (item.fx && item.fy)),
    [expressions, lists, numbers, waveform],
  )

  const liveExpr = expressions.find((expr) => liveIds.includes(expr.id))
  const liveNotes = liveExpr ? expressionNotes(liveExpr, lists) : []
  const noteLabel = liveNotes.length
    ? formatToneChord(liveNotes)
    : hz
      ? `${Math.round(hz)} Hz · ${freqToNote(hz)}`
      : null

  const stopSeq = useCallback(() => {
    window.clearTimeout(seqTimer.current)
    seqTimer.current = 0
  }, [])

  /** Sampling a curve into harmonics is not free, so keep the last few. */
  const curveTable = useCallback(
    (expr: Expression, rowLists: Record<string, number[]>, rowNumbers: Record<string, number>): WaveTable | null => {
      const key = [expr.kind, expr.expr, expr.exprX, expr.exprY, expr.tMin, expr.tMax, waveform].join('|')
      const cache = waveCacheRef.current
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      const table = rowWaveTable(expr, waveform, rowLists, rowNumbers)
      if (cache.size > 48) cache.clear()
      cache.set(key, table)
      return table
    },
    [waveform],
  )

  const stop = useCallback(() => {
    playingRef.current = false
    pendingPlayRef.current = false
    liveIdsRef.current = []
    stopSeq()
    playerRef.current.stop()
    setPlaying(false)
    setHz(null)
    setLiveIds([])
  }, [stopSeq])

  /**
   * Turns the chosen rows into oscillators. Notes and tone(f) get exact
   * frequencies; any other curve plays through its own harmonics at the row's
   * pitch. Rate multiplies the pitch by the same number it scrolls the graph.
   */
  const syncLiveMix = useCallback(
    async (ids: string[], restart: boolean, holdTransport = false) => {
      const rows = expressionsRef.current
      const currentLists = collectLists(rows)
      const currentNumbers = collectNumbers(rows)
      const unique = [...new Set(ids.filter(Boolean))]

      const specs: VoiceSpec[] = []
      const sounding: string[] = []
      let droneHz: number | null = null

      for (const id of unique) {
        const expr = rows.find((row) => row.id === id)
        if (!expr || expr.error) continue
        const sound = rowPlayback(expr, currentLists, currentNumbers)

        if (sound.kind === 'notes') {
          sounding.push(expr.id)
          for (const n of sound.notes) {
            // Keep fractional semitones (3.9) and a₄ detune — do not round to piano keys.
            const freq = Math.min(8000, Math.max(20, toneFreq(n, sound.detune) * sound.rate))
            specs.push({ id: `${expr.id}:${n.toFixed(4)}`, frequencyAt: () => freq, gain: sound.gain })
          }
          continue
        }

        if (sound.kind === 'hertz' && sound.freq != null) {
          sounding.push(expr.id)
          const freq = Math.min(8000, Math.max(20, sound.freq * sound.rate))
          droneHz = freq
          specs.push({ id: expr.id, frequencyAt: () => freq, gain: sound.gain })
          continue
        }

        if (sound.kind === 'curve') {
          const table = curveTable(expr, currentLists, currentNumbers)
          if (!table) continue
          sounding.push(expr.id)
          const freq = pitchToFreq(sound.pitch, sound.rate)
          droneHz = freq
          specs.push({
            id: expr.id,
            frequencyAt: () => freq,
            gain: sound.gain * table.gain,
            wave: table,
          })
        }
      }

      liveIdsRef.current = sounding
      setLiveIds(sounding)

      if (specs.length === 0) {
        setHz(null)
        if (!holdTransport) {
          playingRef.current = false
          setPlaying(false)
          playerRef.current.stop()
          return
        }
        // A rest inside a song: let the voices go, keep the transport running.
        await playerRef.current.playMelody({
          duration,
          waveform,
          volume,
          voices: [],
          restart: false,
          onProgress: () => {},
        })
        return
      }

      playingRef.current = true
      setPlaying(true)
      setHz(droneHz)
      await playerRef.current.playMelody({
        duration,
        waveform,
        volume,
        voices: specs,
        restart,
        onProgress: () => {},
      })
    },
    [curveTable, duration, volume, waveform],
  )

  // A row's shape, pitch, rate or the global sound can change while it plays.
  // Re-voice the live rows so the sound always matches what is drawn.
  useEffect(() => {
    if (!playingRef.current || liveIdsRef.current.length === 0) return
    void syncLiveMix(liveIdsRef.current, false, true)
  }, [expressions, syncLiveMix, waveform])

  /** Walks a chord list in time. Sustained rows keep sounding underneath. */
  const playHits = useCallback(
    (hits: Array<{ time: number; notes: number[]; id?: string; dur?: number }>, sourceBpm: number, loop: boolean) => {
      stopSeq()
      if (hits.length === 0) return
      playingRef.current = true
      setPlaying(true)
      const run = (index: number) => {
        if (!playingRef.current) return
        const hit = hits[index]
        let host = hit.id

        if (!host) {
          // MIDI drives the Now list, and whatever plays tone(Now) follows it.
          const nextRows = expressionsRef.current.map((expr) => {
            if (parseListDef(expr.expr)?.name !== 'Now') return expr
            return { ...expr, expr: hit.notes.length ? `Now = ${formatToneExpr(hit.notes)}` : 'Now =', error: null }
          })
          expressionsRef.current = nextRows
          setExpressions(nextRows)
          host = nextRows.find((expr) => /^\s*tone\s*\(\s*Now\s*\)\s*$/i.test(expr.expr))?.id
        }

        const rows = expressionsRef.current
        const rowLists = collectLists(rows)
        const rowNumbers = collectNumbers(rows)
        const sustain = rows
          .filter((expr) => expr.inSong && expr.part === 'sustain' && !rowIsSilent(expr, rowLists, rowNumbers))
          .map((expr) => expr.id)
        void syncLiveMix([...sustain, host].filter((id): id is string => Boolean(id)), false, true)

        const next = index + 1
        const scale = sourceBpm > 0 ? bpmRef.current / sourceBpm : 1
        if (next < hits.length) {
          const wait = Math.max(40, ((hits[next].time - hit.time) * 1000) / scale)
          seqTimer.current = window.setTimeout(() => run(next), wait)
          return
        }
        if (loop) {
          const lastDur = hit.dur ?? 60 / bpmRef.current
          seqTimer.current = window.setTimeout(() => run(0), Math.max(200, (lastDur * 1000) / scale))
        }
      }
      run(0)
    },
    [stopSeq, syncLiveMix],
  )

  const playSong = useCallback(
    async (fromId?: string) => {
      const rows = expressionsRef.current
      const currentLists = collectLists(rows)
      const currentNumbers = collectNumbers(rows)
      const midi = midiRef.current

      if (fromId) {
        setSelectedId(fromId)
        const row = rows.find((expr) => expr.id === fromId)
        if (!row || rowIsSilent(row, currentLists, currentNumbers)) {
          setMessage('That row is a definition or a flat line, so there is nothing to hear.')
          return
        }
        setMessage(null)
        const live = liveIdsRef.current
        const nextIds = live.includes(fromId) ? live.filter((id) => id !== fromId) : [...live, fromId]
        if (nextIds.length === 0) {
          stop()
          return
        }
        stopSeq()
        await syncLiveMix(nextIds, !playingRef.current)
        return
      }

      if (playingRef.current) {
        stop()
        return
      }

      const armed = rows.filter((expr) => !expr.error && expr.inSong)
      const pool = armed.length > 0 ? armed : rows.filter((expr) => !expr.error && expr.visible)
      const audible = pool.filter((expr) => !rowIsSilent(expr, currentLists, currentNumbers))
      if (audible.length === 0) {
        setMessage('Nothing here makes a sound yet. Write a curve like sin(x), or tap the piano.')
        return
      }
      setMessage(null)
      const sustain = audible.filter((expr) => expr.part === 'sustain').map((expr) => expr.id)

      if (midi) {
        const host = rows.find((expr) => /^\s*tone\s*\(\s*Now\s*\)\s*$/i.test(expr.expr))?.id
        await syncLiveMix([...sustain, host].filter((id): id is string => Boolean(id)), true)
        playHits(
          midi.hits.map((hit) => ({ ...hit })),
          midi.bpm,
          true,
        )
        return
      }

      const hits = sequenceHits(pool, currentLists, currentNumbers, bpm)
      if (hits.length > 1) {
        await syncLiveMix([...sustain, hits[0].id], true)
        playHits(hits, bpm, true)
        return
      }
      await syncLiveMix(audible.map((expr) => expr.id), true)
    },
    [bpm, playHits, stop, stopSeq, syncLiveMix],
  )

  useEffect(() => {
    if (!pendingPlayRef.current) return
    pendingPlayRef.current = false
    void playSong()
  }, [expressions, playSong])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      if (e.code === 'Space') {
        e.preventDefault()
        void playSong()
      }
      if (e.code === 'Escape') stop()
      const digit = e.code.match(/^Digit([1-9])$/)
      if (digit) {
        const pad = expressionsRef.current[Number(digit[1]) - 1]
        if (pad) {
          e.preventDefault()
          void playSong(pad.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playSong, stop])

  useEffect(() => () => playerRef.current.stop(), [])

  const applyPreset = (preset: Preset, replace: boolean, autoplay: boolean) => {
    stop()
    setImportError(null)
    setMessage(null)
    setMidiSong(null)
    setMidiName(null)
    const next = cloneExpressions(preset.expressions)
    if (replace) {
      setExpressions(next)
      setSelectedId(next[0].id)
      setView(preset.view)
      setDuration(preset.duration)
      setWaveform(preset.waveform)
      setBpm(preset.bpm)
    } else {
      setExpressions((list) => {
        const kept = list.filter((expr) =>
          expr.kind === 'parametric' ? expr.exprX.trim() || expr.exprY.trim() : expr.expr.trim(),
        )
        return [...kept, ...next]
      })
      setSelectedId(next[0].id)
    }
    pendingPlayRef.current = autoplay
  }

  /** One edit can change what every other row means, so re-check them all. */
  const updateExpr = (id: string, patch: Partial<Expression>) => {
    setMessage(null)
    setExpressions((list) => {
      const mapped = list.map((expr) => {
        if (expr.id !== id) return expr
        const next = { ...expr, ...patch }
        if (patch.kind === 'cartesian' && expr.kind === 'tones') {
          const parsed = parseTonePatch(expr.expr)
          if (parsed.notes.length > 0) next.expr = formatChordEquation(parsed.notes, parsed.detune)
        }
        if (patch.kind === 'tones' && expr.kind !== 'tones' && parseTonePatch(expr.expr).notes.length === 0) {
          const def = parseListDef(expr.expr)
          const notes = def?.notes.length ? def.notes : expressionNotes(expr, collectLists(list))
          next.expr = notes.length ? formatToneExpr(notes) : 'C4 E4 G4'
        }
        return next
      })
      const nextLists = collectLists(mapped)
      const nextNumbers = collectNumbers(mapped)
      const validated = mapped.map((expr) => ({ ...expr, error: validateExpression(expr, nextLists, nextNumbers) }))
      expressionsRef.current = validated
      return validated
    })
  }

  const addExpr = () => {
    const next = blankExpression(expressions.length)
    setExpressions((list) => [...list, next])
    setSelectedId(next.id)
  }

  const removeExpr = (id: string) => {
    const remaining = expressions.filter((expr) => expr.id !== id)
    if (remaining.length === 0) {
      const fresh = starterWave()
      setExpressions([fresh])
      setSelectedId(fresh.id)
      return
    }
    setExpressions(remaining)
    if (id === selectedId) setSelectedId(remaining[0].id)
    if (liveIdsRef.current.includes(id)) {
      const nextLive = liveIdsRef.current.filter((live) => live !== id)
      if (nextLive.length === 0) stop()
      else void syncLiveMix(nextLive, false)
    }
  }

  const togglePianoNote = (note: number) => {
    const expr = expressions.find((row) => row.id === selectedId) ?? expressions[0]
    if (!expr) return
    const keepPlaying = (id: string) => {
      if (!playingRef.current) return
      const ids = liveIdsRef.current.includes(id) ? liveIdsRef.current : [...liveIdsRef.current, id]
      void syncLiveMix(ids, false)
    }
    // On a drawn curve the piano moves the row's pitch instead of rewriting it.
    if (rowPlayback(expr, lists, numbers).kind === 'curve') {
      updateExpr(expr.id, { pitch: note })
      keepPlaying(expr.id)
      return
    }
    if (expr.kind === 'cartesian') {
      const edit = togglePianoOnEquation(expr.expr, note, lists)
      if (edit.listUpdate) {
        setExpressions((rows) => {
          const next = applyListUpdate(rows, edit.listUpdate!.name, edit.listUpdate!.notes)
          expressionsRef.current = next
          return next
        })
        keepPlaying(expr.id)
        return
      }
      updateExpr(expr.id, { expr: edit.expr })
      keepPlaying(expr.id)
      return
    }
    if (expr.kind !== 'tones') return
    const patch = parseTonePatch(expr.expr)
    const notes = patch.notes.includes(note)
      ? patch.notes.filter((n) => n !== note)
      : [...patch.notes, note].sort((a, b) => a - b)
    updateExpr(expr.id, { expr: formatToneExpr(notes, patch.detune) })
    if (notes.length === 0 && liveIdsRef.current.length <= 1 && liveIdsRef.current[0] === expr.id) {
      stop()
      return
    }
    keepPlaying(expr.id)
  }

  const importFile = async (file: File) => {
    try {
      if (file.size > 8_000_000) throw new Error('That file is too large to import')
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      const midiMagic =
        bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64
      const looksMidi = /\.(mid|midi)$/i.test(file.name) || file.type === 'audio/midi' || file.type === 'audio/x-midi'

      if (midiMagic || looksMidi) {
        try {
          const song = parseMidi(buffer, file.name.replace(/\.(mid|midi)$/i, '') || 'MIDI')
          const first = song.hits.find((hit) => hit.notes.length > 0)?.notes ?? []
          const saved = frequentMidiChords(song, 8).filter((chord) => chord.join(',') !== first.join(','))
          const names = ['Ch1', 'Ch2', 'Ch3', 'Ch4', 'Ch5', 'Ch6', 'Ch7', 'Ch8']
          const next = [
            { ...blankExpression(0), expr: `Now = ${formatToneExpr(first)}`, inSong: false, visible: false },
            { ...blankExpression(1), expr: 'tone(Now)', inSong: true },
            ...saved.map((chord, index) => ({
              ...blankExpression(index + 2),
              expr: `${names[index]} = ${formatToneExpr(chord)}`,
              inSong: false,
              visible: false,
            })),
          ].map((row) => ({ ...row, error: null }))
          stop()
          setImportError(null)
          setMessage(null)
          setMidiSong(song)
          setMidiName(song.name)
          setBpm(Math.round(song.bpm))
          setExpressions(next)
          setSelectedId(next[1]?.id ?? next[0].id)
          setView(MUSIC_VIEW)
          return
        } catch (midiErr) {
          if (midiMagic) throw midiErr
        }
      }

      const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trim()
      const raw: unknown = JSON.parse(text)
      const preset = parseMixFile(raw)
      applyPreset(preset, true, false)
      if (typeof raw === 'object' && raw !== null && 'volume' in raw && typeof raw.volume === 'number') {
        setVolume(Math.min(1, Math.max(0, raw.volume)))
      }
      setImportError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not import that file'
      setImportError(
        /JSON|Unexpected token|not a MIDI|no equations|no playable|No notes/i.test(msg)
          ? `${msg} Use Import MIDI / JSON in the sidebar — don’t drop the file onto a blank browser tab.`
          : msg,
      )
    }
  }

  useEffect(() => {
    importFileRef.current = importFile
  })

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const ignore = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      const file = e.dataTransfer?.files[0]
      if (file) void importFileRef.current(file)
    }
    window.addEventListener('dragover', ignore, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', ignore, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [])

  const exportMix = () => {
    const payload = serializeCurrentMix({
      name: 'My mix',
      view,
      duration,
      waveform,
      bpm,
      volume,
      expressions,
    })
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dmos-mix.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const file = e.dataTransfer.files[0]
        if (file) void importFile(file)
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="8" fill="#2b241c" />
              <path d="M4 20c3-8 6-8 8 0s5 8 8 0 5-8 8 0" fill="none" stroke="#f3b267" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="20" cy="12" r="3.2" fill="#ff6b4a" />
            </svg>
          </span>
          <div>
            <h1>dmos</h1>
            <p>Type an equation, watch it move, hear it play</p>
          </div>
        </div>
        <p className="hint">
          <kbd>space</kbd> play/stop · t runs only while sound is on
        </p>
      </header>
      <div className="workspace">
        <Sidebar
          expressions={expressions}
          selectedId={selectedId}
          playing={playing}
          liveIds={liveIds}
          lists={lists}
          numbers={numbers}
          waveform={waveform}
          volume={volume}
          bpm={bpm}
          noteLabel={noteLabel}
          importError={importError}
          message={message}
          midiName={midiName}
          presets={PRESETS}
          onSelect={setSelectedId}
          onChange={updateExpr}
          onAdd={addExpr}
          onRemove={removeExpr}
          onPlay={() => void playSong()}
          onPlayRow={(id) => void playSong(id)}
          onToggleNote={togglePianoNote}
          onWaveform={setWaveform}
          onVolume={setVolume}
          onBpm={setBpm}
          onPresetPlay={(preset) => applyPreset(preset, true, true)}
          onPresetAdd={(preset) => applyPreset(preset, false, false)}
          onImport={(file) => void importFile(file)}
          onExport={exportMix}
        />
        <Graph view={view} onViewChange={setView} compiled={compiled} running={playing} liveIds={liveIds} />
      </div>
    </div>
  )
}
