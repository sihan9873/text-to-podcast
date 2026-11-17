import * as React from "react"
import {
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"

/* ----------------------------------------------------------------------------
 * Types
 * -------------------------------------------------------------------------- */

export interface Mp3Track {
  src: string
  title: string
  artist?: string
}

export interface AppMp3PlayerProps {
  /** One track, or a playlist. */
  tracks: Mp3Track[]
  startIndex?: number
  /** Browsers usually block autoplay until the user has interacted with the page. */
  autoPlay?: boolean
  /**
   * "simulated" (default): the spectrum is a decorative animation.
   * "live": analyses the real audio with the Web Audio API. The file must be served
   * with CORS headers (Access-Control-Allow-Origin), otherwise it will not load.
   * Starts after the first manual press of play.
   */
  visualizer?: "simulated" | "live"
  /** "full" (default): the digital display. "compact": one slim row, no spectrum or playlist. */
  variant?: "full" | "compact"
  className?: string
  onTrackChange?: (index: number) => void
  onEnded?: () => void
}

/* ----------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

const RATES = [1, 1.25, 1.5, 2, 0.75]

function clock(sec: number, withHours = false) {
  const t = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
  const s = String(t % 60).padStart(2, "0")
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  return withHours || h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${s}`
    : `${String(Math.floor(t / 60)).padStart(2, "0")}:${s}`
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/* ----------------------------------------------------------------------------
 * Seven-segment display (pure SVG, no font needed)
 * -------------------------------------------------------------------------- */

const SEG_POINTS: Record<string, string> = {
  a: "4.5,3 7.5,0 32.5,0 35.5,3 32.5,6 7.5,6",
  b: "37,4.5 40,7.5 40,30.5 37,33.5 34,30.5 34,7.5",
  c: "37,36.5 40,39.5 40,62.5 37,65.5 34,62.5 34,39.5",
  d: "4.5,67 7.5,64 32.5,64 35.5,67 32.5,70 7.5,70",
  e: "3,36.5 6,39.5 6,62.5 3,65.5 0,62.5 0,39.5",
  f: "3,4.5 6,7.5 6,30.5 3,33.5 0,30.5 0,7.5",
  g: "4.5,35 7.5,32 32.5,32 35.5,35 32.5,38 7.5,38",
}

const DIGIT_SEGS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
}

function SegmentDigit({ char }: { char: string }) {
  const lit = DIGIT_SEGS[char] ?? ""
  return (
    <svg
      viewBox="0 0 40 70"
      className="h-full shrink-0"
      style={{ aspectRatio: "40 / 70" }}
      aria-hidden
    >
      {Object.entries(SEG_POINTS).map(([key, points]) => (
        // Unlit segments stay faintly visible, like a real LCD
        <polygon
          key={key}
          points={points}
          fill="currentColor"
          opacity={lit.includes(key) ? 1 : 0.07}
        />
      ))}
    </svg>
  )
}

function SegmentColon({ blink }: { blink: boolean }) {
  const [on, setOn] = React.useState(true)
  React.useEffect(() => {
    if (!blink || prefersReducedMotion()) {
      setOn(true)
      return
    }
    const id = setInterval(() => setOn((v) => !v), 500)
    return () => clearInterval(id)
  }, [blink])
  return (
    <svg
      viewBox="0 0 10 70"
      className="h-full shrink-0"
      style={{ aspectRatio: "10 / 70" }}
      aria-hidden
    >
      <rect x="2" y="20" width="6" height="6" fill="currentColor" opacity={on ? 1 : 0.07} />
      <rect x="2" y="44" width="6" height="6" fill="currentColor" opacity={on ? 1 : 0.07} />
    </svg>
  )
}

function SevenSegment({
  text,
  blink,
  className,
}: {
  text: string
  blink: boolean
  className?: string
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-stretch gap-1.5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.55)]",
        className,
      )}
    >
      {[...text].map((ch, i) =>
        ch === ":" ? (
          <SegmentColon key={i} blink={blink} />
        ) : (
          <SegmentDigit key={i} char={ch} />
        ),
      )}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * LED spectrum (canvas): stacked cells, peak-hold, live or simulated levels
 * -------------------------------------------------------------------------- */

const BARS = 24
const CELLS = 10

