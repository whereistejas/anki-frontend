import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type Ref } from 'react';
import { createPortal } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { RangeSetBuilder } from '@codemirror/state';
import type { EditorView as CodeMirrorEditorView } from '@codemirror/view';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { BookmarkIcon, Cross2Icon, CrossCircledIcon, DragHandleDots2Icon, OpenInNewWindowIcon, TrashIcon } from '@radix-ui/react-icons';
import katex from 'katex';
import type { CardInfo, NoteInfo } from '../lib/ankiconnect';
import { markdownToHtml } from '../lib/markdown';
import { resolveHtmlMedia } from '../lib/media';
import { splitTags } from '../lib/tree';

interface NoteDraft {
  fields: Record<string, string>;
  tags: string;
}

interface CardTileProps {
  availableTags: string[];
  card: CardInfo;
  cardRef?: Ref<HTMLElement>;
  cardStyle?: CSSProperties;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  dragHandleRef?: Ref<HTMLButtonElement>;
  endpoint: string;
  draft: NoteDraft | null;
  isDragOverlay?: boolean;
  isDragging?: boolean;
  isPending?: boolean;
  note: NoteInfo | null;
  onDelete: (noteId: number) => void;
  onFieldChange: (noteId: number, fieldName: string, value: string) => void;
  onOpen: (noteId: number) => void;
  onSuspend: (cardId: number, suspended: boolean) => void;
  onTagsChange: (noteId: number, value: string) => void;
  saving: boolean;
  working: boolean;
}

