import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth } from '../lib/api';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const [msg, setMsg] = useState('Verifying…');
  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setMsg('Missing verification token.');
      return;
    }
    auth
      .verifyEmail(token)
      .then(() => setMsg('Email verified. You can sign in now.'))
      .catch((e: Error) => setMsg(`Verification failed: ${e.message}`));
  }, [params]);
  return (
    <main>
      <h1>Email verification</h1>
      <p>{msg}</p>
    </main>
  );
}
