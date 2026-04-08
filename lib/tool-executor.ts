import pool from './mysql';
import { getTrafficData, getTopPages, getTopEvents } from './ga4';
import { checkQueryValue } from './guards';
import { MAX_LEADS_RETURNED, MAX_SEARCH_RESULTS, MAX_BREAKDOWN_ROWS, MAX_ANALYTICS_BREAKDOWN_ROWS } from './limits';
import type { ClientRecord, LeadsResult, AnalyticsResult, ToolInput, RecentLeadsInput, RecentLeadsResult, LeadRecord, SearchLeadsInput, SearchLeadsResult, SearchableField, AnalyticsBreakdownInput, AnalyticsBreakdownResult } from '@/types';
import type { RowDataPacket } from 'mysql2';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ClientRow = ClientRecord & RowDataPacket;

/**
 * Looks up all list rows that match the given client name (or domain).
 * Returns multiple rows if a client has several forms on the same site.
 */
async function resolveClient(clientName: string): Promise<ClientRecord[]> {
  const term = `%${clientName}%`;
  const [rows] = await pool.execute<ClientRow[]>(
    `SELECT id, domain, list_name, analytics_id
     FROM lists
     WHERE list_name LIKE ? OR domain LIKE ?
     ORDER BY id ASC`,
    [term, term]
  );
  return rows;
}

// ─── Leads query ──────────────────────────────────────────────────────────────

export async function executeLeadsQuery(input: ToolInput): Promise<LeadsResult> {
  const { client_name, start_date, end_date, breakdown } = input;

  // Layer 3 guard — validate free-text values before they touch any query
  const clientGuard = checkQueryValue(client_name, 'client name');
  if (clientGuard.blocked) {
    return { client_name, domain: '', start_date, end_date, total_leads: 0, error: clientGuard.reason };
  }

  const clients = await resolveClient(client_name);

  if (clients.length === 0) {
    return {
      client_name,
      domain: '',
      start_date,
      end_date,
      total_leads: 0,
      error: `No client found matching "${client_name}". Please check the name and try again.`,
    };
  }

  const startTs = `${start_date} 00:00:00`;
  const endTs = `${end_date} 23:59:59`;

  let totalLeads = 0;
  const perList: { list: string; count: number }[] = [];
  const breakdownResults: { list: string; breakdown: Record<string, unknown>[] }[] = [];

  for (const client of clients) {
    const table = `list_${client.id}`;

    try {
      if (breakdown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [rows] = await pool.execute<any[]>(
          `SELECT \`${breakdown}\` as label, COUNT(*) as count
           FROM \`${table}\`
           WHERE dt >= ? AND dt <= ?
             AND (email NOT LIKE '%@newworldgroup.com' OR email IS NULL)
           GROUP BY \`${breakdown}\`
           ORDER BY count DESC
           LIMIT ${MAX_BREAKDOWN_ROWS}`,
          [startTs, endTs]
        );
        breakdownResults.push({ list: client.list_name, breakdown: rows });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [rows] = await pool.execute<any[]>(
          `SELECT COUNT(*) as count FROM \`${table}\`
           WHERE dt >= ? AND dt <= ?
             AND (email NOT LIKE '%@newworldgroup.com' OR email IS NULL)`,
          [startTs, endTs]
        );
        const count = Number(rows[0]?.count ?? 0);
        totalLeads += count;
        perList.push({ list: client.list_name, count });
      }
    } catch {
      // Table may not exist yet for every list entry — skip silently
    }
  }

  return {
    client_name: clients[0].list_name,
    domain: clients[0].domain,
    start_date,
    end_date,
    total_leads: totalLeads,
    // Only expose per-list breakdown when there are multiple forms
    per_list: perList.length > 1 ? perList : undefined,
    breakdown: breakdownResults.length > 0 ? breakdownResults : undefined,
  };
}

// ─── Recent leads (individual records) ───────────────────────────────────────

