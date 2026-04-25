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
  }
}

function buildArtworkUrl(result) {
  const rawUrl = result.artworkUrl600 || result.artworkUrl100 || result.artworkUrl60 || ''
  if (!rawUrl) {
    return ''
  }

  return rawUrl
    .replace(/^http:\/\//, 'https://')
    .replace(/:\/\/is(\d+)\./, '://is$1-ssl.')
    .replace(/\/\d+x\d+bb\./, '/600x600bb.')
}

function getYear(value) {
  return value ? String(value).slice(0, 4) : ''
}
