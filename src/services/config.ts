// src/services/config.ts - Simplified Version with Hardcoded Values

import { Context, Data, Layer } from "effect";
// Import the Schema-derived type and the specific tier schema
import type { RateLimitConfig } from "../models/config";

export class RateLimitConfigError extends Data.TaggedError("RateLimitConfigError")<{
  readonly reason: string;
}> {}

// --- Define Service Tag ---
// Defines the Tag for the configuration service. It expects a service of type RateLimitConfig.
export class RateLimitConfigService
  extends Context.Tag("RateLimitConfigService")<RateLimitConfigService, RateLimitConfig>()
{}

const rateLimitConfigData: RateLimitConfig = {
  free: { requests: 10, windowSeconds: 60 },
  premium: { requests: 100, windowSeconds: 60 },
};

export const RateLimitConfigLayer = Layer.succeed(
  RateLimitConfigService,
  rateLimitConfigData,
);
