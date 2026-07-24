import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

export * from "@testing-library/react";

interface RenderWithProvidersOptions extends RenderOptions {
  /** Wrap in a ReactFlowProvider, for components that read React Flow context. */
  reactFlow?: boolean;
}

function Providers({
  children,
  reactFlow,
}: {
  children: ReactNode;
  reactFlow?: boolean;
}) {
  if (reactFlow) {
    return <ReactFlowProvider>{children}</ReactFlowProvider>;
  }
  return <>{children}</>;
}

/**
 * Thin wrapper around Testing Library's `render` for the providers this app's
 * components actually need in tests (currently only `ReactFlowProvider`, and
 * only for the handful of components that read React Flow context — i18n and
 * Zustand stores are module-level singletons, not React context, so most
 * component tests need no wrapper at all).
 */
export function renderWithProviders(
  ui: ReactElement,
  { reactFlow, ...options }: RenderWithProvidersOptions = {},
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <Providers reactFlow={reactFlow}>{children}</Providers>
    ),
    ...options,
  });
}
