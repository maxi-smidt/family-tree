import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { createMember, createTree } from "../fixtures/seed";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { loginAs, openView, selectTree } from "../fixtures/ui";

async function expectWithinViewport(
  locator: Locator,
  page: Page,
): Promise<void> {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
}

for (const viewport of [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
]) {
  test(`sharing controls fit and remain usable at ${viewport.width}px`, async ({
    adminPage: page,
    adminApi,
    seedTree,
  }) => {
    const tree = await seedTree(`Layout-${crypto.randomUUID().slice(0, 8)}`);
    const recipient = await createTestUser(adminApi, {
      username: `layout-long-username-${crypto.randomUUID().replaceAll("-", "")}`,
    });
    try {
      await adminApi.post(`/workspaces/${tree.id}/access`, {
        username: recipient.username,
        role: "viewer",
      });
      await page.reload();
      await selectTree(page, tree.name);
      // Open through the desktop management view, then exercise the same
      // dialog at both widths without depending on mobile navigation labels.
      await openView(page, "Workspaces");
      await page
        .locator('[data-slot="workspace-card"]')
        .filter({ hasText: tree.name })
        .getByRole("button", { name: "More actions" })
        .click();
      await page.getByRole("menuitem", { name: "Share", exact: true }).click();
      await page.setViewportSize(viewport);

      // The access picker is a popover, which is a dialog too: name this one.
      const dialog = page.getByRole("dialog", {
        name: `Share "${tree.name}"`,
      });
      await expectWithinViewport(dialog, page);
      await expect
        .poll(() =>
          dialog.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);

      // A long account name must not push its role/revoke controls offscreen.
      const recipientRow = dialog
        .getByText(recipient.username, { exact: true })
        .locator("xpath=../..");
      // A role-only API grant shows every area at View, which is no preset
      // (Viewer hides Health and Research tasks), so it reads as Custom.
      const access = recipientRow.getByRole("button", { name: /^Access: / });
      const revoke = recipientRow.getByRole("button", {
        name: "Remove access",
      });
      await access.scrollIntoViewIfNeeded();
      await expectWithinViewport(access, page);
      await expectWithinViewport(revoke, page);
      await expect(access).toHaveAccessibleName("Access: Custom");
      await access.click();
      await page.getByRole("button", { name: "Editor", exact: true }).click();
      await expect(access).toHaveAccessibleName("Access: Editor");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect
        .poll(async () => {
          const access = await adminApi.get<
            Array<{ user_id: string; role: string }>
          >(`/workspaces/${tree.id}/access`);
          return access.find((entry) => entry.user_id === recipient.id)?.role;
        })
        .toBe("editor");

      // Ownership transfer starts collapsed in the People tab. Expand it
      // before checking that a long username fits its controls.
      const ownership = dialog.locator("summary", {
        hasText: "Transfer ownership",
      });
      await ownership.scrollIntoViewIfNeeded();
      await ownership.click();
      const target = dialog.getByRole("combobox", {
        name: "Select a new owner…",
      });
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await page
        .getByRole("option", { name: recipient.username, exact: true })
        .click();
      const transfer = dialog.getByRole("button", {
        name: "Transfer",
        exact: true,
      });
      // Closing the owner list can leave the dialog scrolled a little, so
      // bring each control back into view before checking it fits.
      await target.scrollIntoViewIfNeeded();
      await expectWithinViewport(target, page);
      await transfer.scrollIntoViewIfNeeded();
      await expectWithinViewport(transfer, page);
      await expect
        .poll(() =>
          dialog.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      await transfer.click();
      const confirmation = page.getByRole("alertdialog");
      await expect(confirmation).toBeVisible();
      await confirmation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(dialog).toBeVisible();
    } finally {
      await deleteTestUser(adminApi, recipient.id);
    }
  });
}

test("tab content fills the viewport and long timelines scroll inside the view", async ({
  page,
  secondUser,
  secondApi,
}) => {
  const tree = await createTree(secondApi, "Layout timeline");
  try {
    await loginAs(page, secondUser);
    await selectTree(page, tree.name);
    await openView(page, "Timeline");
    const panel = page.getByRole("tabpanel");
    const empty = panel.getByText("No events found", { exact: true });
    await expect(empty).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    const emptyBox = (await empty.boundingBox())!;
    expect(panelBox.y + panelBox.height).toBeCloseTo(
      page.viewportSize()!.height,
      0,
    );
    // Full-height flex propagation is observable even before there are rows.
    expect(emptyBox.y).toBeGreaterThan(page.viewportSize()!.height / 2);

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        secondApi.post(`/workspaces/${tree.id}/events`, {
          id: crypto.randomUUID(),
          event_type: "marriage",
          date: `${1980 + index}`,
          description: `Scroll marker ${index}`,
          created_at: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    await page.reload();
    const items = panel.getByRole("listitem");
    await expect(items).toHaveCount(24);
    await expect(items.last()).not.toBeInViewport();
    await items.last().scrollIntoViewIfNeeded();
    await expect(items.last()).toBeInViewport({ ratio: 1 });
    await expect(
      panel.getByRole("heading", { name: "Timeline", exact: true }),
    ).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  } finally {
    await secondApi.delete(`/workspaces/${tree.id}`);
  }
});

test("session warning clears the sidebar trigger and can be dismissed", async ({
  page,
  secondUser,
}) => {
  await page.clock.install();
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/login") &&
      response.request().method() === "POST",
  );
  await loginAs(page, secondUser);
  const { access_token: token } = (await (await login).json()) as {
    access_token: string;
  };
  const { exp } = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ) as { exp: number };
  // Enter the real token's warning window without waiting for hours or
  // replacing the auth store. Stay before the automatic refresh deadline.
  await page.clock.fastForward(
    exp * 1000 - (await page.evaluate(() => Date.now())) - 30 * 60 * 1000,
  );

  const alert = page.getByRole("alert");
  const title = alert.getByText("Your session is expiring soon", {
    exact: true,
  });
  await expect(title).toBeVisible();
  const trigger = page.locator('[data-sidebar="trigger"]');
  const triggerBox = (await trigger.boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  const iconBox = (await alert.locator(":scope > svg").boundingBox())!;
  expect(iconBox.x).toBeGreaterThanOrEqual(triggerBox.x + triggerBox.width);
  expect(titleBox.x).toBeGreaterThanOrEqual(triggerBox.x + triggerBox.width);
  await expectWithinViewport(
    alert.getByRole("button", { name: "Dismiss" }),
    page,
  );
  await trigger.click();
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).not.toBeVisible();
});

test("phones navigate from the tab bar and open a person from the tree", async ({
  adminPage: page,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree(`Phone-${crypto.randomUUID().slice(0, 8)}`);
  const member = await createMember(adminApi, tree.id, {
    firstName: "Phone",
    lastName: "Person",
  });
  await page.reload();
  // Pick the workspace with the desktop switcher, then continue on a phone.
  await selectTree(page, tree.name);
  await openView(page, "Tree");
  await page.setViewportSize({ width: 390, height: 844 });

  const tabs = page.getByRole("navigation", { name: "Quick navigation" });
  await expect(tabs).toBeVisible();
  await expect(page.locator('[data-sidebar="trigger"]')).toHaveCount(0);
  await expect(page.getByTestId("tree-selector-header")).toContainText(
    tree.name,
  );

  // Tapping a person brings up the pull-up card; its profile is full screen.
  await page.getByRole("button", { name: "Fit view" }).click();
  await page.locator(`.react-flow__node[data-id="${member.id}"]`).click();
  const card = page.getByRole("region", { name: "Phone Person" });
  await expect(card).toBeVisible();
  await expectWithinViewport(card, page);
  await card.getByRole("button", { name: "View profile" }).click();
  const profile = page.getByRole("dialog", { name: "Person" });
  await expect(
    profile.getByRole("heading", { name: "Phone Person" }),
  ).toBeVisible();
  await profile.getByRole("button", { name: "Back to tree" }).click();
  await expect(profile).toBeHidden();
  await expect(card).toBeVisible();

  // The tab bar switches views; More opens everything else.
  await tabs.getByRole("button", { name: "People" }).click();
  await expect(
    page.getByRole("heading", { name: "People", level: 1 }),
  ).toBeVisible();
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Workspaces" }),
  ).toBeVisible();
});

test("the empty-workspace prompt sits in the middle of the canvas", async ({
  adminPage: page,
  seedTree,
}) => {
  const tree = await seedTree(`Empty-${crypto.randomUUID().slice(0, 8)}`);
  await page.reload();
  await selectTree(page, tree.name);
  await openView(page, "Tree");

  const canvas = page.getByLabel("Family tree canvas");
  const prompt = canvas.locator('[data-slot="empty"]');
  await expect(prompt).toContainText("Start your family tree");
  const c = (await canvas.boundingBox())!;
  const p = (await prompt.boundingBox())!;
  expect(Math.abs(p.x + p.width / 2 - (c.x + c.width / 2))).toBeLessThan(2);
  expect(Math.abs(p.y + p.height / 2 - (c.y + c.height / 2))).toBeLessThan(2);
});

test("timeline connectors meet dot centers across variable-height rows", async ({
  adminPage: page,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("Timeline alignment");
  for (const [index, date] of [
    "2024-06-01",
    "2024-05-01",
    "2024-04-01",
    "1999-01-01",
  ].entries()) {
    await adminApi.post(`/workspaces/${tree.id}/events`, {
      id: crypto.randomUUID(),
      event_type: "marriage",
      date,
      description: "A timeline entry with details. ".repeat(index * 10 + 1),
      created_at: "2026-01-01T00:00:00Z",
    });
  }
  await page.reload();
  await selectTree(page, tree.name);
  await openView(page, "Timeline");
  await page.setViewportSize({ width: 1280, height: 900 });
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("listitem")).toHaveCount(4);
  for (const expanded of [false, true]) {
    if (expanded)
      await panel.getByRole("button", { name: "Show details" }).click();
    for (const list of await panel.locator("ol").all()) {
      const dots = await list.locator('[data-slot="timeline-dot"]').all();
      const lines = await list
        .locator('[data-slot="timeline-connector"]')
        .all();
      const boxes = await Promise.all(
        dots.map(async (dot, i) => ({
          dot: (await dot.boundingBox())!,
          line: (await lines[i].boundingBox())!,
        })),
      );
      for (const { dot, line } of boxes) {
        expect(line.x + line.width / 2).toBeCloseTo(dot.x + dot.width / 2, 1);
      }
      const first = boxes[0];
      const last = boxes[boxes.length - 1];
      expect(first.line.y).toBeCloseTo(first.dot.y + first.dot.height / 2, 1);
      expect(last.line.y + last.line.height).toBeCloseTo(
        last.dot.y + last.dot.height / 2,
        1,
      );
      boxes.slice(1).forEach(({ line }, index) => {
        const previous = boxes[index].line;
        expect(previous.y + previous.height).toBeCloseTo(line.y, 1);
      });
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  for (const dot of await panel.locator('[data-slot="timeline-dot"]').all()) {
    await expect(dot).toBeHidden();
  }
  expect(
    await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
});
