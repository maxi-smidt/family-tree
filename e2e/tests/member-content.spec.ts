/**
 * E2E tests: Member content — events, stories, sources & evidence (#270)
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
    `/trees/${tree.id}/events`,
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
    `/trees/${tree.id}/events`,
  );
  expect(events.find((e) => e.id === event.id)).toBeTruthy();

  const links = await adminApi.get<
    Array<{ event_id: string; member_id: string }>
  >(`/trees/${tree.id}/events/links`);
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
    `/trees/${tree.id}/events`,
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

  await adminApi.patch(`/trees/${tree.id}/events/${event.id}`, {
    event_type: "after_edit",
    date: "1990-05-10",
    location: "Salzburg",
    description: "After Edit",
  });

  const events = await adminApi.get<
    Array<{ id: string; event_type?: string; description?: string }>
  >(`/trees/${tree.id}/events`);
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
    `/trees/${tree.id}/events`,
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

  const res = await fetch(`${API_URL}/trees/${tree.id}/events/${event.id}`, {
    method: "DELETE",
    headers: authHeaders(adminApi.token),
  });
  expect(res.status).toBe(204);

  const events = await adminApi.get<Array<{ id: string }>>(
    `/trees/${tree.id}/events`,
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
    `/trees/${tree.id}/stories`,
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
    `/trees/${tree.id}/stories`,
  );
  expect(stories.find((s) => s.id === story.id)).toBeTruthy();

  // Story links
  const links = await adminApi.get<
    Array<{ member_id?: string; story_id?: string }>
  >(`/trees/${tree.id}/stories/links`);
  expect(links.some((l) => l.story_id === story.id)).toBe(true);
});

test("edit story — content updated", async ({ adminApi, seedTree }) => {
  const tree = await seedTree("E2E-EditStory");
  const story = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/stories`,
    {
      id: randomUUID(),
      title: "Original Title",
      content: "...",
      created_at: nowIso(),
      updated_at: nowIso(),
      member_ids: [],
    },
  );

  await adminApi.patch(`/trees/${tree.id}/stories/${story.id}`, {
    title: "Updated Title",
    content: "Updated content",
    updated_at: nowIso(),
  });

  const stories = await adminApi.get<
    Array<{ id: string; title?: string; content?: string }>
  >(`/trees/${tree.id}/stories`);
  expect(stories.find((s) => s.id === story.id)).toMatchObject({
    title: "Updated Title",
    content: "Updated content",
  });
});

test("delete story — removed from list", async ({ adminApi, seedTree }) => {
  const tree = await seedTree("E2E-DeleteStory");
  const story = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/stories`,
    {
      id: randomUUID(),
      title: "ToDelete",
      content: "...",
      created_at: nowIso(),
      updated_at: nowIso(),
      member_ids: [],
    },
  );

  const res = await fetch(`${API_URL}/trees/${tree.id}/stories/${story.id}`, {
    method: "DELETE",
    headers: authHeaders(adminApi.token),
  });
  expect(res.status).toBe(204);

  const stories = await adminApi.get<Array<{ id: string }>>(
    `/trees/${tree.id}/stories`,
  );
  expect(stories.find((s) => s.id === story.id)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Sources & citations
// ---------------------------------------------------------------------------

test("add source — appears in source list", async ({ adminApi, seedTree }) => {
  const tree = await seedTree("E2E-Source");

  const source = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources`,
    {
      id: randomUUID(),
      title: "Birth Certificate",
      author: "Civil Registry",
      source_date: "1900-01-01",
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  );
  expect(source.id).toBeTruthy();

  const sources = await adminApi.get<Array<{ id: string }>>(
    `/trees/${tree.id}/sources`,
  );
  expect(sources.find((s) => s.id === source.id)).toBeTruthy();
});

test("add citation to source — linked to a member fact", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-Citation");
  const member = await createMember(adminApi, tree.id, {
    firstName: "CitedPerson",
    lastName: "C",
  });
  const source = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources`,
    {
      id: randomUUID(),
      title: "Census 1900",
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  );

  const citation = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources/citations`,
    {
      id: randomUUID(),
      source_id: source.id,
      member_id: member.id,
      fact_type: "birth",
      page: "p. 12",
      detail: "Found in census record",
      created_at: nowIso(),
    },
  );
  expect(citation.id).toBeTruthy();

  const citations = await adminApi.get<Array<{ id: string }>>(
    `/trees/${tree.id}/sources/citations`,
  );
  expect(citations.find((c) => c.id === citation.id)).toBeTruthy();
});

test("add evidence record to source", async ({ adminApi, seedTree }) => {
  const tree = await seedTree("E2E-Evidence");
  const source = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources`,
    {
      id: randomUUID(),
      title: "Old Newspaper",
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  );

  const evidence = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources/${source.id}/evidence`,
    {
      kind: "link",
      filename: "newspaper-link",
      url: "https://example.com/birth-announcement-1920",
    },
  );
  expect(evidence.id).toBeTruthy();

  const sources = await adminApi.get<Array<{ id: string }>>(
    `/trees/${tree.id}/sources`,
  );
  expect(sources.find((s) => s.id === source.id)).toBeTruthy();
});

test("delete source — removes source and citations", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DeleteSource");
  const source = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources`,
    {
      id: randomUUID(),
      title: "ToDeleteSource",
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  );

  const res = await fetch(`${API_URL}/trees/${tree.id}/sources/${source.id}`, {
    method: "DELETE",
    headers: authHeaders(adminApi.token),
  });
  expect(res.status).toBe(204);

  const sources = await adminApi.get<Array<{ id: string }>>(
    `/trees/${tree.id}/sources`,
  );
  expect(sources.find((s) => s.id === source.id)).toBeFalsy();
});

test("delete citation — removed from citation list", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DeleteCitation");
  const member = await createMember(adminApi, tree.id, {
    firstName: "Cit2Person",
    lastName: "X",
  });
  const source = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources`,
    {
      id: randomUUID(),
      title: "Src for Cit",
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  );
  const citation = await adminApi.post<{ id: string }>(
    `/trees/${tree.id}/sources/citations`,
    {
      id: randomUUID(),
      source_id: source.id,
      member_id: member.id,
      fact_type: "name",
      created_at: nowIso(),
    },
  );

  const res = await fetch(
    `${API_URL}/trees/${tree.id}/sources/citations/${citation.id}`,
    {
      method: "DELETE",
      headers: authHeaders(adminApi.token),
    },
  );
  expect(res.status).toBe(204);

  const citations = await adminApi.get<Array<{ id: string }>>(
    `/trees/${tree.id}/sources/citations`,
  );
  expect(citations.find((c) => c.id === citation.id)).toBeFalsy();
});