function CardTile({
  availableTags,
  card,
  cardRef,
  cardStyle,
  dragHandleProps,
  dragHandleRef,
  endpoint,
  draft,
  isDragOverlay = false,
  isDragging = false,
  isPending = false,
  note,
  onDelete,
  onFieldChange,
  onOpen,
  onSuspend,
  onTagsChange,
  saving,
  working,
}: CardTileProps) {
  const fieldNames = note ? getPrimaryFieldNames(note) : [];
  const hasBack = fieldNames.length > 1;
  const frontField = fieldNames[0];
  const backField = fieldNames[1];
  return (
    <article
      className={`group relative masonry-item overflow-hidden rounded-[1.1rem] border border-slate-300 bg-white transition-[box-shadow,opacity,transform] md:rounded-[1.4rem] ${
        isDragging || isDragOverlay
          ? 'z-30 scale-[1.01] opacity-90 shadow-[0_14px_34px_rgba(15,23,42,0.16)] ring-1 ring-sky-200/80'
          : 'shadow-[0_2px_8px_rgba(15,23,42,0.05)] hover:shadow-[0_5px_14px_rgba(15,23,42,0.08)]'
      }`}
      ref={cardRef}
      style={cardStyle}
    >
      <button
        aria-label="Drag to reorder"
        className={`card-drag-handle absolute right-3 top-3 z-20 inline-flex touch-none items-center rounded-full bg-white/90 p-1 text-slate-400 shadow-sm ring-1 ring-slate-200/80 backdrop-blur transition hover:text-slate-700 md:right-4 md:top-4 ${
          isDragging || isDragOverlay ? 'cursor-grabbing opacity-100' : 'cursor-grab opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
        ref={dragHandleRef}
        title="Drag to reorder"
        type="button"
        {...dragHandleProps}
      >
        <DragHandleDots2Icon className="h-4 w-4" />
      </button>

      {note && draft && frontField ? (
        <>
          <section className="min-h-[3rem] pb-5">
            <FieldEditor
              endpoint={endpoint}
              panel="front"
              onChange={(value) => onFieldChange(note.noteId, frontField, value)}
              value={draft.fields[frontField] ?? ''}
            />
          </section>

          {hasBack ? <div className="border-t border-slate-200" /> : null}

          {hasBack && backField ? (
            <section className="relative min-h-[3rem] pb-12">
              <FieldEditor
                endpoint={endpoint}
                panel="back"
                onChange={(value) => onFieldChange(note.noteId, backField, value)}
                value={draft.fields[backField] ?? ''}
              />
              <CardActions
                availableTags={availableTags}
                card={card}
                noteId={note.noteId}
                onDelete={onDelete}
                onOpen={onOpen}
                onSuspend={onSuspend}
                onTagsChange={onTagsChange}
                pending={isPending}
                saving={saving}
                selectedTags={splitTags(draft.tags)}
                working={working}
              />
            </section>
          ) : (
            <section className="relative min-h-[3rem] border-t border-slate-200 pb-12">
              <div className="card-panel card-panel-back" />
              <CardActions
                availableTags={availableTags}
                card={card}
                noteId={note.noteId}
                onDelete={onDelete}
                onOpen={onOpen}
                onSuspend={onSuspend}
                onTagsChange={onTagsChange}
                pending={isPending}
                saving={saving}
                selectedTags={splitTags(draft.tags)}
                working={working}
              />
            </section>
          )}
        </>
      ) : (
        <div className="p-4 text-base font-normal text-slate-400 md:p-5">Note details are not available for this card.</div>
      )}
    </article>
  );
}

function FieldEditor({
  endpoint,
  onChange,
  panel,
  value,
}: {
  endpoint: string;
  onChange: (value: string) => void;
  panel: 'front' | 'back';
  value: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(42);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previewMeasureRef = useRef<HTMLDivElement | null>(null);
  const sourceMeasureRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<CodeMirrorEditorView | null>(null);
  const pendingCursorCoordsRef = useRef<{ x: number; y: number } | null>(null);

  const rawHtml = useMemo(() => markdownToHtml(value) || '&nbsp;', [value]);
  const [resolvedHtml, setResolvedHtml] = useState(rawHtml);

  useEffect(() => {
    let cancelled = false;

    void resolveHtmlMedia(endpoint, rawHtml).then((nextHtml) => {
      if (!cancelled) {
        setResolvedHtml(nextHtml || '&nbsp;');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [endpoint, rawHtml]);

  useLayoutEffect(() => {
    const measure = () => {
      const previewHeight = previewMeasureRef.current?.getBoundingClientRect().height ?? 0;
      const sourceHeight = sourceMeasureRef.current?.getBoundingClientRect().height ?? 0;
      const nextHeight = Math.max(42, Math.ceil(Math.max(previewHeight, sourceHeight)) + 2);

      setMeasuredHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    measure();

    const previewNode = previewMeasureRef.current;
    const sourceNode = sourceMeasureRef.current;
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(measure);
    });

    if (previewNode) {
      resizeObserver.observe(previewNode);
      for (const image of previewNode.querySelectorAll('img')) {
        image.addEventListener('load', measure);
        image.addEventListener('error', measure);
      }
    }

    if (sourceNode) {
      resizeObserver.observe(sourceNode);
    }

    return () => {
      resizeObserver.disconnect();
      if (previewNode) {
        for (const image of previewNode.querySelectorAll('img')) {
          image.removeEventListener('load', measure);
          image.removeEventListener('error', measure);
        }
      }
    };
  }, [resolvedHtml, value]);

  useLayoutEffect(() => {
    if (!isEditing) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsEditing(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isEditing]);

  const editorHeight = measuredHeight;
  const contentPanelClassName = panel === 'front' ? 'card-panel-front' : 'card-panel-back';
  const editorPanelClassName = panel === 'front' ? 'cm-card-front' : 'cm-card-back';

  return (
    <div className="relative h-full" ref={rootRef}>
      <div className="pointer-events-none absolute left-0 top-0 -z-10 w-full opacity-0">
        <div
          className={`card-panel-content ${contentPanelClassName} card-html`}
          dangerouslySetInnerHTML={{ __html: resolvedHtml }}
          ref={previewMeasureRef}
        />
        <div className={`card-panel-content ${contentPanelClassName} whitespace-pre-wrap break-words`} ref={sourceMeasureRef}>
          {value || ' '}
        </div>
      </div>

      {isEditing ? (
        <div style={{ height: `${editorHeight}px` }}>
          <CodeMirror
            basicSetup={{
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              lineNumbers: false,
            }}
            className={`cm-minimal cm-card ${editorPanelClassName}`}
            extensions={editorExtensions}
            height="100%"
            onChange={onChange}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
              if (pendingCursorCoordsRef.current) {
                placeCursorFromCoords(view, pendingCursorCoordsRef.current);
                pendingCursorCoordsRef.current = null;
              }
            }}
            value={value}
          />
        </div>
      ) : (
        <button
          className="h-full w-full text-left"
          onClick={(event) => {
            pendingCursorCoordsRef.current = { x: event.clientX, y: event.clientY };
            setIsEditing(true);
          }}
          style={{ height: `${editorHeight}px` }}
          type="button"
        >
          <div
            className={`card-panel-content ${contentPanelClassName} card-html`}
            dangerouslySetInnerHTML={{ __html: resolvedHtml }}
          />
        </button>
      )}
    </div>
  );
}

function placeCursorFromCoords(view: CodeMirrorEditorView, coords: { x: number; y: number }) {
  window.requestAnimationFrame(() => {
    const position = view.posAtCoords(coords);
    view.focus();

    if (position == null) {
      const end = view.state.doc.length;
      view.dispatch({ selection: { anchor: end } });
      return;
    }

    view.dispatch({ selection: { anchor: position } });
  });
}

function CardActions({
  availableTags,
  card,
  noteId,
  onDelete,
  onOpen,
  onSuspend,
  onTagsChange,
  pending,
  saving,
  selectedTags,
  working,
}: {
  availableTags: string[];
  card: CardInfo;
  noteId: number;
  onDelete: (noteId: number) => void;
  onOpen: (noteId: number) => void;
  onSuspend: (cardId: number, suspended: boolean) => void;
  onTagsChange: (noteId: number, value: string) => void;
  pending: boolean;
  saving: boolean;
  selectedTags: string[];
  working: boolean;
}) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; top: number }>({ left: 12, top: 12 });
  const tagsRootRef = useRef<HTMLDivElement | null>(null);
  const tagsButtonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!tagsOpen) {
      return;
    }

    const updatePosition = () => {
      if (!tagsButtonRef.current) {
        return;
      }

      const rect = tagsButtonRef.current.getBoundingClientRect();
      const dropdownWidth = dropdownRef.current?.offsetWidth ?? 320;
      const dropdownHeight = dropdownRef.current?.offsetHeight ?? 220;
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - dropdownWidth - 12);
      const top = Math.max(12, rect.top - dropdownHeight - 8);

      setDropdownPosition({ left, top });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!tagsRootRef.current?.contains(event.target as Node)) {
        setTagsOpen(false);
      }
    };

    updatePosition();
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [tagsOpen]);

  return (
    <div
      className={`absolute inset-x-3 bottom-3 z-20 flex items-end justify-between gap-3 transition-opacity md:inset-x-4 md:bottom-4 md:gap-4 ${
        tagsOpen
          ? 'visible opacity-100'
          : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'
      }`}
    >
      <div className="pointer-events-auto" ref={tagsRootRef}>
        <button
          aria-label="Edit tags"
          className="inline-flex items-center rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          onClick={() => setTagsOpen((open) => !open)}
          ref={tagsButtonRef}
          title="Edit tags"
          type="button"
        >
          <BookmarkIcon className="h-4 w-4" />
        </button>
        {tagsOpen && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="fixed z-30 min-w-max max-w-[calc(100vw-24px)] rounded-2xl border border-slate-200 bg-white p-2.5 shadow-lg shadow-slate-200/60"
                ref={dropdownRef}
                style={{ left: `${dropdownPosition.left}px`, top: `${dropdownPosition.top}px` }}
              >
                <div className="max-h-52 overflow-auto">
                  <div className="flex flex-col items-start gap-2">
                    {[...availableTags].sort((left, right) => {
                      const leftSelected = selectedTags.includes(left);
                      const rightSelected = selectedTags.includes(right);
                      if (leftSelected === rightSelected) {
                        return left.localeCompare(right);
                      }
                      return leftSelected ? -1 : 1;
                    }).map((tag) => {
                      const selected = selectedTags.includes(tag);

                      return (
                        <button
                          className={`inline-flex w-max items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-normal shadow-sm transition ${
                            selected
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300'
                              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-900'
                          }`}
                          key={tag}
                          onClick={() => {
                            const nextTags = selected
                              ? selectedTags.filter((selectedTag) => selectedTag !== tag)
                              : [...selectedTags, tag];
                            onTagsChange(noteId, nextTags.join(' '));
                          }}
                          type="button"
                        >
                          <span>{tag}</span>
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${selected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                            <Cross2Icon className="h-4 w-4" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>

      <div className="pointer-events-auto flex items-center justify-end gap-1.5 text-base font-normal text-slate-400 md:gap-2">
        {saving ? <SavingSpinner /> : null}
        {pending ? (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-base font-normal text-amber-700 ring-1 ring-amber-200">
            Unsaved
          </span>
        ) : (
          <>
            <button
              aria-label="Open in Anki"
              className="inline-flex items-center rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              onClick={() => onOpen(card.note)}
              title="Open in Anki"
              type="button"
            >
              <OpenInNewWindowIcon className="h-4 w-4" />
            </button>
            <button
              aria-label={card.queue === -1 ? 'Unsuspend' : 'Suspend'}
              aria-pressed={card.queue === -1}
              className={`inline-flex items-center rounded-full p-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                card.queue === -1
                  ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100 hover:text-rose-700'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
              disabled={working}
              onClick={() => onSuspend(card.cardId, card.queue !== -1)}
              title={card.queue === -1 ? 'Unsuspend' : 'Suspend'}
              type="button"
            >
              <CrossCircledIcon className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          aria-label={pending ? 'Discard' : 'Delete'}
          className="inline-flex items-center rounded-full p-1 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
          onClick={() => onDelete(noteId)}
          title={pending ? 'Discard' : 'Delete'}
          type="button"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SavingSpinner() {
  return (
    <span aria-label="Saving" className="inline-flex items-center text-slate-400" role="status" title="Saving">
      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
    </span>
  );
}

function getPrimaryFieldNames(note: NoteInfo): string[] {
  const names = Object.keys(note.fields);
  if (names.length === 0) {
    return [];
  }

  const front = names.find((name) => name.toLowerCase() === 'front') ?? names[0];
  const back = names.find((name) => name.toLowerCase() === 'back' && name !== front) ?? names.find((name) => name !== front);

  return back ? [front, back] : [front];
}

export default memo(CardTile);

class MathWidget extends WidgetType {
  constructor(
    private readonly value: string,
    private readonly displayMode: boolean,
  ) {
    super();
  }

  override toDOM() {
    const element = document.createElement(this.displayMode ? 'div' : 'span');
    element.className = this.displayMode ? 'cm-math-widget cm-math-widget-block' : 'cm-math-widget';
    element.innerHTML = katex.renderToString(this.value, {
      displayMode: this.displayMode,
      strict: 'ignore',
      throwOnError: false,
    });
    return element;
  }
}

const mathPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view: EditorView) {
      this.decorations = buildMathDecorations(view);
    }

    update(update: { docChanged: boolean; selectionSet: boolean; view: EditorView }) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildMathDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

const editorExtensions = [markdownLanguage(), EditorView.lineWrapping, mathPreviewPlugin];

function buildMathDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const selection = view.state.selection.main;

  for (const range of findMathRanges(text)) {
    const overlapsSelection = selection.from <= range.to && selection.to >= range.from;
    if (overlapsSelection) {
      continue;
    }

    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        block: range.displayMode,
        widget: new MathWidget(range.value, range.displayMode),
      }),
    );
  }

  return builder.finish();
}

