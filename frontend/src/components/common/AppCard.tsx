import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const appCardVariants = cva(
  "relative rounded-xl border text-card-foreground transition-all duration-300",
  {
    variants: {
      variant: {
        // Default surface: one step lighter than the page background
        default: "bg-card border-border",
        // Subtle top-light gradient for a more "crafted" feel
        elevated:
          "border-border bg-gradient-to-b from-secondary/60 to-card shadow-lg shadow-black/30",
        // Pink-tinted border for highlighted content
        accent:
          "bg-card border-primary/40 shadow-[0_0_30px_-12px_hsl(var(--primary)/0.5)]",
      },
      interactive: {
        true: "cursor-pointer hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.45)]",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      interactive: false,
    },
  }
)

export interface AppCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof appCardVariants> {}

const AppCard = React.forwardRef<HTMLDivElement, AppCardProps>(
  ({ className, variant, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(appCardVariants({ variant, interactive }), className)}
      {...props}
    />
  )
)
AppCard.displayName = "AppCard"

const AppCardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1.5 p-6 pb-3", className)}
    {...props}
  />
))
AppCardHeader.displayName = "AppCardHeader"

const AppCardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-lg font-semibold leading-tight tracking-tight", className)}
    {...props}
  />
))
AppCardTitle.displayName = "AppCardTitle"

const AppCardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
AppCardDescription.displayName = "AppCardDescription"

const AppCardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-3", className)} {...props} />
))
AppCardContent.displayName = "AppCardContent"

const AppCardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center gap-3 p-6 pt-0", className)}
    {...props}
  />
))
AppCardFooter.displayName = "AppCardFooter"

export {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardDescription,
  AppCardContent,
  AppCardFooter,
  appCardVariants,
}
