import { NodeRuntime } from "@effect/platform-node";
import * as Http from "@effect/platform/HttpServer";
import * as dotenv from "dotenv";
import { Data, Effect, Layer, Option, pipe } from "effect";
import { Api, Handler, RouterBuilder } from "effect-http";
import { NodeServer } from "effect-http-node";


import {
  checkRateLimitEndpoint, // Import the new endpoint spec
  getStatsEndpoint, // Keep if still needed
  updateUserRateLimitEndpoint,
  rateLimiterApi,
} from "./routes/statsRoutes"; // Adjust path: Assuming specs are now in src/api/specs.ts

// 2. Import Services & Layers needed
import { RateLimitConfigError, RateLimitConfigLayer, RateLimitConfigService } from "./services/config";
import type { RedisError } from "./services/redis";
import { RedisLayer, RedisService } from "./services/redis";
import { SupabaseClientService, SupabaseLayer } from "./services/supabase";
// Import the Rate Limiter logic and types
import { Allowed, checkRateLimit, RateLimited, RateLimitStatus } from "./services/rateLimiter";
// Import User type
import type { User } from "./models/user";
// Import Response types (optional)
import type { RateLimitStats } from "./models/stats";

dotenv.config();

// --- Define Local Errors ---
// (These might duplicate ones in statsService, ok for isolated test)
class SupabaseError extends Data.TaggedError("SupabaseError")<{ error: unknown }> {}
class NotFoundError extends Data.TaggedError("NotFoundError")<{ message: string }> {}
type CombinedHandlerError = SupabaseError | NotFoundError | RedisError | RateLimitConfigError;

// Define subset of User type returned by the query
type FetchedUserData = Pick<
  User,
  "id" | "tier" | "override_limit_requests" | "override_limit_window_seconds" | "override_limit_expiry"
>;

// --- Define Handler performing combined Supabase + Redis logic ---
const testCombinedLogicHandler = Handler.make(
  getStatsEndpoint, // Using the spec that expects RateLimitStats response
  ({ query }: { query: { userId: string } }) =>
    // This Effect requires Supabase, Redis, and Config services
    Effect.gen(function*(_) {
      yield* _(Effect.logInfo(`HANDLER: Testing Combined Logic for userId: ${query.userId}`));
      // 1. Get Dependencies
      const supabase = yield* _(SupabaseClientService);
      const redis = yield* _(RedisService);
      const config = yield* _(RateLimitConfigService);
      const nowMillis = Date.now();

      // 2. Fetch User from Supabase
      yield* _(Effect.logDebug(`HANDLER: Attempting Supabase query...`));
      const queryEffect = Effect.tryPromise({
        try: () => supabase.from("users")
          .select("id, tier, override_limit_requests, override_limit_window_seconds, override_limit_expiry")
          .eq("id", query.userId)
          .maybeSingle(),
        catch: (e) => new SupabaseError({ error: e })
      });
      const result = yield* _(queryEffect); // Type: { data: FetchedUserData | null, error: PgError | null }
      const { data: userData, error: userError } = result;

      // Check errors / user not found
      if (userError) yield* _(Effect.fail(new SupabaseError({ error: userError })));
      if (!userData) yield* _(Effect.fail(new NotFoundError({ message: `User ${query.userId} not found` })));
      yield* _(Effect.logInfo(`HANDLER: Fetched user data for ${query.userId}`));

      // 3. Determine Applicable Limit/Window (copied from statsService)
      let effectiveLimit: number;
      let effectiveWindowSeconds: number;
      let isOverrideActive = false;
      const overrideExpiry = userData.override_limit_expiry ? new Date(userData.override_limit_expiry) : null;

      if (
          userData.override_limit_requests != null && userData.override_limit_window_seconds != null &&
          overrideExpiry instanceof Date && !isNaN(overrideExpiry.getTime()) &&
          overrideExpiry.getTime() > nowMillis
      ) {
          effectiveLimit = userData.override_limit_requests;
          effectiveWindowSeconds = userData.override_limit_window_seconds;
          isOverrideActive = true;
      } else {
          const tier = userData.tier as keyof typeof config;
          const tierConfig = config[tier];
          if (!tierConfig) yield* _(Effect.fail(new RateLimitConfigError({ reason: `Config missing for tier ${tier}` })));
          effectiveLimit = tierConfig.requests;
          effectiveWindowSeconds = tierConfig.windowSeconds;
      }
      if (effectiveWindowSeconds <= 0) yield* _(Effect.fail(new RateLimitConfigError({ cause: `Invalid windowSeconds: ${effectiveWindowSeconds}` })));
      yield* _(Effect.logDebug(`HANDLER: Determined limits for ${query.userId}: ${effectiveLimit}req / ${effectiveWindowSeconds}s`));

      // 4. Calculate Redis Key
      const nowSeconds = Math.floor(nowMillis / 1000);
      const windowStartSeconds = Math.floor(nowSeconds / effectiveWindowSeconds) * effectiveWindowSeconds;
      const redisKey = `rate_limit:${query.userId}:${windowStartSeconds}`;

      // 5. Fetch Redis State
      yield* _(Effect.logDebug(`HANDLER: Fetching Redis state for key: ${redisKey}`));
      const [countOption, ttl] = yield* _(
         Effect.all([redis.get(redisKey), redis.ttl(redisKey)], { concurrency: "inherit" })
      );

      // 6. Parse Count
      const currentCount = Option.match(countOption, {
        onNone: () => 0,
        onSome: (str) => Number.isNaN(parseInt(str, 10)) ? 0 : parseInt(str, 10),
      });
      yield* _(Effect.logDebug(`HANDLER: Redis state for <span class="math-inline">\{query\.userId\}\: Count\=</span>{currentCount}, TTL=${ttl}`));

      // 7. Build Actual RateLimitStats Response
      const statsResponse: RateLimitStats = {
        userId: query.userId,
        tier: userData.tier as any,
        limit: effectiveLimit,
        windowSeconds: effectiveWindowSeconds,
        currentCount,
        secondsUntilReset: ttl,
        overrideActive: isOverrideActive,
      };

      yield* _(Effect.logInfo(`HANDLER: Successfully built stats for user ${query.userId}`));
      return statsResponse;

    }).pipe(
      // Catch & Map Errors to HTTP Responses
      Effect.catchTags({
          SupabaseError: (e) => Effect.logError("Handler caught SupabaseError", e.error).pipe(
              Effect.fail(Http.response.internalServerError({ body: "DB Error" }))
          ),
          NotFoundError: (e) => Effect.logWarning("Handler caught NotFoundError", e.message).pipe(
              Effect.fail(Http.response.notFound({ body: e.message }))
          ),
          RedisError: (e) => Effect.logError("Handler caught RedisError", e.cause).pipe(
              Effect.fail(Http.response.internalServerError({ body: "Cache Error" }))
          ),
          RateLimitConfigError: (e) => Effect.logError("Handler caught RateLimitConfigError", e.cause).pipe(
              Effect.fail(Http.response.internalServerError({ body: "Config Error" }))
          )
      }),
      Effect.catchAll((err) =>
        Effect.logError("Handler Test FAILED Unexpectedly", err).pipe(
          Effect.fail(Http.response.internalServerError())
        )
      )
    )
);

