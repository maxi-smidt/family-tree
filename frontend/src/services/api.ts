/**
 * Thin fetch wrapper for the FastAPI backend.
 *
 * The JWT is kept in a module-level variable (mirrored to localStorage) so the
 * client has no import cycle with the auth store. A single `onUnauthorized`
 * callback lets the auth layer react to expired/invalid tokens globally.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TOKEN_KEY = "ft_token";

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
  const headers: Record<string, string> = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (publicTreeToken) headers["X-Public-Tree-Token"] = publicTreeToken;

  let payload: BodyInit | undefined;
  if (options.formData) {
    payload = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(options.body);
  }

  const response = await fetch(buildUrl(path, options.params), {
    method,
    headers,
    body: payload,
  });

  if (response.status === 401) {
    unauthorizedHandler?.();
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(response.status, detail);
  }

  if (options.raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: RequestOptions["params"]) =>
    request<T>("GET", path, { params }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>("PATCH", path, { body }),
  del: <T>(path: string, params?: RequestOptions["params"]) =>
    request<T>("DELETE", path, { params }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>("POST", path, { formData }),
  getRaw: (path: string, params?: RequestOptions["params"]) =>
    request<Response>("GET", path, { params, raw: true }),
};