function readPrimaryColor(el: Element) {
  const raw = getComputedStyle(el).getPropertyValue("--primary").trim()
  if (!raw) return "#ff4d94"
  return /^[\d.]+\s+[\d.]+%\s+[\d.]+%/.test(raw) ? `hsl(${raw})` : raw
}

function LedSpectrum({
  playing,
  analyser,
  className,
}: {
  playing: boolean
  analyser: AnalyserNode | null
  className?: string
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  // Persist across pause/resume so bars fall smoothly instead of snapping to zero
  const levels = React.useRef(new Float32Array(BARS))
  const peaks = React.useRef(new Float32Array(BARS))

  React.useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const color = readPrimaryColor(canvas)
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const reduce = prefersReducedMotion()
    let raf = 0
    let w = 0
    let h = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      const gap = 2
      const cw = (w - gap * (BARS - 1)) / BARS
      const ch = (h - gap * (CELLS - 1)) / CELLS
      ctx.fillStyle = color
      ctx.shadowColor = color
      for (let i = 0; i < BARS; i++) {
        const lit = Math.round(levels.current[i] * CELLS)
        const peak = Math.min(CELLS - 1, Math.round(peaks.current[i] * CELLS))
        const x = i * (cw + gap)
        for (let c = 0; c < CELLS; c++) {
          const y = h - (c + 1) * ch - c * gap
          if (c < lit) {
            ctx.globalAlpha = 0.5 + (c / CELLS) * 0.5
            ctx.shadowBlur = 6
          } else if (c === peak && peak > 0 && playing) {
            ctx.globalAlpha = 1
            ctx.shadowBlur = 6
          } else {
            ctx.globalAlpha = 0.08
            ctx.shadowBlur = 0
          }
          ctx.fillRect(x, y, cw, ch)
        }
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }

    const frame = (now: number) => {
      const t = now / 1000
      let alive = false
      if (analyser && freq) analyser.getByteFrequencyData(freq)
      for (let i = 0; i < BARS; i++) {
        let target = 0
        if (playing) {
          if (analyser && freq) {
            // Log-ish spacing over the lower ~70% of the spectrum
            const usable = freq.length * 0.7
            const lo = Math.floor(Math.pow(i / BARS, 1.6) * usable)
            const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / BARS, 1.6) * usable))
            let sum = 0
            for (let k = lo; k < hi; k++) sum += freq[k]
            target = Math.min(1, (sum / (hi - lo) / 255) * 1.25)
          } else {
            const a = 0.5 + 0.5 * Math.sin(t * 2.1 + i * 0.7)
            const b = 0.5 + 0.5 * Math.sin(t * 0.9 + i * 1.9)
            target = Math.min(1, a * b * (1 - (i / BARS) * 0.45) + Math.random() * 0.12)
          }
        }
        const cur = levels.current[i]
        levels.current[i] = cur + (target - cur) * (target > cur ? 0.5 : 0.12)
        peaks.current[i] = Math.max(levels.current[i], peaks.current[i] - 0.012)
        if (levels.current[i] > 0.01 || peaks.current[i] > 0.01) alive = true
      }
      draw()
      if (playing || alive) raf = requestAnimationFrame(frame)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    if (reduce) {
      levels.current.fill(0)
      peaks.current.fill(0)
      draw()
    } else {
      raf = requestAnimationFrame(frame)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [playing, analyser])

  return <canvas ref={canvasRef} aria-hidden className={cn("block", className)} />
}

/* ----------------------------------------------------------------------------
 * Small display parts
 * -------------------------------------------------------------------------- */

function Annunciator({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] font-semibold tracking-[0.2em] transition-colors",
        on
          ? "text-primary [text-shadow:0_0_8px_hsl(var(--primary))]"
          : "text-primary/15",
      )}
    >
      {children}
    </span>
  )
}

