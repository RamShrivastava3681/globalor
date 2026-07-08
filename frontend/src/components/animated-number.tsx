import { useCountUp } from "@/hooks/use-count-up";
import { fmtMoney } from "@/lib/format";

/**
 * Renders a monetary value that animates from 0 to the target amount.
 * Wraps fmtMoney() so formatting is identical to existing usage.
 */
export function AnimatedMoney({ value, duration = 800, enabled = true }: { value: number; duration?: number; enabled?: boolean }) {
  const animated = useCountUp(value, duration, enabled);
  return <>{fmtMoney(Math.round(animated))}</>;
}

/**
 * Renders any numeric value that animates from 0 to the target.
 * Applies Intl.NumberFormat with the given options.
 */
export function AnimatedNumber({
  value,
  duration = 800,
  enabled = true,
  decimals = 0,
  prefix = "",
  suffix = "",
}: {
  value: number;
  duration?: number;
  enabled?: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const animated = useCountUp(value, duration, enabled);
  const formatted = animated.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return <>{prefix}{formatted}{suffix}</>;
}
