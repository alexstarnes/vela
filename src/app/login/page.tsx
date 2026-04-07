'use client';

import { Suspense } from 'react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/tasks';

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push(from);
        router.refresh();
      } else {
        setError('Invalid password. Try again.');
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="password"
          className="block text-xs font-medium mb-1.5"
          style={{ color: '#8E897B' }}
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          placeholder="Enter your password"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
          style={{
            background: '#282622',
            border: '1px solid #3A3731',
            color: '#ECEAE4',
          }}
        />
      </div>

      {error && (
        <p className="text-xs" style={{ color: '#C4413A' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 rounded-lg text-sm font-medium transition-all"
        style={{
          background: loading ? '#B86F08' : '#F5A623',
          color: '#fff',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#111110' }}>
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{ background: '#1A1918', border: '1px solid #2E2D2A' }}
      >
        {/* Logo */}
        <div className="mb-8">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ fontFamily: 'system-ui, sans-serif', color: '#ECEAE4' }}
          >
            vela<span style={{ color: '#F5A623' }}>.</span>
          </h1>
          <p className="text-xs mt-1" style={{ color: '#6B665A' }}>
            Agent orchestration platform
          </p>
        </div>

        <Suspense fallback={<div style={{ color: '#8E897B', fontSize: 12 }}>Loading...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