export async function executeRecentLeads(input: RecentLeadsInput): Promise<RecentLeadsResult> {
  const { client_name, limit = 10, start_date, end_date } = input;

  const clientGuard = checkQueryValue(client_name, 'client name');
  if (clientGuard.blocked) {
    return { client_name, domain: '', total_available: 0, total_returned: 0, leads: [], error: clientGuard.reason };
  }

  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_LEADS_RETURNED);

  const clients = await resolveClient(client_name);

  if (clients.length === 0) {
    return {
      client_name,
      domain: '',
      total_available: 0,
      total_returned: 0,
      leads: [],
      error: `No client found matching "${client_name}". Please check the name and try again.`,
    };
  }

  const allLeads: LeadRecord[] = [];
  let totalAvailable = 0;

  for (const client of clients) {
    const table = `list_${client.id}`;
    try {
      const whereParams: (string | number)[] = [];
      let whereClauses = `WHERE (email NOT LIKE '%@newworldgroup.com' OR email IS NULL)`;

      if (start_date) {
        whereClauses += ` AND dt >= ?`;
        whereParams.push(`${start_date} 00:00:00`);
      }
      if (end_date) {
        whereClauses += ` AND dt <= ?`;
        whereParams.push(`${end_date} 23:59:59`);
      }

      // Run count and records queries in parallel
      const [countResult, rows] = await Promise.all([
        pool.execute<any[]>(
          `SELECT COUNT(*) as count FROM \`${table}\` ${whereClauses}`,
          whereParams
        ),
        pool.execute<any[]>(
          `SELECT name, email, phone, form_name, dt as submitted_at,
                  source, medium, campaign
           FROM \`${table}\` ${whereClauses}
           ORDER BY dt DESC LIMIT ?`,
          [...whereParams, safeLimit]
        ),
      ]);

      totalAvailable += Number(countResult[0][0]?.count ?? 0);
      allLeads.push(...(rows[0] as LeadRecord[]));
    } catch {
      // Table may not exist — skip
    }
  }

  // Re-sort across all lists and trim to limit
  allLeads.sort((a, b) => {
    const aDate = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
    const bDate = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
    return bDate - aDate;
  });

  const trimmed = allLeads.slice(0, safeLimit);

  return {
    client_name: clients[0].list_name,
    domain: clients[0].domain,
    total_available: totalAvailable,
    total_returned: trimmed.length,
    leads: trimmed,
  };
}

// ─── Lead search (any field) ──────────────────────────────────────────────────

// Strict whitelist — the field name goes directly into the SQL string
// so it must never come from unvalidated user input.
const ALLOWED_SEARCH_FIELDS: SearchableField[] = [
  'email', 'phone', 'name', 'zip', 'address',
  'broker', 'source', 'medium', 'campaign', 'form_name', 'assigned',
];

/**
 * Strip everything except digits from a phone string.
 * "  (201) 555-5555 " → "2015555555"
 */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export async function executeLeadSearch(input: SearchLeadsInput): Promise<SearchLeadsResult> {
  const { client_name, search_value, search_field } = input;

  // Layer 3 guard — validate free-text values before they touch any query
  const clientGuard = checkQueryValue(client_name, 'client name');
  if (clientGuard.blocked) {
    return { client_name, domain: '', search_field, search_value, found: false, total_found: 0, total_returned: 0, submissions: [], error: clientGuard.reason };
  }

  const valueGuard = checkQueryValue(search_value, 'search value');
  if (valueGuard.blocked) {
    return { client_name, domain: '', search_field, search_value, found: false, total_found: 0, total_returned: 0, submissions: [], error: valueGuard.reason };
  }

  // Guard: reject any field not in the whitelist
  if (!ALLOWED_SEARCH_FIELDS.includes(search_field)) {
    return {
      client_name,
      domain: '',
      search_field,
      search_value,
      found: false,
      total_found: 0,
      total_returned: 0,
      submissions: [],
      error: `"${search_field}" is not a searchable field.`,
    };
  }

  const clients = await resolveClient(client_name);

  if (clients.length === 0) {
    return {
      client_name,
      domain: '',
      search_field,
      search_value,
      found: false,
      total_found: 0,
      total_returned: 0,
      submissions: [],
      error: `No client found matching "${client_name}". Please check the name and try again.`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSubmissions: any[] = [];
  let totalFound = 0;

  // For phone searches, normalise both sides to digits only so that
  // "2015555555", "(201) 555-5555", and "201-555-5555" all match each other.
  const isPhone = search_field === 'phone';
  const normalizedValue = isPhone ? digitsOnly(search_value) : search_value;

  for (const client of clients) {
    const table = `list_${client.id}`;
    try {
      const whereClause = isPhone
        ? `WHERE REGEXP_REPLACE(\`phone\`, '[^0-9]', '') = ?`
        : `WHERE \`${search_field}\` = ?`;

      // Run count and records in parallel so we always know the real total
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [countResult, rows] = await Promise.all([
        pool.execute<any[]>(
          `SELECT COUNT(*) as count FROM \`${table}\` ${whereClause}`,
          [normalizedValue]
        ),
        pool.execute<any[]>(
          `SELECT name, email, phone, form_name, dt as submitted_at,
                  source, medium, campaign
           FROM \`${table}\` ${whereClause}
           ORDER BY dt DESC
           LIMIT ${MAX_SEARCH_RESULTS}`,
          [normalizedValue]
        ),
      ]);

      totalFound += Number(countResult[0][0]?.count ?? 0);
      allSubmissions.push(...rows[0]);
    } catch {
      // Table may not exist — skip
    }
  }

  const trimmed = allSubmissions.slice(0, MAX_SEARCH_RESULTS);

  return {
    client_name: clients[0].list_name,
    domain: clients[0].domain,
    search_field,
    search_value,
    found: totalFound > 0,
    total_found: totalFound,
    total_returned: trimmed.length,
    submissions: trimmed,
  };
}

// ─── Analytics breakdown (top pages / top events) ────────────────────────────

export async function executeAnalyticsBreakdown(
  input: AnalyticsBreakdownInput
): Promise<AnalyticsBreakdownResult> {
  const { client_name, start_date, end_date, breakdown, limit = MAX_ANALYTICS_BREAKDOWN_ROWS } = input;

  const term = `%${client_name}%`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await pool.execute<any[]>(
    `SELECT id, domain, list_name, analytics_id
     FROM lists
     WHERE (list_name LIKE ? OR domain LIKE ?)
       AND analytics_id IS NOT NULL
       AND analytics_id != ''
     ORDER BY id ASC
     LIMIT 1`,
    [term, term]
  );

  if (rows.length === 0) {
    return {
      client_name,
      domain: '',
      start_date,
      end_date,
      breakdown,
      rows: [],
      error: `No GA4 property is configured for "${client_name}". Lead data is still available.`,
    };
  }

  const client = rows[0] as ClientRecord;

  try {
    let data: Record<string, unknown>[];
    if (breakdown === 'top_pages') {
      data = (await getTopPages(client.analytics_id!, start_date, end_date, limit)) as unknown as Record<string, unknown>[];
    } else {
      data = (await getTopEvents(client.analytics_id!, start_date, end_date, limit)) as unknown as Record<string, unknown>[];
    }

    return {
      client_name: client.list_name,
      domain: client.domain,
      start_date,
      end_date,
      breakdown,
      rows: data,
    };
  } catch (err) {
    const errorType = classifyGA4Error(err);
    return {
      client_name: client.list_name,
      domain: client.domain,
      start_date,
      end_date,
      breakdown,
      rows: [],
      error: ga4ErrorMessage(errorType, client.list_name, client.analytics_id!),
    };
  }
}

// ─── GA4 error classifier ─────────────────────────────────────────────────────

/**
 * GA4 / gRPC error codes we care about:
 *   7  = PERMISSION_DENIED  (service account not added to the property)
 *   16 = UNAUTHENTICATED    (bad credentials / key)
 *   5  = NOT_FOUND          (property ID doesn't exist)
 */
function classifyGA4Error(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: number })?.code;

  if (code === 7 || message.includes('PERMISSION_DENIED') || message.includes('does not have permission')) {
    return 'permission_denied';
  }
  if (code === 16 || message.includes('UNAUTHENTICATED') || message.includes('invalid_grant')) {
    return 'unauthenticated';
  }
  if (code === 5 || message.includes('NOT_FOUND')) {
    return 'not_found';
  }
  return 'unknown';
}

