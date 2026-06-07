import { describe, it, expect } from "vitest";
import { authErrorToast } from "./loginError";
import { ApiError } from "@/services/api";

describe("authErrorToast", () => {
  it("treats non-ApiError failures as a network/server-unreachable error", () => {
    // fetch rejects with a TypeError when the backend can't be reached.
    expect(authErrorToast(new TypeError("Failed to fetch"), "login")).toEqual({
      key: "network-error",
    });
    expect(
      authErrorToast(new TypeError("Failed to fetch"), "register"),
    ).toEqual({ key: "network-error" });
  });

  it("surfaces the rate-limit message on 429 for both modes", () => {
    expect(authErrorToast(new ApiError(429, "Too many"), "login")).toEqual({
      key: "rate-limit-error",
    });
    expect(authErrorToast(new ApiError(429, "Too many"), "register")).toEqual({
      key: "rate-limit-error",
    });
  });

  it("maps a 401 on login to the credentials error", () => {
    expect(
      authErrorToast(
        new ApiError(401, "Incorrect username or password"),
        "login",
      ),
    ).toEqual({ key: "login-error" });
  });

  it("shows a long-lived toast for accounts pending deletion", () => {
    expect(
      authErrorToast(new ApiError(403, "account_pending_deletion"), "login"),
    ).toEqual({ key: "account-pending-deletion", duration: 10000 });
  });

  it("does not treat a disabled-account 403 as pending deletion", () => {
    expect(
      authErrorToast(new ApiError(403, "Account disabled"), "login"),
    ).toEqual({ key: "login-error" });
  });

  it("maps a 409 on register to the username-taken message", () => {
    expect(
      authErrorToast(new ApiError(409, "Username already taken"), "register"),
    ).toEqual({ key: "username-taken" });
  });

  it("falls back to a generic register error for other register failures", () => {
    expect(
      authErrorToast(
        new ApiError(403, "Self-registration is disabled"),
        "register",
      ),
    ).toEqual({ key: "register-error" });
  });
});
