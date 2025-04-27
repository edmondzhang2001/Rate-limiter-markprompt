/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema } from "effect";
import { Api, QuerySchema } from "effect-http";
import { UserTierSchema } from "../models/user";

const HttpErrorBodySchema = Schema.Struct({
  error: Schema.String, // Simple error message
}).pipe(
  Schema.annotations({ identifier: "HttpErrorBody" }),
);

const GetStatsQuerySchema = Schema.Struct({
  userId: Schema.UUID // Use Schema.String if the ID isn't always a UUID
    .pipe(
      Schema.annotations({ description: "ID of the user to fetch stats for" }),
    ),
});

const GetUserIdQuerySchema = Schema.Struct({
  userId: Schema.UUID,
});

const CheckSuccessResponseSchema = Schema.Struct({
    statusCode: Schema.Number,
    status: Schema.String,
    RetryAfter: Schema.optionalWith(Schema.String, { nullable: true }),
  });

const RateLimitStatsSchema = Schema.Struct({
  userId: Schema.UUID.pipe(
    Schema.annotations({ description: "The ID of the user being queried" }),
  ),
  tier: Schema.String.pipe(
    Schema.annotations({ description: "The user's current subscription tier (string)" }),
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

const getStatsEndpoint = Api.get("getRateLimitStats", "/rate-limit-stats")
  .pipe(
    // Define Request
    Api.setRequestQuery(GetStatsQuerySchema),
    Api.setResponseBody(RateLimitStatsSchema),
    Api.addResponse({
      status: 400, // Bad Request
      body: HttpErrorBodySchema, 
    }),
    Api.addResponse({
      status: 404, // Not Found
      body: HttpErrorBodySchema,
    }),
    Api.addResponse({
      status: 500,
      body: HttpErrorBodySchema,
    }),
  );

const checkRateLimitEndpoint = Api.get("checkRateLimit", "/api/check") // New endpoint
  .pipe(
    Api.setRequestQuery(GetUserIdQuerySchema), // Takes userId query param
    Api.setResponseBody(CheckSuccessResponseSchema), // Success response (200 OK)
    Api.addResponse({ // Rate limited response
      status: 429,
      headers: Schema.Struct({ "Retry-After": Schema.String }),
      description: "Rate limit exceeded",
    }),
    Api.addResponse({ // User not found
      status: 404,
      body: HttpErrorBodySchema,
      description: "User not found",
    }),
    Api.addResponse({ // Other server errors
      status: 500,
      body: HttpErrorBodySchema,
      description: "Internal server error",
    }),
  );

// --- Build the API ---
const baseApi = Api.make({ title: "Rate Limiter API" });
const rateLimiterApi = baseApi.pipe(
  Api.addEndpoint(getStatsEndpoint),
  Api.addEndpoint(checkRateLimitEndpoint),
);

const UpdateUserRateLimitBodySchema = Schema.Struct({
      override_limit_requests: Schema.optionalWith(Schema.Number, { nullable: true }),
      override_limit_window_seconds: Schema.optionalWith(Schema.Number, { nullable: true }),
      override_limit_expiry: Schema.optionalWith(Schema.DateFromString, { nullable: true }),
  });
  
  // Schema for the successful response
  const UpdateUserRateLimitResponseSchema = Schema.Struct({
    success: Schema.Boolean.pipe(
      Schema.annotations({ description: "Indicates the update was successful" })
    ),
    userId: Schema.UUID.pipe(
      Schema.annotations({ description: "The ID of the updated user" })
    ),
    updated: Schema.Struct({
      override_limit_requests: Schema.optionalWith(Schema.Number, { nullable: true }),
      override_limit_window_seconds: Schema.optionalWith(Schema.Number, { nullable: true }),
      override_limit_expiry: Schema.optionalWith(Schema.DateFromString, { nullable: true }),
    }).pipe(
      Schema.annotations({ description: "The updated override values" })
    ),
  });
  
  // Define the endpoint
  const updateUserRateLimitEndpoint = Api.put("updateUserRateLimit", "/users/:userId/rate-limits")
    .pipe(
      // Define request parameters
      Api.setRequestPath(Schema.Struct({
        userId: Schema.UUID.pipe(
          Schema.annotations({ description: "ID of the user to update" })
        ),
      })),
      // Define request body
      Api.setRequestBody(UpdateUserRateLimitBodySchema),
      // Define success response
      Api.setResponseBody(UpdateUserRateLimitResponseSchema),
      // Define error responses
      Api.addResponse({
        status: 400,
        body: HttpErrorBodySchema,
        description: "Client error: Invalid request parameters.",
      }),
      Api.addResponse({
        status: 404,
        body: HttpErrorBodySchema,
        description: "User with the specified ID was not found.",
      }),
      Api.addResponse({
        status: 500,
        body: HttpErrorBodySchema,
        description: "Server error: An internal error occurred.",
      }),
    );

// --- Export ---
// Export both the full API and the specific endpoint definition
// The handler in index.ts needs the specific endpoint (getStatsEndpoint) for Handler.make
export { checkRateLimitEndpoint, getStatsEndpoint, rateLimiterApi, updateUserRateLimitEndpoint };
