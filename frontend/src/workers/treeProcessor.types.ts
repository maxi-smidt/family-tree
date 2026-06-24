import type { MemberDB, RelationDB, Member } from "@/types/member";

export interface RelationStyleOverride {
  color?: string | null;
  strokeWidth?: number | null;
  strokeDasharray?: string | null;
}

export type RelationStyleMap = Record<string, RelationStyleOverride>;

export interface WorkerUnionInfo {
  id: string;
  partner1Id: string;
  partner2Id: string;
  childIds: string[];
  relationType?: string;
  [key: string]: unknown;
}

export interface WorkerEdgeStyle {
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
}

export interface WorkerEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  baseStyle: WorkerEdgeStyle;
  /** All memberPairKeys relevant for determining if this edge is highlighted. */
  _highlightPairs: string[];
}

export interface ParseRequest {
  kind: "parse";
  reqId: number;
  treeId: string;
  members: MemberDB[];
  relations: RelationDB[];
}

export interface ParseResponse {
  kind: "parse:done";
  reqId: number;
  treeId: string;
  members: Member[];
}

export interface DeriveRequest {
  kind: "derive";
  reqId: number;
  treeId: string;
  members: Member[];
  visibleRelationTypes: string[];
  edgeType: string;
  relationStyles: RelationStyleMap;
}

export interface DeriveResponse {
  kind: "derive:done";
  reqId: number;
  treeId: string;
  unions: WorkerUnionInfo[];
  edges: WorkerEdge[];
  hiddenNodeIds: string[];
}

export interface LayoutRequest {
  kind: "layout";
  reqId: number;
  treeId: string;
  members: Member[];
}

export interface LayoutResponse {
  kind: "layout:done";
  reqId: number;
  treeId: string;
  positions: Record<string, { x: number; y: number }>;
}

export interface WorkerErrorResponse {
  kind: "error";
  reqId: number;
  message: string;
}

export type WorkerRequest = ParseRequest | DeriveRequest | LayoutRequest;
export type WorkerResponse =
  | ParseResponse
  | DeriveResponse
  | LayoutResponse
  | WorkerErrorResponse;
