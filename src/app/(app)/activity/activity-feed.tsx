'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, Wifi, WifiOff } from 'lucide-react';

// ─── Event type colors & icons ────────────────────────────────────

const EVENT_META: Record<string, { icon: string; color: string }> = {
  status_change: { icon: '↻', color: '#8E897B' },
  message: { icon: '◆', color: '#F5A623' },
  tool_call: { icon: '⚡', color: '#4A7AB5' },
  model_call: { icon: '◈', color: '#4A7AB5' },
  assignment: { icon: '→', color: '#8E897B' },
  delegation: { icon: '↗', color: '#7C3AED' },
  budget_warning: { icon: '⚠', color: '#C27D1A' },
  budget_exceeded: { icon: '✕', color: '#C4413A' },
  heartbeat_start: { icon: '◷', color: '#6B665A' },
  heartbeat_end: { icon: '◷', color: '#6B665A' },
  error: { icon: '✕', color: '#C4413A' },
  loop_detected: { icon: '↻', color: '#C4413A' },
  approval_request: { icon: '?', color: '#C27D1A' },
  approval_response: { icon: '✓', color: '#3D8B5C' },
  model_fallback: { icon: '⤷', color: '#C27D1A' },
};

// ─── Types ─────────────────────────────────────────────────────────

interface LiveEvent {
  id: string;
  taskId: string;
  taskTitle: string | null;
  agentName: string | null;
  eventType: string;
  payload: Record<string, unknown> | null;
  tokensUsed: number | null;
  costUsd: string | null;
  createdAt: string;
}

interface ActivityFeedProps {
  initialEvents: LiveEvent[];
}

// ─── Helper ────────────────────────────────────────────────────────

function formatContent(event: LiveEvent): string {
  const p = event.payload ?? {};
  switch (event.eventType) {
    case 'status_change':
      return `${p.from ?? '?'} → ${p.to ?? '?'}${p.reason ? ` · ${p.reason}` : ''}`;
    case 'message':
      return String(p.content ?? '').slice(0, 120);
    case 'tool_call':
      return `${p.tool_name ?? 'tool'} → ${JSON.stringify(p.output ?? '').slice(0, 80)}`;
    case 'delegation':
      return `Delegated to ${p.delegated_to ?? 'unknown'}`;
    case 'budget_warning':
      return String(p.message ?? `Budget warning`);
    case 'heartbeat_start':
      return `Heartbeat started`;
    case 'heartbeat_end':
      return `Heartbeat completed${p.tasks_processed ? ` · ${p.tasks_processed} tasks` : ''}`;
    case 'error':
      return String(p.message ?? p.error ?? 'Error occurred').slice(0, 120);
    case 'approval_request':
      return String(p.description ?? 'Approval requested');
    default:
      return JSON.stringify(p).slice(0, 100);
  }
}

// ─── Event Row ────────────────────────────────────────────────────

function EventRow({ event }: { event: LiveEvent }) {
  const meta = EVENT_META[event.eventType] ?? { icon: '·', color: '#6B665A' };
  const content = formatContent(event);
  const time = new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex gap-2.5 text-[11px] group">
      <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
        <span style={{ color: meta.color, fontSize: 9 }}>{meta.icon}</span>
        <div className="w-px flex-1" style={{ background: 'var(--dark-border)', minHeight: 12 }} />
      </div>
      <div className="flex-1 pb-3 min-w-0">
        <div className="flex items-baseline gap-1.5 mb-0.5 flex-wrap">
          {event.agentName && (
            <span className="font-medium" style={{ color: '#ECEAE4' }}>
              {event.agentName}
            </span>
          )}
          <span className="font-mono text-[9px]" style={{ color: 'var(--stone-600)' }}>
            {time}
          </span>
          <span
            className="font-mono text-[9px] px-1 py-0.5 rounded"
            style={{ background: meta.color + '18', color: meta.color }}
          >
            {event.eventType.replace(/_/g, ' ')}
          </span>
          {event.taskTitle && (
            <span className="text-[9px] font-mono truncate" style={{ color: 'var(--stone-500)' }}>
              {event.taskTitle}
            </span>
          )}
          {event.costUsd && parseFloat(event.costUsd) > 0 && (
            <span className="font-mono text-[9px]" style={{ color: 'var(--stone-600)' }}>
              ${parseFloat(event.costUsd).toFixed(6)}
            </span>
          )}
        </div>
        {content && (
          <p className="leading-relaxed break-words" style={{ color: 'var(--stone-400)' }}>
            {content}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Connection status ─────────────────────────────────────────────

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-full"
      style={{
        background: connected ? '#3D8B5C20' : '#C4413A20',
        color: connected ? '#3D8B5C' : '#C4413A',
        border: `1px solid ${connected ? '#3D8B5C40' : '#C4413A40'}`,
      }}
    >
      {connected ? (
        <Wifi size={9} strokeWidth={1.5} />
      ) : (
        <WifiOff size={9} strokeWidth={1.5} />
      )}
      {connected ? 'live' : 'reconnecting'}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────

const MAX_EVENTS = 200;

export function ActivityFeedClient({ initialEvents }: ActivityFeedProps) {
  const [events, setEvents] = useState<LiveEvent[]>(initialEvents);
  const [connected, setConnected] = useState(false);
  const [filterType, setFilterType] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const lastTs = events[events.length - 1]?.createdAt;
      const url = '/api/events/stream';
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('connected', () => {
        setConnected(true);
      });

      es.addEventListener('task_event', (e) => {
        const data = JSON.parse(e.data) as LiveEvent;
        setEvents((prev) => {
          // Deduplicate
          if (prev.some((ev) => ev.id === data.id)) return prev;
          const next = [...prev, data];
          return next.slice(-MAX_EVENTS);
        });
      });

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Reconnect with backoff
        retryTimer = setTimeout(connect, 3000);
      };

      void lastTs;
    }

    connect();

    return () => {
      esRef.current?.close();
      clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const filteredEvents = filterType
    ? events.filter((e) => e.eventType === filterType)
    : events;

  const uniqueTypes = Array.from(new Set(events.map((e) => e.eventType))).sort();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>Activity</p>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4', fontFamily: 'Syne, system-ui' }}>
            Activity Feed
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-[10px] font-mono px-2.5 py-1 rounded-full outline-none focus:ring-2 focus:ring-amber-500"
            style={{
              background: 'var(--dark-surface2)',
              color: 'var(--stone-400)',
              border: '1px solid var(--dark-border)',
            }}
          >
            <option value="">All Types</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <ConnectionBadge connected={connected} />
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-auto p-5">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Activity size={40} strokeWidth={1} className="mx-auto mb-4" style={{ color: 'var(--stone-600)' }} />
            <h2 className="text-sm font-medium mb-1" style={{ color: '#ECEAE4' }}>
              No activity yet
            </h2>
            <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
              Agent events and heartbeats will appear here in real time.
            </p>
          </div>
        ) : (
          <div className="space-y-0 max-w-3xl">
            {filteredEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
