/**
 * User preferences that outlive a session.
 *
 * The audio-quality picker in Settings wrote `lf:quality` to localStorage and
 * nothing ever read it — the stream resolver always reached for the highest
 * bitrate. Routing both sides through here keeps the setting honest.
 */

export const QUALITIES = ['320', '160', '96'] as const
export type Quality = (typeof QUALITIES)[number]

export const DEFAULT_QUALITY: Quality = '320'

const QUALITY_KEY = 'lf:quality'

const isQuality = (v: unknown): v is Quality => QUALITIES.includes(v as Quality)

export function getQuality(): Quality {
  try {
    const saved = localStorage.getItem(QUALITY_KEY)
    return isQuality(saved) ? saved : DEFAULT_QUALITY
  } catch {
    return DEFAULT_QUALITY
  }
}

export function setQuality(q: Quality) {
  try {
    localStorage.setItem(QUALITY_KEY, q)
  } catch {
    // private mode / quota — the choice still applies to this session
  }
}

const VOLUME_KEY = 'lf:volume'

export function getVolume(): number {
  try {
    const raw = Number(localStorage.getItem(VOLUME_KEY))
    // `Number(null)` and `Number('')` are both 0, so a missing or blank entry
    // used to start the app silently muted.
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.8
  } catch {
    return 0.8
  }
}

export function setVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(v))
  } catch {
    // ignore
  }
}
