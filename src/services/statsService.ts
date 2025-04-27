// src/services/statsService.ts - SIMPLIFIED FOR SUPABASE TEST

import { Context, Data, Effect, Layer } from "effect";
// Only Supabase service needed now
import { SupabaseClientService } from "./supabase";
// Import User type - assuming it includes the selected fields
import type { User } from "../models/user";

// --- Define Errors specific to this simplified service ---
export class SupabaseError extends Data.TaggedError("SupabaseError")<{ error: unknown }> {}
export class NotFoundError extends Data.TaggedError("NotFoundError")<{ message: string }> {}

type FetchedUserData = Pick<
  User,
  "id" | "tier" | "override_limit_requests" | "override_limit_window_seconds" | "override_limit_expiry"
>;

export interface StatsService {
  readonly getUserData: ( // Renamed method for clarity
    userId: string,
  ) => Effect.Effect<
    FetchedUserData, // Return type is now the fetched user data subset
    NotFoundError | SupabaseError, // Only these errors are possible now
    SupabaseClientService // Only Supabase dependency now
  >;
}

// --- Context Tag ---
// Keep the tag name for consistency, but the service is simpler now
export class StatsService extends Context.Tag("StatsService")<StatsService, StatsService>() {}

// --- Live Implementation Logic (Simplified) ---
// This function now ONLY fetches user data from Supabase
const getUserDataImpl = (userId: string): Effect.Effect<
  FetchedUserData,
  NotFoundError | SupabaseError,
  SupabaseClientService // Depends only on Supabase
> =>
  Effect.gen(function*(_) {
    yield* _(Effect.logInfo(`getUserDataImpl: Attempting Supabase query for user ${userId}...`));
    const supabase = yield* _(SupabaseClientService); // Requires SupabaseClientService

    // Define and execute the query Effect
    const queryEffect = Effect.tryPromise({
      try: () => {
        console.log(`[DEBUG] Supabase try: Executing query for ${userId}...`); // Keep console log
        return supabase.from("users")
          .select("id, tier, override_limit_requests, override_limit_window_seconds, override_limit_expiry")
          .eq("id", userId)
          .maybeSingle(); // Returns { data: UserData | null, error: PgError | null }
      },
      catch: (e) => {
        console.error(`[ERROR] Supabase CATCH block hit for user ${userId}. Error:`, e); // Keep console log
        return new SupabaseError({ error: e }); // Wrap promise rejection
      },
    });

    // Execute and log outcome
    const result = yield* _(queryEffect.pipe(
      Effect.tapBoth({
        onFailure: (e) => Effect.logError(`getUserDataImpl: Supabase Effect FAILED for ${userId}`, e),
        onSuccess: (res) =>
          Effect.logDebug(`getUserDataImpl: Supabase Effect SUCCEEDED for ${userId}. Raw result:`, {
            data: res?.data,
            error: res?.error,
          }),
      }),
    ));
    yield* _(Effect.logDebug(`getUserDataImpl: Raw Supabase result yielded for ${userId}.`));

    const { data: userData, error: userError } = result;

    // Check for Supabase client error first
    if (userError) {
      yield* _(Effect.logError(`getUserDataImpl: Supabase client returned error for ${userId}`, userError));
      return yield* _(Effect.fail(new SupabaseError({ error: userError })));
    }
    // Check if user data is null (user not found)
    if (!userData) {
      yield* _(Effect.logWarning(`getUserDataImpl: User ${userId} not found.`));
      return yield* _(Effect.fail(new NotFoundError({ message: `User ${userId} not found` })));
    }

    // If successful, return the fetched user data
    yield* _(Effect.logInfo(`getUserDataImpl: Successfully fetched data for user ${userId}`));
    // Cast to the specific type if necessary, assuming DB returns compatible structure
    return userData as FetchedUserData;
  }).pipe(
    Effect.withLogSpan("StatsService.getUserData"), // Updated span name
    Effect.tapErrorCause(cause =>
      // Takes the full Cause<E>
      Effect.logError(
        `Error occurred in getUserStats for userId: ${userId}`,
        cause, // Log the entire Cause object for detailed context
      )
    ),
  );

export const StatsServiceLive = Layer.effect(
  StatsService, // The Tag
  // Provide the implementation object
  Effect.succeed(
    {
      getUserData: (userId: string) => getUserDataImpl(userId), // Call the simplified logic
    } satisfies StatsService,
  ),
);
