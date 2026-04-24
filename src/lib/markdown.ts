import TurndownService from 'turndown';
import { marked } from 'marked';

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

export function htmlToMarkdown(value: string): string {
  return turndown.turndown(value ?? '');
}

export function markdownToHtml(value: string): string {
  return marked.parse(value ?? '') as string;
}
