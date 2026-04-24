import { retrieveMediaFile } from './ankiconnect';

const mediaUrlCache = new Map<string, Promise<string | null>>();

export async function resolveHtmlMedia(endpoint: string, html: string): Promise<string> {
  if (typeof window === 'undefined' || !html.includes('<img')) {
    return html;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');
  const images = [...document.querySelectorAll('img[src]')];

  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute('src')?.trim();
      if (!src || !isAnkiMediaFilename(src)) {
        return;
      }

      const filename = src.split('?')[0]?.split('#')[0] ?? src;
      const resolved = await getMediaDataUrl(endpoint, filename);
      if (resolved) {
        image.setAttribute('src', resolved);
      }
    }),
  );

  return document.body.innerHTML;
}

function isAnkiMediaFilename(src: string): boolean {
  return !/^(?:https?:|data:|blob:|\/)/i.test(src);
}

function getMediaDataUrl(endpoint: string, filename: string): Promise<string | null> {
  const cacheKey = `${endpoint}::${filename}`;
  const existing = mediaUrlCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = retrieveMediaFile(endpoint, filename)
    .then((base64) => (base64 ? `data:${getMimeType(filename)};base64,${base64}` : null))
    .catch(() => null);

  mediaUrlCache.set(cacheKey, promise);
  return promise;
}

function getMimeType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}
