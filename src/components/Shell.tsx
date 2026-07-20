import { NavLink, Link, useNavigate } from 'react-router-dom'
import { Home, Search, Library, Users, Download, Heart, Menu, X, Puzzle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'

const NAV = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/library', icon: Library, label: 'Library' },
  { to: '/favorites', icon: Heart, label: 'Favorites' },
  { to: '/downloads', icon: Download, label: 'Downloads' },
  { to: '/room', icon: Users, label: 'Rooms' },
  { to: '/heardle', icon: Puzzle, label: 'Heardle' },
]

export function Shell({ children }: { children: ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false)
  const hasTrack = usePlayer((s) => s.current !== null)
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-ink-950">
      {/* desktop rail */}
      <nav className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col items-center gap-1 border-r border-ink-800 bg-ink-900 py-5 lg:flex">
        <Link to="/" className="mb-5 text-2xl" title="ListenFree">
          🎧
        </Link>
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
              clsx(
                'flex w-14 flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] transition',
                isActive ? 'bg-ink-800 text-accent' : 'text-ink-400 hover:bg-ink-800/60 hover:text-white',
              )
            }
          >
            <Icon size={19} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* top bar */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur lg:pl-[92px]">
        <button
          onClick={() => setMobileNav(true)}
          className="rounded-lg p-2 text-ink-300 hover:bg-ink-800 lg:hidden"
          aria-label="Open menu"
        >
          <Menu size={19} />
        </button>

        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-white">
          <span className="lg:hidden">🎧</span>
          ListenFree
        </Link>

        <button
          onClick={() => navigate('/search')}
          className="ml-auto flex items-center gap-2 rounded-full border border-ink-700 px-3 py-1.5 text-xs text-ink-400 transition hover:border-ink-600 hover:text-ink-200"
        >
          <Search size={13} />
          <span className="hidden sm:inline">Search music…</span>
        </button>
      </header>

      {/* mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileNav(false)} />
          <nav className="absolute inset-y-0 left-0 w-64 border-r border-ink-800 bg-ink-900 p-4">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-semibold text-white">🎧 ListenFree</span>
              <button onClick={() => setMobileNav(false)} className="rounded p-1.5 text-ink-400 hover:bg-ink-800">
                <X size={17} />
              </button>
            </div>
            {NAV.map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMobileNav(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                    isActive ? 'bg-ink-800 text-accent' : 'text-ink-300 hover:bg-ink-800/60',
                  )
                }
              >
                <Icon size={17} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      <main className={clsx('lg:pl-[76px]', hasTrack ? 'pb-32' : 'pb-12')}>
        <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  )
}
