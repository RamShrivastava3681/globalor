import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-base text-[#0F172A] shadow-sm transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[#64748B] placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B8FF]/20 focus-visible:border-[#00B8FF] disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[#F8FAFC] md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
