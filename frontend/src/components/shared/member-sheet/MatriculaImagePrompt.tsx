import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { isMatriculaUrl } from "@/utils/matricula";

interface Props {
  url: string;
  disabled: boolean;
  onChooseImage: (file: File) => void;
}

/** Fetch only on request; keep an explicit local-file fallback for unavailable scans. */
export function MatriculaImagePrompt({ url, disabled, onChooseImage }: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.member-sheet.documents.matricula",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const fetchImage = useDocumentStore((state) => state.fetchMatriculaImage);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [invalidImage, setInvalidImage] = useState(false);

  useEffect(() => {
    setLoading(false);
    setFetchFailed(false);
    setInvalidImage(false);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [url, disabled]);

  const fetchScan = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setFetchFailed(false);
    const timeout = setTimeout(() => {
      if (controllerRef.current !== controller) return;
      controller.abort();
      controllerRef.current = null;
      setLoading(false);
      setFetchFailed(true);
    }, 60_000);
    try {
      const file = await fetchImage(url.trim(), controller.signal);
      if (!controller.signal.aborted) onChooseImage(file);
    } catch {
      if (!controller.signal.aborted) setFetchFailed(true);
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  if (!isMatriculaUrl(url)) return null;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <p className="text-sm font-medium">{t("prompt")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || loading}
          onClick={() => void fetchScan()}
        >
          {loading ? <Spinner /> : <ImagePlus />}
          {loading ? t("fetching") : t("fetch")}
        </Button>
        {loading && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              controllerRef.current?.abort();
              controllerRef.current = null;
              setLoading(false);
            }}
          >
            {t("cancel")}
          </Button>
        )}
      </div>
      {fetchFailed && (
        <>
          <p role="alert" className="text-xs text-destructive">
            {t("error-fetch")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" asChild>
              <a href={url.trim()} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                {t("open")}
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus />
              {t("choose")}
            </Button>
          </div>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.gif"
        aria-label={t("choose")}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
            setInvalidImage(true);
            return;
          }
          setInvalidImage(false);
          onChooseImage(file);
        }}
      />
      {invalidImage && (
        <p role="alert" className="text-xs text-destructive">
          {t("error-type")}
        </p>
      )}
    </div>
  );
}
