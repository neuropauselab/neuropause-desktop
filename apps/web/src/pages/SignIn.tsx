import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, emailAuth, type ProviderInfo } from '../lib/api';

export default function SignIn() {
  const nav = useNavigate();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provErr, setProvErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    auth
      .providers()
      .then((p) => setProviders(Array.isArray(p) ? p : (p.providers ?? [])))
      .catch((e: Error) => setProvErr(e.message));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const fn = mode === 'register' ? emailAuth.register : emailAuth.login;
      const r = await fn(email, password);
      setMsg(`Signed in as ${r.user.email}`);
      nav('/dashboard');
    } catch (err) {
      setMsg(`${mode === 'register' ? 'Registration' : 'Sign-in'} failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>{mode === 'register' ? 'Create your NeuroPause account' : 'Sign in'}</h1>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required minLength={8} />
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'register' ? 'Register' : 'Sign in'}
        </button>
      </form>
      <p>
        {mode === 'register' ? 'Already have an account?' : 'New to NeuroPause?'}{' '}
        <button onClick={() => setMode(mode === 'register' ? 'login' : 'register')} style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>
          {mode === 'register' ? 'Sign in instead' : 'Create an account'}
        </button>
      </p>
      {msg && <p>{msg}</p>}

      <h2 style={{ marginTop: 24 }}>Or continue with a provider</h2>
      {provErr && <p style={{ color: '#b91c1c' }}>Providers unavailable: {provErr}</p>}
      {providers.length === 0 && !provErr && (
        <p style={{ color: '#666' }}>No OAuth providers are configured on this server yet.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
        {providers.map((p) => (
          <a key={p.id} href={auth.startUrl(p.id)} style={{ padding: 8, border: '1px solid #ccc', borderRadius: 6, textAlign: 'center' }}>
            Continue with {p.name ?? p.id}
          </a>
        ))}
      </div>

      <h2 style={{ marginTop: 32 }}>Forgot password</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          auth
            .requestPasswordReset(resetEmail)
            .then(() => setResetMsg('If that email exists, a reset link has been sent.'))
            .catch((err: Error) => setResetMsg(`Request failed: ${err.message}`));
        }}
      >
        <input value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="you@example.com" type="email" required />
        <button type="submit" style={{ marginLeft: 8 }}>Send reset link</button>
      </form>
      {resetMsg && <p>{resetMsg}</p>}
    </main>
  );
}
