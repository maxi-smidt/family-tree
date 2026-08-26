/**
 * Thin fetch wrapper for the FastAPI backend.
 *
 * The JWT is kept in a module-level variable (mirrored to localStorage) so the
 * client has no import cycle with the auth store. A single `onUnauthorized`
 * callback lets the auth layer react to expired/invalid tokens globally.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TOKEN_KEY = "ft_token";

/** Semantic 401 detail for a password-protected public tree — routed to the
 *  public-password prompt instead of the global re-login handler. */
export const PUBLIC_PASSWORD_REQUIRED = "public_password_required";

/** This build's wire-contract epoch (#1012) — sent on every request so the
 *  backend can reject a mutation from a stale cached frontend instead of
 *  applying it under a contract the two sides don't share. Bump only
 *  alongside a matching bump of backend SCHEMA_EPOCH. */
export const FRONTEND_SCHEMA_EPOCH = 2;
const SCHEMA_EPOCH_HEADER = "X-Schema-Epoch";
const SCHEMA_EPOCH_MISMATCH_DETAIL = "schema_epoch_mismatch";

/** Detail on a 503 while the backend's startup migration is still running
 *  (see app.main.StartupGateMiddleware, #1020) — routed to the maintenance
 *  screen instead of the generic "can't reach the server" retry screen. */
const STARTUP_IN_PROGRESS_DETAIL = "startup_in_progress";

/** 401 details that describe an application flow (a password prompt) rather
 *  than an invalid/expired session — none of these should invalidate the
 *  signed-in user's session or open the global re-login dialog. */
const SEMANTIC_401_DETAILS = new Set([
  PUBLIC_PASSWORD_REQUIRED,
  "invalid_public_password",
  "Password required",
]);

/** Hang ceiling for a staged file upload — bounds a stalled/dead connection,
 *  not the time a large-but-healthy transfer may take. */
export const UPLOAD_STAGE_TIMEOUT_MS = 120_000;

let authToken: string | null = localStorage.getItem(TOKEN_KEY);
let unauthorizedHandler: (() => void) | null = null;

// In-memory only (never persisted): the short-lived unlock token proving a
// visitor entered the correct password for a password-protected public tree.
// A page refresh drops it and re-prompts — acceptable, and safer than
// persisting it alongside the JWT.
let publicTreeToken: string | null = null;

export function setPublicTreeToken(token: string | null) {
  publicTreeToken = token;
}

/** The in-memory password-unlock token used for public-tree requests. */
export function getPublicTreeToken(): string | null {
  return publicTreeToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

let schemaEpochMismatchHandler: (() => void) | null = null;

/** Fires the first time the backend rejects a mutation as a schema-epoch
 *  mismatch (see SCHEMA_EPOCH_MISMATCH_DETAIL) — the global upgrade-required
 *  state, not per-caller error handling. */
export function onSchemaEpochMismatch(handler: () => void) {
  schemaEpochMismatchHandler = handler;
}

let startupInProgressHandler: (() => void) | null = null;

/** Fires on every 503 the backend returns while its startup migration is
 *  still running (see STARTUP_IN_PROGRESS_DETAIL) — the global maintenance
 *  state, not per-caller error handling. */
export function onStartupInProgress(handler: () => void) {
  startupInProgressHandler = handler;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  formData?: FormData;
  raw?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const url = `${API_BASE}${path}`;
  if (!params) return url;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null)
      search.append(key, String(value));
  });
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    [SCHEMA_EPOCH_HEADER]: String(FRONTEND_SCHEMA_EPOCH),
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (publicTreeToken) headers["X-Public-Workspace-Token"] = publicTreeToken;

  let payload: BodyInit | undefined;
  if (options.formData) {
    payload = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(options.body);
  }

  // A hung connection (dead keep-alive socket, dropped wifi, ...) otherwise
  // leaves fetch() pending forever with no error — this is a ceiling on that
  // hang, not a body-transfer deadline, so it must stay generous enough for a
  // full upload on a slow link.
  let timeoutController: AbortController | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let signal = options.signal;
  if (options.timeoutMs !== undefined) {
    timeoutController = new AbortController();
    timeoutId = setTimeout(() => timeoutController?.abort(), options.timeoutMs);
    options.signal?.addEventListener("abort", () => timeoutController?.abort());
    signal = timeoutController.signal;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.params), {
      method,
      headers,
      body: payload,
      signal,
    });
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      // non-JSON error body
    }
    if (response.status === 401 && !SEMANTIC_401_DETAILS.has(detail)) {
      unauthorizedHandler?.();
    }
    if (response.status === 409 && detail === SCHEMA_EPOCH_MISMATCH_DETAIL) {
      schemaEpochMismatchHandler?.();
    }
    if (response.status === 503 && detail === STARTUP_IN_PROGRESS_DETAIL) {
      startupInProgressHandler?.();
    }
    throw new ApiError(response.status, detail);
  }

  if (options.raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(
    path: string,
    params?: RequestOptions["params"],
    timeoutMs?: number,
  ) => request<T>("GET", path, { params, timeoutMs }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>("POST", path, { body, signal }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>("PATCH", path, { body }),
  del: <T>(path: string, params?: RequestOptions["params"]) =>
    request<T>("DELETE", path, { params }),
  postForm: <T>(path: string, formData: FormData, timeoutMs?: number) =>
    request<T>("POST", path, { formData, timeoutMs }),
  getRaw: (path: string, params?: RequestOptions["params"]) =>
    request<Response>("GET", path, { params, raw: true }),
  postRaw: (path: string, body?: unknown) =>
    request<Response>("POST", path, { body, raw: true }),
};
