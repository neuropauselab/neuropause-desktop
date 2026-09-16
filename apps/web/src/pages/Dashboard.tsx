import { useEffect, useState } from 'react';
import { auth } from '../lib/api';

export default function Dashboard() {
  const [me, setMe] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    auth.me().then(setMe).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <main>
      <h1>Dashboard</h1>
      {error && (
        <p style={{ color: '#b91c1c' }}>
          Not signed in ({error}). <a href="/sign-in">Sign in</a>.
        </p>
      )}
      {me != null && <pre style={{ background: '#f4f4f5', padding: 12, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(me, null, 2)}</pre>}
    </main>
  );
}
