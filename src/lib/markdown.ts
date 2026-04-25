import TurndownService from 'turndown';
import { marked } from 'marked';
import katex from 'katex';

const turndown = new TurndownService({
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  headingStyle: 'atx',
  strongDelimiter: '**',
});

marked.setOptions({
  breaks: true,
  gfm: true,
});

marked.use({
  extensions: [
    {
      level: 'block',
      name: 'blockKatex',
      start(src) {
        const dollarIndex = src.indexOf('$$');
        const bracketIndex = src.indexOf('\\[');
        if (dollarIndex === -1) {
          return bracketIndex;
        }
        if (bracketIndex === -1) {
          return dollarIndex;
        }
        return Math.min(dollarIndex, bracketIndex);
      },
      tokenizer(src) {
        if (src.startsWith('$$')) {
          const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
          if (match) {
            return {
              displayMode: true,
              raw: match[0],
              text: match[1].trim(),
              type: 'blockKatex',
            };
          }
        }

        if (src.startsWith('\\[')) {
          const match = /^\\\[([\s\S]+?)\\\](?:\n|$)/.exec(src);
          if (match) {
            return {
              displayMode: true,
              raw: match[0],
              text: match[1].trim(),
              type: 'blockKatex',
            };
          }
        }

        return undefined;
      },
      renderer(token) {
        return katex.renderToString(token.text, {
          displayMode: token.displayMode,
          strict: 'ignore',
          throwOnError: false,
        });
      },
    },
    {
      level: 'inline',
      name: 'inlineKatex',
      start(src) {
        const dollarIndex = src.indexOf('$');
        const parenIndex = src.indexOf('\\(');
        if (dollarIndex === -1) {
          return parenIndex;
        }
        if (parenIndex === -1) {
          return dollarIndex;
        }
        return Math.min(dollarIndex, parenIndex);
      },
      tokenizer(src) {
        if (src.startsWith('\\(')) {
          const match = /^\\\(([^]+?)\\\)/.exec(src);
          if (match) {
            return {
              displayMode: false,
              raw: match[0],
              text: match[1].trim(),
              type: 'inlineKatex',
            };
          }
        }

        if (src.startsWith('$') && !src.startsWith('$$')) {
          let index = 1;
          while (index < src.length) {
            if (src[index] === '$' && src[index - 1] !== '\\') {
              const text = src.slice(1, index);
              if (!/\n/.test(text) && text.trim()) {
                return {
                  displayMode: false,
                  raw: src.slice(0, index + 1),
                  text: text.trim(),
                  type: 'inlineKatex',
                };
              }
              return undefined;
            }
            index += 1;
          }
        }

        return undefined;
      },
      renderer(token) {
        return katex.renderToString(token.text, {
          displayMode: token.displayMode,
          strict: 'ignore',
          throwOnError: false,
        });
      },
    },
  ],
});

turndown.addRule('katexDisplay', {
  filter: (node) => hasClass(node, 'katex-display'),
  replacement: (_content, node) => {
    const tex = extractKatexSource(node);
    return tex ? `\n\n$$${tex}$$\n\n` : '\n\n';
  },
});

turndown.addRule('katexInline', {
  filter: (node) => hasClass(node, 'katex') && !hasClass(node.parentNode, 'katex-display'),
  replacement: (_content, node) => {
    const tex = extractKatexSource(node);
    return tex ? `$${tex}$` : '';
  },
});

export function htmlToMarkdown(value: string): string {
  return turndown.turndown(value ?? '');
}

export function markdownToHtml(value: string): string {
  return marked.parse(value ?? '') as string;
}

function hasClass(node: unknown, className: string): boolean {
  if (!node || typeof node !== 'object' || !('classList' in node)) {
    return false;
  }

  const classList = (node as { classList?: DOMTokenList }).classList;
  return classList?.contains(className) ?? false;
}

function extractKatexSource(node: unknown): string {
  if (!node || typeof node !== 'object' || !('querySelector' in node)) {
    return '';
  }

  const annotation = (node as { querySelector: (selector: string) => Element | null }).querySelector(
    'annotation[encoding="application/x-tex"]',
  );

  return annotation?.textContent?.trim() ?? '';
}
