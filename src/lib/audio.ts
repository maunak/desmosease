import type { Waveform } from '../types'

export type VoiceSpec = {
  id: string
  frequencyAt: (u: number) => number | null
  /** 0..1, straight from tone(hz, gain) or the curve's own amplitude. */
  gain?: number
  /** Harmonics of a drawn curve. Without it the voice uses the global waveform. */
  wave?: { real: Float32Array; imag: Float32Array }
}

type MelodyOpts = {
  duration: number
  waveform: Waveform
  volume: number
  voices: VoiceSpec[]
  restart?: boolean
  onProgress: (u: number) => void
}

type VoiceNode = {
  osc: OscillatorNode
  unison: OscillatorNode
  filter: BiquadFilterNode
  pan: StereoPannerNode
  gain: GainNode
  fadeUntil: number
  fadingOut: boolean
  resting: boolean
  lastFreq: number | null
  lastWave: VoiceSpec['wave'] | null
  lastType: Waveform | null
  lastTarget: number
  killTimer: number | null
}

const ATTACK = 0.11
const RELEASE = 0.62
const REST_FADE = 0.08
const FREQ_TAU = 0.018

function rampGain(param: AudioParam, to: number, when: number, seconds: number): void {
  const end = Math.max(to, 0)
  try {
    param.cancelAndHoldAtTime(when)
  } catch {
    param.cancelScheduledValues(when)
    param.setValueAtTime(Math.max(param.value, 0), when)
  }
  param.linearRampToValueAtTime(end, when + seconds)
}

function hashPan(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0
  return ((h % 1000) / 1000 - 0.5) * 0.84
}

/** High notes get quieter, like a real instrument. Equal sines is what made chords scream. */
function registerGain(freq: number): number {
  const f = Math.max(30, freq)
  const air = 1 / (1 + (f / 1550) ** 1.55)
  const rumble = f < 120 ? 0.5 + 0.5 * (f / 120) : 1
  return rumble * (0.38 + 0.62 * air)
}

function cutoffFor(wave: Waveform, freq: number): number {
  const base = wave === 'sawtooth' ? 980 : wave === 'square' ? 1180 : wave === 'triangle' ? 2400 : 2100
  return Math.min(5200, Math.max(420, base + freq * 0.35))
}

/** A warm analog-ish spectrum. Pure sine is a test tone, not a synth. */
function padTable(wave: Waveform): { real: Float32Array; imag: Float32Array } {
  const n = 48
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let k = 1; k < n; k++) {
    if (wave === 'sine') {
      imag[k] = k === 1 ? 1 : k === 2 ? 0.28 : k === 3 ? 0.11 : k === 4 ? 0.05 : k === 5 ? 0.025 : 0
    } else if (wave === 'triangle') {
      imag[k] = k % 2 === 1 ? ((k % 4 === 1 ? 1 : -1) / (k * k)) * 1.2 : 0
    } else if (wave === 'square') {
      imag[k] = k % 2 === 1 ? 1 / k : 0
    } else {
      imag[k] = 1 / k
    }
  }
  return { real, imag }
}

function plateImpulse(ctx: AudioContext, seconds = 1.7): AudioBuffer {
  const rate = ctx.sampleRate
  const n = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, n, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      const t = i / rate
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.4) * (1 - i / n)
    }
  }
  return buf
}

