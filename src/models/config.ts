// src/models/config.ts

import * as Schema from "@effect/schema/Schema";
// Assuming user.ts (which defines UserTierSchema) is in the same models directory
import { UserTierSchema } from "./user";

/**
 * Defines the rate limit parameters for a specific tier.
 * e.g., { requests: 100, windowSeconds: 3600 }
 */
export const TierRateLimitSchema = Schema.Struct({
  requests: Schema.Number,
  windowSeconds: Schema.Number,
});

// Derives the TypeScript type: { readonly requests: number; readonly windowSeconds: number }
export type TierRateLimit = Schema.Schema.Type<typeof TierRateLimitSchema>;

/**
 * Defines the overall rate limit configuration structure.
 * It expects a record (object) where keys are valid UserTiers ('free', 'premium')
 * and values conform to the TierRateLimitSchema.
 * e.g., { free: { requests: 10, windowSeconds: 60 }, premium: { ... } }
 */
export const RateLimitConfigSchema = Schema.Record({
  key: UserTierSchema,
  value: TierRateLimitSchema,
});

// Derives the TypeScript type: { readonly free: TierRateLimit; readonly premium: TierRateLimit; ... }
export type RateLimitConfig = Schema.Schema.Type<typeof RateLimitConfigSchema>;
