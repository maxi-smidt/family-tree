export interface ResearchTask {
  id: string;
  /** Members this task is about; empty = tree-level task. */
  linkedMemberIds: string[];
  title: string;
  notes: string;
  done: boolean;
  createdAt: string;
  doneAt: string | null;
}

export interface ResearchTaskDB {
  id: string;
  title: string;
  notes: string | null;
  done: boolean;
  created_at: string;
  done_at: string | null;
  member_ids?: string[];
}

export interface ResearchTaskInput {
  title: string;
  notes?: string;
}

/** Open tasks first, each group oldest-first. */
export function compareTasks(a: ResearchTask, b: ResearchTask): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  return a.createdAt.localeCompare(b.createdAt);
}

export function mapTaskFromDB(row: ResearchTaskDB): ResearchTask {
  return {
    id: row.id,
    linkedMemberIds: row.member_ids ?? [],
    title: row.title,
    notes: row.notes ?? "",
    done: row.done,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}
