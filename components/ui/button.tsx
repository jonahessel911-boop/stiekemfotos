import * as React from "react"
import { cn } from "@/lib/utils"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "accent" | "outline" | "ghost"
  size?: "default" | "sm" | "lg"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center whitespace-nowrap rounded text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50"

    const variants = {
      default: "platform-btn platform-btn-primary",
      accent: "platform-btn platform-btn-primary",
      outline: "platform-btn platform-btn-secondary",
      ghost: "hover:bg-gray-100 text-gray-600",
    }

    const sizes = {
      default: "h-11 px-8",
      sm: "h-9 px-4 text-xs",
      lg: "h-12 px-10 text-base",
    }

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }

