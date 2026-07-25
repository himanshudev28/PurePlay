import { NavLink, Link, useNavigate } from 'react-router-dom'
import { Home, Search, Library, Users, Download, Heart, Menu, X, Puzzle, Settings } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { usePlayer } from '@/store/player'

const NAV = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/library', icon: Library, label: 'Library' },
  { to: '/favorites', icon: Heart, label: 'Favorites' },
  { to: '/downloads', icon: Download, label: 'Downloads' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/room', icon: Users, label: 'Rooms' },
  { to: '/heardle', icon: Puzzle, label: 'Heardle' },
]

/** Subset shown in the mobile bottom bar — keep it tight so icons don't crowd. */
const BOTTOM_TABS = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/library', icon: Library, label: 'Library' },
  { to: '/favorites', icon: Heart, label: 'Favorites' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function Shell({ children }: { children: ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false)
  const hasTrack = usePlayer((s) => s.current !== null)
  const viewMode = usePlayer((s) => s.playerViewMode)
  const navigate = useNavigate()
  const drawerRef = useRef<HTMLDivElement>(null)

  /*
    `hasTrack` alone was driving both the bottom-nav offset and the main
    padding, but the bottom bar isn't rendered in card mode — so switching to
    the floating card left the tab bar hovering 72px above nothing.
  */
  const barVisible = hasTrack && viewMode === 'bar'

  // Escape closes the drawer; the backdrop was a plain div with an onClick,
  // which keyboard users had no way to trigger.
  useEffect(() => {
    if (!mobileNav) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNav(false)
    }
    document.addEventListener('keydown', onKey)
    drawerRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileNav])

  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{ background: 'var(--shell-bg, #070708)' }}
    >
      {/* desktop rail */}
      <nav
        aria-label="Main"
        className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col items-center gap-1 py-5 lg:flex transition-colors duration-300"
        style={{
          background: 'var(--shell-sidebar-bg, #0c0c0e)',
          borderRight: '1px solid var(--shell-border, #17171b)',
        }}
      >
        <Link to="/" className="mb-5 text-2xl" aria-label="PurePlay home">
          <span aria-hidden>🎧</span>
        </Link>
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="flex w-14 flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] transition-colors"
            style={({ isActive }) => ({
              color: isActive
                ? 'var(--shell-nav-active, var(--color-accent))'
                : 'var(--shell-nav-text, #9a9aab)',
              background: isActive
                ? 'var(--shell-nav-hover-bg, rgba(23,23,27,0.60))'
                : 'transparent',
            })}
          >
            <Icon size={19} aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* top bar */}
      <header
        className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 lg:pl-[92px] backdrop-blur-xl transition-colors duration-300"
        style={{
          background: 'var(--shell-topbar-bg, rgba(12,12,14,0.75))',
          borderBottom: '1px solid var(--shell-border, #17171b)',
        }}
      >
        <button
          onClick={() => setMobileNav(true)}
          className="rounded-lg p-2 lg:hidden transition-colors"
          style={{ color: 'var(--shell-nav-text, #9a9aab)' }}
          aria-label="Open menu"
          aria-expanded={mobileNav}
        >
          <Menu size={19} />
        </button>

        <Link
          to="/"
          className="flex items-center gap-2 font-semibold tracking-tight transition-colors"
          style={{ color: 'var(--shell-nav-active, white)' }}
        >
          <span className="lg:hidden" aria-hidden>🎧</span>
          <span className="font-handwritten text-2xl font-bold tracking-wide">PurePlay</span>
        </Link>

        <button
          onClick={() => navigate('/search')}
          className="ml-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition"
          style={{
            border: '1px solid var(--shell-border, #232329)',
            color: 'var(--shell-nav-text, #9a9aab)',
          }}
          aria-label="Search music"
        >
          <Search size={13} aria-hidden />
          <span className="hidden sm:inline">Search music…</span>
        </button>
      </header>

      {/* mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 h-full w-full bg-black/70"
            onClick={() => setMobileNav(false)}
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-64 p-4 outline-none transition-colors duration-300"
            style={{
              background: 'var(--shell-sidebar-bg, #0c0c0e)',
              borderRight: '1px solid var(--shell-border, #17171b)',
            }}
          >
            <div className="mb-6 flex items-center justify-between">
              <span
                className="flex items-center gap-1.5"
                style={{ color: 'var(--shell-nav-active, white)' }}
              >
                <span aria-hidden>🎧 </span>
                <span className="font-handwritten text-2xl font-bold tracking-wide">PurePlay</span>
              </span>
              <button
                onClick={() => setMobileNav(false)}
                className="rounded p-1.5 transition"
                style={{ color: 'var(--shell-nav-text, #9a9aab)' }}
                aria-label="Close menu"
              >
                <X size={17} />
              </button>
            </div>
            <nav aria-label="Main">
              {NAV.map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMobileNav(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors"
                  style={({ isActive }) => ({
                    color: isActive
                      ? 'var(--shell-nav-active, var(--color-accent))'
                      : 'var(--shell-nav-text, #9a9aab)',
                    background: isActive
                      ? 'var(--shell-nav-hover-bg, rgba(23,23,27,0.60))'
                      : 'transparent',
                  })}
                >
                  <Icon size={17} aria-hidden />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* main content — extra bottom padding for mobile bottom-nav + player bar */}
      <main className={clsx('lg:pl-[76px]', barVisible ? 'pb-40 lg:pb-32' : 'pb-24 lg:pb-12')}>
        <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">{children}</div>
      </main>

      {/* mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around lg:hidden backdrop-blur-2xl transition-colors duration-300"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.25rem)',
          borderTop: '1px solid var(--shell-border, #17171b)',
          background: 'var(--shell-topbar-bg, rgba(12,12,14,0.85))',
        }}
      >
        {BOTTOM_TABS.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors"
            style={({ isActive }) => ({
              color: isActive
                ? 'var(--shell-nav-active, var(--color-accent))'
                : 'var(--shell-nav-text, #9a9aab)',
            })}
          >
            <Icon size={19} aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
