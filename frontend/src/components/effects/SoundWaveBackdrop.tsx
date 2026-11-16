// components/effects/SoundWaveBackdrop.tsx
import * as React from "react"

/**
 * Canvas-driven login backdrop:
 *  - drifting aurora glows (depth-layered, color-graded)
 *  - layered glowing sound-wave ribbons (additive blending, depth hierarchy)
 *  - an equalizer skyline rising from the bottom edge (unchanged)
 *  - twinkling particles with depth and drift
 *  - pointer interaction: waves swell and bend toward the cursor
 * Decorative only: hidden from assistive tech, honors prefers-reduced-motion,
 * pauses while the tab is hidden.
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

type Ribbon = {
  base: number // 0..1 of height
  amp: number // px at 900px height, scaled later
  freq: number // cycles across width
  speed: number
  phase: number
  thick: number
  colorA: number
  colorB: number
  alpha: number
  hero?: boolean
  /** depth 0 (far) .. 1 (near) — drives blur-like softness and parallax */
  depth: number
}

type Particle = {
  x: number
  y: number
  r: number
  vy: number
  vx: number
  phase: number
  tw: number
  color: number
  /** depth 0 (far) .. 1 (near) */
  depth: number
}

// Depth tiers: back ribbons are wide, slow, low-alpha; front ribbons are
// tighter, faster, brighter. This creates a sense of atmosphere.
const RIBBONS: Ribbon[] = [
  { base: 0.40, amp: 90, freq: 1.15, speed: 0.14, phase: 0.0, thick: 72, colorA: 0, colorB: 1, alpha: 0.10, depth: 0.15 },
  { base: 0.44, amp: 72, freq: 1.9, speed: -0.22, phase: 1.1, thick: 46, colorA: 1, colorB: 2, alpha: 0.08, depth: 0.30 },
  { base: 0.48, amp: 88, freq: 1.05, speed: 0.16, phase: 2.2, thick: 60, colorA: 2, colorB: 0, alpha: 0.11, depth: 0.45 },
  { base: 0.50, amp: 62, freq: 1.8, speed: 0.38, phase: 0.6, thick: 10, colorA: 0, colorB: 1, alpha: 0.52, hero: true, depth: 0.9 },
  { base: 0.54, amp: 48, freq: 2.8, speed: -0.42, phase: 3.0, thick: 22, colorA: 1, colorB: 3, alpha: 0.12, depth: 0.6 },
  { base: 0.58, amp: 74, freq: 1.5, speed: -0.2, phase: 4.1, thick: 40, colorA: 2, colorB: 1, alpha: 0.11, depth: 0.35 },
  { base: 0.62, amp: 40, freq: 3.3, speed: 0.5, phase: 5.2, thick: 16, colorA: 0, colorB: 2, alpha: 0.10, depth: 0.55 },
]

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
    let particles: Particle[] = []

    // pointer state (smoothed, with velocity for inertia)
    const pointer = {
      x: 0.5,
      y: 0.5,
      tx: 0.5,
      ty: 0.5,
      vx: 0,
      vy: 0,
      energy: 0,
      active: false,
    }

    const seedParticles = () => {
      const count = Math.round(Math.min(56, Math.max(14, (w * h) / 34000)))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.1,
        vy: -(2 + Math.random() * 6),
        vx: (Math.random() - 0.5) * 6,
        phase: Math.random() * Math.PI * 2,
        tw: 0.6 + Math.random() * 1.8,
        color: Math.floor(Math.random() * palette.length),
        depth: Math.random(),
      }))
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.floor(rect.width))
      h = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seedParticles()
    }

    // ---------- layers ----------

    // Aurora: depth-layered, elliptical (not circular), with a slow hue drift
    // and a subtle vertical gradient to anchor the composition.
    const drawAurora = (t: number) => {
      const blobs = [
        { x: 0.15 + Math.sin(t * 0.07) * 0.06, y: 0.30 + Math.cos(t * 0.05) * 0.08, rx: 0.60, ry: 0.45, c: palette[0], a: 0.13, depth: 0.2 },
        { x: 0.88 + Math.cos(t * 0.06) * 0.05, y: 0.72 + Math.sin(t * 0.08) * 0.07, rx: 0.55, ry: 0.50, c: palette[2], a: 0.11, depth: 0.35 },
        { x: 0.55 + Math.sin(t * 0.04 + 2) * 0.10, y: 0.95, rx: 0.50, ry: 0.35, c: palette[1], a: 0.08, depth: 0.5 },
        { x: 0.30 + Math.cos(t * 0.035 + 1) * 0.05, y: 0.55 + Math.sin(t * 0.045) * 0.04, rx: 0.35, ry: 0.30, c: palette[3], a: 0.06, depth: 0.25 },
      ]
      if (pointer.active || pointer.energy > 0.02) {
        blobs.push({
          x: pointer.x,
          y: pointer.y,
          rx: 0.30,
          ry: 0.24,
          c: palette[1],
          a: 0.09 * pointer.energy,
          depth: 0.8,
        })
      }

      ctx.globalCompositeOperation = "lighter"
      // Draw far blobs first, near blobs last.
      const ordered = [...blobs].sort((a, b) => a.depth - b.depth)
      for (const b of ordered) {
        const cx = b.x * w
        const cy = b.y * h
        const RX = b.rx * Math.max(w, h)
        const RY = b.ry * Math.max(w, h)
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(1, RY / RX)
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, RX)
        g.addColorStop(0, hsla(b.c, b.a))
        g.addColorStop(0.55, hsla(b.c, b.a * 0.45))
        g.addColorStop(1, hsla(b.c, 0))
        ctx.fillStyle = g
        ctx.fillRect(-RX, -RX, RX * 2, RX * 2)
        ctx.restore()
      }
    }

    const waveY = (r: Ribbon, x: number, t: number, scale: number) => {
      const u = x / w
      const a = u * Math.PI * 2
      // envelope: calmer at edges, lively in the middle
      const env = 0.35 + 0.65 * Math.sin(u * Math.PI)
      let y =
        Math.sin(a * r.freq + t * r.speed * 2 + r.phase) * r.amp * scale * env +
        Math.sin(a * r.freq * 2.3 - t * r.speed * 1.3 + r.phase * 2) * r.amp * 0.16 * scale +
        Math.sin(a * 0.7 + t * 0.15 + r.phase) * 24 * scale

      // pointer: gaussian swell + gentle pull, softened by depth so far
      // ribbons react less (parallax feel)
      if (pointer.energy > 0.001) {
        const d = (u - pointer.x) / 0.18
        const bump = Math.exp(-d * d)
        const react = 0.35 + 0.65 * r.depth
        y += Math.sin(a * r.freq * 3 + t * 1.4 + r.phase) * bump * 16 * scale * pointer.energy * react
        y += (pointer.y - r.base) * h * 0.14 * bump * pointer.energy * react
      }
      return r.base * h + y
    }

    // Ribbons: depth-sorted, with per-ribbon breathing thickness, a proper
    // soft halo for the hero, and a highlight that fades at both edges.
    const drawRibbons = (time: number) => {
      const t = time * 0.65
      const scale = Math.min(1.4, Math.max(0.6, h / 900))
      const step = Math.max(4, Math.round(w / 260))
      ctx.globalCompositeOperation = "lighter"

      const ordered = [...RIBBONS].sort((a, b) => a.depth - b.depth)

      for (const r of ordered) {
        const top: number[] = []
        for (let x = 0; x <= w + step; x += step) top.push(waveY(r, x, t, scale))
        const thickAt = (i: number) =>
          r.thick * 0.65 * scale * (0.72 + 0.28 * Math.sin((i * step / w) * Math.PI * 2 + t * 0.35 + r.phase))

        const grad = ctx.createLinearGradient(0, 0, w, 0)
        const cA = palette[r.colorA]
        const cB = palette[r.colorB]
        // depth-scaled alpha so far ribbons recede
        const aMul = 0.45 + 0.55 * r.depth
        grad.addColorStop(0, hsla(cA, 0))
        grad.addColorStop(0.18, hsla(cA, r.alpha * 0.65 * aMul))
        grad.addColorStop(0.5, hsla(cB, r.alpha * 0.45 * aMul))
        grad.addColorStop(0.82, hsla(cA, r.alpha * 0.65 * aMul))
        grad.addColorStop(1, hsla(cB, 0))

        // translucent body
        ctx.beginPath()
        top.forEach((y, i) => (i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y)))
        for (let i = top.length - 1; i >= 0; i--) ctx.lineTo(i * step, top[i] + thickAt(i))
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()

        // crisp edge
        ctx.beginPath()
        top.forEach((y, i) => (i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y)))
        ctx.lineWidth = r.hero ? 1.3 : 0.6
        ctx.strokeStyle = grad
        ctx.stroke()

        if (r.hero) {
          // Layered strokes create a restrained halo without a full-canvas blur.
          ctx.save()
          ctx.lineWidth = 14
          ctx.globalAlpha = 0.05
          ctx.stroke()
          ctx.lineWidth = 7
          ctx.globalAlpha = 0.10
          ctx.stroke()
          ctx.lineWidth = 3
          ctx.globalAlpha = 0.20
          ctx.stroke()
          ctx.restore()

          // The highlight fades at both edges so its wrap is invisible.
          const cu = (t * 0.045) % 1
          const cx = cu * w
          const cy = waveY(r, cx, t, scale)
          const fade = Math.pow(Math.sin(cu * Math.PI), 2)
          const radius = 34 * scale
          const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
          cg.addColorStop(0, hsla(palette[1], 0.42 * fade))
          cg.addColorStop(0.18, hsla(palette[1], 0.16 * fade))
          cg.addColorStop(1, hsla(palette[1], 0))
          ctx.fillStyle = cg
          ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
        }
      }
    }

    // ===== EQUALIZER SKYLINE — UNCHANGED =====
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
    // ===== END EQUALIZER SKYLINE =====

    // Particles: depth-aware (size, alpha, speed scale with depth), with
    // a soft drift field so motion feels like air, not Brownian noise.
    const drawParticles = (t: number, dt: number) => {
      ctx.globalCompositeOperation = "lighter"
      for (const p of particles) {
        const dScale = 0.4 + 0.6 * p.depth
        const drift = Math.sin(t * 0.4 + p.phase) * 8 * dScale
        p.y += p.vy * dt * dScale
        p.x += (p.vx + drift) * dt * dScale

        // gentle attraction to pointer, stronger for near particles
        if (pointer.energy > 0.05) {
          const dx = pointer.x * w - p.x
          const dy = pointer.y * h - p.y
          const d2 = dx * dx + dy * dy
          const R = 240
          if (d2 < R * R) {
            const f = (1 - Math.sqrt(d2) / R) * 22 * pointer.energy * p.depth * dt
            p.x += dx * f * 0.02
            p.y += dy * f * 0.02
          }
        }
        if (p.y < -10) {
          p.y = h + 10
          p.x = Math.random() * w
        }
        if (p.x < -10) p.x = w + 10
        if (p.x > w + 10) p.x = -10

        const tw = 0.5 + 0.5 * Math.sin(t * p.tw + p.phase)
        const alpha = (0.06 + tw * 0.22) * (0.45 + 0.55 * p.depth)
        const col = palette[p.color]
        const radius = p.r * (3 + 2 * p.depth)
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
        g.addColorStop(0, hsla(col, alpha))
        g.addColorStop(0.3, hsla(col, alpha * 0.35))
        g.addColorStop(1, hsla(col, 0))
        ctx.fillStyle = g
        ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2)
      }
    }

    // Subtle color grade + vignette drawn in-canvas so edges don't clip hard.
    // This replaces the mask-only vignette with a real atmospheric falloff.
    const drawGrade = () => {
      ctx.globalCompositeOperation = "source-over"
      const g = ctx.createRadialGradient(
        w * 0.5, h * 0.5, Math.min(w, h) * 0.25,
        w * 0.5, h * 0.5, Math.max(w, h) * 0.75,
      )
      g.addColorStop(0, "rgba(0,0,0,0)")
      g.addColorStop(1, "rgba(0,0,0,0.42)")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }

    // ---------- loop ----------

    let last = 0
    let time = 0
    const frame = (now: number) => {
      if (!running) return
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
      last = now
      time += dt

      // ease pointer with velocity for subtle inertia
      const ease = Math.min(1, dt * 6)
      const prevX = pointer.x
      const prevY = pointer.y
      pointer.x += (pointer.tx - pointer.x) * ease
      pointer.y += (pointer.ty - pointer.y) * ease
      pointer.vx = (pointer.x - prevX) / Math.max(dt, 1e-3)
      pointer.vy = (pointer.y - prevY) / Math.max(dt, 1e-3)

      const target = pointer.active ? 1 : 0
      pointer.energy += (target - pointer.energy) * Math.min(1, dt * (pointer.active ? 5 : 1.8))

      render(time, dt)
      raf = requestAnimationFrame(frame)
    }

    const render = (t: number, dt: number) => {
      ctx.globalCompositeOperation = "source-over"
      ctx.clearRect(0, 0, w, h)
      drawAurora(t)
      drawRibbons(t)
      drawBars(t)
      drawParticles(t, dt)
      drawGrade()
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
      if (reduced) render(6, 0)
      else start()
    }

    resize()
    const ro = new ResizeObserver(() => {
      resize()
      if (reduced) render(6, 0)
    })
    ro.observe(canvas)

    if (reduced) render(6, 0)
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