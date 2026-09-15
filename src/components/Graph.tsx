import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { boundsFromView, niceStep } from '../lib/math'
import type { CompiledExpr, View } from '../types'

type Props = {
  view: View
  onViewChange: (view: View) => void
  compiled: CompiledExpr[]
  /** t only advances while something is actually sounding. */
  running: boolean
  liveIds: string[]
}

type Point = { x: number; y: number }

function worldToScreen(x: number, y: number, view: View, w: number, h: number): Point {
  return {
    x: w / 2 + (x - view.cx) * view.scale,
    y: h / 2 - (y - view.cy) * view.scale,
  }
}

function screenToWorld(px: number, py: number, view: View, w: number, h: number): Point {
  return {
    x: view.cx + (px - w / 2) / view.scale,
    y: view.cy - (py - h / 2) / view.scale,
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, view: View, w: number, h: number): void {
  const bounds = boundsFromView(view, w, h)
  const xStep = Math.max(niceStep(bounds.xMax - bounds.xMin), 1e-6)
  const yStep = Math.max(niceStep(bounds.yMax - bounds.yMin), 1e-6)
  const minorX = xStep / 5
  const minorY = yStep / 5

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  if (!Number.isFinite(xStep) || !Number.isFinite(yStep)) return

  ctx.lineWidth = 1

  ctx.strokeStyle = '#f0f0f0'
  ctx.beginPath()
  for (let x = Math.floor(bounds.xMin / minorX) * minorX; x <= bounds.xMax; x += minorX) {
    const p = worldToScreen(x, 0, view, w, h)
    ctx.moveTo(p.x, 0)
    ctx.lineTo(p.x, h)
  }
  for (let y = Math.floor(bounds.yMin / minorY) * minorY; y <= bounds.yMax; y += minorY) {
    const p = worldToScreen(0, y, view, w, h)
    ctx.moveTo(0, p.y)
    ctx.lineTo(w, p.y)
  }
  ctx.stroke()

  ctx.strokeStyle = '#dcdcdc'
  ctx.beginPath()
  for (let x = Math.floor(bounds.xMin / xStep) * xStep; x <= bounds.xMax; x += xStep) {
    const p = worldToScreen(x, 0, view, w, h)
    ctx.moveTo(p.x, 0)
    ctx.lineTo(p.x, h)
  }
  for (let y = Math.floor(bounds.yMin / yStep) * yStep; y <= bounds.yMax; y += yStep) {
    const p = worldToScreen(0, y, view, w, h)
    ctx.moveTo(0, p.y)
    ctx.lineTo(w, p.y)
  }
  ctx.stroke()

  const origin = worldToScreen(0, 0, view, w, h)
  ctx.strokeStyle = '#2c2c2c'
  ctx.lineWidth = 1.35
  ctx.beginPath()
  ctx.moveTo(0, origin.y)
  ctx.lineTo(w, origin.y)
  ctx.moveTo(origin.x, 0)
  ctx.lineTo(origin.x, h)
  ctx.stroke()

  ctx.font = '500 11px "IBM Plex Sans", sans-serif'
  ctx.fillStyle = '#6b6b6b'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let x = Math.ceil(bounds.xMin / xStep) * xStep; x <= bounds.xMax; x += xStep) {
    if (Math.abs(x) < xStep / 4) continue
    const p = worldToScreen(x, 0, view, w, h)
    const label = Number.isInteger(x) ? String(x) : x.toFixed(Math.abs(x) < 1 ? 2 : 1)
    ctx.fillText(label, p.x, Math.min(h - 16, Math.max(6, origin.y + 6)))
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let y = Math.ceil(bounds.yMin / yStep) * yStep; y <= bounds.yMax; y += yStep) {
    if (Math.abs(y) < yStep / 4) continue
    const p = worldToScreen(0, y, view, w, h)
    const label = Number.isInteger(y) ? String(y) : y.toFixed(Math.abs(y) < 1 ? 2 : 1)
    ctx.fillText(label, Math.min(w - 8, Math.max(28, origin.x - 8)), p.y)
  }
}

