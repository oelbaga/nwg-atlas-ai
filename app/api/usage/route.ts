import { NextRequest, NextResponse } from 'next/server';
import { getUsageStats } from '@/lib/rate-limit';
import { MAX_RECORDS_RETURNED, MAX_CONVERSATION_HISTORY, MAX_RESPONSE_TOKENS } from '@/lib/limits';

// GET /api/usage — returns today's token usage and estimated cost
export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown';

    const stats = await getUsageStats(ip);

    return NextResponse.json({
      today: {
        ...stats.today,
        estimatedCostUsd: Number(stats.today.estimatedCostUsd.toFixed(4)),
      },
      allTime: {
        ...stats.allTime,
        estimatedCostUsd: Number(stats.allTime.estimatedCostUsd.toFixed(4)),
      },
      byUser: stats.byUser.map(u => ({
        ...u,
        estimatedCostUsd: Number(u.estimatedCostUsd.toFixed(4)),
      })),
      thisHour: stats.thisHour,
      limits: {
        perIpPerHour:        Number(process.env.RATE_LIMIT_PER_IP_PER_HOUR ?? 10),
        dailyTotal:          Number(process.env.RATE_LIMIT_DAILY_TOTAL      ?? 20),
        maxRecordsReturned:  MAX_RECORDS_RETURNED,
        conversationHistory: MAX_CONVERSATION_HISTORY,
        maxResponseTokens:   MAX_RESPONSE_TOKENS,
      },
      pricing: {
        note: 'Estimates based on claude-haiku-4-5 pricing. See ANTHROPIC_MODEL in .env.local.',
        inputPer1MTokens:  0.80,
        outputPer1MTokens: 4.00,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/usage]', message);
    return NextResponse.json(
      {
        error: 'Could not retrieve usage stats.',
        // Surface the real error in non-production so it's easy to debug
        detail: process.env.NODE_ENV !== 'production' ? message : undefined,
      },
      { status: 500 }
    );
  }
}
