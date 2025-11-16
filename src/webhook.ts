import type { WorkerEnv, NoticeItem } from './types';

const GRADE_KEYS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const;
type Grade = (typeof GRADE_KEYS)[number];
type NotificationType = 'new' | 'updated';

interface NotificationPayload {
  new?: NoticeItem[];
  updated?: NoticeItem[];
}

function jsonResponse(body: Record<string, unknown>, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    ...init
  });
}

function formatDate(dateLike?: Date | string): string {
  if (!dateLike) {
    return '日時未取得';
  }
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return '日時未取得';
  }
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatAttachments(attachments: NoticeItem['attachments'] = []): string {
  return attachments
    .map(att => att.file_url ? `- <${att.file_url}|${att.text}>` : `- ${att.text}`)
    .join('\n');
}

function collectTargets(item: NoticeItem): Set<Grade> {
  const targets = new Set<Grade>();
  for (const target of item.to || []) {
    if (target === '全医学部生' || target === '全学') {
      GRADE_KEYS.forEach(key => targets.add(key));
      break;
    }
    if (GRADE_KEYS.includes(target as Grade)) {
      targets.add(target as Grade);
    }
  }
  return targets;
}

export async function notifyItems(newItems: NoticeItem[] = [], updatedItems: NoticeItem[] = [], env: WorkerEnv): Promise<void> {
  for (const item of newItems) {
    await sendWebhook(item, 'new', env);
  }
  for (const item of updatedItems) {
    await sendWebhook(item, 'updated', env);
  }
}

export async function handleNotificationRequest(request: Request, env: WorkerEnv): Promise<Response> {
  let payload: NotificationPayload;
  try {
    payload = await request.json() as NotificationPayload;
  } catch (error) {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const newItems = Array.isArray(payload?.new) ? payload.new : [];
  const updatedItems = Array.isArray(payload?.updated) ? payload.updated : [];

  await notifyItems(newItems, updatedItems, env);

  return jsonResponse({ success: true, new: newItems.length, updated: updatedItems.length });
}

export async function handleErrorRequest(request: Request, env: WorkerEnv): Promise<Response> {
  let payload: Record<string, unknown> | undefined;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch (error) {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const detail = payload?.error ?? payload;
  await sendErrorNotification(detail, env);
  return jsonResponse({ success: true });
}

export async function sendErrorNotification(error: unknown, env: WorkerEnv): Promise<void> {
  if (typeof env.DISCORD_WEBHOOK_URL !== 'string' || !env.DISCORD_WEBHOOK_URL.length) {
    console.warn('DISCORD_WEBHOOK_URL is not configured. Skipping error notification.');
    return;
  }
  const message = `Error tmed-portal-scraping detail: ${JSON.stringify(error, null, 2)}\n`;
  const payload = {
    content: message.length > 1900 ? `${message.slice(0, 1900)}...（The rest is omitted）` : message
  };
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function sendWebhook(item: NoticeItem, type: NotificationType, env: WorkerEnv): Promise<boolean> {
  if (!item?.content) {
    console.log(`Skipping notification for ${item?.title ?? 'unknown title'} due to no access permission`);
    return false;
  }

  const message = `*${type === 'new' ? '【新規】' : '【更新】'}*\n\n` +
    `*${item.title}*\n\n` +
    `*対象:* ${(item.to || []).join(', ')}\n` +
    `*日時:* ${formatDate(item.posted)} 投稿, ${formatDate(item.updated)} 更新\n\n` +
    `${item.content}` +
    (item.attachments && item.attachments.length > 0 ? `\n\n*添付ファイル:*\n${formatAttachments(item.attachments)}` : '');

  const targetGrades = collectTargets(item);
  if (!targetGrades.size) {
    console.log(`No matching grade webhook for: ${item.title}`);
    return false;
  }

  for (const grade of targetGrades) {
    const key = `WEBHOOK_URL_${grade}` as keyof WorkerEnv;
    const urlValue = env[key];
    const url = typeof urlValue === 'string' ? urlValue : undefined;
    if (!url) {
      console.log(`Webhook URL for ${grade} is not set. Skipping...`);
      continue;
    }
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ text: message })
      });
      console.log(`Sent Google Chat notification to ${grade}: ${item.title}`);
    } catch (error) {
      console.error(`Error sending notification to ${grade}:`, error);
    }
  }
  return true;
}
