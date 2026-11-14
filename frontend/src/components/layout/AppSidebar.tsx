import * as React from "react"
import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  LayoutDashboard,
  Plus,
  Loader2,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"

export interface AppSidebarItem {
  label: string
  href: string
  icon?: LucideIcon
  /** Small count/label shown on the right (hidden when collapsed). */
  badge?: string | number
  badgeLabel?: string
}

export interface AppSidebarSection {
  showCreateProject?: boolean
  title?: string
  href?: string
  items: AppSidebarItem[]
}

const defaultSections: AppSidebarSection[] = [
  {
    title: "Workspace",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Projects", href: "/projects", icon: FolderKanban, badge: 4 },
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
      { label: "Team", href: "/team", icon: Users },
    ],
  },
  {
    title: "Account",
    items: [{ label: "Settings", href: "/settings", icon: Settings }],
  },
]

export interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  sections?: AppSidebarSection[]
  /** Current location, e.g. `location.pathname`. Matches by exact path or prefix. */
  activePath?: string
  /**
   * Router-agnostic navigation. Pass your router's navigate function, e.g.
   * `onNavigate={(href) => navigate(href)}`. Without it, links behave as
   * normal anchors.
   */
  onNavigate?: (href: string) => void
  /** Desktop: collapse to an icon rail. */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** Mobile: whether the drawer is open. Ignored on lg+. */
  open?: boolean
  onClose?: () => void
  /** Brand name shown at the top. */
  brand?: string
  onCreateProject?: () => void | Promise<void>
  creatingProject?: boolean
}

function isActive(activePath: string | undefined, href: string) {
  if (!activePath) return false
  if (href === "/") return activePath === "/"
  return activePath === href || activePath.startsWith(href + "/")
}

const AppSidebar = React.forwardRef<HTMLElement, AppSidebarProps>(
  (
    {
      className,
      sections = defaultSections,
      activePath,
      onNavigate,
      collapsed = false,
      onCollapsedChange,
      open = false,
      onClose,
      brand = "Studio",
      onCreateProject,
      creatingProject = false,
      ...props
    },
    ref
  ) => {
    // Close the mobile drawer with Escape.
    React.useEffect(() => {
      if (!open) return
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.()
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }, [open, onClose])

    // Labels hide only on desktop when collapsed; the mobile drawer is always full width.
    const hideWhenCollapsed = collapsed && "lg:hidden"

    return (
      <>
        {/* Mobile backdrop */}
        <div
          aria-hidden="true"
          onClick={onClose}
          className={cn(
            "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
            open ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        />

        <aside
          ref={ref}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex h-dvh min-h-0 w-64 flex-col overflow-hidden border-r border-border bg-card",
            "transition-[transform,width] duration-300 ease-out",
            "lg:static lg:z-20 lg:shrink-0 lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
            collapsed && "lg:w-[72px]",
            className
          )}
          {...props}
        >
          {/* Brand */}
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-[0_0_16px_-4px_hsl(var(--primary))]">
                {brand[0]}
              </span>
              <span
                className={cn(
                  "truncate text-base font-semibold tracking-tight",
                  hideWhenCollapsed
                )}
              >
                {brand}
                <span aria-hidden="true" className="text-primary">.</span>
              </span>
            </div>
            <AppButton
              variant="ghost"
              size="icon"
              className="size-8 lg:hidden"
              aria-label="Close menu"
              onClick={onClose}
            >
              <X />
            </AppButton>
          </div>

          {/* Navigation */}
          <nav
            aria-label="Main"
            className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-5"
          >
            {sections.map((section, i) => (
              <div key={section.title ?? i} className="space-y-1">
                {(section.title || (section.showCreateProject && onCreateProject)) && (
                  <div className={cn('flex items-center justify-between gap-2 px-3 pb-1', collapsed && 'lg:justify-center lg:px-0')}>
                    {section.title && (section.href ? (
                      <a
                        href={section.href}
                        aria-current={activePath === section.href ? "page" : undefined}
                        onClick={(e) => {
                          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                          if (onNavigate) {
                            e.preventDefault()
                            onNavigate(section.href!)
                          }
                          onClose?.()
                        }}
                        className={cn(
                          'rounded-sm text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          hideWhenCollapsed,
                        )}
                      >
                        {section.title}
                      </a>
                    ) : <p className={cn('text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70', hideWhenCollapsed)}>{section.title}</p>)}
                    {section.showCreateProject && onCreateProject && (
                      <AppButton
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={creatingProject ? '正在创建项目' : '新建项目'}
                        title="新建项目"
                        disabled={creatingProject}
                        onClick={async () => {
                          await onCreateProject()
                          onClose?.()
                        }}
                      >
                        {creatingProject ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                      </AppButton>
                    )}
                  </div>
                )}
                {section.items.map((item) => {
                  const active = isActive(activePath, item.href)
                  const Icon = item.icon
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      onClick={(e) => {
                        if (onNavigate) {
                          e.preventDefault()
                          onNavigate(item.href)
                        }
                        onClose?.()
                      }}
                      className={cn(
                        "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium",
                        "transition-colors duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        collapsed && "lg:justify-center lg:px-0",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      {/* Active indicator bar */}
                      <span
                        className={cn(
                          "absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-primary",
                          "shadow-[0_0_10px_hsl(var(--primary))] transition-opacity",
                          active ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {Icon && (
                        <Icon
                          className={cn(
                            "size-[18px] shrink-0 transition-colors",
                            active
                              ? "text-primary"
                              : "group-hover:text-foreground"
                          )}
                        />
                      )}
                      <span className={cn("flex-1 truncate", hideWhenCollapsed)}>
                        {item.label}
                      </span>
                      {item.badge !== undefined && (
                        <span
                          title={item.badgeLabel}
                          aria-label={item.badgeLabel}
                          className={cn(
                            "rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary",
                            hideWhenCollapsed
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </a>
                  )
                })}
              </div>
            ))}
          </nav>

          {/* Collapse toggle (desktop only) */}
          <div className="hidden shrink-0 border-t border-border p-3 lg:block">
            <AppButton
              variant="ghost"
              size="sm"
              className={cn("w-full", collapsed ? "justify-center" : "justify-start")}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => onCollapsedChange?.(!collapsed)}
            >
              {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
              {!collapsed && <span>Collapse</span>}
            </AppButton>
          </div>
        </aside>
      </>
    )
  }
)
AppSidebar.displayName = "AppSidebar"

export { AppSidebar }