export class EquationPlayer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private extras: AudioNode[] = []
  private nodes = new Map<string, VoiceNode>()
  private specs: VoiceSpec[] = []
  private raf = 0
  private ticking = false
  private stopped = true
  private origin = 0
  private duration = 32
  private volume = 0.7
  private waveform: Waveform = 'sine'
  private pad: { real: Float32Array; imag: Float32Array } | null = null
  private onProgress: ((u: number) => void) | null = null
  private mode: 'off' | 'tune' = 'off'
  private lastVoiceCount = -1
  private lastU = 0
  private playGen = 0

  get running(): boolean {
    return !this.stopped && this.mode !== 'off'
  }

  currentU(): number {
    if (!this.running || !this.ctx || this.duration <= 0) return 0
    const t = (this.ctx.currentTime - this.origin) / this.duration
    if (t < 0) return 0
    return t - Math.floor(t)
  }

  setDuration(seconds: number): void {
    const next = Math.max(1, seconds)
    if (this.ctx && this.running && this.mode === 'tune') {
      const u = this.currentU()
      this.duration = next
      this.origin = this.ctx.currentTime - u * this.duration
      return
    }
    this.duration = next
  }

  private async ensureCtx(): Promise<AudioContext> {
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    return this.ctx
  }

  private async ensureMaster(): Promise<{ ctx: AudioContext; master: GainNode }> {
    const ctx = await this.ensureCtx()
    if (!this.master) {
      const voiceIn = ctx.createGain()
      voiceIn.gain.value = 1

      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 72
      hp.Q.value = 0.7

      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 6400
      lp.Q.value = 0.5

      const body = ctx.createGain()
      body.gain.value = 1

      const dry = ctx.createGain()
      dry.gain.value = 0.78

      const wet = ctx.createGain()
      wet.gain.value = 0.34

      const conv = ctx.createConvolver()
      conv.buffer = plateImpulse(ctx)

      const delayL = ctx.createDelay(0.08)
      delayL.delayTime.value = 0.019
      const delayR = ctx.createDelay(0.08)
      delayR.delayTime.value = 0.027
      const chorusL = ctx.createGain()
      chorusL.gain.value = 0.2
      const chorusR = ctx.createGain()
      chorusR.gain.value = 0.2
      const panL = ctx.createStereoPanner()
      panL.pan.value = -0.85
      const panR = ctx.createStereoPanner()
      panR.pan.value = 0.85
      const lfo = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      lfo.frequency.value = 0.23
      lfoGain.gain.value = 0.0035
      lfo.connect(lfoGain)
      lfoGain.connect(delayL.delayTime)
      lfoGain.connect(delayR.delayTime)
      lfo.start()

      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -14
      limiter.knee.value = 12
      limiter.ratio.value = 3.2
      limiter.attack.value = 0.018
      limiter.release.value = 0.28

      voiceIn.connect(hp)
      hp.connect(lp)
      lp.connect(body)
      body.connect(dry)
      body.connect(conv)
      conv.connect(wet)
      body.connect(delayL)
      delayL.connect(chorusL)
      chorusL.connect(panL)
      body.connect(delayR)
      delayR.connect(chorusR)
      chorusR.connect(panR)
      dry.connect(limiter)
      wet.connect(limiter)
      panL.connect(limiter)
      panR.connect(limiter)
      limiter.connect(ctx.destination)

      this.master = voiceIn
      this.limiter = limiter
      this.extras = [hp, lp, body, dry, wet, conv, delayL, delayR, chorusL, chorusR, panL, panR, lfo, lfoGain]
    }
    return { ctx, master: this.master }
  }

  private voiceGain(count: number, spec: VoiceSpec, freq: number | null): number {
    const scale = typeof spec.gain === 'number' && Number.isFinite(spec.gain) ? Math.min(1, Math.max(0, spec.gain)) : 1
    const density = 0.2 / Math.pow(Math.max(1, count), 0.4)
    return this.volume * density * scale * registerGain(freq && freq > 0 ? freq : 440)
  }

  private clearKill(node: VoiceNode): void {
    if (node.killTimer !== null) {
      window.clearTimeout(node.killTimer)
      node.killTimer = null
    }
  }

  private disconnectVoice(node: VoiceNode): void {
    for (const part of [node.osc, node.unison]) {
      try {
        part.stop()
      } catch {
        // already stopped
      }
      try {
        part.disconnect()
      } catch {
        // already disconnected
      }
    }
    for (const part of [node.filter, node.pan, node.gain]) {
      try {
        part.disconnect()
      } catch {
        // already disconnected
      }
    }
  }

  private releaseNode(id: string, node: VoiceNode, when: number): void {
    if (node.fadingOut) return
    node.fadingOut = true
    node.fadeUntil = when + RELEASE
    this.clearKill(node)
    rampGain(node.gain.gain, 0, when, RELEASE)
    node.killTimer = window.setTimeout(() => {
      node.killTimer = null
      this.disconnectVoice(node)
      if (this.nodes.get(id) === node) this.nodes.delete(id)
    }, RELEASE * 1000 + 80)
  }

  stop(): void {
    this.stopped = true
    this.ticking = false
    this.mode = 'off'
    this.playGen += 1
    cancelAnimationFrame(this.raf)
    const ctx = this.ctx
    const now = ctx?.currentTime ?? 0
    if (this.master && ctx) rampGain(this.master.gain, 0, now, 0.22)
    for (const [id, node] of this.nodes) this.releaseNode(id, node, now)
    this.nodes.clear()
    this.specs = []
    this.lastVoiceCount = -1
    this.lastU = 0
    const master = this.master
    const limiter = this.limiter
    const extras = this.extras
    this.master = null
    this.limiter = null
    this.extras = []
    this.onProgress = null
    window.setTimeout(() => {
      master?.disconnect()
      limiter?.disconnect()
      for (const node of extras) {
        if (node instanceof OscillatorNode) {
          try {
            node.stop()
          } catch {
            // already stopped
          }
        }
        try {
          node.disconnect()
        } catch {
          // already disconnected
        }
      }
    }, 280)
  }

  private applyWave(ctx: AudioContext, osc: OscillatorNode, spec: VoiceSpec): void {
    const table = spec.wave ?? this.pad ?? padTable(this.waveform)
    try {
      osc.setPeriodicWave(ctx.createPeriodicWave(table.real, table.imag))
    } catch {
      osc.type = this.waveform
    }
  }

  private setTimbre(ctx: AudioContext, node: VoiceNode, spec: VoiceSpec): void {
    const sameWave = spec.wave ? node.lastWave === spec.wave : node.lastType === this.waveform && !node.lastWave
    if (sameWave) return
    node.lastWave = spec.wave ?? null
    node.lastType = spec.wave ? null : this.waveform
    this.applyWave(ctx, node.osc, spec)
    this.applyWave(ctx, node.unison, spec)
  }

  private setFreq(node: VoiceNode, freq: number, now: number, wrapped: boolean): void {
    const last = node.lastFreq
    const jump = last === null || wrapped || Math.abs(Math.log2(freq / Math.max(last, 1e-6))) > 0.055
    node.lastFreq = freq
    const apply = (param: AudioParam, value: number) => {
      if (jump) {
        param.cancelScheduledValues(now)
        param.setValueAtTime(value, now)
        return
      }
      param.setTargetAtTime(value, now, FREQ_TAU)
    }
    apply(node.osc.frequency, freq)
    apply(node.unison.frequency, freq)
    apply(node.filter.frequency, cutoffFor(this.waveform, freq))
  }

  private spawnVoice(ctx: AudioContext, master: GainNode, spec: VoiceSpec, freq: number | null, now: number): VoiceNode {
    const osc = ctx.createOscillator()
    const unison = ctx.createOscillator()
    const filter = ctx.createBiquadFilter()
    const pan = ctx.createStereoPanner()
    const gain = ctx.createGain()

    filter.type = 'lowpass'
    filter.Q.value = 0.82
    filter.frequency.setValueAtTime(cutoffFor(this.waveform, freq ?? 440), now)
    osc.detune.setValueAtTime(-6, now)
    unison.detune.setValueAtTime(9, now)
    pan.pan.setValueAtTime(hashPan(spec.id), now)
    osc.frequency.setValueAtTime(freq ?? 440, now)
    unison.frequency.setValueAtTime(freq ?? 440, now)
    gain.gain.setValueAtTime(0.0001, now)

    osc.connect(filter)
    unison.connect(filter)
    filter.connect(pan)
    pan.connect(gain)
    gain.connect(master)

    const period = 1 / Math.max(40, freq ?? 440)
    osc.start(now)
    unison.start(now + period * Math.random())

    return {
      osc,
      unison,
      filter,
      pan,
      gain,
      fadeUntil: now + ATTACK,
      fadingOut: false,
      resting: freq === null,
      lastFreq: freq,
      lastWave: null,
      lastType: null,
      lastTarget: 0,
      killTimer: null,
    }
  }

  private syncTuneVoices(ctx: AudioContext, master: GainNode, u: number): void {
    const now = ctx.currentTime
    const keep = new Set(this.specs.map((spec) => spec.id))
    const countChanged = this.lastVoiceCount !== this.specs.length
    this.lastVoiceCount = this.specs.length

    for (const [id, node] of [...this.nodes]) {
      if (keep.has(id) || node.fadingOut) continue
      this.releaseNode(id, node, now)
    }

    for (const spec of this.specs) {
      const freq = spec.frequencyAt(u)
      const target = this.voiceGain(this.specs.length, spec, freq)
      let node = this.nodes.get(spec.id)
      if (node?.fadingOut) {
        this.clearKill(node)
        node.fadingOut = false
        node.resting = freq === null
        node.fadeUntil = now + ATTACK
        this.setTimbre(ctx, node, spec)
        if (freq !== null) this.setFreq(node, freq, now, true)
        node.lastTarget = freq === null ? 0 : target
        rampGain(node.gain.gain, node.lastTarget, now, ATTACK)
        continue
      }
      if (!node) {
        node = this.spawnVoice(ctx, master, spec, freq, now)
        this.setTimbre(ctx, node, spec)
        if (freq !== null) {
          node.lastTarget = target
          rampGain(node.gain.gain, target, now, ATTACK)
        }
        this.nodes.set(spec.id, node)
        continue
      }
      this.setTimbre(ctx, node, spec)
      if (freq !== null && !node.fadingOut) this.setFreq(node, freq, now, false)
      if (!node.fadingOut && !node.resting && Math.abs(node.lastTarget - target) > 1e-4) {
        node.lastTarget = target
        rampGain(node.gain.gain, target, now, countChanged ? 0.28 : 0.1)
        node.fadeUntil = now + 0.28
      }
    }
  }

  private tickTune = (): void => {
    if (this.stopped || this.mode !== 'tune' || !this.ctx) {
      this.ticking = false
      return
    }
    const u = this.currentU()
    const wrapped = this.lastU > 0.72 && u + 0.28 < this.lastU
    this.lastU = u
    const now = this.ctx.currentTime
    for (const spec of this.specs) {
      const node = this.nodes.get(spec.id)
      if (!node || node.fadingOut) continue
      const freq = spec.frequencyAt(u)
      const target = this.voiceGain(this.specs.length, spec, freq)
      if (freq === null) {
        if (!node.resting) {
          node.resting = true
          rampGain(node.gain.gain, 0, now, REST_FADE)
        }
        continue
      }
      this.setFreq(node, freq, now, wrapped)
      if (node.resting) {
        node.resting = false
        node.lastTarget = target
        rampGain(node.gain.gain, target, now, ATTACK)
      }
    }
    this.onProgress?.(u)
    this.raf = requestAnimationFrame(this.tickTune)
  }

  async playMelody(opts: MelodyOpts): Promise<void> {
    const gen = ++this.playGen
    const restart = opts.restart ?? (this.mode !== 'tune' || this.stopped)
    this.stopped = false
    this.volume = opts.volume
    this.waveform = opts.waveform
    this.pad = padTable(opts.waveform)
    this.specs = opts.voices
    this.onProgress = opts.onProgress

    if (!restart && this.ctx && this.mode === 'tune') {
      const u = this.currentU()
      this.duration = Math.max(1, opts.duration)
      this.origin = this.ctx.currentTime - u * this.duration
    } else {
      this.duration = Math.max(1, opts.duration)
    }

    const { ctx, master } = await this.ensureMaster()
    if (this.stopped || gen !== this.playGen) return

    if (restart) {
      cancelAnimationFrame(this.raf)
      this.ticking = false
      this.origin = ctx.currentTime
      this.lastU = 0
      this.lastVoiceCount = -1
    }

    this.mode = 'tune'
    this.syncTuneVoices(ctx, master, restart ? 0 : this.currentU())
    if (!this.ticking) {
      this.ticking = true
      this.raf = requestAnimationFrame(this.tickTune)
    }
  }
}
