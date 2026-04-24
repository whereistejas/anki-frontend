export interface CardInfo {
  answer: string;
  cardId: number;
  deckName: string;
  due: number;
  fields: Record<string, { order: number; value: string }>;
  lapses: number;
  modelName: string;
  note: number;
  ord: number;
  question: string;
  queue: number;
  reps: number;
  type: number;
}

export interface NoteInfo {
  cards: number[];
  fields: Record<string, { order: number; value: string }>;
  modelName: string;
  noteId: number;
  tags: string[];
}

interface AnkiEnvelope<T> {
  error: string | null;
  result: T;
}

export async function invokeAnki<T>(
  endpoint: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      version: 6,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = (await response.json()) as AnkiEnvelope<T>;

  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result;
}

export async function fetchCardsPage(
  endpoint: string,
  cardIds: number[],
): Promise<CardInfo[]> {
  if (cardIds.length === 0) {
    return [];
  }

  return invokeAnki<CardInfo[]>(endpoint, 'cardsInfo', {
    cards: cardIds,
  });
}

export async function fetchNoteInfo(
  endpoint: string,
  noteId: number,
): Promise<NoteInfo | null> {
  const notes = await invokeAnki<NoteInfo[]>(endpoint, 'notesInfo', {
    notes: [noteId],
  });

  return notes[0] ?? null;
}

export async function fetchNotesInfo(
  endpoint: string,
  noteIds: number[],
): Promise<NoteInfo[]> {
  if (noteIds.length === 0) {
    return [];
  }

  return invokeAnki<NoteInfo[]>(endpoint, 'notesInfo', {
    notes: noteIds,
  });
}

export async function retrieveMediaFile(
  endpoint: string,
  filename: string,
): Promise<string | null> {
  const result = await invokeAnki<string | false>(endpoint, 'retrieveMediaFile', {
    filename,
  });

  return typeof result === 'string' ? result : null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
