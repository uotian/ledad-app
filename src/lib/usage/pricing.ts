import { z } from 'zod';

const rateSchema = z.object({
  provider: z.enum(['openai', 'gemini']),
  model: z.string(),
  inputUsdPerMillion: z.number().nonnegative(),
  cachedInputUsdPerMillion: z.number().nonnegative(),
  cacheWriteUsdPerMillion: z.number().nonnegative().optional(),
  outputUsdPerMillion: z.number().nonnegative(),
  longContext: z
    .object({
      threshold: z.number().positive(),
      inputMultiplier: z.number().positive(),
      outputMultiplier: z.number().positive(),
    })
    .optional(),
  audioTokensPerSecond: z.number().positive().optional(),
  estimatedOutputTokensPerMinute: z.number().nonnegative().optional(),
  audioInputUsdPerMinute: z.number().nonnegative().optional(),
  source: z.string().url(),
});
export const pricingSnapshotSchema = z.object({
  version: z.string(),
  capturedAt: z.iso.datetime(),
  checkedOn: z.string(),
  usdToJpy: z.number().positive(),
  exchangeRateDate: z.string(),
  exchangeRateSource: z.string().url(),
  rates: z.array(rateSchema),
});
export type PricingSnapshot = z.infer<typeof pricingSnapshotSchema>;
