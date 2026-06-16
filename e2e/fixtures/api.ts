/**
 * Low-level API helper for E2E tests.
 * All calls go through the backend REST API so tests can arrange state without
 * driving the UI.  Pass a JWT token obtained from apiLogin().
 */

import { API_URL } from "../playwright.config";

export interface ApiClient {
  token: string;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export async function apiLogin(
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Login returned no access_token");
  return data.access_token;
}

export function makeApiClient(token: string): ApiClient {
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  });

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${API_URL}${path}`;
    const res = await fetch(url, {
      method,
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    token,
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    delete: (path: string) => request<void>("DELETE", path),
  };
}
