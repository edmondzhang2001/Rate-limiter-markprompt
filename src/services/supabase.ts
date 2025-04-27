// src/services/supabase.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { Config, Context, Effect, Layer, Secret } from "effect";

// Define the structure for Supabase configuration using Effect's Config module
const SupabaseConfig = Config.all({
  url: Config.string("SUPABASE_URL"),
  // Use Config.secret for sensitive data like API keys.
  // This prevents the key from being accidentally logged.
  serviceKey: Config.secret("SUPABASE_SERVICE_KEY"),
});

/**
 * Defines a Context Tag for the SupabaseClient service.
 * Other parts of the application will use this Tag to access the
 * configured Supabase client instance via Effect's dependency injection.
 * We use a class here for better structure and potential future methods.
 */
export class SupabaseClientService extends Context.Tag("SupabaseClientService")<
  SupabaseClientService, // Type of the Tag itself
  SupabaseClient // Type of the service it provides
>() {}

/**
 * Creates an Effect Layer that provides the live SupabaseClient implementation.
 * It reads configuration from environment variables, creates the client,
 * and makes it available under the SupabaseClientService Tag.
 */
export const SupabaseLayer = Layer.effect(
  SupabaseClientService, // The Tag this layer provides
  // Effect.gen provides a clean way to work with Effects using async/await-like syntax
  Effect.gen(function*(_) {
    // Load the configuration defined above. Config.load returns an Effect.
    yield* _(Effect.logInfo("SupabaseLayer: Build started..."));
    yield* _(Effect.logInfo("SupabaseLayer: Loading SupabaseConfig..."));
    const config = yield* _(SupabaseConfig);

    yield* _(Effect.logInfo(`SupabaseLayer: Configuration loaded. URL: ${config.url}`));

    // Create the Supabase client using the loaded URL and the unwrapped service key

    yield* _(Effect.logInfo("SupabaseLayer: Creating Supabase client object..."));
    const supabase = createClient(
      config.url,
      Secret.value(config.serviceKey), // Use Secret.value() to securely get the string value
      {
        // Recommended options for server-side usage with service_role key:
        auth: {
          autoRefreshToken: false, // No need to refresh token for service key
          persistSession: false, // Don't persist session information server-side
          detectSessionInUrl: false, // Not applicable for server-side
        },
      },
    );

    yield* _(Effect.logInfo("SupabaseLayer: Supabase client created successfully. Build finished."));

    // Return the initialized client. This becomes the service provided by the layer.
    return supabase;
  }).pipe(
    // Enhance error handling context if configuration fails
    Effect.catchTags({
      ConfigError: (error) => {
        const message =
          `Supabase configuration error: ${error}. Did you set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file?`;
        console.error(message);
        // Terminate the application startup if config is missing/invalid
        return Effect.die(new Error(message));
      },
    }),
  ),
);
