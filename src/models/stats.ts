// src/models/stats.ts

import * as Schema from "@effect/schema/Schema";
// Assuming user.ts (which defines UserTierSchema) is in the same models directory
import { UserTierSchema } from "./user"; // Adjust path if needed

/**
 * Defines the structure (Schema) for the response of the /rate-limit-stats endpoint,
 * providing a snapshot of a user's current rate limit status.
 */
export const RateLimitStatsSchema = Schema.Struct({
  id: Schema.UUID.pipe(
    Schema.annotations({ description: "The ID of the user being queried" }),
  ),
  tier: UserTierSchema.pipe(
    Schema.annotations({ description: "The user's current subscription tier" }),
  ),
  limit: Schema.Number.pipe(
    Schema.annotations({ description: "The actual request limit currently applied (requests per window)" }),
  ),
  windowSeconds: Schema.Number.pipe(
    Schema.annotations({ description: "The time window (in seconds) for the applied limit" }),
  ),
  currentCount: Schema.Number.pipe(
    Schema.annotations({ description: "The current number of requests counted in the active window (from Redis)" }),
  ),
  secondsUntilReset: Schema.Number.pipe(
    Schema.annotations({
      description:
        "Approx. seconds remaining until the count resets (based on Redis TTL: -1 means no expiry, -2 means key is gone)",
    }),
  ),
  overrideActive: Schema.Boolean.pipe(
    Schema.annotations({ description: "Indicates if a rate limit override is currently active for this user" }),
  ),
}).pipe(
  Schema.annotations({
    identifier: "RateLimitStats", // Identifier for the schema itself
    description: "Snapshot of a user's current rate limit status.",
  }),
);

/**
 * The derived TypeScript type for RateLimitStats.
 * You'll use this type for variables holding the stats data in your code.
 */
export type RateLimitStats = Schema.Schema.Type<typeof RateLimitStatsSchema>;
