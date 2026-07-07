import {
  Attachment,
  AttachmentDB,
  mapAttachmentFromDB,
} from "@/types/attachment";

export interface Event {
  id: string;
  linkedMemberIds: string[];
  eventType: string;
  date: string;
  location: string | null;
  description: string | null;
  createdAt: string;
  attachments: Attachment[];
}

export interface EventDB {
  id: string;
  event_type: string;
  date: string;
  location: string | null;
  description: string | null;
  created_at: string;
  attachments?: AttachmentDB[];
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
    attachments: (row.attachments ?? []).map(mapAttachmentFromDB),
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
    attachments: event.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      url: a.url,
      mime_type: a.mimeType,
      size: a.size,
      created_at: a.createdAt,
    })),
  };
}
