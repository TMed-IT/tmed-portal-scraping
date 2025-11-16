import type { KVNamespace } from '@cloudflare/workers-types';

export interface NoticeAttachment {
  text: string;
  url?: string;
  file_url?: string | null;
}

export interface NoticeItem {
  id: string;
  to: string[];
  from: string;
  posted: Date;
  updated: Date;
  title: string;
  content?: string;
  attachments?: NoticeAttachment[];
  fullUpdated?: Date;
}

export interface PersistedNoticeItem extends Omit<NoticeItem, 'posted' | 'updated'> {
  posted: string;
  updated: string;
}

export interface NormalizedNotice {
  id: string;
  to: string[];
  from: string;
  posted: string;
  updated: string;
  title: string;
  content?: string;
  attachments: Array<Omit<NoticeAttachment, 'file_url'>>;
}

export interface WorkerEnv extends Record<string, unknown> {
  NOTICE_DATA: KVNamespace;
  LOGIN_ID?: string;
  LOGIN_PASSWORD?: string;
  DISCORD_WEBHOOK_URL?: string;
  UPLOAD_URL?: string;
  UPLOAD_TOKEN?: string;
}

export interface ScraperResult {
  new: number;
  updated: number;
}
