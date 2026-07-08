import { useEffect, useState } from "react";
import { TreeService } from "@/services/TreeService";
import { activeTreeId } from "@/hooks/useTreeStore";

export type GeocodeStatus = "idle" | "checking" | "found" | "not-found";

export interface GeocodePreview {
  status: GeocodeStatus;
  displayName: string | null;
}

// Debounced geocode preview — reports whether a typed location string resolves
// to coordinates, so location inputs can show a resolution hint. Lifted from
// the event dialog so every location input behaves the same way.
export function useGeocodePreview(
  location: string | null | undefined,
  enabled = true,
): GeocodePreview {
  const [status, setStatus] = useState<GeocodeStatus>("idle");
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const loc = location?.trim();
    if (!enabled || !loc) {
      setStatus("idle");
      setDisplayName(null);
      return;
    }
    setStatus("checking");
    const timer = setTimeout(async () => {
      const treeId = activeTreeId();
      if (!treeId) return;
      try {
        const result = await TreeService.geocodePreview(treeId, loc);
        if (result.resolved) {
          setStatus("found");
          setDisplayName(result.display_name);
        } else {
          setStatus("not-found");
          setDisplayName(null);
        }
      } catch {
        setStatus("idle");
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [location, enabled]);

  return { status, displayName };
}
