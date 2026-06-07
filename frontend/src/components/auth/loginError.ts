import { ApiError } from "@/services/api";

export type AuthMode = "login" | "register";

export interface AuthErrorToast {
  /** i18n key relative to the `auth.login` namespace. */
  key: string;
  /** Optional toast duration override in ms. */
  duration?: number;
}

/** Backend detail returned for accounts in the soft-delete grace period. */
const ACCOUNT_PENDING_DELETION = "account_pending_deletion";

/**
 * Map a failed login/registration request to the toast that should be shown.
 *
 * Anything that is not an {@link ApiError} means the request never reached the
 * backend (network failure / server unreachable), so the user's credentials
 * may well be correct — we must not blame them with a "wrong password" message.
 */
export function authErrorToast(err: unknown, mode: AuthMode): AuthErrorToast {
  if (!(err instanceof ApiError)) {
    return { key: "network-error" };
  }

  // Rate limiter kicks in after repeated failures, for both login and register.
  if (err.status === 429) {
    return { key: "rate-limit-error" };
  }

  if (mode === "register") {
    if (err.status === 409) return { key: "username-taken" };
    return { key: "register-error" };
  }

  if (err.status === 403 && err.message === ACCOUNT_PENDING_DELETION) {
    return { key: "account-pending-deletion", duration: 10000 };
  }

  return { key: "login-error" };
}