/** One-line title; scrolls back and forth when it does not fit (a classic LCD ticker). */
function Ticker({ text, className }: { text: string; className?: string }) {
  const box = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    const b = box.current
    const s = inner.current
    if (!b || !s || prefersReducedMotion()) return
    let anim: Animation | undefined
    const start = () => {
      anim?.cancel()
      const overflow = s.scrollWidth - b.clientWidth
      if (overflow <= 0) return
      anim = s.animate(
        [{ transform: "translateX(0)" }, { transform: `translateX(-${overflow}px)` }],
        {
          duration: Math.max(4000, overflow * 40),
          delay: 1200,
          endDelay: 1200,
          iterations: Infinity,
          direction: "alternate",
          easing: "linear",
        },
      )
    }
    start()
    const ro = new ResizeObserver(start)
    ro.observe(b)
    return () => {
      anim?.cancel()
      ro.disconnect()
    }
  }, [text])

  return (
    <div ref={box} className={cn("overflow-hidden whitespace-nowrap", className)}>
      <span ref={inner} className="inline-block" title={text}>
        {text}
      </span>
    </div>
  )
}

/** LED-style bar that is also a real slider (an invisible range input sits on top). */
function SegmentedSlider({
  value,
  max,
  step,
  cells,
  label,
  valueText,
  disabled,
  onChange,
  className,
}: {
  value: number
  max: number
  step: number
  cells: number
  label: string
  valueText?: string
  disabled?: boolean
  onChange: (value: number) => void
  className?: string
}) {
  const filled = max > 0 ? Math.round((value / max) * cells) : 0
  return (
    <div
      className={cn(
        "relative h-4 rounded-sm has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring",
        disabled && "opacity-50",
        className,
      )}
    >
      <div aria-hidden className="flex h-full gap-[3px]">
        {Array.from({ length: cells }, (_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-[2px] transition-colors duration-100",
              i < filled
                ? "bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.6)]"
                : "bg-primary/10",
            )}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </div>
  )
}

const keyClass = cn(
  "inline-flex h-8 min-w-9 items-center justify-center gap-1 rounded-md border px-2",
  "font-mono text-[11px] font-semibold tracking-wider transition-all",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
)

/* ----------------------------------------------------------------------------
 * Playback state (shared by both variants)
 * -------------------------------------------------------------------------- */

type PlayerOptions = Pick<
  AppMp3PlayerProps,
  "tracks" | "startIndex" | "autoPlay" | "visualizer" | "onTrackChange" | "onEnded"
>

/** All playback state and controls, shared by both variants. */
function useMp3Player({
  tracks,
  startIndex = 0,
  autoPlay = false,
  visualizer = "simulated",
  onTrackChange,
  onEnded,
}: PlayerOptions) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const ctxRef = React.useRef<AudioContext | null>(null)
  const wantPlayRef = React.useRef(autoPlay)

  const [index, setIndex] = React.useState(startIndex)
  const [playing, setPlaying] = React.useState(false)
  const [current, setCurrent] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolume] = React.useState(0.8)
  const [muted, setMuted] = React.useState(false)
  const [rate, setRate] = React.useState(1)
  const [repeat, setRepeat] = React.useState(false)
  const [buffering, setBuffering] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null)

  const safeIndex = Math.min(Math.max(index, 0), Math.max(tracks.length - 1, 0))
  const track: Mp3Track | undefined = tracks[safeIndex]
  const multi = tracks.length > 1

  // New source (track change or parent swapped the file): reset the readout
  React.useEffect(() => {
    setCurrent(0)
    setDuration(0)
    setFailed(false)
    setBuffering(false)
  }, [track?.src])

  // Keep the element in sync (playbackRate resets when src changes, so set the default too)
  React.useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.volume = volume
    a.muted = muted
    a.defaultPlaybackRate = rate
    a.playbackRate = rate
  }, [volume, muted, rate, track?.src])

  React.useEffect(
    () => () => {
      void ctxRef.current?.close()
      ctxRef.current = null
    },
    [],
  )

  /** Created lazily inside a user gesture, so the AudioContext is allowed to start. */
  const ensureAnalyser = () => {
    if (visualizer !== "live" || ctxRef.current) return
    const a = audioRef.current
    if (!a) return
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const node = ctx.createAnalyser()
      node.fftSize = 256
      node.smoothingTimeConstant = 0.8
      ctx.createMediaElementSource(a).connect(node)
      node.connect(ctx.destination)
      ctxRef.current = ctx
      setAnalyser(node)
    } catch {
      /* keep the simulated spectrum */
    }
  }

  const play = (fromUser = false) => {
    const a = audioRef.current
    if (!a) return
    if (fromUser) ensureAnalyser()
    void ctxRef.current?.resume()
    a.play().catch(() => setPlaying(false))
  }
  const pause = () => audioRef.current?.pause()
  const toggle = () => (playing ? pause() : play(true))

  const seekTo = (t: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = t
    setCurrent(t)
  }

  const goTo = (i: number, autoplay: boolean) => {
    const next = (i + tracks.length) % tracks.length
    wantPlayRef.current = autoplay
    setIndex(next)
    onTrackChange?.(next)
  }
  const prev = () => {
    const a = audioRef.current
    if (a && (a.currentTime > 3 || !multi)) {
      seekTo(0)
      return
    }
    goTo(safeIndex - 1, playing)
  }
  const next = () => {
    if (multi) goTo(safeIndex + 1, playing)
  }

  const handleEnded = () => {
    onEnded?.()
    if (!multi) return
    if (safeIndex < tracks.length - 1) goTo(safeIndex + 1, true)
    else if (repeat) goTo(0, true)
  }

  // OS-level controls: media keys, lock screen, headset buttons
  const api = React.useRef({ play, pause, prev, next, seekTo })
  api.current = { play, pause, prev, next, seekTo }
  React.useEffect(() => {
    if (!track || !("mediaSession" in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? "",
    })
  }, [track?.title, track?.artist])
  React.useEffect(() => {
    if (!("mediaSession" in navigator)) return
    const ms = navigator.mediaSession
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, fn)
      } catch {
        /* action not supported by this browser */
      }
    }
    set("play", () => api.current.play(true))
    set("pause", () => api.current.pause())
    set("previoustrack", () => api.current.prev())
    set("nexttrack", () => api.current.next())
    set("seekto", (d) => {
      if (d.seekTime != null) api.current.seekTo(d.seekTime)
    })
    return () => {
      for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto"] as const) {
        set(a, null)
      }
    }
  }, [])
  React.useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused"
    }
  }, [playing])

  const withHours = duration >= 3600
  const elapsed = clock(current, withHours)
  const remaining = duration ? `-${clock(Math.max(duration - current, 0), withHours)}` : "--:--"
  const total = duration ? clock(duration, withHours) : "--:--"
  const status = failed ? "Error" : playing ? "Playing" : "Paused"

  // Spread onto the <audio> element rendered by whichever view is active
  const audioProps: React.AudioHTMLAttributes<HTMLAudioElement> = {
    src: track?.src,
    preload: "metadata",
    loop: repeat && !multi,
    crossOrigin: visualizer === "live" ? "anonymous" : undefined,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onPlaying: () => setBuffering(false),
    onWaiting: () => setBuffering(true),
    onCanPlay: () => {
      setBuffering(false)
      if (wantPlayRef.current) {
        wantPlayRef.current = false
        play()
      }
    },
    onLoadedMetadata: (e) => setDuration(e.currentTarget.duration),
    onDurationChange: (e) => setDuration(e.currentTarget.duration),
    onTimeUpdate: (e) => setCurrent(e.currentTarget.currentTime),
    onEnded: handleEnded,
    onError: () => {
      setFailed(true)
      setPlaying(false)
      setBuffering(false)
    },
  }

  return {
    audioRef,
    audioProps,
    tracks,
    track,
    safeIndex,
    multi,
    playing,
    current,
    duration,
    volume,
    setVolume,
    muted,
    setMuted,
    rate,
    setRate,
    repeat,
    setRepeat,
    buffering,
    failed,
    analyser,
    toggle,
    prev,
    next,
    seekTo,
    goTo,
    withHours,
    elapsed,
    remaining,
    total,
    status,
  }
}

