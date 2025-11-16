import type { NormalizedNotice, NoticeAttachment, NoticeItem, ScraperResult, WorkerEnv } from './types';
import { notifyItems, sendErrorNotification } from './webhook';

const PORTAL_BASE_URL = 'https://ep.med.toho-u.ac.jp/';
const TABLE_SELECTORS = ['#T1', '#T2', '#T3', '#T4'];

type FetchLike = typeof fetch;

interface Session {
  request(url: string, options?: RequestInit): Promise<Response>;
  get(url: string, options?: RequestInit): Promise<Response>;
  post(url: string, body: BodyInit | null, options?: RequestInit): Promise<Response>;
}

const clone = <T>(value: T): T => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

export async function runScraper(env: WorkerEnv): Promise<ScraperResult> {
  const loginId = typeof env.LOGIN_ID === 'string' ? env.LOGIN_ID : '';
  const loginPassword = typeof env.LOGIN_PASSWORD === 'string' ? env.LOGIN_PASSWORD : '';
  if (!loginId || !loginPassword) {
    throw new Error('LOGIN_ID or LOGIN_PASSWORD is not configured');
  }
  if (!env.NOTICE_DATA) {
    throw new Error('NOTICE_DATA KV binding is not configured');
  }

  const session = createSession();
  let mainPageDoc: Document;
  try {
    mainPageDoc = await authenticate(session, loginId, loginPassword);
  } catch (error) {
    await sendErrorNotification(error, env);
    throw error;
  }

  const { items } = await collectNotices(session, mainPageDoc);
  return processResponse(items, session, env);
}

async function authenticate(session: Session, loginId: string, loginPassword: string): Promise<Document> {
  const loginUrl = new URL('default.asp', PORTAL_BASE_URL).toString();
  const body = new URLSearchParams({ MAILADDRESS: loginId, LOGINPASS: loginPassword });
  const response = await session.post(loginUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!response.ok) {
    throw new Error(`Login failed with status ${response.status}`);
  }
  const mainPage = await decodeShiftJis(response);
  const doc = parseHtml(mainPage);
  const iframeSrc = doc.querySelector('iframe')?.getAttribute('src');
  if (iframeSrc) {
    const iframeUrl = new URL(iframeSrc, PORTAL_BASE_URL).toString();
    await session.get(iframeUrl);
  }
  return doc;
}

async function collectNotices(session: Session, mainDoc: Document): Promise<{ items: NoticeItem[] }> {
  const items: NoticeItem[] = [];
  let currentYear = new Date().getFullYear();
  let previousUpdated: Date | null = null;

  for (const selector of TABLE_SELECTORS) {
    const table = mainDoc.querySelector(selector);
    if (!table) {
      console.log(`Table not found: ${selector}`);
      continue;
    }
    const rows = Array.from(table.querySelectorAll('tr')).slice(4);
    for (const [index, row] of rows.entries()) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 5) {
        continue;
      }
      const to = splitTargets(cells[0].textContent ?? '');
      const from = sanitizeText(cells[1].textContent ?? '');
      const postedText = sanitizeText(cells[2].textContent ?? '');
      const updatedText = sanitizeText(cells[3].textContent ?? '');
      let updatedCandidate = parseDate(updatedText, currentYear);
      if (previousUpdated && updatedCandidate > previousUpdated) {
        currentYear -= 1;
        updatedCandidate = parseDate(updatedText, currentYear);
      }
      const postedCandidate = parseDate(postedText, currentYear);
      previousUpdated = updatedCandidate;

      const title = sanitizeText(cells[4].textContent ?? '');
      const href = cells[4].querySelector('a')?.getAttribute('href') ?? '';
      const idMatch = href.match(/dID=(\d+)/);
      const id = idMatch ? idMatch[1] : `${selector}-${index}`;

      const rowData: NoticeItem = {
        id,
        to,
        from,
        posted: postedCandidate,
        updated: updatedCandidate,
        title
      };

      if (href) {
        try {
          const detail = await fetchDetailPage(session, href);
          Object.assign(rowData, detail);
          adjustDateWithFullDetail(rowData);
        } catch (error) {
          console.error(`Error fetching detail page for ${id}:`, error);
          throw error;
        }
      }
      items.push(rowData);
    }
  }

  return { items };
}

function adjustDateWithFullDetail(item: NoticeItem): void {
  if (!item.fullUpdated) {
    return;
  }
  const fullYear = item.fullUpdated.getFullYear();
  const posted = new Date(item.posted);
  const updated = new Date(item.updated);
  if (posted.getTime() === updated.getTime() || updated < posted) {
    item.posted = new Date(fullYear, posted.getMonth(), posted.getDate(), posted.getHours(), posted.getMinutes());
    item.updated = new Date(fullYear, updated.getMonth(), updated.getDate(), updated.getHours(), updated.getMinutes());
  } else if (posted < updated) {
    item.updated = new Date(fullYear, updated.getMonth(), updated.getDate(), updated.getHours(), updated.getMinutes());
  }
}

async function fetchDetailPage(session: Session, href: string): Promise<Partial<NoticeItem>> {
  const url = new URL(href, PORTAL_BASE_URL).toString();
  const response = await session.get(url);
  if (!response.ok) {
    throw new Error(`Failed to load detail page ${href} (${response.status})`);
  }
  const html = await decodeShiftJis(response);
  const doc = parseHtml(html);
  const detail: Partial<NoticeItem> = { attachments: [] };
  const rows = doc.querySelectorAll('body > div.clsContainer > div > table.clsTb > tbody > tr');
  rows.forEach((row, index) => {
    if (index === 1) {
      const dateText = row.querySelector('td')?.textContent?.trim();
      detail.fullUpdated = parseFullDate(dateText ?? '');
    } else if (index === 2) {
      const contentRaw = row.querySelector('td')?.innerHTML ?? '';
      detail.content = htmlToMarkdown(contentRaw);
    } else if (index >= 3) {
      const text = row.querySelector('td')?.textContent?.trim() ?? '';
      const urlAttr = row.querySelector('a')?.getAttribute('href');
      if (text) {
        (detail.attachments as NoticeAttachment[]).push({
          text: text.replace(/添付ファイル\d+ \(\w+\) /, ''),
          url: urlAttr ?? undefined
        });
      }
    }
  });
  return detail;
}

async function processResponse(data: NoticeItem[], session: Session, env: WorkerEnv): Promise<ScraperResult> {
  const stored = await env.NOTICE_DATA.get<NormalizedNotice[]>('notice.json', 'json');
  const previousData: NormalizedNotice[] = Array.isArray(stored)
    ? stored.map(normalizeStoredNotice)
    : [];
  const normalizedCurrent = data.map(normalizeNotice);

  const newItems: NoticeItem[] = [];
  const updatedItems: NoticeItem[] = [];
  const itemLookup = new Map(data.map(item => [item.id, item] as const));

  for (const normalizedItem of normalizedCurrent) {
    const original = itemLookup.get(normalizedItem.id);
    if (!original) {
      continue;
    }
    const existingItem = previousData.find(item => item.id === normalizedItem.id);
    if (!existingItem) {
      newItems.push(clone(original));
      continue;
    }
    const isUpdated = hasNoticeChanged(normalizedItem, existingItem);
    const isUpdatedNoDetail = hasNoticeChangedWithoutDetail(normalizedItem, existingItem);

    if (isUpdated) {
      if (!isUpdatedNoDetail) {
        await sendErrorNotification(new Error(`updated Item ${normalizedItem.id} can't be detected without detail`), env);
      }
      updatedItems.push(clone(original));
    }
  }

  if (newItems.length || updatedItems.length) {
    if (newItems.length > 20 || updatedItems.length > 20) {
      console.log('Too many new or updated items. Skipping attachment uploads and notifications.');
    } else {
      try {
        const enrichedNew = await Promise.all(newItems.map(item => saveAttachmentForItem(session, item, env)));
        const enrichedUpdated = await Promise.all(updatedItems.map(item => saveAttachmentForItem(session, item, env)));
        await notifyItems(enrichedNew, enrichedUpdated, env);
      } catch (error) {
        console.error('Error during notification pipeline', error);
        await sendErrorNotification(error, env);
      }
    }
  }

  await env.NOTICE_DATA.put('notice.json', JSON.stringify(normalizedCurrent));
  return { new: newItems.length, updated: updatedItems.length };
}

async function saveAttachmentForItem(session: Session, item: NoticeItem, env: WorkerEnv): Promise<NoticeItem> {
  if (!item.attachments?.length) {
    return item;
  }
  const attachments: NoticeAttachment[] = [];
  for (const attachment of item.attachments) {
    try {
      const fileUrl = await saveAttachment(session, attachment, env);
      attachments.push({ ...attachment, file_url: fileUrl ?? null });
    } catch (error) {
      console.error('Error saving attachment', attachment.text, error);
      await sendErrorNotification(error, env);
      attachments.push(attachment);
    }
  }
  return { ...item, attachments };
}

