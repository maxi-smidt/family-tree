import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMember } from "@/types/member";
import { MemberPicker } from "./MemberPicker";

const members = Array.from({ length: 30 }, (_, index) => ({
  ...createMember({ x: 0, y: 0 }),
  firstName: index === 0 ? "Grace" : "Ada",
  lastName: index === 0 ? "Hopper" : `Lovelace ${index}`,
}));

const nextFrame = () =>
  act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });

const renderPicker = (props = {}) => {
  const onChange = vi.fn();
  render(
    <MemberPicker
      members={members}
      value={null}
      onChange={onChange}
      placeholder="Choose a person"
      noResultsText="No people found"
      {...props}
    />,
  );
  return onChange;
};

describe("MemberPicker search scrolling", () => {
  it("returns to the top when searching, refining, and clearing a query", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("combobox"));
    const list = await screen.findByRole("listbox");
    const input = screen.getByPlaceholderText(/Search people/);
    await nextFrame();

    for (const query of ["Ada", "Ada Love", ""]) {
      list.scrollTop = 600;
      fireEvent.change(input, { target: { value: query } });
      await waitFor(() => expect(list.scrollTop).toBe(0));
      expect(screen.getAllByRole("option")[0]).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });

  it("allows scrolling and keyboard selection after the search settles", async () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole("combobox"));
    const input = screen.getByPlaceholderText(/Search people/);
    fireEvent.change(input, { target: { value: "Ada" } });
    await nextFrame();

    const list = screen.getByRole("listbox");
    list.scrollTop = 400;
    fireEvent.scroll(list);
    await nextFrame();
    expect(list.scrollTop).toBe(400);

    const secondResult = screen.getAllByRole("option")[1];
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(secondResult).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(
      secondResult.getAttribute("data-value"),
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("starts with a fresh search when an automatically opened picker is reopened", async () => {
    renderPicker({ autoOpen: true });
    const input = await screen.findByPlaceholderText(/Search people/);
    fireEvent.change(input, { target: { value: "Grace" } });
    await nextFrame();
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByPlaceholderText(/Search people/)).toHaveValue("");
    await nextFrame();
    expect(screen.getAllByRole("option")).toHaveLength(members.length);
    expect(screen.getByRole("listbox").scrollTop).toBe(0);
  });
});