type Mp3Player = ReturnType<typeof useMp3Player>

/* ----------------------------------------------------------------------------
 * Compact view: one slim row, no spectrum / playlist / speed / repeat
 * -------------------------------------------------------------------------- */

function CompactView({ p, className }: { p: Mp3Player; className?: string }) {
  const {
    audioRef,
    audioProps,
    track,
    multi,
    playing,
    current,
    duration,
    muted,
    setMuted,
    failed,
    toggle,
    prev,
    next,
    seekTo,
    withHours,
    elapsed,
    total,
    status,
  } = p
  if (!track) return null

  return (
    <section
      aria-label="MP3 player"
      className={cn(
        "flex items-center gap-2 rounded-xl border border-border bg-gradient-to-b from-secondary/40 to-card px-3 py-2.5 shadow-md shadow-black/20",
        className,
      )}
    >
      <audio ref={audioRef} {...audioProps} />
      <p className="sr-only" aria-live="polite">
        {status}: {track.title}
      </p>

      {multi && (
        <AppButton
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 [&_svg]:size-4"
          aria-label="Previous track"
          onClick={prev}
        >
          <SkipBack />
        </AppButton>
      )}
      <AppButton
        size="icon"
        variant="primary"
        className="size-10 shrink-0 rounded-full [&_svg]:size-4"
        aria-label={playing ? "Pause" : "Play"}
        onClick={toggle}
      >
        {playing ? <Pause /> : <Play className="translate-x-px" />}
      </AppButton>
      {multi && (
        <AppButton
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 [&_svg]:size-4"
          aria-label="Next track"
          onClick={next}
        >
          <SkipForward />
        </AppButton>
      )}

      <div className="ml-1 min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <Ticker
            text={
              failed
                ? "Can't load this audio file"
                : track.artist
                  ? `${track.title} — ${track.artist}`
                  : track.title
            }
            className={cn(
              "min-w-0 flex-1 font-mono text-xs",
              failed
                ? "text-destructive"
                : "text-primary [text-shadow:0_0_8px_hsl(var(--primary)/0.5)]",
            )}
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums tracking-wider text-primary/70">
            {elapsed}
            <span className="text-primary/30"> / </span>
            {total}
          </span>
        </div>
        <SegmentedSlider
          className="mt-1.5 h-2.5"
          cells={40}
          value={Math.min(current, duration || 0)}
          max={duration || 1}
          step={1}
          disabled={!duration || failed}
          label="Seek"
          valueText={`${clock(current, withHours)} of ${total}`}
          onChange={seekTo}
        />
      </div>

      <AppButton
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-muted-foreground [&_svg]:size-4"
        aria-pressed={muted}
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={() => setMuted((m) => !m)}
      >
        {muted ? <VolumeX /> : <Volume2 />}
      </AppButton>
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * Full view: LCD, spectrum, transport keys, playlist
 * -------------------------------------------------------------------------- */

function FullView({ p, className }: { p: Mp3Player; className?: string }) {
  const {
    audioRef,
    audioProps,
    tracks,
    track,
    safeIndex,
    multi,
    playing,
    current,
    duration,
    volume,
    setVolume,
    muted,
    setMuted,
    rate,
    setRate,
    repeat,
    setRepeat,
    buffering,
    failed,
    analyser,
    toggle,
    prev,
    next,
    seekTo,
    goTo,
    withHours,
    elapsed,
    remaining,
    total,
    status,
  } = p
  if (!track) return null

  return (
    <section
      aria-label="MP3 player"
      className={cn(
        "rounded-2xl border border-border bg-gradient-to-b from-secondary/50 to-card p-4 shadow-xl shadow-black/30 sm:p-5",
        className,
      )}
    >
      <audio ref={audioRef} {...audioProps} />

      {/* Screen reader summary (announced on state changes only) */}
      <p className="sr-only" aria-live="polite">
        {status}: {track.title}
      </p>
      <p className="sr-only">
        {clock(current, withHours)} of {total}
      </p>

      {/* LCD */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-[hsl(240_10%_5%)] p-4 shadow-[inset_0_2px_14px_rgba(0,0,0,0.85)]">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 left-1/2 h-24 w-3/4 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0, transparent 2px, rgba(0,0,0,0.28) 2px, rgba(0,0,0,0.28) 3px)",
          }}
        />

        <div className="relative space-y-3">
          {/* Annunciators */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Annunciator on={playing && !buffering && !failed}>PLAY</Annunciator>
              <Annunciator on={!playing && current > 0 && !failed}>PAUSE</Annunciator>
              <Annunciator on={buffering && !failed}>BUF</Annunciator>
              <Annunciator on={repeat}>LOOP</Annunciator>
              <Annunciator on={failed}>ERR</Annunciator>
            </div>
            <span className="font-mono text-[10px] tracking-[0.2em] text-primary/70">
              {multi
                ? `TRK ${String(safeIndex + 1).padStart(2, "0")}/${String(tracks.length).padStart(2, "0")}`
                : rate !== 1
                  ? `${rate}X`
                  : ""}
            </span>
          </div>

          {/* Time + spectrum */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <SevenSegment text={elapsed} blink={playing} className="h-14 sm:h-16" />
              <p className="font-mono text-[11px] tabular-nums tracking-wider text-primary/60">
                {remaining} <span className="text-primary/30">/</span> {total}
              </p>
            </div>
            <LedSpectrum
              playing={playing && !failed}
              analyser={analyser}
              className="h-16 w-full sm:w-56"
            />
          </div>

          {/* Title ticker */}
          <div className="border-t border-primary/10 pt-2.5 font-mono text-xs tracking-wide text-primary [text-shadow:0_0_8px_hsl(var(--primary)/0.5)]">
            <Ticker
              text={
                failed
                  ? "Can't load this audio file"
                  : track.artist
                    ? `${track.title} — ${track.artist}`
                    : track.title
              }
            />
          </div>
        </div>
      </div>

      {/* Seek */}
      <SegmentedSlider
        className="mt-4"
        cells={48}
        value={Math.min(current, duration || 0)}
        max={duration || 1}
        step={1}
        disabled={!duration || failed}
        label="Seek"
        valueText={`${clock(current, withHours)} of ${total}`}
        onChange={seekTo}
      />

      {/* Controls */}
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={repeat}
            aria-label={multi ? "Repeat playlist" : "Repeat track"}
            onClick={() => setRepeat((v) => !v)}
            className={cn(
              keyClass,
              repeat
                ? "border-primary/60 bg-primary/10 text-primary shadow-[0_0_10px_-2px_hsl(var(--primary))]"
                : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            <Repeat className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Playback speed ${rate}x, press to change`}
            onClick={() => setRate((r) => RATES[(RATES.indexOf(r) + 1) % RATES.length])}
            className={cn(
              keyClass,
              "tabular-nums",
              rate !== 1
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {rate}x
          </button>
        </div>

        <div className="flex items-center gap-2">
          <AppButton
            size="icon"
            variant="ghost"
            className="size-10 [&_svg]:size-5"
            aria-label={multi ? "Previous track" : "Restart"}
            onClick={prev}
          >
            <SkipBack />
          </AppButton>
          <AppButton
            size="icon"
            variant="primary"
            className="size-14 rounded-full [&_svg]:size-6"
            aria-label={playing ? "Pause" : "Play"}
            onClick={toggle}
          >
            {playing ? <Pause /> : <Play className="translate-x-0.5" />}
          </AppButton>
          <AppButton
            size="icon"
            variant="ghost"
            className="size-10 [&_svg]:size-5"
            aria-label="Next track"
            disabled={!multi}
            onClick={next}
          >
            <SkipForward />
          </AppButton>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            aria-pressed={muted}
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted((m) => !m)}
            className={cn(
              keyClass,
              "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {muted || volume === 0 ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </button>
          <SegmentedSlider
            className="hidden w-24 sm:block"
            cells={10}
            value={muted ? 0 : volume}
            max={1}
            step={0.05}
            label="Volume"
            valueText={`${Math.round((muted ? 0 : volume) * 100)}%`}
            onChange={(v) => {
              setVolume(v)
              setMuted(false)
            }}
          />
        </div>
      </div>

      {/* Playlist */}
      {multi && (
        <ol className="mt-4 max-h-44 divide-y divide-border overflow-y-auto overscroll-contain rounded-lg border border-border">
          {tracks.map((t, i) => {
            const active = i === safeIndex
            return (
              <li key={`${t.src}-${i}`}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => (active ? toggle() : goTo(i, true))}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "bg-primary/5" : "hover:bg-accent/40",
                  )}
                >
                  <span
                    className={cn(
                      "w-6 shrink-0 font-mono text-xs tabular-nums",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate", active && "font-medium")}>
                      {t.title}
                    </span>
                    {t.artist && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.artist}
                      </span>
                    )}
                  </span>
                  {active && playing && <Play className="size-3 shrink-0 text-primary" />}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * AppMp3Player
 * -------------------------------------------------------------------------- */

export function AppMp3Player({
  variant = "full",
  className,
  ...options
}: AppMp3PlayerProps) {
  const player = useMp3Player(options)
  return variant === "compact" ? (
    <CompactView p={player} className={className} />
  ) : (
    <FullView p={player} className={className} />
  )
}

export default AppMp3Player
