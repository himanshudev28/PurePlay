const PALETTES = [
  { rgb: 'rgb(255, 107, 74)', bg: 'linear-gradient(180deg, rgba(180, 50, 20, 0.65) 0%, rgba(60, 15, 5, 0.85) 55%, #070708 100%)' },
  { rgb: 'rgb(225, 29, 72)', bg: 'linear-gradient(180deg, rgba(160, 20, 50, 0.65) 0%, rgba(50, 10, 20, 0.85) 55%, #070708 100%)' },
  { rgb: 'rgb(139, 92, 246)', bg: 'linear-gradient(180deg, rgba(90, 40, 180, 0.65) 0%, rgba(30, 15, 60, 0.85) 55%, #070708 100%)' },
  { rgb: 'rgb(59, 130, 246)', bg: 'linear-gradient(180deg, rgba(30, 80, 180, 0.65) 0%, rgba(10, 30, 60, 0.85) 55%, #070708 100%)' },
  { rgb: 'rgb(16, 185, 129)', bg: 'linear-gradient(180deg, rgba(10, 120, 80, 0.65) 0%, rgba(5, 40, 30, 0.85) 55%, #070708 100%)' },
  { rgb: 'rgb(245, 158, 11)', bg: 'linear-gradient(180deg, rgba(170, 100, 10, 0.65) 0%, rgba(50, 30, 5, 0.85) 55%, #070708 100%)' },
  { rgb: 'rgb(236, 72, 153)', bg: 'linear-gradient(180deg, rgba(160, 40, 100, 0.65) 0%, rgba(50, 10, 35, 0.85) 55%, #070708 100%)' },
]

export function getFallbackPalette(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % PALETTES.length
  return PALETTES[index]
}

export function extractColorFromImage(
  imgUrl: string | undefined,
  seed: string,
  callback: (rgb: string, bgGradient: string) => void,
) {
  const fallback = getFallbackPalette(seed)
  if (!imgUrl) {
    callback(fallback.rgb, fallback.bg)
    return
  }

  const img = new Image()
  img.crossOrigin = 'Anonymous'
  img.src = imgUrl

  img.onload = () => {
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        callback(fallback.rgb, fallback.bg)
        return
      }

      canvas.width = 32
      canvas.height = 32
      ctx.drawImage(img, 0, 0, 32, 32)

      const imageData = ctx.getImageData(0, 0, 32, 32).data
      let r = 0, g = 0, b = 0, count = 0

      for (let i = 0; i < imageData.length; i += 16) {
        const pr = imageData[i]
        const pg = imageData[i + 1]
        const pb = imageData[i + 2]
        // skip near-white and near-black
        if (pr + pg + pb > 80 && pr + pg + pb < 680) {
          r += pr
          g += pg
          b += pb
          count++
        }
      }

      if (count > 0) {
        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)

        const rgb = `rgb(${r}, ${g}, ${b})`
        const bgGradient = `linear-gradient(180deg, rgba(${r}, ${g}, ${b}, 0.75) 0%, rgba(${Math.round(r * 0.25)}, ${Math.round(g * 0.25)}, ${Math.round(b * 0.25)}, 0.9) 60%, #070708 100%)`
        callback(rgb, bgGradient)
      } else {
        callback(fallback.rgb, fallback.bg)
      }
    } catch {
      callback(fallback.rgb, fallback.bg)
    }
  }

  img.onerror = () => {
    callback(fallback.rgb, fallback.bg)
  }
}
