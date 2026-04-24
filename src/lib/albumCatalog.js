const ITUNES_SEARCH_ENDPOINT = 'https://itunes.apple.com/search'

export async function searchAlbumCatalog(query, { signal } = {}) {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const url = new URL(ITUNES_SEARCH_ENDPOINT)
  url.searchParams.set('term', trimmedQuery)
  url.searchParams.set('media', 'music')
  url.searchParams.set('entity', 'album')
  url.searchParams.set('country', 'us')
  url.searchParams.set('limit', '12')

  const response = await fetch(url, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })

  if (!response.ok) {
    throw new Error('The album catalog did not respond cleanly.')
  }

  const data = await response.json()

  return (data.results ?? []).map(mapAlbumResult).filter(Boolean)
}

export async function findAlbumCatalogMatch(record, { signal } = {}) {
  const query = [record.artist, record.album].filter(Boolean).join(' ').trim()
  if (!query) {
    return null
  }

  const results = await searchAlbumCatalog(query, { signal })
  const targetAlbum = normalizeSearchText(record.album)
  const targetArtist = normalizeSearchText(record.artist)

  return (
    [...results].sort((left, right) => {
      return scoreAlbumMatch(right, targetAlbum, targetArtist) -
        scoreAlbumMatch(left, targetAlbum, targetArtist)
    })[0] ?? null
  )
}

function mapAlbumResult(result) {
  if (!result || result.wrapperType !== 'collection' || !result.collectionName) {
    return null
  }

  return {
    id: `itunes-${result.collectionId}`,
    album: result.collectionName,
    artist: result.artistName || '',
    year: getYear(result.releaseDate),
    genre: result.primaryGenreName || '',
    coverUrl: buildArtworkUrl(result),
    appleUrl:
      typeof result.collectionViewUrl === 'string' ? result.collectionViewUrl : '',
  }
}

function buildArtworkUrl(result) {
  const rawUrl = result.artworkUrl600 || result.artworkUrl100 || result.artworkUrl60 || ''

  if (!rawUrl) {
    return ''
  }

  const upgradedUrl = rawUrl.replace(/\/\d+x\d+bb\./, '/600x600bb.')
  return sanitizeArtworkUrl(upgradedUrl)
}

function sanitizeArtworkUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }

  return value
    .replace(/^http:\/\//, 'https://')
    .replace(/:\/\/is(\d+)\./, '://is$1-ssl.')
}

function getYear(value) {
  if (!value) {
    return ''
  }

  return String(value).slice(0, 4)
}

function scoreAlbumMatch(result, targetAlbum, targetArtist) {
  const album = normalizeSearchText(result.album)
  const artist = normalizeSearchText(result.artist)
  let score = 0

  if (album === targetAlbum) {
    score += 400
  } else if (album.includes(targetAlbum) || targetAlbum.includes(album)) {
    score += 180
  }

  if (artist === targetArtist) {
    score += 320
  } else if (artist.includes(targetArtist) || targetArtist.includes(artist)) {
    score += 140
  }

  return score
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
