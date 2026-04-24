import { useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode } from '../lib/tree';

interface TreeViewProps {
  emptyLabel: string;
  nodes: TreeNode[];
  onSelect: (path: string | null) => void;
  selectedPath: string | null;
  title: string;
}

export default function TreeView({
  emptyLabel,
  nodes,
  onSelect,
  selectedPath,
  title,
}: TreeViewProps) {
  const initialExpanded = useMemo(() => collectPaths(nodes), [nodes]);
  const storageKey = `myanki.tree.expanded.${title.toLowerCase().replace(/\s+/g, '-')}`;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const hasRestoredRef = useRef(false);
  const previousPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const availablePaths = new Set(initialExpanded);

    setExpanded((current) => {
      if (!hasRestoredRef.current) {
        let next = new Set(initialExpanded);

        try {
          const saved = window.localStorage.getItem(storageKey);
          if (saved) {
            const parsed = JSON.parse(saved) as string[];
            next = new Set(parsed.filter((path) => availablePaths.has(path)));
          }
        } catch {
          next = new Set(initialExpanded);
        }

        hasRestoredRef.current = true;
        previousPathsRef.current = availablePaths;
        return next;
      }

      const next = new Set([...current].filter((path) => availablePaths.has(path)));

      for (const path of availablePaths) {
        if (!previousPathsRef.current.has(path)) {
          next.add(path);
        }
      }

      previousPathsRef.current = availablePaths;
      return next;
    });
  }, [initialExpanded, storageKey]);

  useEffect(() => {
    if (!hasRestoredRef.current) {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify([...expanded]));
  }, [expanded, storageKey]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <section className="flex h-full min-h-0 max-h-[calc(100vh-1rem)] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white md:max-h-[calc(100vh-2rem)]">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>

      {nodes.length === 0 ? (
        <div className="grid min-h-[8rem] place-items-center px-3 text-sm text-slate-400">{emptyLabel}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1.5">
          {nodes.map((node) => (
            <TreeRow
              expanded={expanded}
              key={node.id}
              level={0}
              node={node}
              onSelect={onSelect}
              selectedPath={selectedPath}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface TreeRowProps {
  expanded: Set<string>;
  level: number;
  node: TreeNode;
  onSelect: (path: string | null) => void;
  selectedPath: string | null;
  toggle: (path: string) => void;
}

function TreeRow({ expanded, level, node, onSelect, selectedPath, toggle }: TreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <div className="flex items-center gap-1" style={{ paddingLeft: `${level * 14}px` }}>
        <button
          aria-label={hasChildren ? (isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`) : `Open ${node.name}`}
          className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 transition ${
            hasChildren ? 'hover:bg-slate-100 hover:text-slate-700' : 'cursor-default opacity-40'
          }`}
          onClick={() => {
            if (hasChildren) {
              toggle(node.path);
            }
          }}
          type="button"
        >
          {hasChildren ? <Chevron open={isExpanded} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
        </button>

        <button
          className={`flex-1 truncate rounded px-2 py-1 text-left text-sm transition ${
            isSelected ? 'bg-sky-50 text-sky-700' : 'text-slate-700 hover:bg-slate-50'
          }`}
          onClick={() => onSelect(node.path)}
          title={node.path}
          type="button"
        >
          {node.name}
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <div>
          {node.children.map((child) => (
            <TreeRow
              expanded={expanded}
              key={child.id}
              level={level + 1}
              node={child}
              onSelect={onSelect}
              selectedPath={selectedPath}
              toggle={toggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9 6L15 12L9 18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function collectPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];

  const visit = (items: TreeNode[]) => {
    for (const node of items) {
      paths.push(node.path);
      visit(node.children);
    }
  };

  visit(nodes);
  return paths;
}
