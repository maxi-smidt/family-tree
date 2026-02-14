export interface Event {
  id: string;
  memberId: string;
  eventType: string;
  date: string;
  location: string | null;
  description: string | null;
  createdAt: string;
}

export interface EventDB {
  id: string;
  member_id: string;
  event_type: string;
  date: string;
  location: string | null;
  description: string | null;
  created_at: string;
}

export interface EventInput {
  eventType: string;
  date: string;
  location?: string | null;
  description?: string | null;
}

export function mapEventFromDB(row: EventDB): Event {
  return {
    id: row.id,
    memberId: row.member_id,
    eventType: row.event_type,
    date: row.date,
    location: row.location,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function mapEventToDB(event: Event): EventDB {
  return {
    id: event.id,
    member_id: event.memberId,
    event_type: event.eventType,
    date: event.date,
    location: event.location,
    description: event.description,
    created_at: event.createdAt,
  };
}
