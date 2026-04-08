export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  isLoading?: boolean;
  isError?: boolean;
}

export interface Conversation {
  id: string;
  createdAt: string;
}

export interface ClientRecord {
  id: number;
  domain: string;
  list_name: string;
  analytics_id: string | null;
}

export interface LeadsResult {
  client_name: string;
  domain: string;
  start_date: string;
  end_date: string;
  total_leads: number;
  per_list?: { list: string; count: number }[];
  breakdown?: { list: string; breakdown: Record<string, unknown>[] }[];
  error?: string;
}

export interface AnalyticsResult {
  client_name: string;
  domain: string;
  start_date: string;
  end_date: string;
  sessions: number;
  active_users: number;
  pageviews: number;
  error?: string;
}

export interface ToolInput {
  client_name: string;
  start_date: string;
  end_date: string;
  breakdown?: 'source' | 'medium' | 'campaign' | 'form_name';
}

export type SearchableField =
  | 'email'
  | 'phone'
  | 'name'
  | 'zip'
  | 'address'
  | 'broker'
  | 'source'
  | 'medium'
  | 'campaign'
  | 'form_name'
  | 'assigned';

export interface SearchLeadsInput {
  client_name: string;
  search_value: string;
  search_field: SearchableField;
}

export interface LeadSearchMatch {
  form_name: string | null;
  submitted_at: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

export interface SearchLeadsResult {
  client_name: string;
  domain: string;
  search_field: string;
  search_value: string;
  found: boolean;
  total_found: number;
  total_returned: number;
  submissions: LeadSearchMatch[];
  error?: string;
}

export interface RecentLeadsInput {
  client_name: string;
  limit?: number;
  start_date?: string;
  end_date?: string;
}

export interface LeadRecord {
  name: string | null;
  email: string | null;
  phone: string | null;
  form_name: string | null;
  submitted_at: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

export interface RecentLeadsResult {
  client_name: string;
  domain: string;
  total_available: number;
  total_returned: number;
  leads: LeadRecord[];
  error?: string;
}

export type AnalyticsBreakdownType = 'top_pages' | 'top_events';

export interface AnalyticsBreakdownInput {
  client_name: string;
  start_date: string;
  end_date: string;
  breakdown: AnalyticsBreakdownType;
  limit?: number;
}

export interface AnalyticsBreakdownResult {
  client_name: string;
  domain: string;
  start_date: string;
  end_date: string;
  breakdown: AnalyticsBreakdownType;
  rows: Record<string, unknown>[];
  error?: string;
}

export interface ApiChatRequest {
  message: string;
  conversationId?: string;
}

export interface ApiChatResponse {
  message: string;
  conversationId: string;
}
