/**
 * How the Sessions queue groups. The Chats list now keeps its own order
 * (Projects or Recent) in chat-list.ts; this key still drives the shared
 * session grouping in sessions-view.ts.
 */

/** "recent" is the ungrouped one: every conversation, newest first. */
export type SessionsGroupKey = "recent" | "project" | "agent" | "day" | "state";