function ga4ErrorMessage(type: string, clientName: string, propertyId: string): string {
  switch (type) {
    case 'permission_denied':
      return `The analytics service account does not have access to the GA4 property for ${clientName} (property ID: ${propertyId}). The service account needs to be added as a Viewer in GA4 → Admin → Property Access Management. Lead data is still fully available.`;
    case 'unauthenticated':
      return `The Google Analytics credentials are invalid or expired. Please check the GOOGLE_SERVICE_ACCOUNT_JSON environment variable.`;
    case 'not_found':
      return `The GA4 property ID (${propertyId}) stored for ${clientName} does not exist or has been deleted. Lead data is still fully available.`;
    default:
      return `Could not retrieve analytics data for ${clientName} right now. Lead data is still fully available.`;
  }
}

// ─── Analytics query ──────────────────────────────────────────────────────────

export async function executeAnalyticsQuery(
  input: Omit<ToolInput, 'breakdown'>
): Promise<AnalyticsResult> {
  const { client_name, start_date, end_date } = input;

  // Find first matching client that actually has a GA4 property configured
  const term = `%${client_name}%`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await pool.execute<any[]>(
    `SELECT id, domain, list_name, analytics_id
     FROM lists
     WHERE (list_name LIKE ? OR domain LIKE ?)
       AND analytics_id IS NOT NULL
       AND analytics_id != ''
     ORDER BY id ASC
     LIMIT 1`,
    [term, term]
  );

  if (rows.length === 0) {
    return {
      client_name,
      domain: '',
      start_date,
      end_date,
      sessions: 0,
      active_users: 0,
      pageviews: 0,
      error: `No GA4 property is configured for "${client_name}". The client may not exist or analytics may not have been set up for their site. Lead data is still fully available if the client exists.`,
    };
  }

  const client = rows[0] as ClientRecord;

  try {
    const data = await getTrafficData(client.analytics_id!, start_date, end_date);
    return {
      client_name: client.list_name,
      domain: client.domain,
      start_date,
      end_date,
      sessions: data.sessions,
      active_users: data.activeUsers,
      pageviews: data.pageviews,
    };
  } catch (err) {
    const errorType = classifyGA4Error(err);
    return {
      client_name: client.list_name,
      domain: client.domain,
      start_date,
      end_date,
      sessions: 0,
      active_users: 0,
      pageviews: 0,
      error: ga4ErrorMessage(errorType, client.list_name, client.analytics_id!),
    };
  }
}
