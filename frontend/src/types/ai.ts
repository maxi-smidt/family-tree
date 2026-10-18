/** A person's own AI provider for transcribing document files (#1123). */

export type AiProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "openai_compatible";

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  default_model: string;
  needs_api_key: boolean;
  /** The person enters the endpoint (admins only). */
  custom_base_url: boolean;
  supports_pdf: boolean;
}

/** As the server returns them; the API key itself is never sent back. */
export interface AiSettings {
  configured: boolean;
  provider: AiProviderId | null;
  model: string | null;
  base_url: string | null;
  has_api_key: boolean;
  api_key_hint: string | null;
  /** A key is stored but the server can no longer decrypt it. */
  api_key_unreadable: boolean;
  /** The custom prompt, or `null` for the default. */
  prompt: string | null;
  default_prompt: string;
  providers: AiProviderInfo[];
}

export interface AiSettingsSave {
  provider: AiProviderId;
  model: string;
  base_url?: string | null;
  /** Omitted keeps the saved key; `""` removes it. */
  api_key?: string | null;
  prompt?: string | null;
}

/** MIME types a provider can read: images always, PDFs if it says so. */
export const AI_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export function canTranscribe(
  provider: AiProviderInfo | undefined,
  mimeType: string | null,
): boolean {
  if (!provider || !mimeType) return false;
  const mime = mimeType.toLowerCase();
  return (
    AI_IMAGE_TYPES.includes(mime) ||
    (provider.supports_pdf && mime === "application/pdf")
  );
}
