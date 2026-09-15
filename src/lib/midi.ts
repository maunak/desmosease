export type MidiHit = {
  time: number
  notes: number[]
}

export type MidiSong = {
  name: string
  bpm: number
  duration: number
  hits: MidiHit[]
}

function readStr(data: Uint8Array, offset: number, n: number): string {
  const start = Math.max(0, offset)
  const end = Math.min(data.length, start + n)
  let text = ''
  for (let i = start; i < end; i += 1) text += String.fromCharCode(data[i] ?? 0)
  return text
}

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1]
}

function readU32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
}

function readVar(data: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let i = offset
  while (i < data.length) {
    const byte = data[i]
    i += 1
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) break
  }
  return { value, next: i }
}

function ticksToSeconds(tick: number, tempos: Array<{ tick: number; usPerQ: number }>, tpb: number): number {
  let seconds = 0
  let prevTick = 0
  let usPerQ = 500000
  for (const tempo of tempos) {
    if (tempo.tick >= tick) break
    seconds += ((tempo.tick - prevTick) * usPerQ) / (tpb * 1_000_000)
    prevTick = tempo.tick
    usPerQ = tempo.usPerQ
  }
  seconds += ((tick - prevTick) * usPerQ) / (tpb * 1_000_000)
  return seconds
}

export function parseMidi(buffer: ArrayBuffer, name = 'MIDI'): MidiSong {
  const data = new Uint8Array(buffer)
  if (data.length < 14 || readStr(data, 0, 4) !== 'MThd') {
    throw new Error('That file is not a MIDI song')
  }
  const headerLen = readU32(data, 4)
  const trackCount = readU16(data, 10)
  const division = readU16(data, 12)
  if (division & 0x8000) throw new Error('This MIDI time format is not supported')
  const tpb = Math.max(1, division)
  let offset = 8 + headerLen

  const tempos: Array<{ tick: number; usPerQ: number }> = [{ tick: 0, usPerQ: 500000 }]
  const raw: Array<{ tick: number; type: 'on' | 'off'; midi: number }> = []

  for (let t = 0; t < trackCount && offset + 8 <= data.length; t++) {
    if (readStr(data, offset, 4) !== 'MTrk') break
    const size = readU32(data, offset + 4)
    offset += 8
    const end = Math.min(data.length, offset + size)
    let tick = 0
    let status = 0
    let i = offset
    let guard = 0
    while (i < end && guard < data.length + 8) {
      guard += 1
      const started = i
      const delta = readVar(data, i)
      tick += delta.value
      i = delta.next
      if (i >= end || i >= data.length) break
      let command = data[i]
      if (command === undefined) break
      if (command < 0x80) {
        command = status
        if (command < 0x80) {
          i += 1
          continue
        }
      } else {
        i += 1
        status = command
      }
      const kind = command & 0xf0
      const channel = command & 0x0f
      if (command === 0xff) {
        status = 0
        if (i >= data.length) break
        const meta = data[i] ?? 0
        i += 1
        const len = readVar(data, i)
        i = len.next
        if (meta === 0x51 && len.value >= 3 && i + 2 < data.length) {
          const usPerQ = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
          if (usPerQ > 0) tempos.push({ tick, usPerQ })
        }
        i += len.value
        if (i <= started) i = started + 1
        continue
      }
      if (command === 0xf0 || command === 0xf7) {
        status = 0
        const len = readVar(data, i)
        i = len.next + len.value
        if (i <= started) i = started + 1
        continue
      }
      if (kind === 0x90 || kind === 0x80) {
        const note = data[i]
        const vel = data[i + 1]
        i += 2
        if (channel === 9 || note === undefined || note > 127) {
          if (i <= started) i = started + 1
          continue
        }
        const on = kind === 0x90 && (vel ?? 0) > 0
        raw.push({ tick, type: on ? 'on' : 'off', midi: note })
        if (raw.length > 80_000) break
        continue
      }
      if (kind === 0xc0 || kind === 0xd0) {
        i += 1
      } else {
        i += 2
      }
      if (i <= started) i = started + 1
    }
    offset = end
  }

  tempos.sort((a, b) => a.tick - b.tick)
  raw.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1))

  const held = new Map<number, number>()
  const hits: MidiHit[] = []
  let lastSig = ''

  const snapshot = (tick: number) => {
    const notes = [...held.values()].sort((a, b) => a - b)
    const sig = notes.join(',')
    if (sig === lastSig) return
    lastSig = sig
    hits.push({ time: ticksToSeconds(tick, tempos, tpb), notes })
  }

  for (const event of raw) {
    if (event.type === 'on') held.set(event.midi, event.midi - 69)
    else held.delete(event.midi)
    snapshot(event.tick)
    if (hits.length > 8000) break
  }

  const compact: MidiHit[] = []
  for (const hit of hits) {
    const prev = compact[compact.length - 1]
    if (prev && Math.abs(hit.time - prev.time) < 0.045) {
      prev.notes = hit.notes
      continue
    }
    compact.push({ ...hit })
  }

  const sounding = compact.filter((hit) => hit.notes.length > 0)
  const duration = compact.length ? compact[compact.length - 1].time : 0
  const startTempo = [...tempos].reverse().find((tempo) => tempo.tick === 0) ?? tempos[0]
  const bpm = Math.round((60_000_000 / (startTempo?.usPerQ ?? 500000)) * 10) / 10

  if (sounding.length === 0) throw new Error('No notes found in that MIDI file')

  return {
    name,
    bpm: Math.min(240, Math.max(40, bpm)),
    duration,
    hits: compact.slice(0, 2000),
  }
}

export function uniqueMidiChords(song: MidiSong, limit = 16): number[][] {
  return frequentMidiChords(song, limit)
}

export function frequentMidiChords(song: MidiSong, limit = 8): number[][] {
  const durations = new Map<string, { notes: number[]; dur: number }>()
  const hits = song.hits
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]
    if (hit.notes.length === 0) continue
    const end = hits[i + 1]?.time ?? song.duration
    const dur = Math.max(0, end - hit.time)
    if (dur < 0.07) continue
    const key = hit.notes.join(',')
    const prev = durations.get(key)
    if (prev) prev.dur += dur
    else durations.set(key, { notes: hit.notes, dur })
  }
  return [...durations.values()]
    .sort((a, b) => b.dur - a.dur)
    .slice(0, limit)
    .map((item) => item.notes)
}
