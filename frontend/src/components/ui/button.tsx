import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B8FF]/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-br from-[#00B8FF] to-[#0099D9] text-white shadow-sm hover:shadow-md hover:from-[#0099D9] hover:to-[#0077B6] active:shadow-sm rounded-xl",
        destructive:
          "bg-[#DC2626] text-white shadow-sm hover:bg-[#B91C1C] active:shadow-sm rounded-xl",
        outline:
          "border border-[#E2E8F0] bg-white shadow-sm hover:bg-[#F8FAFC] hover:border-[#CBD5E1] text-[#0F172A] rounded-xl",
        secondary:
          "bg-[#F0F9FF] text-[#00B8FF] border border-[#BFDBFE] hover:bg-[#E0F2FE] hover:border-[#00B8FF] rounded-xl",
        ghost:
          "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] rounded-lg",
        link:
          "text-[#00B8FF] underline-offset-4 hover:underline",
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
