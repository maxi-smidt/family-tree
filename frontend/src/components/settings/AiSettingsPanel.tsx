import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAiSettingsStore } from "@/hooks/useAiSettingsStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ApiError } from "@/services/api";
import type { AiProviderId } from "@/types/ai";

/** The person's own AI provider for transcribing document files: which
 *  service, which model, their API key (stored encrypted on the server and
 *  never shown again). The instruction sent with each file lives in the
 *  backend. */
export function AiSettingsPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "user-settings.ai" });
  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);
  const settings = useAiSettingsStore((s) => s.settings);
  const load = useAiSettingsStore((s) => s.load);
  const save = useAiSettingsStore((s) => s.save);
  const remove = useAiSettingsStore((s) => s.remove);

  const [provider, setProvider] = useState<AiProviderId>("gemini");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load(true).catch(() => toast.error(t("error-load")));
  }, [load, t]);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider ?? "gemini");
    setModel(settings.model ?? "");
    setBaseUrl(settings.base_url ?? "");
    setApiKey("");
  }, [settings]);

  if (!settings) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  const providers = settings.providers.filter(
    (p) => isAdmin || !p.custom_base_url || p.id === settings.provider,
  );
  const info = settings.providers.find((p) => p.id === provider);
  const sameProvider = settings.provider === provider;
  const keySaved = sameProvider && settings.has_api_key;
  const needsKey =
    !!info?.needs_api_key && (!keySaved || settings.api_key_unreadable);
  const canSave =
    !busy &&
    (!needsKey || apiKey.trim() !== "") &&
    (!info?.custom_base_url || baseUrl.trim() !== "");

  const handleSave = async () => {
    setBusy(true);
    try {
      await save({
        provider,
        model: model.trim(),
        base_url: info?.custom_base_url ? baseUrl.trim() : null,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      toast.success(t("saved"));
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      toast.error(
        t(
          [
            "api_key_required",
            "invalid_base_url",
            "custom_endpoint_admin_only",
          ].includes(code)
            ? `errors.${code}`
            : "error-save",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await remove();
      toast.success(t("removed"));
    } catch {
      toast.error(t("error-save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <p className="font-medium text-sm">{t("title")}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t("hint")}</p>
        <p className="text-xs text-muted-foreground mt-2">
          {settings.configured ? t("status-on") : t("status-off")}
        </p>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="ai-provider">{t("provider")}</FieldLabel>
        <Select
          value={provider}
          onValueChange={(v) => {
            setProvider(v as AiProviderId);
            setModel(v === settings.provider ? (settings.model ?? "") : "");
            setApiKey("");
          }}
        >
          <SelectTrigger id="ai-provider" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {t(`providers.${p.id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {info && (
          <p className="text-xs text-muted-foreground">
            {t(`provider-hints.${info.id}`)}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="ai-model">{t("model")}</FieldLabel>
        <Input
          id="ai-model"
          className="w-72"
          value={model}
          placeholder={info?.default_model}
          onChange={(e) => setModel(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("model-hint", { model: info?.default_model })}
        </p>
      </div>

      {info?.custom_base_url && (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="ai-base-url">{t("base-url")}</FieldLabel>
          <Input
            id="ai-base-url"
            value={baseUrl}
            placeholder="http://localhost:11434/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <FieldLabel htmlFor="ai-api-key">
          {info?.needs_api_key ? t("api-key") : t("api-key-optional")}
        </FieldLabel>
        <Input
          id="ai-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={keySaved ? t("api-key-keep") : ""}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {keySaved && settings.api_key_unreadable
            ? t("api-key-unreadable")
            : keySaved
              ? settings.api_key_hint
                ? t("api-key-saved-hint", { hint: settings.api_key_hint })
                : t("api-key-saved")
              : t("api-key-storage")}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">{t("privacy")}</p>

      <div className="flex justify-between gap-2">
        {settings.provider ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void handleRemove()}
          >
            {t("turn-off")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          disabled={!canSave}
          onClick={() => void handleSave()}
        >
          {busy && <Spinner />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
