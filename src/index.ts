import type { ScheduledEvent } from '@cloudflare/workers-types';
import type { WorkerEnv, ScraperResult } from './types';
import { runScraper } from './scraper';
import { handleErrorRequest, handleNotificationRequest, sendErrorNotification } from './webhook';

type JsonBody = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

function jsonResponse(body: JsonBody, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    ...init
  });
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
  }
};
