import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth } from '../lib/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const token = params.get('token') ?? '';
  return (
    <main>
      <h1>Reset password</h1>
      {!token && <p>Missing reset token — use the link from your email.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          auth
            .resetPassword(token, password)
            .then(() => setMsg('Password updated. You can sign in now.'))
            .catch((err: Error) => setMsg(`Reset failed: ${err.message}`));
        }}
      >
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" required minLength={8} />
        <button type="submit" style={{ marginLeft: 8 }} disabled={!token}>Set password</button>
      </form>
      {msg && <p>{msg}</p>}
    </main>
  );
}
