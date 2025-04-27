/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
// src/services/redis.ts

import { Config, Context, Data, Effect, Layer, Option, Secret } from "effect";
// Import ioredis types directly
import Redis, { type Redis as IORedisClient, type RedisOptions } from "ioredis";

// --- Configuration Schema ---
const RedisConfigSchema = Config.all({
  host: Config.string("REDIS_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.integer("REDIS_PORT").pipe(
    Config.withDefault(6379),
    Config.validate({ message: "port number out of range", validation: (n) => n > 0 && n < 65536 }),
  ),
  // Use Config.secret for password, make it optional
  password: Config.option(Config.secret("REDIS_PASSWORD")),
  db: Config.option(Config.integer("REDIS_DB")),
});

// --- Custom Error Type ---
export class RedisError extends Data.TaggedError("RedisError")<{
  readonly cause: unknown;
}> {}


export interface RedisService {
  readonly incr: (key: string) => Effect.Effect<number, RedisError>;
  readonly expire: (key: string, seconds: number) => Effect.Effect<boolean, RedisError>;
  readonly ttl: (key: string) => Effect.Effect<number, RedisError>;
  readonly eval: (
    script: string,
    keys: ReadonlyArray<string>,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<unknown, RedisError>;
  readonly get: (key: string) => Effect.Effect<Option.Option<string>, RedisError>; // Return Option for clarity
  readonly setex: (key: string, seconds: number, value: string) => Effect.Effect<"OK", RedisError>;
  readonly del: (key: string | ReadonlyArray<string>) => Effect.Effect<number, RedisError>; // number of keys deleted
}

export class RedisService extends Context.Tag("RedisService")<RedisService, RedisService>() {}


export const RedisLayer = Layer.scoped(
  RedisService,
  Effect.gen(function*(_) {
    const config = yield* _(RedisConfigSchema);

    const redisClient = yield* _(
      Effect.acquireRelease(
        Effect.sync(() => {
          const options: RedisOptions = {
            host: config.host,
            port: config.port,
            password: Option.map(config.password, Secret.value).pipe(Option.getOrUndefined),
            db: Option.getOrUndefined(config.db),
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            enableOfflineQueue: true,
            lazyConnect: true,
          };
          const client = new Redis(options);

          // Basic logging for connection events (can be enhanced)
          client.on("connect", () => console.log(`Redis client connected to ${config.host}:${config.port}`));
          client.on("ready", () => console.log("Redis client ready."));
          client.on("reconnecting", (delay) => console.log(`Redis client reconnecting in ${delay}ms...`));
          client.on("error", (error) => console.error("Redis Client Error:", error)); // Log errors

          return client;
        }).pipe(
          // Connect explicitly and handle potential initial connection error
          Effect.flatMap(client =>
            Effect.tryPromise({
              try: () => client.connect(),
              catch: (error) => {
                console.error(`Initial Redis connection failed to ${config.host}:${config.port}`);
                return new RedisError({ cause: error });
              },
            }).pipe(Effect.as(client)) // Return the client on success
          ),
          // More robust error logging for the acquire phase
          Effect.tapError((e) =>
            e._tag === "RedisError"
              ? Effect.logError("Redis acquire failed", { error: e.cause })
              : Effect.logError("Redis acquire failed with unexpected error", { error: e }) // Log other potential errors
          ),
        ),
        // Release: Disconnect the client gracefully
        (client) =>
          Effect.sync(() => {
            console.log("Disconnecting Redis client...");
            // .quit() waits for pending commands to finish before closing the connection
            client.quit().catch((e) => console.error("Error during Redis quit:", e));
            // client.disconnect(); // Use if immediate disconnect is needed and you don't care about pending commands
          }).pipe(
            // Ensure release action doesn't fail the scope closure
            Effect.tapError((e) => Effect.logWarning("Redis release failed", e)),
            Effect.ignore, // Ignore errors during release
          ),
      ),
    );

    // Implement the RedisService interface using the connected client
    // Wrap ioredis promises with Effect.tryPromise and map errors
    const service: RedisService = {
      incr: (key) =>
        Effect.tryPromise({
          try: () => redisClient.incr(key),
          catch: (error) => new RedisError({ cause: error }),
        }),

      expire: (key, seconds) =>
        Effect.tryPromise({
          try: () => redisClient.expire(key, seconds), // Returns 1 on success, 0 if key didn't exist
          catch: (error) => new RedisError({ cause: error }),
        }).pipe(
          Effect.map(result => result === 1), // Map 1 to true, 0 to false
        ),

      ttl: (key) =>
        Effect.tryPromise({
          try: () => redisClient.ttl(key), // Returns seconds, -1, or -2
          catch: (error) => new RedisError({ cause: error }),
        }),

      eval: (script, keys, args) =>
        Effect.tryPromise({
          // ioredis eval signature is (script, numkeys, key1, key2, ..., arg1, arg2, ...)
          try: () => redisClient.eval(script, keys.length, ...keys, ...args),
          catch: (error) => new RedisError({ cause: error }),
        }),

      get: (key) =>
        Effect.tryPromise({
          try: () => redisClient.get(key), // Returns string or null
          catch: (error) => new RedisError({ cause: error }),
        }).pipe(
          Effect.map(Option.fromNullable), // Map null to None, string to Some(string)
        ),

      setex: (key, seconds, value) =>
        Effect.tryPromise({
          try: () => redisClient.setex(key, seconds, value), // Returns 'OK'
          catch: (error) => new RedisError({ cause: error }),
        }),

      del: (key) =>
        Effect.tryPromise({
          // ioredis del signature is (key1, key2, ...) or accepts an array directly
          // Using spread with [key] for single value ensures compatibility with the variadic API
          try: () => redisClient.del(...(Array.isArray(key) ? key : [key])), // Returns number of keys deleted
          catch: (error) => new RedisError({ cause: error }),
        }),
    };

    // Return the implemented service
    return service;
  }),
);
