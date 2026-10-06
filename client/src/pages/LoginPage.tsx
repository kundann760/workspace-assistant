import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useAuth } from '../context/AuthContext';

function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled in your Firebase project (see SETUP_GUIDE.md, step 2).',
    'auth/unauthorized-domain': 'This domain is not authorised in Firebase → Authentication → Settings → Authorized domains.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  };
  return map[code] ?? (err as Error)?.message ?? 'Sign-in failed.';
}

export default function LoginPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const reset = async () => {
    if (!email) return setError('Enter your email first, then click "Forgot password".');
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo('Password reset email sent.');
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <div className="center-screen">
      <div className="card narrow">
        <h1 className="brand">📚 Workspace Assistant</h1>
        <p className="muted">Ask questions about your documents, with each workspace's knowledge kept separate.</p>

        <form onSubmit={submit} className="stack">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          {info && <div className="alert info">{info}</div>}
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="divider">or</div>
        <button onClick={google} className="full">
          Continue with Google
        </button>

        <div className="row space-between small">
          <button className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
          {mode === 'signin' && (
            <button className="link" onClick={reset}>
              Forgot password
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
