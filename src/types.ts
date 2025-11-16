import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

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
  DB: D1Database;
  ATTACHMENTS_BUCKET?: R2Bucket;
  LOGIN_ID?: string;
  LOGIN_PASSWORD?: string;
  DISCORD_WEBHOOK_URL?: string;
  R2_PUBLIC_BASE_URL?: string;
}

export interface ScraperResult {
  new: number;
  updated: number;
}
