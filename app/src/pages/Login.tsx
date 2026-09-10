import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, isFirebaseConfigured } from '../contexts/AuthContext';
import { Button, Card, Field, Input } from '../components/ui';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch {
      setError('שם משתמש או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-brand-950 px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xl font-extrabold text-brand-900">ניהול עבודות וקבלנים</p>
          <p className="mt-1 text-sm text-ink-muted">התחברות למערכת</p>
        </div>

        {!isFirebaseConfigured ? (
          <div className="rounded-xl bg-danger-100 p-4 text-sm text-danger-600">
            המערכת עדיין לא מחוברת ל-Firebase. יש למלא את הפרטים בקובץ{' '}
            <code dir="ltr">src/firebaseConfig.ts</code> לפי ההוראות ב-README.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="אימייל">
              <Input
                type="email"
                dir="ltr"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="סיסמה">
              <Input
                type="password"
                dir="ltr"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <p className="text-sm text-danger-600">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'מתחבר…' : 'התחברות'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
