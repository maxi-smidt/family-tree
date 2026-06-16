import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Bold, Italic, Heading2, List, Link } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MarkdownContent } from "@/components/shared/MarkdownContent";

type Props = {
  id?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

type InsertionSpec = {
  prefix: string;
  suffix: string;
  defaultText: string;
};

type EditorTab = "write" | "preview";

function insertMarkdown(
  textarea: HTMLTextAreaElement,
  spec: InsertionSpec,
  onChange: (v: string) => void,
): void {
  const { prefix, suffix, defaultText } = spec;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.substring(0, start);
  const selected = textarea.value.substring(start, end);
  const after = textarea.value.substring(end);

  const text = selected.length > 0 ? selected : defaultText;
  const inserted = `${prefix}${text}${suffix}`;
  const next = `${before}${inserted}${after}`;
  onChange(next);

  // Restore selection after React re-render
  requestAnimationFrame(() => {
    if (selected.length > 0) {
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + text.length,
      );
    } else {
      const cursor = start + prefix.length + text.length;
      textarea.setSelectionRange(cursor, cursor);
    }
    textarea.focus();
  });
}

export function MarkdownEditor({ id, value, placeholder, onChange }: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.markdown-editor",
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("write");

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.style.overflowY = "hidden";
  }, []);

  useLayoutEffect(() => {
    if (activeTab !== "write") return;

    resizeTextarea();
    const frame = requestAnimationFrame(resizeTextarea);

    return () => cancelAnimationFrame(frame);
  }, [activeTab, resizeTextarea, value]);

  useLayoutEffect(() => {
    if (activeTab !== "write") return;

    const handleResize = () => resizeTextarea();
    window.addEventListener("resize", handleResize);

    const observedElement = textareaRef.current?.parentElement;
    let resizeObserver: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined" && observedElement) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(observedElement);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
    };
  }, [activeTab, resizeTextarea]);

  function handleToolbarAction(spec: InsertionSpec) {
    if (textareaRef.current) {
      insertMarkdown(textareaRef.current, spec, onChange);
    }
  }

  const toolbarButtons: Array<{
    icon: React.ReactNode;
    labelKey: string;
    spec: InsertionSpec;
  }> = [
    {
      icon: <Bold className="size-3.5" />,
      labelKey: "bold",
      spec: { prefix: "**", suffix: "**", defaultText: t("bold-default") },
    },
    {
      icon: <Italic className="size-3.5" />,
      labelKey: "italic",
      spec: { prefix: "_", suffix: "_", defaultText: t("italic-default") },
    },
    {
      icon: <Heading2 className="size-3.5" />,
      labelKey: "heading",
      spec: { prefix: "## ", suffix: "", defaultText: t("heading-default") },
    },
    {
      icon: <List className="size-3.5" />,
      labelKey: "bullet",
      spec: { prefix: "- ", suffix: "", defaultText: t("bullet-default") },
    },
    {
      icon: <Link className="size-3.5" />,
      labelKey: "link",
      spec: {
        prefix: "[",
        suffix: `](${t("link-url-placeholder")})`,
        defaultText: t("link-default"),
      },
    },
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) =>
        setActiveTab(tab === "preview" ? "preview" : "write")
      }
      className="w-full gap-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        {/* Toolbar */}
        <div
          className="flex items-center gap-0.5"
          role="toolbar"
          aria-label={t("toolbar-label")}
        >
          {toolbarButtons.map((btn) => (
            <Tooltip key={btn.labelKey}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t(btn.labelKey)}
                  onMouseDown={(e) => {
                    // Prevent textarea from losing focus
                    e.preventDefault();
                    handleToolbarAction(btn.spec);
                  }}
                >
                  {btn.icon}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t(btn.labelKey)}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Write / Preview toggle */}
        <TabsList className="h-7 text-xs">
          <TabsTrigger value="write" className="h-5 px-2 text-xs">
            {t("tab-write")}
          </TabsTrigger>
          <TabsTrigger value="preview" className="h-5 px-2 text-xs">
            {t("tab-preview")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="write">
        <Textarea
          ref={textareaRef}
          id={id}
          value={value}
          className="overflow-hidden text-xs! shadow-none resize-none font-mono"
          rows={4}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={resizeTextarea}
        />
      </TabsContent>

      <TabsContent value="preview">
        <div className="min-h-[6rem] rounded-md border border-input bg-transparent px-3 py-2">
          {value.trim() ? (
            <MarkdownContent content={value} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t("preview-empty")}
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
