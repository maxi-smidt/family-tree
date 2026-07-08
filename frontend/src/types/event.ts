export interface Event {
  id: string;
  linkedMemberIds: string[];
  eventType: string;
  date: string;
  location: string | null;
  description: string | null;
  createdAt: string;
  documentIds: string[];
}

export interface EventDB {
  id: string;
  event_type: string;
  date: string;
  location: string | null;
  description: string | null;
  created_at: string;
  document_ids?: string[];
}

export interface EventInput {
  eventType: string;
  date: string;
  location?: string | null;
  description?: string | null;
}

export function mapEventFromDB(row: EventDB, linkedMemberIds: string[]): Event {
  return {
    id: row.id,
    linkedMemberIds,
    eventType: row.event_type,
    date: row.date,
    location: row.location,
    description: row.description,
    createdAt: row.created_at,
    documentIds: row.document_ids ?? [],
  };
}

export function mapEventToDB(event: Event): EventDB {
  return {
    id: event.id,
    event_type: event.eventType,
    date: event.date,
    location: event.location,
    description: event.description,
    created_at: event.createdAt,
    document_ids: event.documentIds,
  };
}
