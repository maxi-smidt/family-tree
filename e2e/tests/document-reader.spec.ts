import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { test, expect, type ApiClient } from "../fixtures";
import { API_URL } from "../playwright.config";
import { CURRENT_SCHEMA_EPOCH, SCHEMA_EPOCH_HEADER } from "../fixtures/api";
import { loginAs, openView, selectTree } from "../fixtures/ui";

test.setTimeout(60_000);

// A real two-page PDF, with different text and page sizes so the canvas must
// actually change on navigation. No browser PDF plugin or external fixture.
function registerPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 700] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["Birth register", "Marriage register"].map((heading) => {
      const stream = `BT /F1 30 Tf 50 620 Td (${heading}) Tj /F1 16 Tf 0 -50 Td (Johann Schmidt - 1890) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function seedDocument(page: Page, api: ApiClient, treeId: string) {
  const document = await api.post<{ id: string }>(
    `/workspaces/${treeId}/documents`,
    { title: "Family registers", member_ids: [] },
  );
  const headers = {
    Authorization: `Bearer ${api.token}`,
    [SCHEMA_EPOCH_HEADER]: CURRENT_SCHEMA_EPOCH,
  };
  const base = `${API_URL}/workspaces/${treeId}/documents/${document.id}`;
  const uploaded = await page.request.post(`${base}/files`, {
    headers,
    multipart: {
      filename: "register.pdf",
      file: {
        name: "register.pdf",
        mimeType: "application/pdf",
        buffer: registerPdf(),
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const file = (await uploaded.json()) as { id: string; url: string };
  const textUrl = `${base}/files/${file.id}/text`;
  const saved = await page.request.put(textUrl, {
    headers,
    data: {
      markdown:
        "<!-- page 1 -->\n# Birth register\n\nJohann Schmidt, 1890\n\n<!-- page 2 -->\n# Marriage register\n\nJohann and Maria, 1912",
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return { textUrl, headers, mediaUrl: file.url };
}

async function openReader(page: Page, treeName: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  if ((await sidebar.getAttribute("data-state")) === "collapsed") {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
  }
  await selectTree(page, treeName);
  await openView(page, "Documents");
  await page.getByRole("button", { name: "Show details" }).click();
  await page.getByRole("button", { name: "register.pdf", exact: true }).click();
  return page.getByRole("dialog", { name: "Text of register.pdf" });
}

for (const width of [360, 1280]) {
  test(`document reader navigates, pans and edits at ${width}px`, async ({
    adminPage: page,
    adminApi,
    seedTree,
  }) => {
    const tree = await seedTree();
    const { textUrl, headers, mediaUrl } = await seedDocument(
      page,
      adminApi,
      tree.id,
    );
    const dialog = await openReader(page, tree.name);
    await page.setViewportSize({ width, height: 800 });
    const original = dialog.getByRole("region", { name: "Original file" });
    const text = dialog.getByRole("region", { name: "Document text" });
    await expect(
      original.getByRole("img", { name: "Original page 1" }),
    ).toBeVisible();
    await expect(
      text.getByRole("heading", { name: "Birth register" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    const footer = dialog.locator('[data-slot="dialog-footer"]');
    const pagination = footer.getByRole("group", { name: "Document pages" });
    await expect(pagination).toBeVisible();
    const paginationBox = (await pagination.boundingBox())!;
    const footerBox = (await footer.boundingBox())!;
    expect(
      Math.abs(
        paginationBox.x +
          paginationBox.width / 2 -
          (footerBox.x + footerBox.width / 2),
      ),
    ).toBeLessThanOrEqual(1);
    const readerBox = (await dialog
      .locator('[data-slot="document-reader"]')
      .boundingBox())!;
    expect(paginationBox.y).toBeGreaterThanOrEqual(
      readerBox.y + readerBox.height - 1,
    );
    const downloadEvent = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("register.pdf");
    expect(await download.failure()).toBeNull();
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    expect(await readFile(downloadedPath!)).toEqual(registerPdf());
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      )
      .toBeLessThanOrEqual(1);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    const fileBox = (await original.boundingBox())!;
    const textBox = (await text.boundingBox())!;
    if (width < 768) {
      expect(textBox.y).toBeGreaterThanOrEqual(fileBox.y + fileBox.height - 1);
      await expect(dialog.getByRole("separator")).toBeHidden();
    } else {
      expect(textBox.x).toBeGreaterThan(fileBox.x + fileBox.width);
      const divider = dialog.getByRole("separator");
      await divider.focus();
      await page.keyboard.press("ArrowRight");
      await expect(divider).toHaveAttribute("aria-valuenow", "55");
      expect((await original.boundingBox())!.width).toBeGreaterThan(
        fileBox.width,
      );
      const handle = (await divider.boundingBox())!;
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(handle.x - 70, handle.y + handle.height / 2);
      await page.mouse.up();
      await expect
        .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
        .toBeLessThan(55);
    }
    await dialog.getByRole("button", { name: "Next page" }).click();
    const canvas = original.getByRole("img", { name: "Original page 2" });
    await expect(canvas).toBeVisible();
    await expect(
      text.getByRole("heading", { name: "Marriage register" }),
    ).toBeVisible();
    await expect(
      text.getByRole("heading", { name: "Birth register" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Next page" }),
    ).toBeDisabled();
    const initialWidth = (await canvas.boundingBox())!.width;
    await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect
      .poll(async () => (await canvas.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialWidth);
    const viewport = dialog.locator('[data-slot="document-file-viewport"]');
    const area = (await viewport.boundingBox())!;
    await page.mouse.move(area.x + area.width * 0.75, area.y + 70);
    await page.mouse.down();
    await page.mouse.move(area.x + 15, area.y + 40);
    await page.mouse.up();
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Fit to width" }).click();
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollLeft))
      .toBe(0);
    await dialog.getByRole("button", { name: "Edit text" }).click();
    await dialog
      .getByRole("textbox")
      .fill("# Marriage register\n\nJohann and Maria, 1913");
    await dialog.getByRole("button", { name: "Previous page" }).click();
    await expect(dialog.getByRole("textbox")).toHaveValue(/Birth register/);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Edit text" }),
    ).toBeVisible();
    const response = await page.request.get(textUrl, { headers });
    const saved = (await response.json()) as { markdown: string };
    expect(saved.markdown).toContain("<!-- page 1 -->\n# Birth register");
    expect(saved.markdown).toContain(
      "<!-- page 2 --># Marriage register\n\nJohann and Maria, 1913",
    );
    await expect(page.getByText("Text saved", { exact: true })).toBeHidden();
    await page.screenshot({
      path: test.info().outputPath(`reader-${width}.png`),
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    // Use the desktop navigation width again to reach the file row directly.
    await page.setViewportSize({ width: 1280, height: 800 });
    const mediaEvent = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url() === new URL(mediaUrl, API_URL).href,
    );
    const popupEvent = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Open in another window" }).click();
    const popup = await popupEvent;
    try {
      const media = await mediaEvent;
      expect(media.ok()).toBeTruthy();
      expect(media.headers()["content-type"]).toContain("application/pdf");
      expect(Number(media.headers()["content-length"])).toBe(
        registerPdf().length,
      );
      // Native PDF windows expose a placeholder URL in headless Chromium;
      // verify the requested original file and actual window creation instead.
      expect(popup.isClosed()).toBe(false);
    } finally {
      await popup.close();
    }
  });
}

test("view access can read PDF pages without editing", async ({
  page,
  adminApi,
  seedTree,
  secondUser,
}) => {
  const tree = await seedTree();
  await seedDocument(page, adminApi, tree.id);
  await adminApi.post(`/workspaces/${tree.id}/access`, {
    username: secondUser.username,
    role: "viewer",
  });
  await loginAs(page, secondUser);
  const dialog = await openReader(page, tree.name);
  await dialog.getByRole("button", { name: "Next page" }).click();
  await expect(
    dialog.getByRole("img", { name: "Original page 2" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Marriage register" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Edit text" })).toHaveCount(
    0,
  );
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
});
