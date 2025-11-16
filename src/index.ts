import type { ScheduledEvent } from '@cloudflare/workers-types';
import type { WorkerEnv, ScraperResult } from './types';
import { runScraper } from './scraper';
import { handleErrorRequest, handleNotificationRequest, sendErrorNotification } from './webhook';

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_IN_SECONDS = Math.floor(THIRTY_DAYS_IN_MS / 1000);

type JsonBody = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

function jsonResponse(body: JsonBody, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    ...init
  });
}

interface AttachmentRow {
  id: number;
  r2_key: string | null;
}

interface NoticeIdRow {
  id: string;
}

async function cleanupExpiredData(env: WorkerEnv): Promise<{ notices: number; attachments: number }> {
  if (!env.DB) {
    console.warn('DB binding is not configured. Skip D1 cleanup.');
    return { notices: 0, attachments: 0 };
  }

  const threshold = Math.floor(Date.now() / 1000) - THIRTY_DAYS_IN_SECONDS;

  const { results: attachmentRows } = await env.DB.prepare(`
    SELECT na.id, na.r2_key
    FROM notice_attachments na
    JOIN notices n ON na.notice_id = n.id
    WHERE n.created_at <= ?
  `).bind(threshold).all<AttachmentRow>();

  const keysToDelete = Array.from(new Set(
    attachmentRows
      .map((row) => row.r2_key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0)
  ));

  if (keysToDelete.length) {
    if (!env.ATTACHMENTS_BUCKET) {
      console.warn('ATTACHMENTS_BUCKET binding is not configured. Skipping R2 cleanup but removing metadata.');
    } else {
      await deleteR2Objects(env.ATTACHMENTS_BUCKET, keysToDelete);
    }
  }

  if (attachmentRows.length) {
    await deleteAttachmentRows(env.DB, attachmentRows.map((row) => row.id));
  }

  const { results: noticeRows } = await env.DB.prepare(`
    SELECT id
    FROM notices
    WHERE created_at <= ?
  `).bind(threshold).all<NoticeIdRow>();

  if (noticeRows.length) {
    await deleteNoticeRows(env.DB, noticeRows.map((row) => row.id));
  }

  return { notices: noticeRows.length, attachments: attachmentRows.length };
}

async function deleteR2Objects(bucket: WorkerEnv['ATTACHMENTS_BUCKET'], keys: string[]): Promise<void> {
  if (!bucket) {
    return;
  }
  const chunkSize = 1000;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    await bucket.delete(chunk);
  }
}

async function deleteAttachmentRows(db: WorkerEnv['DB'], ids: number[]): Promise<void> {
  if (!ids.length) {
    return;
  }
  const placeholders = ids.map(() => '?').join(', ');
  await db.prepare(`
    DELETE FROM notice_attachments
    WHERE id IN (${placeholders})
  `).bind(...ids).run();
}

async function deleteNoticeRows(db: WorkerEnv['DB'], ids: string[]): Promise<void> {
  if (!ids.length) {
    return;
  }
  const placeholders = ids.map(() => '?').join(', ');
  await db.prepare(`
    DELETE FROM notices
    WHERE id IN (${placeholders})
  `).bind(...ids).run();
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/notify') {
      return handleNotificationRequest(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/error') {
      return handleErrorRequest(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'Not found' }, { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: WorkerEnv): Promise<void> {
    try {
      const result: ScraperResult = await runScraper(env);
      console.log(`Scraper finished: ${JSON.stringify(result)}`);
    } catch (error) {
      console.error('Scheduled scraper failed', error);
      await sendErrorNotification(error, env);
    }

    try {
      const cleanupResult = await cleanupExpiredData(env);
      if (cleanupResult.notices || cleanupResult.attachments) {
        console.log(`Cleaned up ${cleanupResult.notices} expired notices and ${cleanupResult.attachments} attachments.`);
      }
    } catch (error) {
      console.error('Failed to clean up expired D1/R2 data', error);
      await sendErrorNotification(error, env);
    }
  }
};
