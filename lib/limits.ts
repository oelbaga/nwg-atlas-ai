// ─── App-wide limits ──────────────────────────────────────────────────────────
//
// All caps and defaults are defined here so they can be changed in one place.

// Maximum individual lead records returned by get_recent_leads
export const MAX_LEADS_RETURNED = 25;

// Maximum rows returned by search_leads
export const MAX_SEARCH_RESULTS = 25;

// Maximum breakdown rows returned by query_leads (source / medium / campaign / form_name)
export const MAX_BREAKDOWN_ROWS = 25;

// Maximum rows returned by query_analytics_breakdown (top_pages / top_events)
export const MAX_ANALYTICS_BREAKDOWN_ROWS = 10;

// Number of past messages (user + assistant) sent to Claude as context.
// Each pair = 1 user message + 1 assistant reply.
export const MAX_CONVERSATION_HISTORY = 6;

// Max tokens Claude can use in a single response
export const MAX_RESPONSE_TOKENS = 1024;
