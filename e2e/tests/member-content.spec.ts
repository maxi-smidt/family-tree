/**
 * E2E tests: Member content — events, stories & documents (#270, #594)
 * Depends on foundation harness (#263).
 */

import { test, expect } from "../fixtures";
import { createMember } from "../fixtures/seed";
import { randomUUID } from "crypto";
import { API_URL } from "../playwright.config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

test("add event — appears in tree's event list", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-Events");
  const member = await createMember(adminApi, tree.id, {
    firstName: "EventPerson",
    lastName: "E",
  });

  const event = await adminApi.post<{ id: string }>(
    `/workspaces/${tree.id}/events`,
    {
      id: randomUUID(),
      event_type: "birthday_party",
      date: "2000-01-01",
      location: "Vienna",
      description: "Birthday Party",
      created_at: nowIso(),
      member_ids: [member.id],
    },
  );
  expect(event.id).toBeTruthy();

  const events = await adminApi.get<Array<{ id: string; event_type?: string }>>(
    `/workspaces/${tree.id}/events`,
  );
  expect(events.find((e) => e.id === event.id)).toBeTruthy();

  const links = await adminApi.get<
    Array<{ event_id: string; member_id: string }>
  >(`/workspaces/${tree.id}/events/links`);
  expect(links).toContainEqual({
    event_id: event.id,
    member_id: member.id,
  });
});

test("edit event — updated title reflects in API", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-EditEvent");
  const event = await adminApi.post<{ id: string }>(
    `/workspaces/${tree.id}/events`,
    {
      id: randomUUID(),
      event_type: "before_edit",
      date: "1990-05-10",
      location: null,
      description: "Before Edit",
      created_at: nowIso(),
      member_ids: [],
    },
  );

  await adminApi.patch(`/workspaces/${tree.id}/events/${event.id}`, {
    event_type: "after_edit",
    date: "1990-05-10",
    location: "Salzburg",
    description: "After Edit",
  });

  const events = await adminApi.get<
    Array<{ id: string; event_type?: string; description?: string }>
  >(`/workspaces/${tree.id}/events`);
  const found = events.find((e) => e.id === event.id);
  expect(found).toMatchObject({
    event_type: "after_edit",
    description: "After Edit",
  });
});

