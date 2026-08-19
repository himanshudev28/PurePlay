/**
 * Recognising a *vibe* query, and turning it into something a catalog can answer.
 *
 * "breakup song" and "party songs" are not titles — they describe how the
 * listener wants to feel. Catalog search is literal, so it answered them with
 * the handful of recordings actually *called* "Breakup Song" and nothing else:
 * eight rows of the same title by eight unknown artists, and not one of the
 * heartbreak songs anybody meant.
 *
 * So when the whole query reads as a mood, the app stops asking the catalog
 * that question and asks several better ones instead (see `searchMood`).
 */

export interface Mood {
  key: string
  /** Shown to the listener so the substitution is never silent. */
  label: string
  /** Phrases that mean this mood. Matched as whole words, longest first. */
  triggers: string[]
  /** Fanned out to the song search — the mood as a catalog would file it. */
  songQueries: string[]
  /** Curated sets answer a vibe better than any single song does. */
  playlistQueries: string[]
}

/**
 * Words that carry no meaning of their own in a search box.
 *
 * These are what makes "party", "party song", "some party songs" and "best
 * party music" the same request. Anything left over after these and a mood
 * trigger are removed is a *specific* search, and mood expansion backs off.
 */
const FILLER = new Set([
  'song', 'songs', 'music', 'track', 'tracks', 'playlist', 'playlists', 'mix', 'list',
  'gaana', 'gaane', 'gana', 'gane', 'geet', 'ke', 'ka', 'ki', 'wale', 'wala',
  'top', 'best', 'good', 'great', 'nice', 'hit', 'hits', 'super', 'all', 'more',
  'the', 'a', 'an', 'of', 'for', 'me', 'my', 'some', 'any', 'and', 'or', 'to',
  'mood', 'moods', 'vibe', 'vibes', 'type', 'kind', 'like', 'feel', 'feeling',
  'play', 'listen', 'new', 'latest', 'old', 'collection', 'compilation',
])

/**
 * Language and industry words that stay attached to the expansion.
 *
 * "sad punjabi songs" is still a mood query, but asking the catalog for plain
 * "sad songs" throws away the half of the request that says *which* catalog
 * shelf to look on — so these ride along into every expanded query instead of
 * disqualifying it.
 */
const MODIFIERS = new Set([
  'hindi', 'bollywood', 'punjabi', 'tamil', 'telugu', 'kannada', 'malayalam',
  'marathi', 'bhojpuri', 'gujarati', 'bengali', 'urdu', 'english', 'desi',
  'indian', 'pop', 'rap', 'hiphop', 'edm', 'rock', 'indie', 'kpop', 'korean',
])

