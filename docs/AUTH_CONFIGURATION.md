# Auth configuration — email + Google OAuth

What the application expects from Supabase, Google and Vercel. No secret value
belongs in this file or in the repository: every credential below is set in a
provider dashboard and read from the environment.

## Environment

| Variable | Where it is read | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server clients, session proxy | Project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server clients, session proxy | Publishable/anon key only. Never the service-role key. |
| `NEXT_PUBLIC_SITE_URL` | `src/lib/url.ts` | The deliberate production origin for auth redirects. |

The service-role key is **not** used anywhere in this application. Every query
runs as the signed-in user so RLS is the authorization boundary; there is no
code path that fakes a user's authorization with a privileged credential.

`resolveSiteOrigin` (`src/lib/url.ts`) picks the redirect origin in this order:

1. `NEXT_PUBLIC_SITE_URL` in production,
2. the request's own `x-forwarded-host` on a Vercel preview — a preview is not
   the production host, so it must come back to itself,
3. the forwarded host, then `VERCEL_URL`, then `http://localhost:3000`.

This is why one `NEXT_PUBLIC_SITE_URL` covers production without breaking
previews, and why nothing reads `request.nextUrl.origin` (behind Vercel's proxy
that can be an internal address).

## Supabase

**Authentication → URL configuration**

- Site URL: the production origin (same value as `NEXT_PUBLIC_SITE_URL`).
- Redirect allow-list — one entry per environment that must complete a callback:

  ```
  http://localhost:3000/auth/callback
  https://<production-domain>/auth/callback
  https://*-<team-or-project>.vercel.app/auth/callback   # previews
  ```

**Authentication → Providers → Google**

- Enabled.
- Client ID and Client Secret from the Google Cloud OAuth client below. The
  secret is entered in the Supabase dashboard and never leaves it.
- Supabase's own callback URL — shown on that screen — is what Google must
  authorize:

  ```
  https://<project-ref>.supabase.co/auth/v1/callback
  ```

**Authentication → Email**

- Confirmation on or off both work. With it on, signup returns a "check your
  inbox" state rather than sending the visitor to a protected route they cannot
  yet reach; the confirmation link lands on `/auth/callback`.

## Google Cloud Console

OAuth 2.0 Client ID, type *Web application*:

- **Authorized JavaScript origins** — the app's own origins:
  `http://localhost:3000`, the production domain.
- **Authorized redirect URI** — Supabase's callback, not the app's:
  `https://<project-ref>.supabase.co/auth/v1/callback`.

The app's `/auth/callback` is where *Supabase* redirects afterwards, so it goes
in the Supabase allow-list above, not in Google's.

The OAuth consent screen must be published (or the test account added as a test
user) before anyone outside the project can sign in.

## Vercel

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`NEXT_PUBLIC_SITE_URL` for Production, Preview and Development. Previews resolve
their own origin from the request, so `NEXT_PUBLIC_SITE_URL` may hold the
production origin in every scope.

## The one flow both methods share

```
email:   /join      → signUp        → (confirm) → /auth/callback → bootstrap → resolveSessionDestination
google:  /join      → signInWithOAuth → Google  → /auth/callback → bootstrap → resolveSessionDestination
```

- The PKCE verifier is written server-side as an HTTP-only cookie by
  `signInWithGoogleAction`, and read back by `/auth/callback`.
- Application records are provisioned by one database trigger
  (`btg.handle_new_auth_user`), whichever method the account arrives through.
  It is conflict-safe, so a returning OAuth user is never re-provisioned.
- Where the same verified address arrives through both methods, Supabase links
  the second identity onto the existing `auth.users` row. There is no
  application-level email matching, and no custom account merging.
