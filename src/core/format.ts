/** Display helpers. Every number in GenBonds is a price, so every number is tabular. */

const WEI_PER_ETH = 1_000_000_000_000_000_000n;

/** Wei to a short decimal string. No locale separators — these get compared by eye, in columns. */
export function eth(wei: bigint, dp = 3): string {
  const negative = wei < 0n;
  const value = negative ? -wei : wei;
  const whole = value / WEI_PER_ETH;
  const frac = value % WEI_PER_ETH;
  const fracStr = frac.toString().padStart(18, "0").slice(0, dp).replace(/0+$/, "");
  const body = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function toWei(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n;
  const [whole = "0", frac = ""] = trimmed.split(".");
  return BigInt(whole || "0") * WEI_PER_ETH + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

/** Basis points as a percentage, e.g. 1146 -> "11.46%". */
export function pct(bps: number, dp = 2): string {
  return `${(bps / 100).toFixed(dp)}%`;
}

export function bpsLabel(bps: number): string {
  return `${bps.toLocaleString("en-US")} bps`;
}

export function addr(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function hours(count: number): string {
  if (count < 48) return `${count}h`;
  const days = Math.round(count / 24);
  return `${days}d`;
}

export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const delta = unixSeconds - now;
  const abs = Math.abs(delta);
  const unit = abs < 3600 ? "min" : abs < 86400 ? "h" : "d";
  const size = abs < 3600 ? abs / 60 : abs < 86400 ? abs / 3600 : abs / 86400;
  const rounded = Math.max(1, Math.round(size));
  return delta >= 0 ? `in ${rounded}${unit === "min" ? "m" : unit}` : `${rounded}${unit === "min" ? "m" : unit} ago`;
}
