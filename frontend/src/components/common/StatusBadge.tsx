// src/components/common/StatusBadge.tsx
import * as React from "react"
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileEdit,
  Loader2,
  RotateCcw,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { AudioVersionListItem, AudioSentenceItem, CandidateStatus, ScriptStatus } from "@/api"

// ============================================================
// 状态定义
// ============================================================

/** 音频域：版本 / 句段 / 候选 */
export type AudioLikeStatus =
  | AudioVersionListItem["status"]
  | AudioSentenceItem["status"]
  | CandidateStatus
  | "not_generated"

/** 脚本域 */
export type ScriptLikeStatus = ScriptStatus

/** 通用状态：所有域并集 */
export type StatusLike = AudioLikeStatus | ScriptLikeStatus

interface StatusMeta {
  label: string
  className: string
  icon: React.ElementType
  spin?: boolean
}

// ============================================================
// 状态 → 样式映射（键为 status 值，跨域唯一）
// ============================================================

const STATUS_MAP: Record<StatusLike, StatusMeta> = {
  // ---- 脚本域 ----
  draft: {
    label: "草稿",
    className: "bg-amber-500/15 text-amber-400",
    icon: FileEdit,
  },
  confirmed: {
    label: "已确认",
    className: "bg-emerald-500/15 text-emerald-400",
    icon: CheckCircle2,
  },

  // ---- 音频域 ----
  not_generated: {
    label: "未生成",
    className: "bg-muted text-muted-foreground",
    icon: Clock,
  },
  pending: {
    label: "待生成",
    className: "bg-muted text-muted-foreground",
    icon: Clock,
  },
  queued: {
    label: "排队中",
    className: "bg-muted text-muted-foreground",
    icon: Clock,
  },
  running: {
    label: "生成中",
    className: "bg-sky-500/15 text-sky-400",
    icon: Loader2,
    spin: true,
  },
  ready: {
    label: "已完成",
    className: "bg-emerald-500/15 text-emerald-400",
    icon: CheckCircle2,
  },
  succeeded: {
    label: "成功",
    className: "bg-emerald-500/15 text-emerald-400",
    icon: CheckCircle2,
  },
  failed: {
    label: "失败",
    className: "bg-red-500/15 text-red-400",
    icon: AlertCircle,
  },
  accepted: {
    label: "已采用",
    className: "bg-emerald-500/15 text-emerald-400",
    icon: CheckCircle2,
  },
  discarded: {
    label: "已保留原片段",
    className: "bg-muted text-muted-foreground",
    icon: RotateCcw,
  },
}

/** 未知状态兜底 */
const FALLBACK_META: StatusMeta = {
  label: "未知状态",
  className: "bg-muted text-muted-foreground",
  icon: AlertCircle,
}

// ============================================================
// 尺寸
// ============================================================

const SIZE_MAP = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
} as const

const ICON_SIZE_MAP = {
  sm: "size-3",
  md: "size-3.5",
} as const

// ============================================================
// 组件
// ============================================================

export interface StatusBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  status: StatusLike | (string & {}) // 允许后端扩展值，未命中时走兜底
  size?: keyof typeof SIZE_MAP
  showIcon?: boolean
  /** 自定义文案，覆盖默认 label */
  label?: React.ReactNode
}

export function StatusBadge({
  status,
  size = "sm",
  showIcon = true,
  label,
  className,
  ...rest
}: StatusBadgeProps) {
  const meta = Object.prototype.hasOwnProperty.call(STATUS_MAP, status)
    ? STATUS_MAP[status as StatusLike]
    : FALLBACK_META
  const Icon = meta.icon
  const text = label ?? meta.label

  return (
    <span
      role="status"
      aria-label={typeof text === "string" ? text : undefined}
      title={typeof text === "string" ? text : undefined}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium",
        SIZE_MAP[size],
        meta.className,
        className,
      )}
      {...rest}
    >
      {showIcon && (
        <Icon
          aria-hidden
          className={cn(ICON_SIZE_MAP[size], meta.spin && "animate-spin")}
        />
      )}
      {text}
    </span>
  )
}

// 语义化别名，调用方可按域命名，实际实现共享
export const AudioStatusBadge = StatusBadge
export const ScriptStatusBadge = StatusBadge

export default StatusBadge
