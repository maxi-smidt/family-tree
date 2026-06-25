/**
 * Optional error-monitoring integration (Sentry / GlitchTip).
 *
 * All exports are no-ops when:
 *   - the admin has not set SENTRY_DSN (config.sentry_dsn is null), or
 *   - the user has not opted in (user.error_monitoring is false/absent).
 *
 * PII scrubbing: sendDefaultPii is always false and beforeSend removes
 * cookies, auth headers, and e-mail addresses before any event is sent.
 */

import * as Sentry from "@sentry/react";
import type { AuthConfig, User } from "@/types/user";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _inited = false;

// ---------------------------------------------------------------------------
// beforeSend hook
// ---------------------------------------------------------------------------

const _EMAIL_RE = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
const _SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
]);

function _scrub(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // --- request headers ---
  const req = event.request ?? {};
  if (req.headers) {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      cleaned[k] = _SENSITIVE_HEADERS.has(k.toLowerCase())
        ? "[filtered]"
        : String(v).replace(_EMAIL_RE, "[email]");
    }
    req.headers = cleaned;
  }

  // --- cookies ---
  if ("cookies" in req) {
    delete (req as Record<string, unknown>)["cookies"];
  }

  // --- body ---
  if ("data" in req) {
    delete (req as Record<string, unknown>)["data"];
  }

  // --- query string ---
  if ("query_string" in req) {
    delete (req as Record<string, unknown>)["query_string"];
  }
  if (req.url && req.url.includes("?")) {
    req.url = req.url.split("?")[0];
  }

  event.request = req;

  // --- user context ---
  if (event.user?.email) {
    const { email: _drop, ...rest } = event.user;
    event.user = rest;
  }

  return event;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Sentry SDK.  Safe to call multiple times — only inits once.
 */
export function initMonitoring(dsn: string, tracesSampleRate: number): void {
  if (_inited) return;
  _inited = true;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate,
    beforeSend: _scrub,
  });
}

/**
 * Close the Sentry client and mark as uninitialised so initMonitoring can
 * reinitialise if the user opts back in during the same session.
 */
export async function closeMonitoring(): Promise<void> {
  if (!_inited) return;
  _inited = false;
  await Sentry.close();
}

/**
 * Capture an error — no-op when monitoring is not active.
 */
export function captureError(error: unknown): void {
  if (!_inited) return;
  Sentry.captureException(error);
}

/**
 * Single decision point: enable monitoring iff the admin has set a DSN AND
 * this user has opted in.  Called after any auth state change.
 */
export function syncMonitoring(
  config: AuthConfig | null,
  user: User | null,
): void {
  try {
    if (config?.sentry_dsn && user?.error_monitoring) {
      initMonitoring(config.sentry_dsn, config.sentry_traces_sample_rate ?? 0);
    } else {
      // Fire-and-forget; errors here must never affect the auth flow.
      void closeMonitoring();
    }
  } catch {
    // Swallow — monitoring failures must never surface to users.
  }
}
