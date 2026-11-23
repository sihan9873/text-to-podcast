// components/effects/SoundWaveBackdrop.tsx
import * as React from "react"

/**
 * Digital audio backdrop: frequency grid, stereo oscilloscope traces,
 * and an equalizer skyline. Decorative, reduced-motion aware,
 * and paused while the tab is hidden.
 */

type HSL = [number, number, number]

function readPrimary(): HSL {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim()
    const m = raw.match(/(-?[\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/)
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  } catch {
    /* ignore */
  }
  return [330, 85, 65]
}

const hsla = ([h, s, l]: HSL, a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`

export function SoundWaveBackdrop({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const primary = readPrimary()
    const palette: HSL[] = [
      primary,
      [320, 90, 76],
      [265, 85, 70],
      [195, 90, 68],
    ]

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    let reduced = motionQuery.matches

    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let running = false

    // pointer state (smoothed)
    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, energy: 0, active: false }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.floor(rect.width))
      h = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // ---------- layers ----------

    const drawSignal = (t: number) => {
      ctx.save()
      ctx.globalCompositeOperation = "lighter"

      const left = w * 0.06
      const right = w * 0.94
      const span = right - left
      const top = h * 0.27
      const bottom = h * 0.69
      const spacing = Math.max(24, Math.min(48, w / 28))
      const amplitude = Math.min(44, h * 0.055)
      const px = pointer.x * w
      const py = pointer.y * h

      // ----- frequency grid -----
      const grid = new Path2D()
      const cols: number[] = []
      const rows: number[] = []
      for (let x = left; x <= right; x += spacing) {
        grid.moveTo(x, top)
        grid.lineTo(x, bottom)
        cols.push(x)
      }
      for (let y = top; y <= bottom; y += spacing) {
        grid.moveTo(left, y)
        grid.lineTo(right, y)
        rows.push(y)
      }

      const fade = ctx.createLinearGradient(left, 0, right, 0)
      fade.addColorStop(0, hsla(palette[2], 0))
      fade.addColorStop(0.18, hsla(palette[2], 0.085))
      fade.addColorStop(0.82, hsla(palette[2], 0.085))
      fade.addColorStop(1, hsla(palette[2], 0))
      ctx.lineWidth = 0.7
      ctx.strokeStyle = fade
      ctx.stroke(grid)

      // a soft light band sweeps across the grid
      const sweepX = left + (((t * 0.05) % 1.3) - 0.15) * span
      const band = ctx.createLinearGradient(sweepX - 140, 0, sweepX + 140, 0)
      band.addColorStop(0, hsla(palette[1], 0))
      band.addColorStop(0.5, hsla(palette[1], 0.17))
      band.addColorStop(1, hsla(palette[1], 0))
      ctx.strokeStyle = band
      ctx.stroke(grid)

      // grid lights up around the cursor
      if (pointer.energy > 0.01) {
        const rg = ctx.createRadialGradient(px, py, 0, px, py, 210)
        rg.addColorStop(0, hsla(palette[1], 0.3 * pointer.energy))
        rg.addColorStop(1, hsla(palette[1], 0))
        ctx.strokeStyle = rg
        ctx.stroke(grid)
      }

      // intersection nodes with a travelling pulse
      for (const cx of cols) {
        const u = (cx - left) / span
        const edge = Math.sin(Math.PI * u)
        for (const ry of rows) {
          const pulse = 0.5 + 0.5 * Math.sin(u * 11 - t * 1.1 + ry * 0.008)
          let a = (0.05 + 0.2 * pulse * pulse) * edge
          if (pointer.energy > 0.01) {
            const d = Math.hypot(cx - px, ry - py) / 170
            a += Math.exp(-d * d) * 0.4 * pointer.energy
          }
          if (a < 0.02) continue
          ctx.fillStyle = hsla(palette[pulse > 0.8 ? 1 : 2], Math.min(a, 0.7))
          ctx.fillRect(cx - 1, ry - 1, 2, 2)
        }
      }

      // ----- stereo oscilloscope traces -----
      const points = Math.max(160, Math.ceil(span / 3))

      const traceY = (channel: number, u: number, tt: number) => {
        const x = left + u * span
        const baseline = h * (0.39 + channel * 0.18)
        const envelope = Math.pow(Math.sin(Math.PI * u), 1.5)
        const modulation =
          0.35 + 0.65 * Math.pow(Math.sin(u * 9 - tt * 0.45 + channel * 2), 2)
        const carrier =
          Math.sin(u * Math.PI * 48 - tt * 1.8 + channel) * 0.7 +
          Math.sin(u * Math.PI * 86 + tt * 0.9) * 0.3
        const distance = (x / w - pointer.x) / 0.14
        const response = 1 + 0.35 * Math.exp(-distance * distance) * pointer.energy
        return baseline + carrier * amplitude * envelope * modulation * response
      }

      const tracePath = (channel: number, tt: number, from = 0, to = 1) => {
        const i0 = Math.max(0, Math.floor(from * points))
        const i1 = Math.min(points, Math.ceil(to * points))
        ctx.beginPath()
        for (let i = i0; i <= i1; i++) {
          const u = i / points
          const x = left + u * span
          const y = traceY(channel, u, tt)
          if (i === i0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
      }

      ctx.lineJoin = "round"
      ctx.lineCap = "round"

      for (let channel = 0; channel < 2; channel++) {
        const baseline = h * (0.39 + channel * 0.18)
        const color = palette[channel === 0 ? 0 : 3]

        const gradient = ctx.createLinearGradient(left, 0, right, 0)
        gradient.addColorStop(0, hsla(color, 0))
        gradient.addColorStop(0.12, hsla(color, 0.42))
        gradient.addColorStop(0.5, hsla(color, 0.22))
        gradient.addColorStop(0.88, hsla(color, 0.42))
        gradient.addColorStop(1, hsla(color, 0))

        // dashed zero-line
        const axis = ctx.createLinearGradient(left, 0, right, 0)
        axis.addColorStop(0, hsla(color, 0))
        axis.addColorStop(0.5, hsla(color, 0.16))
        axis.addColorStop(1, hsla(color, 0))
        ctx.setLineDash([2, 9])
        ctx.strokeStyle = axis
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(left, baseline)
        ctx.lineTo(right, baseline)
        ctx.stroke()
        ctx.setLineDash([])

        // phosphor afterimages: earlier copies of the trace fade out behind it
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1
        for (let k = 3; k >= 1; k--) {
          tracePath(channel, t - k * 0.22)
          ctx.globalAlpha = 0.2 / k
          ctx.stroke()
        }

        // main trace: wide bloom + crisp line
        tracePath(channel, t)
        ctx.lineWidth = 5
        ctx.globalAlpha = 0.1
        ctx.stroke()
        ctx.lineWidth = 1.2
        ctx.globalAlpha = 1
        ctx.stroke()

        // playhead: bright comet-tail along the trace, a vertical scan line and a glowing head
        const progress = (t * 0.065 + channel * 0.5) % 1
        const headX = left + progress * span
        const intensity = Math.pow(Math.sin(progress * Math.PI), 2)
        const tail = Math.max(0, progress - 0.11)

        if (progress > 0.002) {
          const tailX = left + tail * span
          const trail = ctx.createLinearGradient(tailX, 0, headX, 0)
          trail.addColorStop(0, hsla(color, 0))
          trail.addColorStop(1, hsla([color[0], 70, 88], 0.95 * intensity))
          tracePath(channel, t, tail, progress)
          ctx.strokeStyle = trail
          ctx.lineWidth = 6
          ctx.globalAlpha = 0.18
          ctx.stroke()
          ctx.lineWidth = 1.8
          ctx.globalAlpha = 1
          ctx.stroke()
        }

        const scan = ctx.createLinearGradient(0, baseline - amplitude, 0, baseline + amplitude)
        scan.addColorStop(0, hsla(color, 0))
        scan.addColorStop(0.5, hsla(color, 0.3 * intensity))
        scan.addColorStop(1, hsla(color, 0))
        ctx.fillStyle = scan
        ctx.fillRect(headX, baseline - amplitude, 1, amplitude * 2)

        const headY = traceY(channel, progress, t)
        const glow = ctx.createRadialGradient(headX, headY, 0, headX, headY, 16)
        glow.addColorStop(0, hsla([color[0], 80, 94], 0.85 * intensity))
        glow.addColorStop(0.25, hsla(color, 0.4 * intensity))
        glow.addColorStop(1, hsla(color, 0))
        ctx.fillStyle = glow
        ctx.fillRect(headX - 16, headY - 16, 32, 32)
      }

      ctx.restore()
    }

    const drawBars = (t: number) => {
      const gap = 6
      const bw = w < 640 ? 5 : 7
      const n = Math.floor(w / (bw + gap))
      const maxH = h * 0.2
      ctx.globalCompositeOperation = "lighter"

      for (let i = 0; i < n; i++) {
        const u = i / (n - 1)
        const x = i * (bw + gap) + gap / 2
        const env = Math.pow(Math.sin(u * Math.PI), 1.4)
        const a = 0.5 + 0.5 * Math.sin(t * 1.9 + i * 0.37)
        const b = 0.5 + 0.5 * Math.sin(t * 0.8 - i * 0.13 + 2)
        const c = 0.5 + 0.5 * Math.sin(t * 3.1 + i * 0.91)
        let v = (0.18 + 0.82 * (a * 0.5 + b * 0.35 + c * 0.15)) * env

        if (pointer.energy > 0.001) {
          const d = (u - pointer.x) / 0.1
          v += Math.exp(-d * d) * 0.55 * pointer.energy
        }
        const bh = Math.max(2, Math.min(1.2, v) * maxH)
        const y = h - bh

        const col = palette[Math.round(u * 2) % 3]
        const g = ctx.createLinearGradient(0, y, 0, h)
        g.addColorStop(0, hsla(col, 0.38 * (0.4 + env)))
        g.addColorStop(1, hsla(col, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, bw / 2)
        else ctx.rect(x, y, bw, bh)
        ctx.fill()

        // floating cap
        const capY = y - 6 - 4 * Math.sin(t * 2 + i)
        ctx.fillStyle = hsla(col, 0.4 * env)
        ctx.fillRect(x, capY, bw, 1.5)
      }
    }

    // ---------- loop ----------

    let last = 0
    let time = 0
    const frame = (now: number) => {
      if (!running) return
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
      last = now
      time += dt

      // ease pointer
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 6)
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 6)
      const target = pointer.active ? 1 : 0
      pointer.energy += (target - pointer.energy) * Math.min(1, dt * (pointer.active ? 5 : 1.8))

      render(time)
      raf = requestAnimationFrame(frame)
    }

    const render = (t: number) => {
      ctx.globalCompositeOperation = "source-over"
      ctx.clearRect(0, 0, w, h)
      drawSignal(t)
      drawBars(t)
      ctx.globalCompositeOperation = "source-over"
    }

    const start = () => {
      if (running || reduced || document.hidden) return
      running = true
      last = 0
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.tx = (e.clientX - rect.left) / rect.width
      pointer.ty = (e.clientY - rect.top) / rect.height
      pointer.active = true
    }
    const onLeave = () => {
      pointer.active = false
    }
    const onVisibility = () => (document.hidden ? stop() : start())

    const onMotionChange = () => {
      reduced = motionQuery.matches
      stop()
      if (reduced) render(6)
      else start()
    }

    resize()
    const ro = new ResizeObserver(() => {
      resize()
      if (reduced) render(6)
    })
    ro.observe(canvas)

    if (reduced) render(6)
    else start()

    motionQuery.addEventListener("change", onMotionChange)
    window.addEventListener("pointermove", onMove, { passive: true })
    document.addEventListener("pointerleave", onLeave)
    window.addEventListener("blur", onLeave)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      stop()
      ro.disconnect()
      motionQuery.removeEventListener("change", onMotionChange)
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerleave", onLeave)
      window.removeEventListener("blur", onLeave)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className ?? ""}`}
      style={{
        // soft vignette so the login card area stays calm
        WebkitMaskImage:
          "radial-gradient(ellipse at 50% 50%, black 55%, rgba(0,0,0,0.75) 100%)",
        maskImage:
          "radial-gradient(ellipse at 50% 50%, black 55%, rgba(0,0,0,0.75) 100%)",
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
