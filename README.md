# Effect Rate Limiter Project

This project implements a rate limiting service built using the [Effect](https://effect.website/) ecosystem for TypeScript. It demonstrates how to control access to API endpoints based on request frequency per client, leveraging external services like Supabase for user data and Redis for caching rate limit state.

## Features

* **Tier-Based Rate Limiting:** Applies different request limits based on user tiers (e.g., "free", "premium") defined in configuration.
* **Admin Overrides:** Supports user-specific rate limit overrides (requests, window duration, expiry) stored in the database.
* **Client Identification:** Designed to identify clients via request information (e.g., Bearer token - *full authentication logic using tokens is not yet implemented in the provided handlers*).
* **Distributed State:** Uses Redis to store rate limit counters atomically, making it suitable for serverless or multi-server environments.
* **Observability Endpoint:** Includes an endpoint (`/rate-limit-stats`) to query the current rate limit status for a specific user.
* **Type-Safe:** Built with Effect and `@effect/schema` for robust type safety and error handling.
* **HTTP Server:** Uses `effect-http` for defining and serving API endpoints.

## Core Technologies

* [Effect](https://effect.website/)
* [TypeScript](https://www.typescriptlang.org/)
* [@effect/schema](https://effect.website/docs/schema/introduction)
* [@effect/platform](https://effect.website/docs/platform/introduction) & [@effect/platform-node](https://github.com/Effect-TS/effect/tree/main/packages/platform-node)
* [effect-http](https://github.com/Effect-TS/effect-http) & [effect-http-node](https://github.com/Effect-TS/effect-http/tree/main/packages/node)
* [Supabase](https://supabase.com/) (PostgreSQL)
* [Redis](https://redis.io/)
* [pnpm](https://pnpm.io/)

## Setup

### Prerequisites

1.  **Node.js:** Ensure you have Node.js installed (v18 or later recommended).
2.  **pnpm:** This project uses pnpm for package management. Install it if you haven't: `npm install -g pnpm`.
3.  **Redis:** A running Redis instance is required. You can run it locally or use a cloud provider.
4.  **Supabase Project:** You need a Supabase project.
    * Sign up at [supabase.com](https://supabase.com/).
    * Create a new project.

### Database Setup (Supabase)

1.  **Create `users` Table:** In your Supabase project's SQL Editor, create a table named `users` (in the `public` schema). It should include at least the following columns:
    * `id`: `uuid`, Primary Key (e.g., `default gen_random_uuid()`). Consider linking to `auth.users(id)` if using Supabase Auth.
    * `tier`: `text` (or a custom `user_tier` enum like `ENUM ('free', 'premium')`), `NOT NULL`, `DEFAULT 'free'`.
    * `override_limit_requests`: `integer`, `NULL` (Allows NULL).
    * `override_limit_window_seconds`: `integer`, `NULL` (Allows NULL).
    * `override_limit_expiry`: `timestamptz`, `NULL` (Allows NULL).
    * `created_at`: `timestamptz`, `NOT NULL`, `DEFAULT now()`.
    * `updated_at`: `timestamptz`, `NOT NULL`, `DEFAULT now()` (Consider adding an update trigger).
2.  **Add Sample Data:** Ensure the `users` table contains at least one user record with a known `id` (e.g., `0e635e78-fee6-43be-9556-1bfb3d169ec7`) for testing the API endpoints.
3.  **Row Level Security (RLS):**
    * Enable RLS for the `users` table.
    * **Important:** For backend access using the `service_role` key, RLS is typically bypassed. If you encounter issues where the backend cannot read data (e.g., getting 404 Not Found for existing users), temporarily disable RLS for the `users` table *for debugging purposes only* or add a permissive `SELECT` policy like `CREATE POLICY "Allow public select" ON public.users FOR SELECT USING (true);`. Remember to configure secure policies for production or if using non-service keys.

### Environment Variables

1.  Create a file named `.env` in the project root directory.
2.  Add your Supabase project URL, Supabase **service\_role** key, and Redis connection details:

    ```dotenv
    # .env

    # Supabase Credentials (Get from Project Settings -> API)
    SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
    SUPABASE_SERVICE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY # Use the secret service_role key!

    # Redis Connection
    REDIS_HOST=127.0.0.1 # Or your Redis host
    REDIS_PORT=6379      # Or your Redis port
    # REDIS_PASSWORD=your_secure_password # Uncomment and set if needed
    # REDIS_DB=0 # Uncomment and set if using a specific DB number
    ```
3.  **Important:** Add `.env` to your `.gitignore` file to avoid committing secrets.

### Configuration

1.  **Rate Limits:** Configure the default rate limits per tier. If you are using the hardcoded config layer (`Layer.succeed` in `src/services/config.ts`), modify the values there directly:
    ```typescript
    // Example in src/services/config.ts
    const rateLimitConfigData: RateLimitConfig = {
      free: { requests: 10, windowSeconds: 60 },
      premium: { requests: 100, windowSeconds: 60 }
    };
    ```
    *(If you implemented the file-based loading layer, ensure `rate-limit-config.json` exists in the root with the desired structure).*

### Install Dependencies

Navigate to the project root in your terminal and run:

```bash
pnpm install
```
Running the Server
To start the HTTP server defined in src/index.ts:

pnpm tsx src/index.ts

The server will start, typically on http://localhost:3000. You should see logs indicating initialization of services (Supabase, Redis) and the server listening for requests.

API Endpoints

1. Check Rate Limit
Endpoint: GET /api/check/:userId | jq

2. Check stats
Endpoint: GET /rate-limit-stats/:userId
