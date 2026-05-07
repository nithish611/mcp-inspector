import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.9)] hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-[0_8px_20px_-12px_hsl(var(--destructive)/0.8)] hover:bg-destructive/90',
        outline: 'border border-input bg-background/80 hover:bg-accent/70 hover:text-accent-foreground',
        secondary: 'bg-secondary/90 text-secondary-foreground hover:bg-secondary',
        ghost: 'hover:bg-accent/60 hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        panel: 'border border-border/70 bg-card/85 text-foreground shadow-sm hover:bg-card',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
