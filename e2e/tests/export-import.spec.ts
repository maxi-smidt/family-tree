/**
 * E2E tests: Export / import round-trip (#268)
 * native, encrypted, and GEDCOM formats.
 * Depends on foundation harness (#263).
 */

import { test, expect } from "../fixtures";
import { seedMinimalFamily, deleteTree } from "../fixtures/seed";
import { waitForJob } from "../fixtures/api";
import { API_URL } from "../playwright.config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exportTree(
  token: string,
  treeId: string,
  password?: string,
): Promise<ArrayBuffer> {
  const exportRes = await fetch(`${API_URL}/trees/${treeId}/export`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: password || null }),
  });
  expect(exportRes.ok).toBe(true);
  const blob = await exportRes.arrayBuffer();
  expect(blob.byteLength).toBeGreaterThan(0);
  return blob;
}

async function importBundle(
  token: string,
  blob: ArrayBuffer,
  name: string,
  password?: string,
): Promise<{ id: string; name: string }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([blob], { type: "application/octet-stream" }),
    "export.treedb",
  );
  form.append("name", name);
  if (password) form.append("password", password);

  const importRes = await fetch(`${API_URL}/trees/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  expect(importRes.status).toBe(202);
  const { job_id } = (await importRes.json()) as { job_id: string };
  const treeId = await waitForJob(token, job_id);
  const treeRes = await fetch(`${API_URL}/trees/${treeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(treeRes.ok).toBe(true);
  return (await treeRes.json()) as { id: string; name: string };
}

async function expectFamilyMembers(
  api: { get<T = unknown>(path: string): Promise<T> },
  treeId: string,
) {
  const members = await api.get<Array<{ firstName?: string }>>(
    `/trees/${treeId}/members`,
  );
  const names = members.map((m) => m.firstName);
  expect(names).toEqual(expect.arrayContaining(["Alice", "Bob", "Charlie"]));
}

// ---------------------------------------------------------------------------
// Native round-trip
// ---------------------------------------------------------------------------

test("native export→import round-trip — member names preserved", async ({
  adminApi,
  seedTree,
}) => {
  const src = await seedTree("E2E-Export-Src");
  await seedMinimalFamily(adminApi, src.id);

  const blob = await exportTree(adminApi.token, src.id);
  const imported = await importBundle(
    adminApi.token,
    blob,
    "E2E-Export-Imported",
  );
  try {
    expect(imported.name).toBe("E2E-Export-Imported");
    await expectFamilyMembers(adminApi, imported.id);
  } finally {
    await deleteTree(adminApi, imported.id);
  }
});

// ---------------------------------------------------------------------------
// Import inspect
// ---------------------------------------------------------------------------

test("import inspect — returns bundle metadata without committing", async ({
  adminApi,
  seedTree,
}) => {
  const src = await seedTree("E2E-Inspect-Src");
  await seedMinimalFamily(adminApi, src.id); // 3 members

  const blob = await exportTree(adminApi.token, src.id);

  // Build a multipart form for /import/inspect
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([blob], { type: "application/octet-stream" }),
    "export.treedb",
  );

  const inspectRes = await fetch(`${API_URL}/trees/import/inspect`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminApi.token}` },
    body: formData,
  });
  expect(inspectRes.ok).toBe(true);
  const preview = (await inspectRes.json()) as {
    password_required: boolean;
    name?: string | null;
    bundle_version?: number | null;
  };
  expect(preview).toMatchObject({
    password_required: false,
    name: "E2E-Inspect-Src",
    // Bumped to 3 in v1.7: the export bundle now carries the Documents model
    // (see BUNDLE_VERSION in backend/app/api/routes/export_import.py, #661).
    bundle_version: 3,
  });
});

// ---------------------------------------------------------------------------
// Encrypted export
// ---------------------------------------------------------------------------

test("encrypted export — correct passphrase imports successfully", async ({
  adminApi,
  seedTree,
}) => {
  const src = await seedTree("E2E-Enc-Src");
  await seedMinimalFamily(adminApi, src.id);

  const passphrase = "test-passphrase-123";

  const blob = await exportTree(adminApi.token, src.id, passphrase);
  const imported = await importBundle(
    adminApi.token,
    blob,
    "E2E-Enc-Imported",
    passphrase,
  );

  try {
    await expectFamilyMembers(adminApi, imported.id);
  } finally {
    await deleteTree(adminApi, imported.id);
  }
});

test("encrypted export — wrong passphrase is rejected", async ({
  adminApi,
  seedTree,
}) => {
  const src = await seedTree("E2E-Enc-Bad-Pass");
  await seedMinimalFamily(adminApi, src.id);

  const blob = await exportTree(adminApi.token, src.id, "correct-horse");

  const form = new FormData();
  form.append(
    "file",
    new Blob([blob], { type: "application/octet-stream" }),
    "enc.treedb",
  );
  form.append("password", "wrong-passphrase");
  form.append("name", "ShouldNotImport");

  const importRes = await fetch(`${API_URL}/trees/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminApi.token}` },
    body: form,
  });
  // Should fail — wrong key
  expect(importRes.ok).toBe(false);
  expect([400, 401, 422]).toContain(importRes.status);
});

// ---------------------------------------------------------------------------
// GEDCOM import
// ---------------------------------------------------------------------------

const SAMPLE_GEDCOM = `0 HEAD
1 SOUR FamilyTree
1 CHAR UTF-8
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Gedcom /Doe/
1 SEX M
1 BIRT
2 DATE 1 JAN 1970
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
0 TRLR`;

test("GEDCOM import — members are created from .ged file", async ({
  adminApi,
}) => {
  let importedId: string | null = null;
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([SAMPLE_GEDCOM], { type: "text/plain" }),
      "sample.ged",
    );
    form.append("name", "E2E-GEDCOM-Imported");

    const importRes = await fetch(`${API_URL}/trees/import-gedcom`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminApi.token}` },
      body: form,
    });
    expect(importRes.status).toBe(202);
    const { job_id } = (await importRes.json()) as { job_id: string };
    importedId = await waitForJob(adminApi.token, job_id);

    const treeRes = await fetch(`${API_URL}/trees/${importedId}`, {
      headers: { Authorization: `Bearer ${adminApi.token}` },
    });
    expect(treeRes.ok).toBe(true);
    const imported = (await treeRes.json()) as { id: string; name: string };
    expect(imported.name).toBe("E2E-GEDCOM-Imported");

    const members = await adminApi.get<
      Array<{ firstName?: string; lastName?: string }>
    >(`/trees/${importedId}/members`);
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ firstName: "Gedcom", lastName: "Doe" }),
        expect.objectContaining({ firstName: "Jane", lastName: "Doe" }),
      ]),
    );
  } finally {
    if (importedId) await deleteTree(adminApi, importedId);
  }
});
