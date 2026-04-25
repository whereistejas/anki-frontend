import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRightIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { fetchCardsPage, fetchNotesInfo, invokeAnki, type CardInfo, type NoteInfo } from '../lib/ankiconnect';
import { buildHierarchy, quoteSearchValue, type TreeNode } from '../lib/tree';
import { htmlToMarkdown, markdownToHtml } from '../lib/markdown';
import CardTile from './CardTile';

type CardStateFilter = 'all' | 'new' | 'learn' | 'review' | 'due' | 'suspended' | 'buried';
type FlagFilter = 'all' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7';
type StatusTone = 'error' | 'success';

interface PageCard {
  card: CardInfo;
  note: NoteInfo | null;
}

interface LocalPageCard {
  card: CardInfo;
  note: NoteInfo;
}

interface NoteDraft {
  fields: Record<string, string>;
  tags: string;
}

interface BreadcrumbOption {
  label: string;
  path: string;
}

interface BreadcrumbSegment {
  key: string;
  label: string;
  path: string | null;
  options: BreadcrumbOption[];
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';
const POLL_INTERVAL_MS = 15_000;
const AUTOSAVE_DELAY_MS = 800;
const ROOT_BREADCRUMB_KEY = '__root__';

export default function App() {
  const endpoint = DEFAULT_ENDPOINT;
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const stateFilter: CardStateFilter = 'all';
  const flagFilter: FlagFilter = 'all';
  const pageSize = 48;
  const [pageCards, setPageCards] = useState<PageCard[]>([]);
  const [localPageCards, setLocalPageCards] = useState<LocalPageCard[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, NoteDraft>>({});
  const [noteSnapshots, setNoteSnapshots] = useState<Record<number, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Record<number, boolean>>({});
  const [workingCardIds, setWorkingCardIds] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState<{ text: string; tone: StatusTone } | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);

  const noteDraftsRef = useRef(noteDrafts);
  const noteSnapshotsRef = useRef(noteSnapshots);
  const localPageCardsRef = useRef(localPageCards);
  const autosaveTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const nextTempNoteIdRef = useRef(-1);
  const nextTempCardIdRef = useRef(-1);

  const query = useMemo(() => buildQuery({ flagFilter, selectedTag, stateFilter }), [flagFilter, selectedTag, stateFilter]);
  const tagTree = useMemo(() => buildHierarchy(expandHierarchicalPaths(tags)), [tags]);
  const visiblePageCards = useMemo(() => [...localPageCards, ...pageCards], [localPageCards, pageCards]);

  useEffect(() => {
    noteDraftsRef.current = noteDrafts;
  }, [noteDrafts]);

  useEffect(() => {
    noteSnapshotsRef.current = noteSnapshots;
  }, [noteSnapshots]);

  useEffect(() => {
    localPageCardsRef.current = localPageCards;
  }, [localPageCards]);

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
    if (!status) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStatus(null);
    }, status.tone === 'error' ? 5000 : 3000);

    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    for (const pageCard of visiblePageCards) {
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
        if (noteId < 0) {
          void persistLocalNote(noteId);
          return;
        }
        void persistNote(noteId);
      }, AUTOSAVE_DELAY_MS);
    }

    return () => {
      for (const timer of Object.values(autosaveTimersRef.current)) {
        window.clearTimeout(timer);
      }
      autosaveTimersRef.current = {};
    };
  }, [noteDrafts, noteSnapshots, savingNoteIds, visiblePageCards]);

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
    if (noteId < 0) {
      removeLocalDraft(noteId);
      return;
    }

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
      const template = await getNewCardTemplate({
        endpoint,
        selectedTag,
        visiblePageCards,
      });
      const noteId = nextTempNoteIdRef.current;
      const cardId = nextTempCardIdRef.current;
      nextTempNoteIdRef.current -= 1;
      nextTempCardIdRef.current -= 1;

      const localPageCard = buildLocalPageCard({
        cardId,
        deckName: template.deckName,
        fieldNames: template.fieldNames,
        modelName: template.modelName,
        noteId,
        tags: template.tags,
      });
      const draft = noteToDraft(localPageCard.note);
      const snapshot = serializeDraft(draft);

      setLocalPageCards((current) => [localPageCard, ...current]);
      setNoteDrafts((current) => ({ ...current, [noteId]: draft }));
      setNoteSnapshots((current) => ({ ...current, [noteId]: snapshot }));
      setStatus({ text: 'New card ready. Start typing to save it.', tone: 'success' });
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
    } finally {
      setCreatingCard(false);
    }
  }

  async function persistLocalNote(noteId: number) {
    const localPageCard = localPageCardsRef.current.find((pageCard) => pageCard.note.noteId === noteId);
    const draft = noteDraftsRef.current[noteId];

    if (!localPageCard || !draft) {
      return;
    }

    const fieldNames = getOrderedFieldNames(localPageCard.note);
    const firstFieldName = fieldNames[0];
    const hasContent = Object.values(draft.fields).some((value) => value.trim().length > 0) || draft.tags.trim().length > 0;

    if (!hasContent || !firstFieldName || !draft.fields[firstFieldName]?.trim()) {
      return;
    }

    setSavingNoteIds((current) => ({ ...current, [noteId]: true }));

    try {
      await invokeAnki<number>(endpoint, 'addNote', {
        note: {
          deckName: localPageCard.card.deckName,
          fields: Object.fromEntries(
            Object.entries(draft.fields).map(([fieldName, value]) => [fieldName, markdownToHtml(value)]),
          ),
          modelName: localPageCard.note.modelName,
          tags: splitTagsForSave(draft.tags),
        },
      });

      removeLocalDraft(noteId);
      setStatus({ text: 'Card added.', tone: 'success' });
      await refreshCollection(false);
    } catch (error) {
      setStatus({ text: getErrorMessage(error), tone: 'error' });
      setSavingNoteIds((current) => ({ ...current, [noteId]: false }));
    }
  }

  function removeLocalDraft(noteId: number) {
    const timer = autosaveTimersRef.current[noteId];
    if (timer) {
      window.clearTimeout(timer);
      delete autosaveTimersRef.current[noteId];
    }

    setLocalPageCards((current) => current.filter((pageCard) => pageCard.note.noteId !== noteId));
    setNoteDrafts((current) => omitRecordKey(current, noteId));
    setNoteSnapshots((current) => omitRecordKey(current, noteId));
    setSavingNoteIds((current) => omitRecordKey(current, noteId));
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

  return (
    <main className="h-screen overflow-hidden bg-slate-50 text-slate-900">
      <div className="mx-auto flex h-full max-w-[1720px] flex-col gap-2 md:gap-3">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-slate-50/92 via-slate-50/22 to-slate-50/0 backdrop-blur-md">
            <div className="px-2 pt-1 pb-2 md:px-5 md:pt-2 md:pb-2.5">
              <div className="flex flex-wrap items-center gap-2.5 px-0.5 py-0.5 md:px-0">
                <TagBreadcrumb nodes={tagTree} onSelect={setSelectedTag} selectedPath={selectedTag} />

                <button
                  aria-label="Add new card"
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-base font-normal text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={creatingCard}
                  onClick={() => void createNewCard()}
                  title="Add new card"
                  type="button"
                >
                  <PlusCircledIcon className="h-4 w-4" />
                  <span>New card</span>
                </button>
              </div>
            </div>
          </div>

          {visiblePageCards.length === 0 ? (
            <div className="grid min-h-0 flex-1 place-items-center px-2 pt-12 pb-2 text-base text-slate-400 md:px-5 md:pt-16 md:pb-5">
              {loading ? 'Loading cards…' : 'No cards match the current filters.'}
            </div>
          ) : (
            <div className="scrollbar-hidden min-h-0 flex-1 overflow-auto px-2 pt-12 pb-2 md:px-5 md:pt-16 md:pb-5">
              <LayoutGroup>
                <motion.div className="masonry-grid" layout transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                  <AnimatePresence initial={false} mode="popLayout">
                    {visiblePageCards.map((pageCard) => (
                      <CardTile
                        availableTags={tags}
                        card={pageCard.card}
                        endpoint={endpoint}
                        draft={pageCard.note ? noteDrafts[pageCard.note.noteId] ?? null : null}
                        isPending={pageCard.note?.noteId ? pageCard.note.noteId < 0 : false}
                        key={pageCard.card.cardId}
                        note={pageCard.note}
                        onDelete={deleteNote}
                        onFieldChange={updateDraftField}
                        onOpen={openInBrowser}
                        onSuspend={setSuspended}
                        onTagsChange={updateDraftTags}
                        saving={pageCard.note ? Boolean(savingNoteIds[pageCard.note.noteId]) : false}
                        working={pageCard.note?.noteId ? pageCard.note.noteId < 0 ? false : Boolean(workingCardIds[pageCard.card.cardId]) : false}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </LayoutGroup>
            </div>
          )}
        </section>

        <AnimatePresence>
          {status ? <Toast key={`${status.tone}:${status.text}`} status={status} /> : null}
        </AnimatePresence>
      </div>
    </main>
  );
}

function Toast({ status }: { status: { text: string; tone: StatusTone } }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`pointer-events-none fixed right-3 bottom-3 z-40 max-w-[min(28rem,calc(100vw-1.5rem))] rounded-2xl border px-4 py-3 text-base shadow-lg backdrop-blur-sm md:right-5 md:bottom-5 ${toneClassName(status.tone)}`}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {status.text}
    </motion.div>
  );
}

function TagBreadcrumb({
  nodes,
  onSelect,
  selectedPath,
}: {
  nodes: TreeNode[];
  onSelect: (path: string | null) => void;
  selectedPath: string | null;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const segments = useMemo(() => buildBreadcrumbSegments(nodes, selectedPath), [nodes, selectedPath]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenKey(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenKey(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="min-w-0 flex-1" ref={rootRef}>
      <div className="flex flex-wrap items-center gap-1 text-base">
        {segments.map((segment) => {
          const isOpen = openKey === segment.key;
          const isActive = selectedPath === segment.path || (!selectedPath && segment.path === null);
          const hasDropdown = segment.path === null || segment.options.length > 0;

          return (
            <div className="flex items-center gap-1" key={segment.key}>
              <button
                className={`inline-flex items-center rounded-full px-2 py-1 text-left transition ${
                  isActive
                    ? 'text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                onClick={() => {
                  onSelect(segment.path);
                  setOpenKey(null);
                }}
                title={segment.path ?? '/'}
                type="button"
              >
                <span className="font-normal">{segment.label}</span>
              </button>

              {hasDropdown ? (
                <div className="relative">
                  <button
                    aria-expanded={isOpen}
                    className="inline-flex items-center rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    onClick={() => setOpenKey((current) => (current === segment.key ? null : segment.key))}
                    title={`Show child tags for ${segment.path ?? '/'}`}
                    type="button"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>

                  {isOpen ? (
                    <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 min-w-[14rem] max-w-[min(20rem,80vw)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-200/70">
                      <div className="max-h-72 overflow-auto">
                        {segment.path === null ? (
                          <>
                            <DropdownItem active={selectedPath === null} label="/" onClick={() => {
                              onSelect(null);
                              setOpenKey(null);
                            }} />
                            {segment.options.length > 0 ? <div className="my-1 border-t border-slate-100" /> : null}
                          </>
                        ) : null}

                        {segment.options.map((option) => (
                          <DropdownItem
                            active={selectedPath === option.path}
                            key={option.path}
                            label={option.label}
                            onClick={() => {
                              onSelect(option.path);
                              setOpenKey(null);
                            }}
                            title={option.path}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DropdownItem({
  active,
  label,
  onClick,
  title,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-base font-normal transition ${
        active ? 'text-slate-900' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
      }`}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

function buildBreadcrumbSegments(nodes: TreeNode[], selectedPath: string | null): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [
    {
      key: ROOT_BREADCRUMB_KEY,
      label: '/',
      path: null,
      options: flattenNodes(nodes),
    },
  ];

  if (!selectedPath) {
    return segments;
  }

  const parts = selectedPath.split('::').filter(Boolean);

  for (let index = 0; index < parts.length; index += 1) {
    const path = parts.slice(0, index + 1).join('::');
    const currentNode = findNodeByPath(nodes, path);

    segments.push({
      key: path,
      label: parts[index],
      path,
      options: currentNode
        ? currentNode.children.map((child) => ({
            label: child.name,
            path: child.path,
          }))
        : [],
    });
  }

  return segments;
}

function flattenNodes(nodes: TreeNode[]): BreadcrumbOption[] {
  const options: BreadcrumbOption[] = [];

  const visit = (items: TreeNode[]) => {
    for (const item of items) {
      options.push({
        label: item.path,
        path: item.path,
      });
      visit(item.children);
    }
  };

  visit(nodes);
  return options;
}

function findNodeByPath(nodes: TreeNode[], path: string): TreeNode | null {
  const parts = path.split('::').filter(Boolean);
  let currentNodes = nodes;
  let currentNode: TreeNode | null = null;

  for (const part of parts) {
    currentNode = currentNodes.find((node) => node.name === part) ?? null;
    if (!currentNode) {
      return null;
    }
    currentNodes = currentNode.children;
  }

  return currentNode;
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

function getOrderedFieldNames(note: NoteInfo): string[] {
  return Object.entries(note.fields)
    .sort((left, right) => left[1].order - right[1].order)
    .map(([name]) => name);
}

function buildLocalPageCard({
  cardId,
  deckName,
  fieldNames,
  modelName,
  noteId,
  tags,
}: {
  cardId: number;
  deckName: string;
  fieldNames: string[];
  modelName: string;
  noteId: number;
  tags: string[];
}): LocalPageCard {
  const fields = Object.fromEntries(fieldNames.map((fieldName, index) => [fieldName, { order: index, value: '' }]));

  return {
    card: {
      answer: '',
      cardId,
      deckName,
      due: 0,
      fields,
      lapses: 0,
      modelName,
      note: noteId,
      ord: 0,
      question: '',
      queue: 0,
      reps: 0,
      type: 0,
    },
    note: {
      cards: [],
      fields,
      modelName,
      noteId,
      tags,
    },
  };
}

async function getNewCardTemplate({
  endpoint,
  selectedTag,
  visiblePageCards,
}: {
  endpoint: string;
  selectedTag: string | null;
  visiblePageCards: Array<PageCard | LocalPageCard>;
}): Promise<{ deckName: string; fieldNames: string[]; modelName: string; tags: string[] }> {
  let modelName: string | undefined;
  let fieldNames: string[] = [];

  const firstVisibleNote = visiblePageCards.find((pageCard) => pageCard.note)?.note;
  if (firstVisibleNote) {
    modelName = firstVisibleNote.modelName;
    fieldNames = getOrderedFieldNames(firstVisibleNote);
  } else {
    const modelNames = await invokeAnki<string[]>(endpoint, 'modelNames');
    modelName = modelNames[0];
    if (!modelName) {
      throw new Error('No note type available to create a card.');
    }
    fieldNames = await invokeAnki<string[]>(endpoint, 'modelFieldNames', { modelName });
  }

  const deckNames = await invokeAnki<string[]>(endpoint, 'deckNames');
  const deckName = visiblePageCards[0]?.card.deckName ?? deckNames[0] ?? 'Default';

  return {
    deckName,
    fieldNames,
    modelName,
    tags: selectedTag ? [selectedTag] : [],
  };
}

function omitRecordKey<T>(record: Record<number, T>, key: number): Record<number, T> {
  const next = { ...record };
  delete next[key];
  return next;
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
    return 'border-emerald-200 bg-emerald-50/90 text-emerald-800 shadow-emerald-100/80';
  }
  if (tone === 'error') {
    return 'border-rose-200 bg-rose-50/90 text-rose-800 shadow-rose-100/80';
  }
  return 'border-slate-200 bg-white/90 text-slate-700 shadow-slate-200/80';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}