function findMathRanges(text: string): Array<{ displayMode: boolean; from: number; to: number; value: string }> {
  const ranges: Array<{ displayMode: boolean; from: number; to: number; value: string }> = [];
  let index = 0;

  while (index < text.length) {
    if (text.startsWith('$$', index)) {
      const end = text.indexOf('$$', index + 2);
      if (end !== -1) {
        const value = text.slice(index + 2, end).trim();
        if (value) {
          ranges.push({ displayMode: true, from: index, to: end + 2, value });
        }
        index = end + 2;
        continue;
      }
    }

    if (text.startsWith('\\[', index)) {
      const end = text.indexOf('\\]', index + 2);
      if (end !== -1) {
        const value = text.slice(index + 2, end).trim();
        if (value) {
          ranges.push({ displayMode: true, from: index, to: end + 2, value });
        }
        index = end + 2;
        continue;
      }
    }

    if (text.startsWith('\\(', index)) {
      const end = text.indexOf('\\)', index + 2);
      if (end !== -1) {
        const value = text.slice(index + 2, end).trim();
        if (value) {
          ranges.push({ displayMode: false, from: index, to: end + 2, value });
        }
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '$' && text[index - 1] !== '\\' && !text.startsWith('$$', index)) {
      let end = index + 1;

      while (end < text.length) {
        if (text[end] === '\n') {
          end = -1;
          break;
        }

        if (text[end] === '$' && text[end - 1] !== '\\') {
          break;
        }

        end += 1;
      }

      if (end > index) {
        const value = text.slice(index + 1, end).trim();
        if (value) {
          ranges.push({ displayMode: false, from: index, to: end + 1, value });
        }
        index = end + 1;
        continue;
      }
    }

    index += 1;
  }

  return ranges;
}
