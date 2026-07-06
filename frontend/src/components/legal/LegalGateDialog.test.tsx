import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useLegalStore } from "@/hooks/useLegalStore";
import { type User } from "@/types/user";
import { LegalGateDialog } from "./LegalGateDialog";

const USER: User = {
  id: "user-1",
  username: "first-user",
  email: null,
  full_name: null,
  is_admin: false,
  is_active: true,
  auth_provider: "local",
  created_at: "2026-01-01T00:00:00Z",
};

const DOCUMENTS = {
  terms_body: "Terms body",
  privacy_body: "Privacy body",
  imprint_body: "Imprint body",
  version: "2",
  locale: "en",
};

describe("LegalGateDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useAuthStore.setState({ user: null });
    useLegalStore.setState({
      documents: null,
      loaded: false,
      loading: false,
      accepting: false,
      load: vi.fn().mockResolvedValue(undefined),
      accept: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("does not render when the user has already accepted", () => {
    useAuthStore.setState({
      user: { ...USER, legal_acceptance_required: true, legal_accepted: true },
    });
    render(<LegalGateDialog />);
    expect(screen.queryByText("Before you continue")).not.toBeInTheDocument();
  });

  it("does not render when legal acceptance is not required", () => {
    useAuthStore.setState({
      user: {
        ...USER,
        legal_acceptance_required: false,
        legal_accepted: false,
      },
    });
    render(<LegalGateDialog />);
    expect(screen.queryByText("Before you continue")).not.toBeInTheDocument();
  });

  it("opens and loads the documents when acceptance is pending", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    useLegalStore.setState({ load });
    useAuthStore.setState({
      user: {
        ...USER,
        legal_acceptance_required: true,
        legal_accepted: false,
      },
    });

    render(<LegalGateDialog />);

    expect(screen.getByText("Before you continue")).toBeInTheDocument();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });

  it("keeps Accept disabled until the checkbox is ticked, then accepts", async () => {
    const accept = vi.fn().mockResolvedValue(undefined);
    useLegalStore.setState({
      documents: DOCUMENTS,
      loaded: true,
      accept,
    });
    useAuthStore.setState({
      user: {
        ...USER,
        legal_acceptance_required: true,
        legal_accepted: false,
      },
    });

    render(<LegalGateDialog />);

    const acceptButton = screen.getByRole("button", {
      name: "Accept and continue",
    });
    expect(acceptButton).toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(acceptButton).toBeEnabled();

    fireEvent.click(acceptButton);
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("has no close button and ignores Escape", async () => {
    useLegalStore.setState({ documents: DOCUMENTS, loaded: true });
    useAuthStore.setState({
      user: {
        ...USER,
        legal_acceptance_required: true,
        legal_accepted: false,
      },
    });

    render(<LegalGateDialog />);

    expect(
      screen.queryByRole("button", { name: /close/i }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(screen.getByText("Before you continue")).toBeInTheDocument();
  });
});
