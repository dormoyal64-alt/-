import { type ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'ראשי', icon: '🏠', end: true },
  { to: '/jobs', label: 'עבודות', icon: '🧰' },
  { to: '/reports', label: 'דוחות שבועיים', icon: '📊' },
  { to: '/manage', label: 'ניהול', icon: '⚙️' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="flex min-h-dvh flex-col sm:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-l border-border bg-surface p-4 sm:flex">
        <div className="mb-6 px-2">
          <p className="text-lg font-extrabold text-brand-900">ניהול עבודות</p>
          <p className="text-xs text-ink-muted">{user?.email}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-brand-900 text-white' : 'text-ink hover:bg-surface-muted'
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={handleSignOut}
          className="mt-4 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-right text-sm font-medium text-ink-muted hover:bg-surface-muted"
        >
          <span aria-hidden>🚪</span>
          התנתקות
        </button>
      </aside>

      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 sm:hidden">
        <p className="text-base font-extrabold text-brand-900">ניהול עבודות</p>
        <button onClick={() => setMenuOpen((v) => !v)} className="rounded-lg p-2 text-ink" aria-label="תפריט">
          ☰
        </button>
      </header>
      {menuOpen && (
        <div className="border-b border-border bg-surface px-4 py-2 sm:hidden">
          <p className="mb-2 truncate text-xs text-ink-muted">{user?.email}</p>
          <button onClick={handleSignOut} className="w-full rounded-lg py-2 text-right text-sm font-medium text-danger-600">
            התנתקות
          </button>
        </div>
      )}

      <main className="flex-1 overflow-x-hidden px-4 pb-24 pt-4 sm:px-6 sm:pb-8 sm:pt-6">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${isActive ? 'text-brand-900' : 'text-ink-muted'}`
            }
          >
            <span className="text-lg" aria-hidden>
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
