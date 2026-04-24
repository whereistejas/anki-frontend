import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { LayoutGroup, motion } from 'framer-motion';
import { fetchCardsPage, fetchNotesInfo, invokeAnki, type CardInfo, type NoteInfo } from '../lib/ankiconnect';
import { buildHierarchy, quoteSearchValue } from '../lib/tree';
import { htmlToMarkdown, markdownToHtml } from '../lib/markdown';
import CardTile from './CardTile';
import TreeView from './TreeView';

type CardStateFilter = 'all' | 'new' | 'learn' | 'review' | 'due' | 'suspended' | 'buried';
type FlagFilter = 'all' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7';
type StatusTone = 'error' | 'success';

interface PageCard {
  card: CardInfo;
  note: NoteInfo | null;
}

interface NoteDraft {
  fields: Record<string, string>;
  tags: string;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';
const POLL_INTERVAL_MS = 15_000;
const AUTOSAVE_DELAY_MS = 800;

export default function App() {
  const endpoint = DEFAULT_ENDPOINT;
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const stateFilter: CardStateFilter = 'all';
  const flagFilter: FlagFilter = 'all';
  const pageSize = 48;
  const [pageCards, setPageCards] = useState<PageCard[]>([]);
  const [tagPaneWidth, setTagPaneWidth] = useState(240);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [isResizingTagPane, setIsResizingTagPane] = useState(false);
  const [isTagPaneCollapsed, setIsTagPaneCollapsed] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, NoteDraft>>({});
  const [noteSnapshots, setNoteSnapshots] = useState<Record<number, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Record<number, boolean>>({});
  const [workingCardIds, setWorkingCardIds] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState<{ text: string; tone: StatusTone } | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);