function plotCartesian(
  ctx: CanvasRenderingContext2D,
  compiled: CompiledExpr,
  view: View,
  w: number,
  h: number,
  t: number,
  dim: boolean,
): void {
  if (!compiled.f) return
  const bounds = boundsFromView(view, w, h)
  const samples = Math.max(400, Math.floor(w * 2.2))
  const yLimit = (bounds.yMax - bounds.yMin) * 2.4
  ctx.strokeStyle = compiled.color
  ctx.globalAlpha = dim ? 0.24 : 1
  ctx.lineWidth = dim ? 1.6 : 2.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  let drawing = false
  let prevY = NaN
  for (let i = 0; i <= samples; i++) {
    const x = bounds.xMin + (i / samples) * (bounds.xMax - bounds.xMin)
    const y = compiled.f(x, t)
    if (!Number.isFinite(y) || Math.abs(y - prevY) > yLimit) {
      drawing = false
      prevY = y
      continue
    }
    const p = worldToScreen(x, y, view, w, h)
    if (!drawing) {
      ctx.moveTo(p.x, p.y)
      drawing = true
    } else {
      ctx.lineTo(p.x, p.y)
    }
    prevY = y
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

function plotParametric(
  ctx: CanvasRenderingContext2D,
  compiled: CompiledExpr,
  view: View,
  w: number,
  h: number,
  t: number,
  dim: boolean,
): void {
  const samples = 1800
  ctx.strokeStyle = compiled.color
  ctx.globalAlpha = dim ? 0.24 : 1
  ctx.lineWidth = dim ? 1.6 : 2.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  let drawing = false
  if (compiled.kind === 'polar' && compiled.r) {
    for (let i = 0; i <= samples; i++) {
      const theta = compiled.t0 + (i / samples) * (compiled.t1 - compiled.t0)
      const r = compiled.r(theta, t)
      if (!Number.isFinite(r)) {
        drawing = false
        continue
      }
      const p = worldToScreen(r * Math.cos(theta), r * Math.sin(theta), view, w, h)
      if (!drawing) {
        ctx.moveTo(p.x, p.y)
        drawing = true
      } else {
        ctx.lineTo(p.x, p.y)
      }
    }
  } else if (compiled.fx && compiled.fy) {
    for (let i = 0; i <= samples; i++) {
      const p0 = compiled.t0 + (i / samples) * (compiled.t1 - compiled.t0)
      const x = compiled.fx(p0)
      const y = compiled.fy(p0)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        drawing = false
        continue
      }
      const p = worldToScreen(x, y, view, w, h)
      if (!drawing) {
        ctx.moveTo(p.x, p.y)
        drawing = true
      } else {
        ctx.lineTo(p.x, p.y)
      }
    }
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

function drawClock(ctx: CanvasRenderingContext2D, h: number, t: number, running: boolean): void {
  const label = `t = ${t.toFixed(2)}${running ? '' : '  (paused)'}`
  ctx.font = '500 12px "IBM Plex Mono", monospace'
  const width = ctx.measureText(label).width + 18
  ctx.fillStyle = running ? 'rgba(255, 107, 74, 0.12)' : 'rgba(42, 36, 28, 0.06)'
  ctx.strokeStyle = running ? 'rgba(212, 82, 52, 0.45)' : 'rgba(42, 36, 28, 0.16)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(12, h - 34, width, 24, 6)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = running ? '#b8431f' : '#6d6458'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 21, h - 21)
}

export function Graph({ view, onViewChange, compiled, running, liveIds }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  const dragRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null)
  const hoverRef = useRef<Point | null>(null)
  const compiledRef = useRef(compiled)
  const liveRef = useRef(liveIds)
  const runningRef = useRef(running)
  const tRef = useRef(0)
  const lastFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    viewRef.current = view
    compiledRef.current = compiled
    liveRef.current = liveIds
    runningRef.current = running
  }, [view, compiled, liveIds, running])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    const draw = (now: number) => {
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const h = Math.max(1, rect.height)
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }

      // t is the ticker. It moves only while the sound is on, so a still
      // picture means nothing is playing.
      const last = lastFrameRef.current
      lastFrameRef.current = now
      const isRunning = runningRef.current
      if (isRunning && last !== null) {
        tRef.current += Math.min(0.05, Math.max(0, (now - last) / 1000))
      }
      const t = tRef.current

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const currentView = viewRef.current
      drawGrid(ctx, currentView, w, h)

      const live = liveRef.current
      const highlight = isRunning && live.length > 0
      for (const item of compiledRef.current) {
        const dim = highlight && !live.includes(item.id)
        const rowT = t * (item.speed || 1)
        if (item.kind === 'cartesian' || item.kind === 'tones') {
          plotCartesian(ctx, item, currentView, w, h, rowT, dim)
        } else {
          plotParametric(ctx, item, currentView, w, h, rowT, dim)
        }
      }

      const hover = hoverRef.current
      if (hover) {
        const p = worldToScreen(hover.x, hover.y, currentView, w, h)
        ctx.strokeStyle = 'rgba(44, 44, 44, 0.28)'
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(p.x, 0)
        ctx.lineTo(p.x, h)
        ctx.moveTo(0, p.y)
        ctx.lineTo(w, p.y)
        ctx.stroke()
        ctx.setLineDash([])
        const label = `(${hover.x.toFixed(2)}, ${hover.y.toFixed(2)})`
        ctx.font = '500 12px "IBM Plex Mono", monospace'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        const tx = Math.min(w - 132, p.x + 10)
        const ty = Math.min(h - 28, p.y + 10)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
        ctx.lineWidth = 1
        ctx.fillRect(tx - 6, ty - 4, 128, 22)
        ctx.strokeRect(tx - 6, ty - 4, 128, 22)
        ctx.fillStyle = '#2a241c'
        ctx.fillText(label, tx, ty)
      }

      drawClock(ctx, h, t, isRunning)

      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const current = viewRef.current
      const world = screenToWorld(px, py, current, rect.width, rect.height)
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const scale = Math.min(520, Math.max(8, current.scale * factor))
      onViewChange({
        scale,
        cx: world.x - (px - rect.width / 2) / scale,
        cy: world.y + (py - rect.height / 2) / scale,
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [onViewChange])

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    dragRef.current = {
      px: e.clientX,
      py: e.clientY,
      cx: viewRef.current.cx,
      cy: viewRef.current.cy,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    hoverRef.current = screenToWorld(px, py, viewRef.current, rect.width, rect.height)
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.px
    const dy = e.clientY - drag.py
    onViewChange({
      ...viewRef.current,
      cx: drag.cx - dx / viewRef.current.scale,
      cy: drag.cy + dy / viewRef.current.scale,
    })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    canvasRef.current?.releasePointerCapture(e.pointerId)
  }

  return (
    <div className="graph" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          hoverRef.current = null
        }}
      />
      <div className="graph-tools">
        <button
          type="button"
          onClick={() => onViewChange({ ...view, scale: Math.min(520, view.scale * 1.2) })}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => onViewChange({ ...view, scale: Math.max(8, view.scale / 1.2) })}
          aria-label="Zoom out"
        >
          −
        </button>
        <button type="button" onClick={() => onViewChange({ cx: 0, cy: 0, scale: 44 })}>
          Home
        </button>
        <button
          type="button"
          title="Send t back to 0"
          onClick={() => {
            tRef.current = 0
          }}
        >
          t = 0
        </button>
      </div>
    </div>
  )
}