/*
  The lexicon.

  Each mood's queries are what a person who knew the catalog would have typed:
  the mood's own name is usually the *worst* of them (that is the literal search
  we are replacing), so the strong editorial phrases lead. Four song queries is
  the ceiling on purpose — the public catalog rate-limits bursts, and search is
  already firing a combined search alongside these.
*/
const MOODS: Mood[] = [
  {
    key: 'breakup',
    label: 'Breakup & heartbreak',
    triggers: ['breakup', 'break up', 'broken heart', 'heartbreak', 'heart break', 'dard', 'bewafa', 'bewafai', 'cheating', 'moving on'],
    songQueries: ['sad love songs', 'heartbreak songs', 'dard bhare gaane', 'breakup songs'],
    playlistQueries: ['breakup', 'heartbreak'],
  },
  {
    key: 'sad',
    label: 'Sad & emotional',
    triggers: ['sad', 'sadness', 'emotional', 'crying', 'cry', 'lonely', 'loneliness', 'depressed', 'depressing', 'melancholy', 'udaas', 'gham'],
    songQueries: ['sad songs', 'emotional songs', 'sad hindi songs', 'dard bhare gaane'],
    playlistQueries: ['sad', 'emotional'],
  },
  {
    key: 'party',
    label: 'Party & dance floor',
    triggers: ['party', 'partying', 'club', 'clubbing', 'dance', 'dancing', 'dj', 'rave', 'nightout', 'night out', 'banger', 'bangers'],
    songQueries: ['party hits', 'dance hits', 'bollywood party songs', 'club bangers'],
    playlistQueries: ['party', 'dance'],
  },
  {
    key: 'romantic',
    label: 'Romantic',
    triggers: ['romantic', 'romance', 'love', 'lovely', 'valentine', 'crush', 'pyaar', 'pyar', 'ishq', 'mohabbat', 'couple', 'date night'],
    songQueries: ['romantic hits', 'love songs', 'hindi romance', 'romantic duets'],
    playlistQueries: ['romantic', 'love'],
  },
  {
    key: 'workout',
    label: 'Workout & motivation',
    triggers: ['workout', 'work out', 'gym', 'exercise', 'running', 'cardio', 'training', 'motivation', 'motivational', 'pump up', 'energetic', 'high energy', 'beast mode'],
    songQueries: ['workout songs', 'gym motivation songs', 'high energy hits', 'motivational songs'],
    playlistQueries: ['workout', 'gym'],
  },
  {
    key: 'chill',
    label: 'Chill & lo-fi',
    triggers: ['chill', 'chilling', 'relax', 'relaxing', 'lofi', 'lo fi', 'calm', 'soothing', 'peaceful', 'sukoon', 'unwind'],
    songQueries: ['lofi songs', 'chill hits', 'relaxing songs', 'soothing hindi songs'],
    playlistQueries: ['lofi', 'chill'],
  },
  {
    key: 'sleep',
    label: 'Sleep & wind-down',
    triggers: ['sleep', 'sleeping', 'bedtime', 'night time', 'insomnia', 'lullaby', 'lullabies', 'neend'],
    songQueries: ['sleep music', 'soft songs', 'calm instrumental', 'late night songs'],
    playlistQueries: ['sleep', 'soft'],
  },
  {
    key: 'study',
    label: 'Study & focus',
    triggers: ['study', 'studying', 'focus', 'concentration', 'reading', 'work from home', 'coding', 'homework'],
    songQueries: ['study music', 'focus instrumental', 'lofi study', 'concentration music'],
    playlistQueries: ['study', 'focus'],
  },
  {
    key: 'drive',
    label: 'Driving & road trip',
    triggers: ['drive', 'driving', 'road trip', 'roadtrip', 'travel', 'travelling', 'traveling', 'journey', 'highway', 'long drive'],
    songQueries: ['road trip songs', 'travel songs', 'long drive songs', 'feel good hits'],
    playlistQueries: ['travel', 'road trip'],
  },
  {
    key: 'happy',
    label: 'Happy & feel-good',
    triggers: ['happy', 'happiness', 'feel good', 'feelgood', 'cheerful', 'fun', 'upbeat', 'good mood', 'khushi'],
    songQueries: ['feel good songs', 'happy songs', 'upbeat hits', 'mood booster songs'],
    playlistQueries: ['feel good', 'happy'],
  },
  {
    key: 'rain',
    label: 'Rain & monsoon',
    triggers: ['rain', 'rainy', 'monsoon', 'barish', 'baarish', 'rainy day'],
    songQueries: ['monsoon songs', 'baarish songs', 'rainy day songs', 'romantic monsoon hits'],
    playlistQueries: ['monsoon', 'rain'],
  },
  {
    key: 'wedding',
    label: 'Wedding & sangeet',
    triggers: ['wedding', 'shaadi', 'shadi', 'sangeet', 'mehendi', 'mehndi', 'baraat', 'marriage'],
    songQueries: ['wedding songs', 'sangeet hits', 'shaadi dance songs', 'bollywood wedding songs'],
    playlistQueries: ['wedding', 'sangeet'],
  },
  {
    key: 'devotional',
    label: 'Devotional',
    triggers: ['devotional', 'bhakti', 'bhajan', 'bhajans', 'aarti', 'mantra', 'mantras', 'spiritual', 'temple', 'prayer', 'god'],
    songQueries: ['bhajans', 'devotional songs', 'aarti', 'mantras'],
    playlistQueries: ['devotional', 'bhakti'],
  },
  {
    key: 'retro',
    label: 'Retro & golden oldies',
    triggers: ['retro', 'oldies', 'old school', 'oldschool', 'nostalgia', 'nostalgic', 'classic', 'classics', 'golden era', 'purane', '90s', '80s', '70s', '60s'],
    songQueries: ['90s hits', 'old hindi songs', 'retro bollywood', 'golden oldies'],
    playlistQueries: ['retro', '90s'],
  },
  {
    key: 'festival',
    label: 'Festival',
    triggers: ['holi', 'diwali', 'navratri', 'garba', 'ganesh chaturthi', 'festive', 'festival', 'celebration', 'new year'],
    songQueries: ['festival songs', 'celebration hits', 'bollywood dance songs', 'holi songs'],
    playlistQueries: ['festival', 'celebration'],
  },
  {
    key: 'patriotic',
    label: 'Patriotic',
    triggers: ['patriotic', 'desh bhakti', 'deshbhakti', 'independence day', 'republic day', 'army'],
    songQueries: ['desh bhakti songs', 'patriotic songs', 'independence day songs', 'army songs'],
    playlistQueries: ['patriotic', 'desh bhakti'],
  },
]

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/** Whole-word phrase test, so "party" doesn't match "Partymonster". */
function hasPhrase(tokens: string[], phrase: string): number {
  const p = phrase.split(' ')
  for (let i = 0; i + p.length <= tokens.length; i++) {
    if (p.every((w, j) => tokens[i + j] === w)) return i
  }
  return -1
}

