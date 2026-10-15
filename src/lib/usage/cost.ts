import type { PricingSnapshot } from './pricing';

export type ProviderCost = { yen: number | null; incomplete: boolean };
export type MeetingCost = {
  pricing: PricingSnapshot | null;
  openai: ProviderCost;
  gemini: ProviderCost;
};
