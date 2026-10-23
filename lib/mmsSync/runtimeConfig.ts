import pool from '../db';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface MmsRuntimeConfig {
    enabled: boolean;
    automatic: boolean;
    notificationsEnabled: boolean;
    url: string;
    apiKey: string;
    courseAllowlist: string;
    pilotStartDate: string;
    publicOrigin: string;
    feedbackUrlTemplate: string;
    providerId: string;
    websiteId: number;
    horizonDays: number;
    accessSupport: string;
    source: 'database' | 'environment';
}

const fromEnvironment = (): MmsRuntimeConfig => ({
    enabled: process.env.MMS_SYNC_ENABLED === 'true',
    automatic: process.env.MMS_SYNC_AUTOMATIC !== 'false',
    notificationsEnabled: process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED === 'true',
    url: process.env.MMS_SYNC_URL || '', apiKey: process.env.MMS_SYNC_API_KEY || '',
    courseAllowlist: process.env.MMS_SYNC_COURSE_ALLOWLIST || '',
    pilotStartDate: process.env.MMS_PILOT_START_DATE || '2026-10-23',
    publicOrigin: process.env.MMS_PUBLIC_ORIGIN || '',
    feedbackUrlTemplate: process.env.MMS_SYNC_FEEDBACK_URL_TEMPLATE || '',
    providerId: process.env.MMS_SYNC_PROVIDER_ID || 'tertiary-sg',
    websiteId: Number(process.env.MMS_SYNC_WEBSITE_ID || 1),
    horizonDays: Number(process.env.MMS_SYNC_HORIZON_DAYS || 60),
    accessSupport: process.env.MMS_ACCESS_SUPPORT || '', source: 'environment',
});

type Cache = { value?: MmsRuntimeConfig; expires?: number; pending?: Promise<MmsRuntimeConfig>; schema?: Promise<void> };
const cache = (globalThis as typeof globalThis & { __mmsRuntimeConfig?: Cache }).__mmsRuntimeConfig ||= {};

export function getMmsRuntimeConfig(): MmsRuntimeConfig {
    return cache.value?.source === 'database' ? cache.value : fromEnvironment();
}

export async function loadMmsRuntimeConfig(force = false): Promise<MmsRuntimeConfig> {
    if (!force && cache.value && Date.now() < (cache.expires || 0)) return getMmsRuntimeConfig();
    if (cache.pending) return cache.pending;
    cache.pending = (async () => {
        if (!cache.schema) cache.schema = readFile(path.join(process.cwd(), 'database/migrations/create_mms_handover_config.sql'), 'utf8')
            .then(sql => pool.query(sql)).then(() => undefined).catch(e => { cache.schema = undefined; throw e; });
        await cache.schema;
        const row = (await pool.query('SELECT *,pilot_start_date::text AS pilot_start_date_text FROM mms_handover_config WHERE id=1')).rows[0];
        const value: MmsRuntimeConfig = row ? {
            enabled: row.enabled, automatic: row.automatic, notificationsEnabled: row.notifications_enabled,
            url: row.url, apiKey: row.api_key, courseAllowlist: row.course_allowlist,
            pilotStartDate: row.pilot_start_date_text, publicOrigin: row.public_origin,
            feedbackUrlTemplate: row.feedback_url_template, providerId: row.provider_id,
            websiteId: Number(row.website_id), horizonDays: Number(row.horizon_days),
            accessSupport: row.access_support, source: 'database',
        } : fromEnvironment();
        cache.value = value;
        cache.expires = Date.now() + 5000;
        return value;
    })().finally(() => { cache.pending = undefined; });
    return cache.pending;
}
