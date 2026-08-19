import { useHomeLayout } from '@/hooks/useHomeLayout'
import { useHomeFeed } from './home/useHomeFeed'
import GridHome from './home/GridHome'
import ClassicHome from './home/ClassicHome'

/**
 * Home, in whichever layout Settings selected.
 *
 * The feed is fetched here rather than inside each layout so flipping the
 * toggle re-renders instantly against data that is already loaded, instead of
 * re-running every catalog request on both sides of the switch.
 */
export default function Home() {
  const layout = useHomeLayout()
  const feed = useHomeFeed()

  return layout === 'classic' ? <ClassicHome feed={feed} /> : <GridHome feed={feed} />
}
