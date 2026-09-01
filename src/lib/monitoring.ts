import crypto from 'crypto';
import { prisma } from './db';
import { eventBus } from './events';
import { createNotification } from './notifications';
import { toJson } from './json';
import type { monitoringEventSchema } from './validation';
import type { z } from 'zod';

type MonitoringEventInput = z.infer<typeof monitoringEventSchema>;

const DEFAULT_SEVERITY_BY_TYPE: Record<string, string> = {
  js_error: 'error',
  unhandled_rejection: 'error',
  console_error: 'warning',
  network_error: 'warning',
  crash: 'critical',
};

/**
 * Groups occurrences of "the same problem" together. Deliberately coarse —
 * type + normalized message + route — rather than hashing the full stack,
 * so the same error thrown from slightly different call sites (or with a
 * different dynamic value interpolated into the message) still collapses
 * into one issue instead of flooding the list with near-duplicates.
 */
export function computeFingerprint(params: { type: string; message: string; route?: string }): string {
  const normalizedMessage = params.message
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/gi, '#') // ids/hashes
    .replace(/\d+/g, '#') // any other numbers
    .trim()
    .slice(0, 300);
  const key = `${params.type}|${normalizedMessage}|${params.route ?? ''}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export interface IngestParams {
  organizationId: string;
  storeId: string;
  event: MonitoringEventInput;
}

/**
 * Records one raw occurrence and folds it into its deduplicated issue —
 * see docs/API_CONTRACTS.md "Monitoring". Publishes a live-update event on
 * every occurrence (so an open dashboard tab reflects new activity without
 * a refresh) and raises a Notification only when an issue is genuinely new
 * or regresses from resolved, to avoid paging on every repeat occurrence
 * of an already-known problem.
 */
export async function ingestMonitoringEvent({ organizationId, storeId, event }: IngestParams) {
  const fingerprint = computeFingerprint({ type: event.type, message: event.message, route: event.route });
  const severity = event.severity ?? DEFAULT_SEVERITY_BY_TYPE[event.type] ?? 'error';
  const now = new Date();

  const existing = await prisma.monitoringIssue.findUnique({
    where: { storeId_fingerprint: { storeId, fingerprint } },
  });

  let issue;
  let isNew = false;
  let isRegression = false;

  if (existing) {
    isRegression = existing.status === 'resolved';
    issue = await prisma.monitoringIssue.update({
      where: { id: existing.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastSeenAt: now,
        lastBrowser: event.diagnostics?.userAgent ?? existing.lastBrowser,
        lastStatusCode: event.statusCode ?? existing.lastStatusCode,
        stack: event.stack ?? existing.stack,
        status: isRegression ? 'unresolved' : existing.status,
      },
    });
  } else {
    isNew = true;
    issue = await prisma.monitoringIssue.create({
      data: {
        organizationId,
        storeId,
        fingerprint,
        type: event.type,
        message: event.message,
        stack: event.stack,
        route: event.route,
        severity,
        occurrenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastBrowser: event.diagnostics?.userAgent,
        lastStatusCode: event.statusCode,
      },
    });
  }

  await prisma.monitoringEvent.create({
    data: {
      issueId: issue.id,
      storeId,
      type: event.type,
      message: event.message,
      stack: event.stack,
      route: event.route,
      statusCode: event.statusCode,
      browser: event.diagnostics?.userAgent,
      diagnostics: toJson(event.diagnostics ?? {}),
      occurredAt: now,
    },
  });

  eventBus.publish({
    type: isNew ? 'monitoring.issue_created' : 'monitoring.issue_updated',
    organizationId,
    payload: { id: issue.id, storeId },
  });

  if (isNew || isRegression) {
    await createNotification({
      organizationId,
      storeId,
      type: 'monitoring.issue',
      title: isRegression ? 'Issue reoccurred' : 'New issue detected',
      body: `${issue.type.replace(/_/g, ' ')}: ${issue.message.slice(0, 140)}`,
      severity: severity === 'critical' || severity === 'error' ? 'critical' : severity === 'warning' ? 'warning' : 'info',
    });
  }

  return issue;
}
