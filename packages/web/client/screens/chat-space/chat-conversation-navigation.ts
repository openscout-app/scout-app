export interface ConversationNavigationRow {
  id: string;
  unread: boolean;
  mentioned: boolean;
  muted: boolean;
}

export function conversationStep(
  rows: readonly ConversationNavigationRow[],
  currentId: string | null,
  direction: -1 | 1,
  unreadOnly: boolean,
): string | null {
  const eligible = (row: ConversationNavigationRow) =>
    !unreadOnly || (row.unread && (!row.muted || row.mentioned));
  const currentIndex = rows.findIndex((row) => row.id === currentId);
  let index = currentIndex < 0 ? (direction > 0 ? 0 : rows.length - 1) : currentIndex + direction;
  while (index >= 0 && index < rows.length) {
    const row = rows[index]!;
    if (eligible(row)) return row.id;
    index += direction;
  }
  return null;
}
