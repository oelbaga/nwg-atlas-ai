import Anthropic from '@anthropic-ai/sdk';
import { MAX_RECORDS_RETURNED } from './limits';

export const tools: Anthropic.Tool[] = [
  {
    name: 'query_leads',
    description: `Query lead / contact-form submission counts from the MySQL database for a specific client and date range.
Use this whenever someone asks about leads, inquiries, registrations, or form submissions for a client.
The database contains one table per list (named list_{id}). The 'lists' table maps client names and domains to their list IDs and GA4 property IDs.
When a client has multiple forms (multiple list entries), this tool aggregates all of them.
Optionally you can break down results by source, medium, campaign, or form_name.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        client_name: {
          type: 'string',
          description: 'The name or partial name of the client / property (e.g. "Seraphine", "Vermella Harrison", "Quinn JC")',
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (inclusive). Omit only when the user has explicitly confirmed they want all-time data.',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (inclusive). Omit only when the user has explicitly confirmed they want all-time data.',
        },
        breakdown: {
          type: 'string',
          enum: ['source', 'medium', 'campaign', 'form_name'],
          description: 'Optional: break down lead counts by this field instead of returning a single total',
        },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'get_recent_leads',
    description: `Retrieve the most recent individual lead records for a client, showing names, emails, phone numbers, submission dates, and traffic sources.
Use this when someone asks to "show", "list", or "see" leads — e.g. "show me the last 10 leads for Seraphine", "what are the most recent leads for Edison Lofts?", "show me leads from this week for Vermella".
Optionally filter by a date range. The limit defaults to 10 and can go up to 50.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        client_name: {
          type: 'string',
          description: 'The name or partial name of the client / property',
        },
        limit: {
          type: 'number',
          description: `Number of records to return (default 10, max ${MAX_RECORDS_RETURNED})`,
        },
        start_date: {
          type: 'string',
          description: 'Optional start date filter in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'Optional end date filter in YYYY-MM-DD format',
        },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'search_leads',
    description: `Search for a specific value in any field within a client's lead submissions.
Use this when someone asks whether a specific email, phone number, name, or any other detail appears in a client's leads.
Examples: "Did john@gmail.com contact Seraphine?", "Has anyone with phone 555-1234 reached out to Edison Lofts?", "Did someone named John Smith register for Vermella?".
Returns all matching submissions with date, name, email, phone, form name, and traffic source.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        client_name: {
          type: 'string',
          description: 'The name or partial name of the client / property to search within',
        },
        search_value: {
          type: 'string',
          description: 'The value to search for (e.g. "john@example.com", "555-1234", "John Smith")',
        },
        search_field: {
          type: 'string',
          enum: ['id', 'email', 'phone', 'name', 'zip', 'address', 'broker', 'source', 'medium', 'campaign', 'keywords', 'assigned'],
          description: 'Which field to search in. Infer this from context — use "id" for a specific record ID, "email" for email addresses, "phone" for phone numbers, "name" for names, etc.',
        },
      },
      required: ['client_name', 'search_value', 'search_field'],
    },
  },
  {
    name: 'query_analytics_breakdown',
    description: `Query a detailed GA4 breakdown for a client — either top pages by pageviews or top events by count.
Use this when someone asks about:
• Which pages get the most traffic / hits / views ("top pages", "most visited pages", "pages with most hits")
• What events are firing ("top events", "what events", "form submissions tracked in GA4")
This is separate from the overall traffic summary — use query_analytics for totals and this tool for breakdowns.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        client_name: {
          type: 'string',
          description: 'The name or partial name of the client / property',
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (inclusive)',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (inclusive)',
        },
        breakdown: {
          type: 'string',
          enum: ['top_pages', 'top_events'],
          description: '"top_pages" for pages ranked by pageviews; "top_events" for GA4 events ranked by count',
        },
        limit: {
          type: 'number',
          description: 'How many rows to return (default 10, max 25)',
        },
      },
      required: ['client_name', 'start_date', 'end_date', 'breakdown'],
    },
  },
  {
    name: 'list_clients',
    description: `Retrieve a list of clients from the database. Use this when someone asks to see, list, or browse clients — e.g. "show me the last 10 clients", "list all clients", "find clients named Vermella".
Returns the total count of matching clients and up to the capped number of records ordered by most recently added.
Optionally filter by a search term that matches the client name or domain.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: `Number of records to return (default 10, max ${MAX_RECORDS_RETURNED})`,
        },
        search: {
          type: 'string',
          description: 'Optional search term to filter clients by name or domain',
        },
      },
      required: [],
    },
  },
  {
    name: 'query_analytics',
    description: `Query Google Analytics 4 traffic data (sessions, active users, pageviews) for a specific client and date range.
Use this whenever someone asks about overall traffic totals, visitors, sessions, or pageviews for a client website.
Not all clients have GA4 configured — if the analytics_id is missing the tool will say so.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        client_name: {
          type: 'string',
          description: 'The name or partial name of the client / property',
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (inclusive)',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (inclusive)',
        },
      },
      required: ['client_name', 'start_date', 'end_date'],
    },
  },
];
