export type FriendStatus = "pending" | "accepted" | "declined" | "blocked";

/** A friend relationship from the current user's point of view. */
export interface Friend {
  user_id: string;
  username: string;
  full_name: string | null;
  status: FriendStatus;
  /** "incoming" = they sent me a pending request; "outgoing" = I sent it. */
  direction: "incoming" | "outgoing";
  created_at: string;
  responded_at: string | null;
}

/** A user matched by username search, annotated with our relationship (if any). */
export interface UserSearchResult {
  user_id: string;
  username: string;
  full_name: string | null;
  status: FriendStatus | null;
  /** Set only for a pending status: who sent the request. */
  direction: "incoming" | "outgoing" | null;
}
