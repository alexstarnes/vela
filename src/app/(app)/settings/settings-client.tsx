'use client';

import { useState } from 'react';
import { Cpu, Link2, DollarSign, AlertTriangle, CheckCircle, XCircle, Loader } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  tier: string;
  isLocal: boolean;
  isAvailable: boolean;
  inputCostPer1m: string;
  outputCostPer1m: string;
  maxContextTokens: number;
}

interface SettingsClientProps {
  models: ModelConfig[];
  ollamaTunnelUrl: string;
}

// ─── Tabs ──────────────────────────────────────────────────────────

type Tab = 'models' | 'tunnel' | 'budgets' | 'danger';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'models', label: 'Models', icon: <Cpu size={13} strokeWidth={1.5} /> },
  { id: 'tunnel', label: 'Tunnel', icon: <Link2 size={13} strokeWidth={1.5} /> },
  { id: 'budgets', label: 'Budgets', icon: <DollarSign size={13} strokeWidth={1.5} /> },
  { id: 'danger', label: 'Danger Zone', icon: <AlertTriangle size={13} strokeWidth={1.5} /> },
];

// ─── Models Tab ────────────────────────────────────────────────────

function ModelsTab({ models }: { models: ModelConfig[] }) {
  const tierOrder = ['fast', 'standard', 'premium'];
  const grouped = tierOrder.map((tier) => ({
    tier,
    items: models.filter((m) => m.tier === tier),
  })).filter((g) => g.items.length > 0);

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Cpu size={36} strokeWidth={1} style={{ color: 'var(--stone-600)' }} className="mb-3" />
        <p className="text-sm font-medium mb-1" style={{ color: '#ECEAE4' }}>No models configured</p>
        <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
          Run <code className="font-mono text-[11px]" style={{ color: '#F5A623' }}>pnpm db:seed</code> to populate default models.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(({ tier, items }) => (
        <div key={tier}>
          <p className="text-[9px] font-mono uppercase tracking-wider mb-2" style={{ color: 'var(--stone-500)' }}>
            {tier} tier
          </p>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--dark-border)' }}>
            {/* Table header */}
            <div
              className="grid gap-2 px-4 py-2 text-[9px] font-mono uppercase tracking-wider"
              style={{ background: 'var(--dark-surface2)', color: 'var(--stone-500)', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto' }}
            >
              <span>Model</span>
              <span>Provider</span>
              <span>Context</span>
              <span>In / 1M</span>
              <span>Out / 1M</span>
              <span>Available</span>
            </div>
            {items.map((model, i) => (
              <div
                key={model.id}
                className="grid gap-2 items-center px-4 py-2 text-[10px] font-mono border-t"
                style={{
                  borderColor: i === 0 ? 'transparent' : 'var(--dark-border)',
                  color: 'var(--stone-500)',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto',
                }}
              >
                <div>
                  <p style={{ color: '#ECEAE4' }}>{model.name}</p>
                  <p className="text-[9px]" style={{ color: 'var(--stone-600)' }}>{model.modelId}</p>
                </div>
                <span>{model.provider}</span>
                <span>{(model.maxContextTokens / 1000).toFixed(0)}K</span>
                <span>${parseFloat(model.inputCostPer1m).toFixed(2)}</span>
                <span>${parseFloat(model.outputCostPer1m).toFixed(2)}</span>
                <span>
                  {model.isAvailable ? (
                    <CheckCircle size={12} strokeWidth={1.5} style={{ color: '#3D8B5C' }} />
                  ) : (
                    <XCircle size={12} strokeWidth={1.5} style={{ color: '#C4413A' }} />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tunnel Tab ────────────────────────────────────────────────────

function TunnelTab({ ollamaTunnelUrl }: { ollamaTunnelUrl: string }) {
  const [url, setUrl] = useState(ollamaTunnelUrl);
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  const testPing = async () => {
    if (!url) return;
    setPingStatus('testing');
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      setPingStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setPingStatus('fail');
    }
  };

  const pingColor = { idle: 'var(--stone-500)', testing: '#F5A623', ok: '#3D8B5C', fail: '#C4413A' }[pingStatus];
  const pingLabel = { idle: 'Test connection', testing: 'Testing…', ok: 'Connected', fail: 'Failed' }[pingStatus];

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <p className="text-[9px] font-mono uppercase tracking-wider mb-2" style={{ color: 'var(--stone-500)' }}>
          Ollama Tunnel URL
        </p>
        <p className="text-[11px] mb-3" style={{ color: 'var(--stone-400)' }}>
          Connect to your local Ollama instance via Cloudflare Tunnel. Set the{' '}
          <code className="font-mono text-[11px]" style={{ color: '#F5A623' }}>OLLAMA_TUNNEL_URL</code>{' '}
          environment variable to persist this setting.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setPingStatus('idle'); }}
            placeholder="https://your-tunnel.trycloudflare.com"
            className="flex-1 text-[11px] font-mono px-3 py-2 rounded-md outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 focus:ring-offset-[var(--dark-bg)]"
            style={{
              background: 'var(--dark-surface)',
              border: '1px solid var(--dark-border)',
              color: '#ECEAE4',
            }}
          />
          <button
            onClick={testPing}
            disabled={pingStatus === 'testing' || !url}
            className="flex items-center gap-1.5 text-[10px] font-mono px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 transition-colors"
            style={{
              background: 'var(--dark-surface2)',
              color: pingColor,
              border: `1px solid ${pingStatus === 'idle' ? 'var(--dark-border)' : pingColor + '40'}`,
            }}
          >
            {pingStatus === 'testing' && <Loader size={11} strokeWidth={1.5} className="animate-spin" />}
            {pingLabel}
          </button>
        </div>

        {pingStatus === 'ok' && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: '#3D8B5C' }}>
            <CheckCircle size={12} strokeWidth={1.5} />
            Ollama is reachable at this URL.
          </div>
        )}
        {pingStatus === 'fail' && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: '#C4413A' }}>
            <XCircle size={12} strokeWidth={1.5} />
            Could not reach Ollama. Check the tunnel URL and ensure Ollama is running.
          </div>
        )}
      </div>

      <div
        className="rounded-lg p-3 text-[10px] font-mono space-y-1"
        style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)', color: 'var(--stone-500)' }}
      >
        <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--stone-600)' }}>Current value</p>
        <p style={{ color: ollamaTunnelUrl ? '#F5A623' : 'var(--stone-600)' }}>
          {ollamaTunnelUrl || '(not set — using cloud models only)'}
        </p>
      </div>
    </div>
  );
}

