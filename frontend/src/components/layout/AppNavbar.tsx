import * as React from "react"
import { Bell, Menu, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"

export interface AppNavbarUser {
  name: string
  /** Optional avatar image URL; falls back to initials. */
  avatarUrl?: string
}

export interface AppNavbarProps extends React.HTMLAttributes<HTMLElement> {
  /** Brand / page title shown on the left. */
  title?: string
  /** Opens the mobile sidebar drawer. The menu button is hidden on lg+. */
  onMenuClick?: () => void
  /** Shows a pink dot on the bell when true. */
  hasNotifications?: boolean
  onNotificationsClick?: () => void
  /** Called with the search text when the user presses Enter. */
  onSearch?: (query: string) => void
  user?: AppNavbarUser
  onUserClick?: () => void
  /** Extra actions rendered before the bell, e.g. a primary "New" button. */
  actions?: React.ReactNode
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

const AppNavbar = React.forwardRef<HTMLElement, AppNavbarProps>(
  (
    {
      className,
      title = "AIVoice",
      onMenuClick,
      hasNotifications = false,
      onNotificationsClick,
      onSearch,
      user,
      onUserClick,
      actions,
      ...props
    },
    ref
  ) => {
    const [query, setQuery] = React.useState("")

    return (
      <header
        ref={ref}
        className={cn(
          "sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border",
          "bg-background/75 px-4 backdrop-blur-md md:px-6",
          className
        )}
        {...props}
      >
        <AppButton
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open menu"
          onClick={onMenuClick}
        >
          <Menu />
        </AppButton>

        <span className="text-base font-semibold tracking-tight">
          {title}
          <span className="text-primary">.</span>
        </span>

        {/* Search */}
        <form
          role="search"
          className="mx-auto hidden w-full max-w-md md:block"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch?.(query.trim())
          }}
        >
          <label className="relative block">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className={cn(
                "h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm",
                "placeholder:text-muted-foreground transition-colors",
                "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              )}
            />
          </label>
        </form>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {actions}

          <AppButton
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
            onClick={onNotificationsClick}
          >
            <Bell />
            {hasNotifications && (
              <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
            )}
          </AppButton>

          {user && (
            <button
              type="button"
              onClick={onUserClick}
              aria-label={`Account: ${user.name}`}
              className={cn(
                "ml-1 flex size-9 items-center justify-center overflow-hidden rounded-full",
                "border border-border bg-secondary text-xs font-semibold text-secondary-foreground",
                "transition-all hover:border-primary/60 hover:shadow-[0_0_14px_-4px_hsl(var(--primary))]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                initials(user.name)
              )}
            </button>
          )}
        </div>
      </header>
    )
  }
)
AppNavbar.displayName = "AppNavbar"

export { AppNavbar }
