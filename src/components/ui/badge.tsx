import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#00B8FF]/30 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-gradient-to-br from-[#00B8FF] to-[#0099D9] text-white shadow-sm",
        secondary:
          "border-transparent bg-[#F0F9FF] text-[#00B8FF] hover:bg-[#E0F2FE]",
        destructive:
          "border-transparent bg-[#DC2626] text-white shadow-sm",
        outline: "text-[#0F172A] border-[#E2E8F0]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