const updateUserRateLimitHandler = Handler.make(
  updateUserRateLimitEndpoint,
  ({ body, query }) => 
    Effect.gen(function*(_) {
      yield* _(Effect.logInfo(`HANDLER: Updating rate limit overrides for userId: ${query.userId}`));
      
      // Get Supabase client
      const supabase = yield* _(SupabaseClientService);
      
      // Prepare update data (only include fields that are provided)
      const updateData: Record<string, any> = {};
      
      if ('override_limit_requests' in body) {
        updateData.override_limit_requests = body.override_limit_requests;
      }
      
      if ('override_limit_window_seconds' in body) {
        updateData.override_limit_window_seconds = body.override_limit_window_seconds;
      }
      
      if ('override_limit_expiry' in body) {
        updateData.override_limit_expiry = body.override_limit_expiry;
      }
      
      // Update timestamp
      updateData.updated_at = new Date().toISOString();
      
      // Attempt to update the user
      const updateEffect = Effect.tryPromise({
        try: () => supabase
          .from('users')
          .update(updateData)
          .eq('id', query.userId)
          .select('override_limit_requests, override_limit_window_seconds, override_limit_expiry')
          .single(),
        catch: (e) => new SupabaseError({ error: e })
      });
      
      const { data: updatedUser, error } = yield* _(updateEffect);
      
      // Handle errors
      if (error) {
        yield* _(Effect.logError(`Failed to update user ${query.userId}:`, error));
        return yield* _(Effect.fail(new SupabaseError({ error })));
      }
      
      if (!updatedUser) {
        yield* _(Effect.logWarning(`User ${query.userId} not found`));
        return yield* _(Effect.fail(new NotFoundError({ message: `User ${query.userId} not found` })));
      }
      
      yield* _(Effect.logInfo(`Successfully updated rate limit overrides for user ${query.userId}`));
      
      // Return success response
      return {
        success: true,
        userId: query.userId,
        updated: {
          override_limit_requests: updatedUser.override_limit_requests,
          override_limit_window_seconds: updatedUser.override_limit_window_seconds,
          override_limit_expiry: updatedUser.override_limit_expiry,
        }
      };
    }).pipe(
      Effect.catchTags({
        NotFoundError: (e) => Effect.logWarning("Handler caught NotFoundError", e.message).pipe(
          Effect.fail(Http.response.notFound({ body: { error: e.message } }))
        ),
        SupabaseError: (e) => Effect.logError("Handler caught SupabaseError", e.error).pipe(
          Effect.fail(Http.response.internalServerError({ body: { error: "Database error" } }))
        ),
      }),
      Effect.catchAll((err) =>
        Effect.logError("Update Rate Limit Handler FAILED Unexpectedly", err).pipe(
          Effect.fail(Http.response.internalServerError({ body: { error: "An unexpected server error occurred" } }))
        )
      )
    )
);

