import { cn } from "@/lib/utils"

/**
 * 角色配色：按角色顺序循环取色（第一个角色用主题粉色）。
 * 脚本页、音频页、角色模板页共用。
 * 脚本和音频按角色顺序配色，角色模板按名称固定配色。
 */
export const ROLE_TONES = [
  { avatar: "bg-primary/15 text-primary ring-primary/30", text: "text-primary" },
  { avatar: "bg-violet-500/15 text-violet-300 ring-violet-400/30", text: "text-violet-300" },
  { avatar: "bg-sky-500/15 text-sky-300 ring-sky-400/30", text: "text-sky-300" },
  { avatar: "bg-amber-500/15 text-amber-300 ring-amber-400/30", text: "text-amber-300" },
  { avatar: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30", text: "text-emerald-300" },
  { avatar: "bg-orange-500/15 text-orange-300 ring-orange-400/30", text: "text-orange-300" },
]

export const roleTone = (index: number) =>
  ROLE_TONES[Math.max(index, 0) % ROLE_TONES.length]

/** 没有角色顺序可参考时，按名字取稳定的配色序号 */
export function hashToneIndex(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return h % ROLE_TONES.length
}

const SIZES = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const

export function RoleAvatar({
  name,
  toneIndex = 0,
  size = "md",
  className,
}: {
  name?: string
  toneIndex?: number
  size?: keyof typeof SIZES
  className?: string
}) {
  const displayName = name?.trim()
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-1",
        SIZES[size],
        displayName
          ? roleTone(toneIndex).avatar
          : "bg-secondary text-muted-foreground ring-border",
        className,
      )}
    >
      {displayName ? ([...displayName][0] ?? "?") : "?"}
    </span>
  )
}