async function saveAttachment(session: Session, attachment: NoticeAttachment, env: WorkerEnv): Promise<string | null> {
  if (!attachment.url) {
    return null;
  }
  const url = new URL(attachment.url, PORTAL_BASE_URL).toString();
  const response = await session.get(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment ${attachment.text} (${response.status})`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    console.warn('Received HTML while expecting attachment');
    return null;
  }
  const arrayBuffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  return uploadFile(base64, attachment.text, env);
}

async function uploadFile(file: string, title: string, env: WorkerEnv): Promise<string | null> {
  if (typeof env.UPLOAD_URL !== 'string' || typeof env.UPLOAD_TOKEN !== 'string') {
    console.warn('UPLOAD_URL or UPLOAD_TOKEN is not configured. Skipping upload.');
    return null;
  }
  const payload = {
    token: env.UPLOAD_TOKEN,
    filename: title,
    mimeType: inferMimeType(title),
    fileData: file
  } satisfies Record<string, unknown>;
  const response = await fetch(env.UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
  const data = await response.json() as { fileUrl?: string };
  if (!data.fileUrl) {
    throw new Error('Upload response missing fileUrl');
  }
  return data.fileUrl;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function inferMimeType(filename = ''): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png'
  };
  return map[ext ?? ''] || 'application/octet-stream';
}

function normalizeNotice(item: NoticeItem): NormalizedNotice {
  return {
    id: item.id,
    to: [...item.to],
    from: item.from,
    posted: new Date(item.posted).toISOString(),
    updated: new Date(item.updated).toISOString(),
    title: item.title,
    content: item.content,
    attachments: (item.attachments || []).map(({ file_url: _fileUrl, ...rest }) => ({ ...rest }))
  };
}

function normalizeStoredNotice(item: NormalizedNotice): NormalizedNotice {
  return {
    id: item.id,
    to: Array.isArray(item.to) ? [...item.to] : [],
    from: item.from,
    posted: item.posted,
    updated: item.updated,
    title: item.title,
    content: item.content,
    attachments: Array.isArray(item.attachments) ? item.attachments.map(att => ({ ...att })) : []
  };
}

function hasNoticeChanged(current: NormalizedNotice, previous: NormalizedNotice): boolean {
  return current.updated !== previous.updated ||
    current.content !== previous.content ||
    JSON.stringify(current.attachments) !== JSON.stringify(previous.attachments) ||
    current.from !== previous.from ||
    JSON.stringify(current.to) !== JSON.stringify(previous.to) ||
    current.title !== previous.title;
}

function hasNoticeChangedWithoutDetail(current: NormalizedNotice, previous: NormalizedNotice): boolean {
  return current.updated !== previous.updated ||
    current.from !== previous.from ||
    JSON.stringify(current.to) !== JSON.stringify(previous.to) ||
    current.title !== previous.title;
}

function splitTargets(text: string): string[] {
  return text
    .split(/[,、]/)
    .map(part => part.trim())
    .filter(Boolean);
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseDate(dateStr: string, year: number): Date {
  if (!dateStr) {
    return new Date(year, 0, 1);
  }
  const [monthDay, time] = dateStr.split(' ');
  if (!monthDay || !time) {
    return new Date(year, 0, 1);
  }
  const [month, day] = monthDay.split('/').map(part => parseInt(part, 10));
  const [hour, minute] = time.split(':').map(part => parseInt(part, 10));
  if ([month, day, hour, minute].some(value => Number.isNaN(value))) {
    return new Date(year, 0, 1);
  }
  return new Date(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
}

function parseFullDate(dateStr: string): Date {
  if (!dateStr) {
    return new Date();
  }
  const regex = /(\d{4})\D+(\d{1,2})\D+(\d{1,2}).*?(\d{1,2}):(\d{1,2})/;
  const match = dateStr.match(regex);
  if (match) {
    const [, year, month, day, hour, minute] = match.map(Number);
    const parsed = new Date(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  const fallback = new Date(dateStr);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

function htmlToMarkdown(html = ''): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*\/li\s*>/gi, '')
    .replace(/<\s*strong[^>]*>/gi, '**')
    .replace(/<\s*\/strong\s*>/gi, '**')
    .replace(/<\s*em[^>]*>/gi, '_')
    .replace(/<\s*\/em\s*>/gi, '_')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

async function decodeShiftJis(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder('shift_jis');
  return decoder.decode(buffer);
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function createSession(fetchImpl: FetchLike = fetch): Session {
  const cookieJar = new Map<string, string>();
  return {
    async request(url: string, options: RequestInit = {}): Promise<Response> {
      const headers = new Headers(options.headers || {});
      if (cookieJar.size) {
        headers.set('Cookie', Array.from(cookieJar.values()).join('; '));
      }
      const response = await fetchImpl(url, { ...options, headers });
      const cookies = extractCookies(response);
      cookies.forEach(cookie => {
        const [nameValue] = cookie.split(';');
        if (!nameValue) {
          return;
        }
        const [name, value] = nameValue.split('=');
        if (!name) {
          return;
        }
        cookieJar.set(name.trim(), `${name.trim()}=${value ?? ''}`);
      });
      return response;
    },
    get(url: string, options: RequestInit = {}) {
      return this.request(url, { ...options, method: 'GET' });
    },
    post(url: string, body: BodyInit | null, options: RequestInit = {}) {
      return this.request(url, { ...options, method: 'POST', body });
    }
  };
}

function extractCookies(response: Response): string[] {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(response.headers);
  }
  const header = response.headers.get('set-cookie');
  if (!header) {
    return [];
  }
  if (header.includes('\n')) {
    return header.split('\n').map(line => line.trim()).filter(Boolean);
  }
  return splitSetCookieHeader(header);
}

function splitSetCookieHeader(header: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < header.length; i++) {
    const char = header[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    }
    if (char === ',' && !inQuotes) {
      const next = header.slice(i + 1);
      if (/^\s*[^=]+=/.test(next)) {
        cookies.push(header.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}