  const noteDraftsRef = useRef(noteDrafts);
  const noteSnapshotsRef = useRef(noteSnapshots);
  const autosaveTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const resizingTagPaneRef = useRef(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  const query = useMemo(() => buildQuery({ flagFilter, selectedTag, stateFilter }), [flagFilter, selectedTag, stateFilter]);
  const tagTree = useMemo(() => buildHierarchy(expandHierarchicalPaths(tags)), [tags]);

  useEffect(() => {
    noteDraftsRef.current = noteDrafts;
  }, [noteDrafts]);

  useEffect(() => {
    noteSnapshotsRef.current = noteSnapshots;
  }, [noteSnapshots]);

  useEffect(() => {
    void refreshCollection(true);
  }, [pageSize, query]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshCollection(false);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [pageSize, query]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const updateLayout = () => setIsCompactLayout(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!resizingTagPaneRef.current || !layoutRef.current || isCompactLayout) {
        return;
      }

      const bounds = layoutRef.current.getBoundingClientRect();
      const nextWidth = event.clientX - bounds.left;
      setTagPaneWidth(Math.min(420, Math.max(180, Math.round(nextWidth))));
    };

    const stopResize = () => {
      resizingTagPaneRef.current = false;
      setIsResizingTagPane(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [isCompactLayout]);

  useEffect(() => {
    for (const pageCard of pageCards) {
      if (!pageCard.note) {
        continue;
      }

      const noteId = pageCard.note.noteId;
      const draft = noteDrafts[noteId];
      const snapshot = noteSnapshots[noteId];
      const signature = draft ? serializeDraft(draft) : null;

      if (!draft || !signature || !snapshot || signature === snapshot || savingNoteIds[noteId]) {
        continue;
      }

      if (autosaveTimersRef.current[noteId]) {
        window.clearTimeout(autosaveTimersRef.current[noteId]);
      }

      autosaveTimersRef.current[noteId] = window.setTimeout(() => {
        delete autosaveTimersRef.current[noteId];
        void persistNote(noteId);
      }, AUTOSAVE_DELAY_MS);
    }

    return () => {
      for (const timer of Object.values(autosaveTimersRef.current)) {
        window.clearTimeout(timer);
      }
      autosaveTimersRef.current = {};
    };
  }, [noteDrafts, noteSnapshots, pageCards, savingNoteIds]);

  async function refreshCollection(initial: boolean) {
    setLoading(initial);

    try {
      const [tagNames, cardIds] = await Promise.all([
        invokeAnki<string[]>(endpoint, 'getTags'),
        invokeAnki<number[]>(endpoint, 'findCards', {
          query,
        }),
      ]);

      setTags(tagNames);

      const visibleCardIds = cardIds.slice(0, pageSize);
      if (visibleCardIds.length === 0) {
        setPageCards([]);
        return;
      }

      const cards = await fetchCardsPage(endpoint, visibleCardIds);
      const noteIds = [...new Set(cards.map((card) => card.note))];
      const notes = await fetchNotesInfo(endpoint, noteIds);
      const noteMap = new Map(notes.map((note) => [note.noteId, note]));

      setPageCards(cards.map((card) => ({ card, note: noteMap.get(card.note) ?? null })));
      syncDraftsFromNotes(notes);
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function syncDraftsFromNotes(notes: NoteInfo[]) {
    const incomingSnapshots = Object.fromEntries(notes.map((note) => [note.noteId, serializeDraft(noteToDraft(note))]));

    setNoteSnapshots((current) => ({
      ...current,
      ...incomingSnapshots,
    }));

    setNoteDrafts((current) => {
      const next = { ...current };

      for (const note of notes) {
        const incoming = noteToDraft(note);
        const incomingSignature = serializeDraft(incoming);
        const currentDraft = current[note.noteId];
        const currentDraftSignature = currentDraft ? serializeDraft(currentDraft) : null;
        const previousSnapshot = noteSnapshotsRef.current[note.noteId];

        if (!currentDraft || !currentDraftSignature || currentDraftSignature === previousSnapshot) {
          next[note.noteId] = incoming;
          continue;
        }

        if (currentDraftSignature === incomingSignature) {
          next[note.noteId] = incoming;
        }
      }

      return next;
    });
  }

  async function persistNote(noteId: number) {
    const draft = noteDraftsRef.current[noteId];
    const snapshot = noteSnapshotsRef.current[noteId];

    if (!draft || !snapshot || serializeDraft(draft) === snapshot) {
      return;
    }

    const previous = deserializeDraft(snapshot);
    const previousTags = new Set(splitTagsForSave(previous.tags));
    const nextTags = new Set(splitTagsForSave(draft.tags));
    const toAdd = [...nextTags].filter((tag) => !previousTags.has(tag));
    const toRemove = [...previousTags].filter((tag) => !nextTags.has(tag));

    setSavingNoteIds((current) => ({ ...current, [noteId]: true }));

    try {
      await invokeAnki(endpoint, 'updateNoteFields', {
        note: {
          id: noteId,
          fields: Object.fromEntries(
            Object.entries(draft.fields).map(([fieldName, value]) => [fieldName, markdownToHtml(value)]),
          ),
        },
      });

      if (toRemove.length > 0) {
        await invokeAnki(endpoint, 'removeTags', {
          notes: [noteId],
          tags: toRemove.join(' '),
        });
      }

      if (toAdd.length > 0) {
        await invokeAnki(endpoint, 'addTags', {
          notes: [noteId],
          tags: toAdd.join(' '),
        });
      }

      const nextSnapshot = serializeDraft(draft);
      setNoteSnapshots((current) => ({ ...current, [noteId]: nextSnapshot }));
      setStatus({ text: 'Saved.', tone: 'success' });
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
    } finally {
      setSavingNoteIds((current) => ({ ...current, [noteId]: false }));
    }
  }

  async function setSuspended(cardId: number, suspended: boolean) {
    setWorkingCardIds((current) => ({ ...current, [cardId]: true }));

    try {
      await invokeAnki(endpoint, suspended ? 'suspend' : 'unsuspend', {
        cards: [cardId],
      });
      await refreshCollection(false);
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
    } finally {
      setWorkingCardIds((current) => ({ ...current, [cardId]: false }));
    }
  }

  async function deleteNote(noteId: number) {
    if (!window.confirm('Delete this note and all of its cards?')) {
      return;
    }

    setSavingNoteIds((current) => ({ ...current, [noteId]: true }));

    try {
      await invokeAnki(endpoint, 'deleteNotes', {
        notes: [noteId],
      });
      await refreshCollection(false);
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
    } finally {
      setSavingNoteIds((current) => ({ ...current, [noteId]: false }));
    }
  }

  async function openInBrowser(noteId: number) {
    try {
      await invokeAnki(endpoint, 'guiBrowse', {
        query: `nid:${noteId}`,
      });
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
    }
  }

  async function createNewCard() {
    setCreatingCard(true);

    try {
      let modelName: string | undefined;
      let fieldNames: string[] = [];

      const firstVisibleNote = pageCards.find((pageCard) => pageCard.note)?.note;
      if (firstVisibleNote) {
        modelName = firstVisibleNote.modelName;
        fieldNames = Object.keys(firstVisibleNote.fields);
      } else {
        const modelNames = await invokeAnki<string[]>(endpoint, 'modelNames');
        modelName = modelNames[0];
        if (!modelName) {
          throw new Error('No note type available to create a card.');
        }
        fieldNames = await invokeAnki<string[]>(endpoint, 'modelFieldNames', { modelName });
      }

      const deckNames = await invokeAnki<string[]>(endpoint, 'deckNames');
      const deckName = pageCards[0]?.card.deckName ?? deckNames[0] ?? 'Default';
      const fields = Object.fromEntries(fieldNames.map((fieldName) => [fieldName, '']));
      const tags = selectedTag ? [selectedTag] : [];

      await invokeAnki<number>(endpoint, 'addNote', {
        note: {
          deckName,
          fields,
          modelName,
          tags,
        },
      });

      setStatus({ text: 'Card added.', tone: 'success' });
      await refreshCollection(false);
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
    } finally {
      setCreatingCard(false);
    }
  }

  function updateDraftField(noteId: number, fieldName: string, value: string) {
    setNoteDrafts((current) => ({
      ...current,
      [noteId]: {
        fields: {
          ...(current[noteId]?.fields ?? {}),
          [fieldName]: value,
        },
        tags: current[noteId]?.tags ?? '',
      },
    }));
  }

  function updateDraftTags(noteId: number, value: string) {
    setNoteDrafts((current) => ({
      ...current,
      [noteId]: {
        fields: current[noteId]?.fields ?? {},
        tags: value,
      },
    }));
  }

  const layoutStyle = isCompactLayout
    ? {
        gridTemplateColumns: 'minmax(0, 1fr)',
        gridTemplateRows: isTagPaneCollapsed ? '0 minmax(0, 1fr)' : '12rem minmax(0, 1fr)',
      }
    : {
        gridTemplateColumns: isTagPaneCollapsed ? 'minmax(0, 1fr)' : `${tagPaneWidth}px 1rem minmax(0, 1fr)`,
      };

  return (
    <main className="h-screen overflow-hidden bg-slate-50 text-slate-900">
      <div className="mx-auto flex h-full max-w-[1720px] flex-col gap-2 md:gap-3">
        <div className="grid min-h-0 flex-1 gap-0 transition-[grid-template-columns,grid-template-rows] duration-200" ref={layoutRef} style={layoutStyle}>
          {!isTagPaneCollapsed ? (
            <aside
              className={`flex min-h-0 flex-col overflow-hidden ${isCompactLayout ? 'pl-2 pt-3 pb-2' : 'pl-2 pt-5 pb-2 md:pl-5 md:pb-5'}`}
            >
              <TreeView
                emptyLabel="No tags found."
                nodes={tagTree}
                onSelect={setSelectedTag}
                selectedPath={selectedTag}
                title="Tags"
              />
            </aside>
          ) : null}

          {!isCompactLayout && !isTagPaneCollapsed ? (
            <div
              aria-label="Resize tags panel"
              className="group flex min-h-0 cursor-col-resize items-stretch justify-center"
              onPointerDown={(event) => {
                event.preventDefault();
                resizingTagPaneRef.current = true;
                setIsResizingTagPane(true);
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
              role="separator"
            >
              <div
                className={`w-[0.24rem] rounded-full bg-slate-300 transition-opacity ${
                  isResizingTagPane ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              />
            </div>
          ) : null}

          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <button
                aria-label={isTagPaneCollapsed ? 'Show tags panel' : 'Hide tags panel'}
                aria-pressed={!isTagPaneCollapsed}
                className="absolute left-2 top-2 z-10 inline-flex items-center rounded-full bg-white/90 p-1.5 text-slate-500 shadow-sm ring-1 ring-slate-200 backdrop-blur transition hover:text-slate-900 md:left-5 md:top-5"
                onClick={() => setIsTagPaneCollapsed((current) => !current)}
                title={isTagPaneCollapsed ? 'Show tags panel' : 'Hide tags panel'}
                type="button"
              >
                {isTagPaneCollapsed ? (
                  <ChevronRightIcon className="h-4 w-4 md:h-5 md:w-5" />
                ) : (
                  <ChevronLeftIcon className="h-4 w-4 md:h-5 md:w-5" />
                )}
              </button>
              {pageCards.length === 0 ? (
                <div className="grid min-h-0 flex-1 place-items-center text-sm text-slate-400">
                  {loading ? 'Loading cards…' : 'No cards match the current filters.'}
                </div>
              ) : (
                <>
                  <button
                    aria-label="Add new card"
                    className="absolute right-2 top-2 z-10 inline-flex items-center rounded-full bg-white/90 text-slate-500 shadow-sm ring-1 ring-slate-200 backdrop-blur transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 md:right-5 md:top-5"
                    disabled={creatingCard}
                    onClick={() => void createNewCard()}
                    title="Add new card"
                    type="button"
                  >
                    <PlusCircledIcon className="h-6 w-6 md:h-8 md:w-8" />
                  </button>
                  <div className="scrollbar-hidden min-h-0 flex-1 overflow-auto px-2 pt-2 pb-2 md:px-5 md:pt-5 md:pb-5">
                    <LayoutGroup>
                      <motion.div
                        className={`masonry-grid ${isTagPaneCollapsed && !isCompactLayout ? 'masonry-grid-wide' : ''}`}
                        layout
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      >
                        {pageCards.map((pageCard) => (
                          <CardTile
                            availableTags={tags}
                            card={pageCard.card}
                            endpoint={endpoint}
                            draft={pageCard.note ? noteDrafts[pageCard.note.noteId] ?? null : null}
                            key={pageCard.card.cardId}
                            note={pageCard.note}
                            onDelete={deleteNote}
                            onFieldChange={updateDraftField}
                            onOpen={openInBrowser}
                            onSuspend={setSuspended}
                            onTagsChange={updateDraftTags}
                            saving={pageCard.note ? Boolean(savingNoteIds[pageCard.note.noteId]) : false}
                            working={Boolean(workingCardIds[pageCard.card.cardId])}
                          />
                        ))}
                      </motion.div>
                    </LayoutGroup>
                  </div>
                </>
              )}
          </section>
        </div>

        {status ? (
          <div className={`px-2 pb-2 text-xs ${toneClassName(status.tone)} md:px-5 md:pb-3`}>
            {status.text}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function buildQuery({
  flagFilter,
  selectedTag,
  stateFilter,
}: {
  flagFilter: FlagFilter;
  selectedTag: string | null;
  stateFilter: CardStateFilter;
}): string {
  const parts: string[] = [];

  if (selectedTag) {
    parts.push(`tag:${quoteSearchValue(selectedTag)}*`);
  }

  if (stateFilter !== 'all') {
    parts.push(`is:${stateFilter}`);
  }

  if (flagFilter !== 'all') {
    parts.push(`flag:${flagFilter}`);
  }

  return parts.join(' ').trim();
}

function expandHierarchicalPaths(paths: string[]): string[] {
  const expanded = new Set<string>();

  for (const path of paths) {
    const parts = path.split('::').filter(Boolean);
    let current = '';

    for (const part of parts) {
      current = current ? `${current}::${part}` : part;
      expanded.add(current);
    }
  }

  return [...expanded];
}

function noteToDraft(note: NoteInfo): NoteDraft {
  return {
    fields: Object.fromEntries(Object.entries(note.fields).map(([name, value]) => [name, htmlToMarkdown(value.value)])),
    tags: note.tags.join(' '),
  };
}

function serializeDraft(draft: NoteDraft): string {
  return JSON.stringify(draft);
}

function deserializeDraft(value: string): NoteDraft {
  return JSON.parse(value) as NoteDraft;
}

function splitTagsForSave(value: string): string[] {
  return value
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toneClassName(tone: StatusTone): string {
  if (tone === 'success') {
    return 'text-emerald-700';
  }
  if (tone === 'error') {
    return 'text-rose-700';
  }
  return 'text-slate-500';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}
