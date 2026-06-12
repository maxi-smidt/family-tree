export interface BuildInfo {
  version: string;
  revision: string;
  buildDate: string;
}

export const buildInfo: BuildInfo = {
  version:
    import.meta.env.VITE_APP_VERSION ||
    (import.meta.env.DEV ? "dev" : "unknown"),
  revision: import.meta.env.VITE_GIT_SHA || "dev",
  buildDate: import.meta.env.VITE_BUILD_DATE || "",
};

export const APP_VERSION = buildInfo.version;
