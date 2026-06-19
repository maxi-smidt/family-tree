import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { CreateDatabaseDialog } from "./CreateDatabaseDialog";

describe("CreateDatabaseDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("allows cancellation by default", () => {
    const onCancel = vi.fn();

    render(
      <CreateDatabaseDialog isOpen onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables cancellation when the tutorial owns the dialog", () => {
    const onCancel = vi.fn();

    render(
      <CreateDatabaseDialog
        isOpen
        onConfirm={vi.fn()}
        onCancel={onCancel}
        disableCancel
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).not.toHaveBeenCalled();
  });
});
