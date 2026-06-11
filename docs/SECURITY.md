# Security

## Authentication & authorization

- **Local accounts**: username/password, hashed with **bcrypt**. Sessions use
  **JWT** bearer tokens.
- **Authentik (OIDC)**: optional single sign-on. Enabled when the
  `AUTHENTIK_*` environment variables are set. New users can be auto-provisioned;
  `AUTHENTIK_ADMIN_GROUP` membership is **synced on every Authentik login** —
  admin is granted when the user is in the group and **revoked** when they are
  not. Local accounts (``auth_provider="local"``) are not affected by OIDC
  logins, even if they share an email address with an Authentik user.
- **Admin-managed users**: self-registration is off by default. The first
  account (seeded from `FIRST_ADMIN_*`) is an admin; admins create further users
  and can toggle self-registration at runtime.
- **Owned + shared trees**: every tree has an owner and can be shared with other
  users as `viewer` (read-only) or `editor` (read/write). The backend enforces
  this on every request (`get_readable_tree` / `get_writable_tree`).
- **Login rate limiting**: `/auth/login` is throttled per client IP + username
  (`LOGIN_MAX_ATTEMPTS` failures within `LOGIN_RATE_LIMIT_WINDOW_SECONDS` →
  `429`) to blunt brute-force attempts. The limiter is in-memory and so is
  process-local; a multi-replica deployment would need a shared store.
- **Constant-time login**: `/auth/login` and `/auth/restore-account` always run a
  full bcrypt key derivation, even when the supplied username does not exist or has
  no stored password hash (a dummy hash is verified instead). This makes response
  timing uniform and eliminates the timing side-channel that would otherwise let an
  attacker enumerate valid usernames. Registration intentionally returns a distinct
  `409 Username already taken` — this is an acceptable trade-off because
  self-registration is disabled by default, and when it is enabled the actionable
  error message is required for usability.
- **Initial admin password**: `FIRST_ADMIN_PASSWORD` is **required** by the
  production `docker-compose.yml`. If the seed ever runs with the placeholder
  value `admin`, a warning is logged — set a strong password and change it after
  first login.

### Token storage (known trade-off)

The JWT is stored in the browser's `localStorage`, which is readable by any
script running on the page and therefore exposed to XSS. This keeps the client
simple and avoids CSRF handling. Moving to an `HttpOnly`, `SameSite` cookie
would remove the XSS exposure at the cost of adding CSRF protection and reworking
the OAuth redirect (which currently hands the token back in the URL fragment).
This is a deliberate, documented trade-off rather than an oversight.

**Planned hardening path (tracked in [#151](https://github.com/maxi-smidt/family-tree/issues/151)):**

1. ✅ **CSP (done)** — A strict Content-Security-Policy is served by nginx in
   production (see `frontend/nginx.conf`). It blocks inline script injection and
   limits resource origins, reducing the blast radius of any XSS even while the
   token remains in `localStorage`.
2. **HttpOnly cookie migration (future)** — Switching to `HttpOnly; SameSite=Lax`
   cookies would prevent JS from reading the token at all, eliminating the XSS
   token-theft vector. This requires:
   - Backend: issue the JWT as a Set-Cookie header instead of a JSON body field.
   - Frontend: remove `setAuthToken` / `getAuthToken` from `api.ts`; the browser
     sends the cookie automatically.
   - OAuth redirect: the Authentik callback currently delivers the token in the
     URL fragment (`#token=...`). This would need to become a server-side
     `/auth/callback` redirect that issues the cookie, removing the fragment.
   - CSRF protection: add a `SameSite=Lax` cookie (sufficient for most flows) or
     a CSRF double-submit token for any state-mutating non-navigation requests.

## HTTP security headers

The nginx frontend container (`frontend/nginx.conf`) sets the following headers
on every response:

| Header                    | Value                                      | Purpose                                              |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `Content-Security-Policy` | see below                                  | Restricts resource origins; reduces XSS blast radius |
| `X-Frame-Options`         | `DENY`                                     | Clickjacking protection for older browsers           |
| `X-Content-Type-Options`  | `nosniff`                                  | Prevents MIME-type sniffing                          |
| `Referrer-Policy`         | `strict-origin-when-cross-origin`          | Avoids leaking URL fragments to third parties        |
| `Permissions-Policy`      | `camera=(), microphone=(), geolocation=()` | Disables device APIs this app never uses             |

### Content-Security-Policy

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
connect-src 'self';
font-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

**Why `'unsafe-inline'` for `style-src`?**
Radix UI (used by Shadcn components) and React Flow inject inline `style="..."`
attributes at runtime for dynamic positioning (e.g. dropdowns, popovers, tree
edges). Removing `'unsafe-inline'` would break these. A nonce-based approach
would require per-request SSR that nginx cannot provide. Since CSS cannot
exfiltrate tokens (only JS can), this does not weaken the main XSS defence.

**Why `blob:` for `img-src`?**
`useMediaUrl` (`frontend/src/hooks/useMediaUrl.ts`) fetches `/api/media/*`
endpoints with the Bearer token and converts the response to a `blob:` URL so
the `<img>` tag can display it without embedding the token in the src attribute.

**Authentik/OIDC OAuth flow**: the OAuth redirect is a browser _navigation_
(top-level `Location:` redirect), not a fetch. Navigation is not governed by
`connect-src`. `frame-ancestors 'none'` only applies to embedding, not to
top-level navigations, so the login flow is unaffected.

**Vite dev server**: this nginx configuration only applies to the production
Docker build. The Vite dev server does not use these headers; HMR websockets and
module hot-reloading work as normal in development.

## Data at rest

The database is **not** encrypted at rest — it relies on the security of the
host and PostgreSQL. Protect the deployment with the usual measures (firewall,
TLS termination at your reverse proxy, disk encryption, database credentials).

Uploaded media (member photos, gallery images) is stored on the filesystem under
`DATA_PATH/media` with random UUID filenames and served from `/api/media/...`.

## Export encryption

Encryption is applied **only to exported `.treedb` files** — this is the one
place data leaves the server.

- **Algorithm**: AES-256-GCM (authenticated encryption).
- **Key derivation**: scrypt.
- **Always encrypted**: every export is encrypted. If you don't provide a
  password, the file is encrypted with the server's `SECRET_KEY`; if you do, the
  key is derived from your password instead.
- **File header**: a `FTREE1` magic prefix plus a flag byte indicating whether
  the file is password-protected.

### Exporting

1. Open the **Database Management** view.
2. Click the export (upload) icon for a tree.
3. Optionally enter a password, or skip for server-key encryption.
4. The encrypted `.treedb` file downloads through your browser.

### Importing

1. Click **Import** and choose a `.treedb` file.
2. The app inspects the file; if it is password-protected you are prompted.
3. The tree is imported as a **new** tree you own, with all ids regenerated so it
   never collides with existing data.

> **Password recovery**: a password-protected export cannot be recovered if the
> password is lost. Server-key-encrypted exports can only be imported by the same
> instance (same `SECRET_KEY`).

## Reporting security issues

If you discover a vulnerability, please **do not** open a public issue. Email the
maintainer directly with details and steps to reproduce, and allow time for a fix
before public disclosure.

## Disclaimer

This software is provided "as is" without warranty. Operators are responsible for
securing their deployment, choosing strong passwords, and managing backups. See
the [LICENSE](../LICENSE) file for full details.