test("delete event — removed from event list", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DeleteEvent");
  const event = await adminApi.post<{ id: string }>(
    `/workspaces/${tree.id}/events`,
    {
      id: randomUUID(),
      event_type: "to_delete_event",
      date: "2001-01-01",
      location: null,
      description: "ToDeleteEvent",
      created_at: nowIso(),
      member_ids: [],
    },
  );

  const res = await fetch(`${API_URL}/workspaces/${tree.id}/events/${event.id}`, {
    method: "DELETE",
    headers: authHeaders(adminApi.token),
  });
  expect(res.status).toBe(204);

  const events = await adminApi.get<Array<{ id: string }>>(
    `/workspaces/${tree.id}/events`,
  );
  expect(events.find((e) => e.id === event.id)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

test("create story — appears in story list and linked member", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-Story");
  const member = await createMember(adminApi, tree.id, {
    firstName: "StoryPerson",
    lastName: "S",
  });

  const story = await adminApi.post<{ id: string }>(
    `/workspaces/${tree.id}/stories`,
    {
      id: randomUUID(),
      title: "My Story",
      content: "Once upon a time...",
      created_at: nowIso(),
      updated_at: nowIso(),
      member_ids: [member.id],
    },
  );
  expect(story.id).toBeTruthy();

  // Story visible in list
  const stories = await adminApi.get<Array<{ id: string }>>(
    `/workspaces/${tree.id}/stories`,
  );
  expect(stories.find((s) => s.id === story.id)).toBeTruthy();

  // Story links
  const links = await adminApi.get<
    Array<{ member_id?: string; story_id?: string }>
  >(`/workspaces/${tree.id}/stories/links`);
  expect(links.some((l) => l.story_id === story.id)).toBe(true);
});

test("edit story — content updated", async ({ adminApi, seedTree }) => {
  const tree = await seedTree("E2E-EditStory");
  const story = await adminApi.post<{ id: string }>(
    `/workspaces/${tree.id}/stories`,
    {
      id: randomUUID(),
      title: "Original Title",
      content: "...",
      created_at: nowIso(),
      updated_at: nowIso(),
      member_ids: [],
    },
  );

  await adminApi.patch(`/workspaces/${tree.id}/stories/${story.id}`, {
    title: "Updated Title",
    content: "Updated content",
    updated_at: nowIso(),
  });

  const stories = await adminApi.get<
    Array<{ id: string; title?: string; content?: string }>
  >(`/workspaces/${tree.id}/stories`);
  expect(stories.find((s) => s.id === story.id)).toMatchObject({
    title: "Updated Title",
    content: "Updated content",
  });
});

test("delete story — removed from list", async ({ adminApi, seedTree }) => {
  const tree = await seedTree("E2E-DeleteStory");
  const story = await adminApi.post<{ id: string }>(
    `/workspaces/${tree.id}/stories`,
    {
      id: randomUUID(),
      title: "ToDelete",
      content: "...",
      created_at: nowIso(),
      updated_at: nowIso(),
      member_ids: [],
    },
  );

  const res = await fetch(`${API_URL}/workspaces/${tree.id}/stories/${story.id}`, {
    method: "DELETE",
    headers: authHeaders(adminApi.token),
  });
  expect(res.status).toBe(204);

  const stories = await adminApi.get<Array<{ id: string }>>(
    `/workspaces/${tree.id}/stories`,
  );
  expect(stories.find((s) => s.id === story.id)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Documents (reusable files/links attached to people, events & stories)
// ---------------------------------------------------------------------------

interface DocumentFile {
  id: string;
  kind: string;
  filename: string | null;
  url: string;
}

interface Document {
  id: string;
  title: string;
  member_ids: string[];
  files: DocumentFile[];
}

test("add document — appears in document list", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-Document");
  const member = await createMember(adminApi, tree.id, {
    firstName: "DocPerson",
    lastName: "D",
  });

  const document = await adminApi.post<Document>(
    `/workspaces/${tree.id}/documents`,
    {
      title: "Birth Certificate",
      document_date: "1900-01-01",
      member_ids: [member.id],
    },
  );
  expect(document.id).toBeTruthy();
  expect(document.member_ids).toContain(member.id);

  const documents = await adminApi.get<Document[]>(
    `/workspaces/${tree.id}/documents`,
  );
  expect(documents.find((d) => d.id === document.id)).toBeTruthy();
});

test("add link to document — appears in document files", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DocumentLink");
  const member = await createMember(adminApi, tree.id, {
    firstName: "LinkedPerson",
    lastName: "L",
  });
  const document = await adminApi.post<Document>(
    `/workspaces/${tree.id}/documents`,
    {
      title: "Census 1900",
      member_ids: [member.id],
    },
  );

  const file = await adminApi.post<DocumentFile>(
    `/workspaces/${tree.id}/documents/${document.id}/links`,
    {
      url: "https://example.com/birth-announcement-1920",
      filename: "newspaper-link",
    },
  );
  expect(file.id).toBeTruthy();
  expect(file.kind).toBe("link");

  const documents = await adminApi.get<Document[]>(
    `/workspaces/${tree.id}/documents`,
  );
  const stored = documents.find((d) => d.id === document.id);
  expect(stored?.files.find((f) => f.id === file.id)).toBeTruthy();
});

test("set people mentioned — updates document member links", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DocumentMembers");
  const first = await createMember(adminApi, tree.id, {
    firstName: "FirstMentioned",
    lastName: "M",
  });
  const second = await createMember(adminApi, tree.id, {
    firstName: "SecondMentioned",
    lastName: "M",
  });
  const document = await adminApi.post<Document>(
    `/workspaces/${tree.id}/documents`,
    {
      title: "Family Record",
      member_ids: [first.id],
    },
  );

  const res = await fetch(
    `${API_URL}/workspaces/${tree.id}/documents/${document.id}/members`,
    {
      method: "PUT",
      headers: authHeaders(adminApi.token),
      body: JSON.stringify({ member_ids: [first.id, second.id] }),
    },
  );
  expect(res.status).toBe(204);

  const documents = await adminApi.get<Document[]>(
    `/workspaces/${tree.id}/documents`,
  );
  const stored = documents.find((d) => d.id === document.id);
  expect(stored?.member_ids).toContain(first.id);
  expect(stored?.member_ids).toContain(second.id);
});

test("delete document — removed from document list", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DeleteDocument");
  const member = await createMember(adminApi, tree.id, {
    firstName: "DelDocPerson",
    lastName: "X",
  });
  const document = await adminApi.post<Document>(
    `/workspaces/${tree.id}/documents`,
    {
      title: "ToDeleteDocument",
      member_ids: [member.id],
    },
  );

  const res = await fetch(
    `${API_URL}/workspaces/${tree.id}/documents/${document.id}`,
    {
      method: "DELETE",
      headers: authHeaders(adminApi.token),
    },
  );
  expect(res.status).toBe(204);

  const documents = await adminApi.get<Document[]>(
    `/workspaces/${tree.id}/documents`,
  );
  expect(documents.find((d) => d.id === document.id)).toBeFalsy();
});

test("delete document file — removed from document files", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DeleteDocumentFile");
  const member = await createMember(adminApi, tree.id, {
    firstName: "FileOwner",
    lastName: "X",
  });
  const document = await adminApi.post<Document>(
    `/workspaces/${tree.id}/documents`,
    {
      title: "Doc with file",
      member_ids: [member.id],
    },
  );
  const file = await adminApi.post<DocumentFile>(
    `/workspaces/${tree.id}/documents/${document.id}/links`,
    {
      url: "https://example.com/record",
      filename: "record-link",
    },
  );

  const res = await fetch(
    `${API_URL}/workspaces/${tree.id}/documents/${document.id}/files/${file.id}`,
    {
      method: "DELETE",
      headers: authHeaders(adminApi.token),
    },
  );
  expect(res.status).toBe(204);

  const documents = await adminApi.get<Document[]>(
    `/workspaces/${tree.id}/documents`,
  );
  const stored = documents.find((d) => d.id === document.id);
  expect(stored?.files.find((f) => f.id === file.id)).toBeFalsy();
});