export interface MoodMatch {
  mood: Mood
  /**
   * True when the query says it wants a *kind* of music rather than naming one
   * — "party songs", "sad hindi music". A bare "party" or "ishq" is just as
   * likely to be a title, so those are offered rather than applied.
   */
  explicit: boolean
}

/**
 * The mood a query is asking for, or null when it is asking for something
 * specific.
 *
 * Deliberately all-or-nothing: every word has to be the mood, a modifier, or
 * filler. "party songs" and "best sad punjabi songs" expand; "party monster"
 * and "breakup song kailash munda" do not — someone naming a recording still
 * gets the literal search they asked for, which is the whole reason this can't
 * just be a keyword bonus in the ranker.
 */
export function detectMood(query: string): MoodMatch | null {
  const tokens = tokenize(query)
  if (!tokens.length) return null

  // Longest trigger first: "break up" must win over a stray "up" elsewhere, and
  // "road trip" over "trip".
  const candidates = MOODS.flatMap((m) =>
    m.triggers.map((t) => ({ mood: m, trigger: t, size: t.split(' ').length })),
  ).sort((a, b) => b.size - a.size || b.trigger.length - a.trigger.length)

  for (const { mood, trigger } of candidates) {
    const at = hasPhrase(tokens, trigger)
    if (at < 0) continue

    const rest = [...tokens.slice(0, at), ...tokens.slice(at + trigger.split(' ').length)]
    const modifiers = rest.filter((w) => MODIFIERS.has(w))
    // Anything that is neither filler nor a modifier makes this a real search.
    if (rest.some((w) => !FILLER.has(w) && !MODIFIERS.has(w))) return null

    // Bare "party" or "ishq" is as likely a title as a mood; the words around
    // it ("party songs", "sad music") are what make the intent explicit.
    const explicit = rest.length > 0 || trigger.includes(' ')

    if (!modifiers.length) return { mood, explicit }
    const prefix = modifiers.join(' ')
    // Don't re-state a modifier the seed already carries — "hindi lofi" must
    // not expand to "hindi soothing hindi songs".
    const widen = (q: string) =>
      modifiers.every((m) => q.toLowerCase().includes(m)) ? q : `${prefix} ${q}`
    return {
      mood: {
        ...mood,
        label: `${mood.label} · ${prefix}`,
        songQueries: mood.songQueries.map(widen),
        playlistQueries: mood.playlistQueries.map(widen),
      },
      explicit,
    }
  }

  return null
}
