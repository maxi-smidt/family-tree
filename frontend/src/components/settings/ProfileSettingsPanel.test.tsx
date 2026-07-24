import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import type { User } from "@/types/user";
import { ProfileSettingsPanel } from "./ProfileSettingsPanel";

vi.mock("@/components/auth/AccountAvatar", () => ({
  AccountAvatar: () => <div data-testid="account-avatar" />,
}));

vi.mock("@/components/shared/member-sheet/dialog/ImageCropDialog", () => ({
  ImageCropDialog: ({
    imageData,
    onConfirm,
  }: {
    imageData: string | null;
    onConfirm: (imageData: string) => void;
  }) =>
    imageData ? (
      <button
        type="button"
        onClick={() => onConfirm("data:image/jpeg;base64,Y3JvcHBlZA==")}
      >
        Confirm crop
      </button>
    ) : null,
}));

const USER: User = {
  id: "user-1",
  username: "ada",
  email: null,
  full_name: null,
  first_name: "Ada",
  last_name: "Lovelace",
  is_admin: false,
  is_active: true,
  auth_provider: "local",
  created_at: "2026-01-01T00:00:00Z",
};

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL() {
    this.result = "data:image/png;base64,b3JpZ2luYWw=";
    this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
  }
}

describe("ProfileSettingsPanel", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: USER,
      accountOperation: "idle",
      uploadProfileImage: vi.fn().mockResolvedValue(undefined),
    });
    vi.stubGlobal("FileReader", MockFileReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ user: null });
  });

  it("crops a selected profile image before uploading it", async () => {
    const { container } = render(<ProfileSettingsPanel />);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: {
        files: [new File(["source"], "source.png", { type: "image/png" })],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm crop" }));

    await waitFor(() => {
      expect(useAuthStore.getState().uploadProfileImage).toHaveBeenCalledTimes(
        1,
      );
    });
    const uploaded = vi.mocked(useAuthStore.getState().uploadProfileImage).mock
      .calls[0][0];
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded.name).toBe("profile.jpg");
    expect(uploaded.type).toBe("image/jpeg");
  });
});
