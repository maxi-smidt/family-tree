export interface ResearchTask {
  id: string;
  memberId: string | null;
  title: string;
  notes: string;
  done: boolean;
  createdAt: string;
  doneAt: string | null;
}

export interface ResearchTaskDB {
  id: string;
  member_id: string | null;
  title: string;
  notes: string | null;
  done: boolean;
  created_at: string;
  done_at: string | null;
}

export interface ResearchTaskInput {
  memberId?: string | null;
  title: string;
  notes?: string;
}

export function mapTaskFromDB(row: ResearchTaskDB): ResearchTask {
  return {
    id: row.id,
    memberId: row.member_id,
    title: row.title,
    notes: row.notes ?? "",
    done: row.done,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}