const checkRateLimitHandler = Handler.make(
  checkRateLimitEndpoint, // Use the correct endpoint spec
  ({ query }: { query: { userId: string } }) =>
    // Input has validated userId
    Effect.gen(function*(_) {
      yield* _(Effect.logInfo(`HANDLER 'checkRateLimit': Received request for userId: ${query.userId}`));

      // This handler needs Supabase to fetch user, then Redis+Config via checkRateLimit
      const supabase = yield* _(SupabaseClientService);

      // 1. Fetch User from Supabase
      const queryEffect = Effect.tryPromise({
        try: () =>
          supabase.from("users")
            .select("id, tier, override_limit_requests, override_limit_window_seconds, override_limit_expiry") // Select fields needed by User type for checkRateLimit
            .eq("id", query.userId)
            .maybeSingle(),
        catch: (e) => new SupabaseError({ error: e }),
      });
      const result = yield* _(queryEffect);
      const { data: userData, error: userError } = result;

      // Handle fetch errors
      if (userError) yield* _(Effect.fail(new SupabaseError({ error: userError })));
      if (!userData) yield* _(Effect.fail(new NotFoundError({ message: `User ${query.userId} not found` })));
      yield* _(Effect.logDebug(`HANDLER: Found user ${query.userId}`));

      // Cast userData to User type expected by checkRateLimit
      const user = userData as User;

      // 2. Call the actual rate limiter service function
      // checkRateLimit requires RedisService and RateLimitConfigService in context
      const status = yield* _(checkRateLimit(user));

      // 3. Map status to HTTP response
      if (status instanceof Allowed) {
        yield* _(Effect.logInfo(`HANDLER: Allowed for user ${query.userId}`));
        // Return success body matching CheckSuccessResponseSchema { status: "ALLOWED" }
        return { statusCode: 200, status: "ALLOWED" };
      } else { // status is RateLimited
        yield* _(Effect.logWarning(`HANDLER: Rate limited for user ${query.userId}`));
        return { statusCode: 429, status: "NOT ALLOWED", RetryAfter: status.retryAfterSeconds.toString()};
      }
    }).pipe(
      Effect.catchTags({
        NotFoundError: (e: { message: any }) =>
          Effect.logWarning("Handler caught NotFoundError").pipe(
            Effect.fail(Http.response.notFound({ body: { error: e.message } })),
          ),
        SupabaseError: (e: { error: any }) =>
          Effect.logError("Handler caught SupabaseError", e.error).pipe(
            Effect.fail(Http.response.internalServerError({ body: { error: "Database error" } })),
          ),
        RedisError: (e: { cause: any }) =>
          Effect.logError("Handler caught RedisError", e.cause).pipe(
            Effect.fail(Http.response.internalServerError({ body: { error: "Cache error" } })),
          ),
        RateLimitConfigError: (e: { cause: any }) =>
          Effect.logError("Handler caught RateLimitConfigError", e.cause).pipe(
            Effect.fail(Http.response.internalServerError({ body: { error: "Config error" } })),
          ),
      }),
      Effect.catchAll((err) =>
        Effect.logError("Check Rate Limit Handler FAILED Unexpectedly", err).pipe(
          Effect.fail(Http.response.internalServerError({ body: { error: "An unexpected server error occurred" } })),
        )
      ),
    ),
);


const AppLayers = Layer.mergeAll(SupabaseLayer, RedisLayer, RateLimitConfigLayer);

const app = pipe(
  RouterBuilder.make(rateLimiterApi),
  RouterBuilder.handle(checkRateLimitHandler),
  RouterBuilder.handle(testCombinedLogicHandler),
  RouterBuilder.handle(updateUserRateLimitHandler),
  RouterBuilder.build,
);


const serverEffect = app.pipe(
  NodeServer.listen({ port: 3000 }),
  Effect.provide(AppLayers),
);

console.log("Server starting (Combined Supabase + Redis Test) on http://localhost:3000 ...");
NodeRuntime.runMain(serverEffect);