// ─── Budgets Tab ───────────────────────────────────────────────────

const DEFAULT_BUDGETS = [
  { tier: 'Premium agents (Claude Sonnet 4)', key: 'premium', default: 50 },
  { tier: 'Standard agents (Claude Haiku 4.5)', key: 'standard', default: 25 },
  { tier: 'Fast agents (local models)', key: 'fast', default: 10 },
];

function BudgetsTab() {
  const [budgets, setBudgets] = useState(
    DEFAULT_BUDGETS.reduce((acc, b) => ({ ...acc, [b.key]: b.default }), {} as Record<string, number>)
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In production, call a server action to persist
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-[11px]" style={{ color: 'var(--stone-400)' }}>
        Default monthly budget limits per agent tier (USD). Agents exceeding their budget will be paused until the next billing cycle.
      </p>

      <div className="space-y-3">
        {DEFAULT_BUDGETS.map(({ tier, key }) => (
          <div key={key}>
            <label className="text-[9px] font-mono uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--stone-500)' }}>
              {tier}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono" style={{ color: 'var(--stone-500)' }}>$</span>
              <input
                type="number"
                min={0}
                step={5}
                value={budgets[key]}
                onChange={(e) => setBudgets((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                className="w-28 text-[11px] font-mono px-3 py-1.5 rounded-md outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 focus:ring-offset-[var(--dark-bg)]"
                style={{
                  background: 'var(--dark-surface)',
                  border: '1px solid var(--dark-border)',
                  color: '#ECEAE4',
                }}
              />
              <span className="text-[10px] font-mono" style={{ color: 'var(--stone-600)' }}>/month</span>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        className="text-[10px] font-mono px-3 py-1.5 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors"
        style={{ background: saved ? '#3D8B5C' : '#F5A623', color: '#fff' }}
      >
        {saved ? 'Saved!' : 'Save defaults'}
      </button>

      <p className="text-[10px] font-mono" style={{ color: 'var(--stone-600)' }}>
        Note: These are default values for new agents. Existing agents keep their configured budgets.
      </p>
    </div>
  );
}

// ─── Danger Zone Tab ──────────────────────────────────────────────

function DangerTab() {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleAction = async (action: string) => {
    if (confirming !== action) {
      setConfirming(action);
      return;
    }
    setLoading(true);
    setConfirming(null);
    try {
      if (action === 'reset-locks') {
        const res = await fetch('/api/heartbeat', { method: 'POST' });
        if (res.ok) {
          setResult('Task locks cleared successfully.');
        } else {
          setResult('Failed to clear locks.');
        }
      }
    } catch {
      setResult('Request failed.');
    } finally {
      setLoading(false);
      setTimeout(() => setResult(null), 4000);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div
        className="rounded-lg p-1 overflow-hidden"
        style={{ border: '1px solid #C4413A40' }}
      >
        <div className="px-3 py-2" style={{ background: '#C4413A10' }}>
          <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#C4413A' }}>
            Danger Zone
          </p>
        </div>

        {/* Reset locked tasks */}
        <div
          className="flex items-center justify-between px-4 py-3 border-t"
          style={{ borderColor: '#C4413A20' }}
        >
          <div>
            <p className="text-[11px] font-medium" style={{ color: '#ECEAE4' }}>
              Clear task locks
            </p>
            <p className="text-[10px]" style={{ color: 'var(--stone-500)' }}>
              Reset all running task locks. Use this if heartbeats are stuck.
            </p>
          </div>
          <button
            onClick={() => handleAction('reset-locks')}
            disabled={loading}
            className="text-[10px] font-mono px-3 py-1.5 rounded-md ml-4 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 shrink-0 transition-colors"
            style={{
              background: confirming === 'reset-locks' ? '#C4413A' : '#C4413A20',
              color: confirming === 'reset-locks' ? '#fff' : '#C4413A',
              border: '1px solid #C4413A40',
            }}
          >
            {loading ? 'Working…' : confirming === 'reset-locks' ? 'Confirm?' : 'Clear locks'}
          </button>
        </div>
      </div>

      {confirming && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: '#C27D1A' }}>
          <AlertTriangle size={12} strokeWidth={1.5} />
          Click again to confirm. This action cannot be undone.
        </div>
      )}

      {result && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: '#3D8B5C20', border: '1px solid #3D8B5C40', color: '#3D8B5C' }}
        >
          {result}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────

export function SettingsClient({ models, ollamaTunnelUrl }: SettingsClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('models');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div>
          <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>Settings</p>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4', fontFamily: 'Syne, system-ui' }}>
            Settings
          </h1>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center gap-0 px-4 border-b shrink-0"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-inset"
            style={{
              color: activeTab === tab.id ? '#F5A623' : 'var(--stone-500)',
              borderBottom: activeTab === tab.id ? '2px solid #F5A623' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'models' && <ModelsTab models={models} />}
        {activeTab === 'tunnel' && <TunnelTab ollamaTunnelUrl={ollamaTunnelUrl} />}
        {activeTab === 'budgets' && <BudgetsTab />}
        {activeTab === 'danger' && <DangerTab />}
      </div>
    </div>
  );
}
