import { Member, MemberDB, RelationDB } from "@/types/member";
import { mapMembersFromRows } from "@/utils/memberMapping";
import type {
  WorkerResponse,
  ParseRequest,
  ParseResponse,
  DeriveRequest,
  DeriveResponse,
  WorkerUnionInfo,
  WorkerEdge,
} from "@/workers/treeProcessor.types";

// Trees with fewer members than this are mapped synchronously on the main
// thread so the postMessage round-trip doesn't add latency for small datasets.
const SYNC_PARSE_THRESHOLD = 2_000;

export interface DeriveResult {
  unions: WorkerUnionInfo[];
  edges: WorkerEdge[];
  hiddenNodeIds: string[];
}

type PendingResolve = (r: WorkerResponse) => void;
type PendingReject = (e: Error) => void;

class TreeProcessorClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<
    number,
    { resolve: PendingResolve; reject: PendingReject }
  >();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./treeProcessor.worker.ts", import.meta.url),
        { type: "module" },
      );

      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const res = e.data;
        const p = this.pending.get(res.reqId);
        if (!p) return;
        this.pending.delete(res.reqId);
        if (res.kind === "error") {
          p.reject(new Error(res.message));
        } else {
          p.resolve(res);
        }
      };

      this.worker.onerror = (e) => {
        console.error("Tree processor worker error:", e);
        const err = new Error("Worker error");
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.worker = null; // allow recreation on next call
      };
    }
    return this.worker;
  }

  async parseMembers(
    treeId: string,
    members: MemberDB[],
    relations: RelationDB[],
  ): Promise<Member[]> {
    if (members.length < SYNC_PARSE_THRESHOLD) {
      return mapMembersFromRows(members, relations);
    }

    const worker = this.getWorker();
    const reqId = ++this.reqId;

    return new Promise<Member[]>((resolve, reject) => {
      this.pending.set(reqId, {
        resolve: (r) => resolve((r as ParseResponse).members),
        reject,
      });
      const req: ParseRequest = {
        kind: "parse",
        reqId,
        treeId,
        members,
        relations,
      };
      worker.postMessage(req);
    });
  }

  deriveView(
    treeId: string,
    members: Member[],
    visibleRelationTypes: string[],
    edgeType: string,
  ): { reqId: number; promise: Promise<DeriveResult> } {
    const reqId = ++this.reqId;

    if (members.length === 0) {
      return {
        reqId,
        promise: Promise.resolve({ unions: [], edges: [], hiddenNodeIds: [] }),
      };
    }

    const worker = this.getWorker();
    const promise = new Promise<DeriveResult>((resolve, reject) => {
      this.pending.set(reqId, {
        resolve: (r) => {
          const res = r as DeriveResponse;
          resolve({
            unions: res.unions,
            edges: res.edges,
            hiddenNodeIds: res.hiddenNodeIds,
          });
        },
        reject,
      });
    });

    const req: DeriveRequest = {
      kind: "derive",
      reqId,
      treeId,
      members,
      visibleRelationTypes,
      edgeType,
    };
    worker.postMessage(req);

    return { reqId, promise };
  }
}

export const treeProcessorClient = new TreeProcessorClient();
