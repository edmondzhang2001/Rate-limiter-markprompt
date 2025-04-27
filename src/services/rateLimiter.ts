/* eslint-disable @typescript-eslint/no-empty-object-type */
// src/services/rateLimiter.ts - Simplified Version (Tier-based Only)

import { Data, Effect, Number } from "effect";
// Adjust paths as needed
import type { User } from "../models/user"; // Make sure User type has at least 'id' and 'tier'
import { RateLimitConfigError, RateLimitConfigService } from "./config";
import { RedisError, RedisService } from "./redis";

// --- Define Rate Limit Status ADT ---
// (Using Data.TaggedClass for better structure)
export type RateLimitStatus = Allowed | RateLimited;
export class Allowed extends Data.TaggedClass("Allowed")<{}> {}
export class RateLimited extends Data.TaggedClass("RateLimited")<{
  readonly retryAfterSeconds: number;
}> {}

// --- Lua Script for Atomic INCR + EXPIRE ---
// (This remains the same - crucial for atomicity)
const incrWithExpireScript = `
  local current_count = redis.call('INCR', KEYS[1])
  if tonumber(current_count) == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current_count
`;


/**
 * Checks if a request for the given user should be allowed based *only* on their tier's rate limit.
 * Requires RedisService, RateLimitConfigService, and Clock in the Effect Context.
 * Uses a Lua script for atomic Redis operations.
 *
 * @param user The authenticated user object (must contain id and tier).
 * @returns Effect resolving to Allowed or RateLimited status, failing with RedisError or RateLimitConfigError.
 */
export const checkRateLimit = (
  user: User,
): Effect.Effect<
  RateLimitStatus,
  RedisError | RateLimitConfigError, // Potential failure types
  RedisService | RateLimitConfigService
> =>
  Effect.gen(function*(_) {
    // 1. Get Dependencies
    const config = yield* _(RateLimitConfigService);
    const redis = yield* _(RedisService);
    const nowMillis = Date.now(); // Or yield* Clock.currentTimeMillis if using Clock service

    // --- Determine Applicable Limit ---
    let effectiveLimit: number;
    let effectiveWindowSeconds: number;

    // Check if ALL required override fields are present AND expiry is valid
    if (
      user.override_limit_requests != null // Check requests override exists
      && user.override_limit_window_seconds != null // Check window override exists
      && user.override_limit_expiry != null // Check expiry override exists
      && user.override_limit_expiry.getTime() > nowMillis // IMPORTANT: Check expiry > now
    ) {
      // --- Use Active Override ---
      effectiveLimit = user.override_limit_requests;
      effectiveWindowSeconds = user.override_limit_window_seconds;
      yield* _(
        Effect.logDebug(
          `User ${user.id}: Using ACTIVE override limit (${effectiveLimit}/${effectiveWindowSeconds}s). Expiry: ${user.override_limit_expiry.toISOString()}`,
        ),
      );
    } else {
      // --- Use Tier Limit ---
      // Optional logging if an override was present but expired/incomplete
      if (user.override_limit_expiry && user.override_limit_expiry.getTime() <= nowMillis) {
        yield* _(
          Effect.logDebug(
            `User ${user.id}: Override found but EXPIRED at ${user.override_limit_expiry.toISOString()}. Using tier limit.`,
          ),
        );
      } else if (
        user.override_limit_requests != null || user.override_limit_window_seconds != null
        || user.override_limit_expiry != null
      ) {
        // This case means some override fields were set, but not all needed for it to be active
        yield* _(Effect.logDebug(`User ${user.id}: Incomplete or non-expiring override found, using tier limit.`));
      }

      // Get limits from the configuration based on the user's tier
      const tierConfig = config[user.tier];
      if (!tierConfig) {
        const reason = `Config missing for tier ${user.tier}`;
        yield* _(Effect.logError(`Rate limit ${reason} for User ${user.id}`));
        // Ensure correct property name ('cause' likely)
        return yield* _(new RateLimitConfigError({ reason }));
      }
      effectiveLimit = tierConfig.requests;
      effectiveWindowSeconds = tierConfig.windowSeconds;
      yield* _(
        Effect.logDebug(
          `User ${user.id}: Using tier '${user.tier}' limit (${effectiveLimit}/${effectiveWindowSeconds}s).`,
        ),
      );
    }

    const limit = effectiveLimit;
    const windowSeconds = effectiveWindowSeconds;

    if (windowSeconds <= 0) {
      const reason = `Invalid windowSeconds: ${windowSeconds}`;
      yield* _(
        Effect.logError(
          `Invalid windowSeconds (${windowSeconds}) defined for user ${user.id} (limit: ${limit})`,
        ),
      );
      return yield* _(new RateLimitConfigError({ reason }));
    }

    const nowSeconds = Math.floor(nowMillis / 1000);
    const windowStartSeconds = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
    const redisKey = `rate_limit:${user.id}:${windowStartSeconds}`;

    // 5. Redis Interaction (Atomic)
    const evalResult = yield* _(
      redis.eval(
        incrWithExpireScript,
        [redisKey], // KEYS array
        [windowSeconds.toString()], // ARGV array
      ),
    );

    if (!Number.isNumber(evalResult)) {
      const reason = `Unexpected non-number result type from Redis EVAL: ${typeof evalResult}`;
      yield* _(
        Effect.logError(reason, { result: evalResult, key: redisKey }),
      );

      return yield* _(new RedisError({ cause: reason }));
    }

    const currentCount: number = evalResult;

    if (currentCount > limit) {
      // Rate Limit Exceeded
      yield* _(
        Effect.logWarning(
          `User ${user.id}: Rate limit EXCEEDED (${currentCount}/${limit}) [Key: ${redisKey}]`,
        ),
      );
      const ttl = yield* _(redis.ttl(redisKey));
      const retryAfter = ttl >= 0 ? ttl : windowSeconds;

      yield* _(
        Effect.logDebug(
          `User ${user.id}: TTL check for ${redisKey} returned ${ttl}, setting Retry-After to ${retryAfter}s.`,
        ),
      );
      return new RateLimited({ retryAfterSeconds: retryAfter });
    } else {
      yield* _(
        Effect.logDebug(
          `User ${user.id}: Rate limit check passed (${currentCount}/${limit}) [Key: ${redisKey}]`,
        ),
      );
      return new Allowed();
    }
  });
