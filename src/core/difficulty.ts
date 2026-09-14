/**
 * A client-side *estimate* of task difficulty.
 *
 * The contract gets this number from validator consensus over the acceptance
 * criteria. That takes a round trip and costs gas, which makes it useless for
 * a form that re-prices as you type. So the slip shows an estimate derived
 * from signals a validator would also weigh — vagueness, hard thresholds,
 * third parties, time pressure — and says so in the interface.
 *
 * This is the one number on the quote slip that is not the contract's answer.
 * It is labelled as an estimate everywhere it appears, and `bind()` will
 * happily return a different multiplier.
 */

export interface DifficultyEstimate {
  riskMult: number;
  driver: string;
  confident: boolean;
}

const SIGNALS: Array<[RegExp, number, string]> = [
  [/\b(judge|judgement|assess|quality|reasonable|appropriate|satisfactor)/i, 60, "acceptance depends on judgement"],
  [/\b(uptime|latency|real[- ]time|live|continuous|streaming)\b/i, 45, "continuous availability requirement"],
  [/\b(third[- ]party|external|upstream|api|scrape|vendor)\b/i, 35, "upstream dependency outside the agent"],
  [/\b(99(\.\d+)?%|zero|every|all|no more than|must not)\b/i, 40, "hard threshold with no tolerance"],
  [/\b(approximately|roughly|as needed|best effort|etc\.?)\b/i, 55, "criteria left open-ended"],
];

export function estimateDifficulty(criteria: string, durationHours: number): DifficultyEstimate {
  let score = 120;
  let heaviest = 0;
  let driver = "routine work against explicit criteria";

  for (const [pattern, weight, label] of SIGNALS) {
    if (pattern.test(criteria)) {
      score += weight;
      if (weight > heaviest) {
        heaviest = weight;
        driver = label;
      }
    }
  }

  const words = criteria.trim().split(/\s+/).filter(Boolean).length;
  if (words < 20) {
    score += 50;
    if (heaviest < 50) driver = "criteria too thin to adjudicate";
  }

  if (durationHours <= 6) score += 40;
  else if (durationHours >= 72) score -= 15;

  return {
    riskMult: Math.max(100, Math.min(400, score)),
    driver,
    confident: words >= 20,
  };
}
