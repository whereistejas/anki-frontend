export interface TreeNode {
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
}

interface MutableTreeNode {
  children: Map<string, MutableTreeNode>;
  id: string;
  name: string;
  path: string;
}

export function buildHierarchy(paths: string[]): TreeNode[] {
  const root = new Map<string, MutableTreeNode>();

  for (const fullPath of paths.sort((left, right) => left.localeCompare(right))) {
    if (!fullPath.trim()) {
      continue;
    }

    const parts = fullPath.split('::').filter(Boolean);
    let level = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}::${part}` : part;

      if (!level.has(part)) {
        level.set(part, {
          children: new Map(),
          id: currentPath,
          name: part,
          path: currentPath,
        });
      }

      level = level.get(part)!.children;
    }
  }

  return toNodes(root);
}

function toNodes(level: Map<string, MutableTreeNode>): TreeNode[] {
  return [...level.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((node) => ({
      id: node.id,
      name: node.name,
      path: node.path,
      children: toNodes(node.children),
    }));
}

export function quoteSearchValue(value: string): string {
  const escaped = value.replaceAll('"', '\\"');
  return `"${escaped}"`;
}

export function stripHtml(value: string): string {
  if (typeof window === 'undefined') {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const div = document.createElement('div');
  div.innerHTML = value;
  return div.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export function splitTags(value: string): string[] {
  return value
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}
