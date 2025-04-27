import * as Schema from "@effect/schema/Schema";
import type { Brand } from "effect"; // Optional: For branded types

/**
 * Schema definition for the possible user tiers.
 * Ensures the tier is one of the allowed literal string values.
 */
export const UserTierSchema = Schema.Union(
  Schema.Literal("free"),
  Schema.Literal("premium"),
);

/**
 * TypeScript type derived from the UserTierSchema.
 * Provides static type checking for user tiers.
 */
export type UserTier = Schema.Schema.Type<typeof UserTierSchema>;

/**
 * Schema definition for the User entity.
 * Includes runtime validation for types (e.g., UUID for id, specific tiers, date strings).
 */
export const UserSchema = Schema.Struct({
  id: Schema.UUID.pipe(
    Schema.annotations({ description: "Unique user identifier (UUID)" }),
  ),
  tier: UserTierSchema,
  created_at: Schema.DateFromString.pipe(
    Schema.annotations({ description: "User creation timestamp" }),
  ),
  updated_at: Schema.DateFromString.pipe(
    Schema.annotations({ description: "User last update timestamp" }),
  ),
  override_limit_requests: Schema.optionalWith(Schema.Number, { nullable: true }),
  override_limit_window_seconds: Schema.optionalWith(Schema.Number, { nullable: true }),
  override_limit_expiry: Schema.optionalWith(Schema.DateFromString, { nullable: true }),
}).pipe(
  Schema.annotations({
    identifier: "User",
    description: "Represents a user account in the system.",
  }),
);

/**
 * TypeScript type derived from the UserSchema.
 * This is the primary type you'll use for user objects in your application code.
 * It represents the *decoded* form (e.g., `id` is string, `tier` is 'free'|'premium', `created_at` is Date).
 */
export type User = Schema.Schema.Type<typeof UserSchema>;

/**
 * Optional: Define a branded type for UserId for enhanced type safety.
 * This helps prevent accidentally using any string where a UserId is expected.
 */
export type UserId = Brand.Branded<Schema.UUID, "UserId">;
