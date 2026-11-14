import * as React from "react"

type WaveSpec = {
  amplitude: number
  center: number
  phase: number
  cycles: number
  opacity: number
  duration: number
}

const WIDTH = 1440

// Integer frequencies repeat exactly at WIDTH, keeping the animation seamless.
const WAVES: WaveSpec[] = Array.from({ length: 9 }, (_, index) => ({
  amplitude: 30 + index * 4,
  center: 160 + index * 7,
  phase: index * 0.32,
  cycles: index < 5 ? 2 : 3,
  opacity: index === 3 ? 0.55 : 0.12 + (index % 3) * 0.06,
  duration: index < 5 ? 32 : 44,
}))

function buildWave(wave: WaveSpec) {
  const points: string[] = []
  for (let x = 0; x <= WIDTH * 2; x += 4) {
    const angle = (x / WIDTH) * Math.PI * 2
    const y = wave.center
      + Math.sin(angle * wave.cycles + wave.phase) * wave.amplitude
      + Math.sin(angle + wave.phase) * 18
    points.push(`${x === 0 ? "M" : "L"}${x},${y.toFixed(2)}`)
  }
  return points.join(" ")
}

const PATHS = WAVES.map(buildWave)

/** Decorative, gently drifting audio ribbons; hidden from assistive technology. */
export function SoundWaveBackdrop({ className }: { className?: string }) {
  const id = React.useId()
  const gradientId = `${id}-wave-color`
  const fadeId = `${id}-wave-fade`
  const maskId = `${id}-wave-mask`

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className ?? ""}`}
      style={{
        backgroundImage: "radial-gradient(ellipse at 15% 35%, hsl(var(--primary) / 0.11), transparent 50%), radial-gradient(ellipse at 90% 70%, hsl(265 85% 65% / 0.09), transparent 45%)",
      }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 400"
        preserveAspectRatio="none"
        fill="none"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="50%" stopColor="hsl(320 90% 76%)" />
            <stop offset="100%" stopColor="hsl(265 85% 70%)" />
          </linearGradient>
          <linearGradient id={fadeId}>
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="15%" stopColor="white" stopOpacity="0.85" />
            <stop offset="50%" stopColor="white" stopOpacity="0.25" />
            <stop offset="85%" stopColor="white" stopOpacity="0.85" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={maskId}>
            <rect width={WIDTH} height="400" fill={`url(#${fadeId})`} />
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          {WAVES.map((wave, index) => (
            <g
              key={index}
              className="wave-scroll"
              style={{
                "--wave-duration": `${wave.duration}s`,
                "--wave-direction": index < 5 ? "normal" : "reverse",
                "--wave-distance": `-${WIDTH}px`,
                "--wave-breathe-duration": `${10 + index * 1.3}s`,
                "--wave-breathe-delay": `${-index * 2.7}s`,
              } as React.CSSProperties}
            >
              <g className="wave-breathe">
              <path
                d={PATHS[index]}
                stroke={`url(#${gradientId})`}
                strokeWidth={index === 3 ? 1.5 : 0.8}
                strokeOpacity={wave.opacity}
                vectorEffect="non-scaling-stroke"
              />
              {index === 3 && (
                <path
                  d={PATHS[index]}
                  stroke={`url(#${gradientId})`}
                  strokeWidth="7"
                  strokeOpacity="0.035"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              </g>
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
