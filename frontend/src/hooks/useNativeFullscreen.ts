import { useEffect, useRef, useState } from "react";

/** Own native fullscreen only while this reader is open. The document root
 * keeps dialogs, menus and tooltips rendered through portals visible too. */
export function useNativeFullscreen(open: boolean) {
  const [fullscreen, setFullscreen] = useState(false);
  const ownsFullscreen = useRef(false);
  const active = useRef(open);
  const supported =
    typeof document.documentElement.requestFullscreen === "function" &&
    document.fullscreenEnabled;

  useEffect(() => {
    active.current = open;
    const sync = () => {
      const ours =
        ownsFullscreen.current &&
        document.fullscreenElement === document.documentElement;
      if (!ours) ownsFullscreen.current = false;
      setFullscreen(ours);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !ownsFullscreen.current ||
        document.fullscreenElement !== document.documentElement
      )
        return;
      // Exit before a portalled tooltip or menu consumes Escape. The next
      // Escape can then dismiss the reader normally.
      event.preventDefault();
      event.stopPropagation();
      void document.exitFullscreen().catch(() => {});
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("keydown", escape, true);
    return () => {
      active.current = false;
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("keydown", escape, true);
      if (
        ownsFullscreen.current &&
        document.fullscreenElement === document.documentElement
      ) {
        void document.exitFullscreen().catch(() => {});
      }
      ownsFullscreen.current = false;
    };
  }, [open]);

  const exit = async () => {
    if (
      ownsFullscreen.current &&
      document.fullscreenElement === document.documentElement
    ) {
      await document.exitFullscreen();
    }
  };

  const toggle = async () => {
    if (!supported || !active.current) return;
    if (
      ownsFullscreen.current &&
      document.fullscreenElement === document.documentElement
    ) {
      await exit();
      return;
    }
    ownsFullscreen.current = true;
    try {
      await document.documentElement.requestFullscreen({
        navigationUI: "hide",
      });
      // Closing the reader while the browser is entering fullscreen must
      // not leave the rest of the application in fullscreen.
      if (!active.current) {
        if (document.fullscreenElement === document.documentElement)
          await document.exitFullscreen();
        ownsFullscreen.current = false;
      } else {
        setFullscreen(document.fullscreenElement === document.documentElement);
      }
    } catch (error) {
      ownsFullscreen.current = false;
      throw error;
    }
  };

  return { fullscreen, supported, toggle };
}
