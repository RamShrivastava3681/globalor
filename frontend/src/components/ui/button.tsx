import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-br from-[#00B8FF] to-[#0099D9] dark:from-[#38BDF8] dark:to-[#0EA5E9] text-white shadow-sm hover:shadow-md hover:from-[#0099D9] hover:to-[#0077B6] dark:hover:from-[#7DD3FC] dark:hover:to-[#38BDF8] active:shadow-sm rounded-xl",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:opacity-90 active:shadow-sm rounded-xl",
        outline:
          "border border-border bg-card shadow-sm hover:bg-accent hover:border-primary/30 text-foreground rounded-xl",
        secondary:
          "bg-secondary text-primary border border-primary/20 hover:bg-primary/15 hover:border-primary rounded-xl",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-lg",
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-xl px-8",
        icon: "h-9 w-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
