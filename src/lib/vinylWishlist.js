const STORAGE_KEY = 'wax-wishlist.records'

const FIELD_ALIASES = {
  album: ['album', 'title', 'name', 'record'],
  artist: ['artist', 'band', 'performer'],
  year: ['year', 'releaseyear', 'released', 'date'],
  genre: ['genre', 'style', 'category'],
  coverUrl: ['coverUrl', 'coverurl', 'cover', 'image', 'imageUrl', 'imageurl', 'artwork', 'art'],
  amazonUrl: ['amazonUrl', 'amazonurl', 'amazon', 'link', 'url'],
  notes: ['notes', 'note', 'comment', 'comments', 'memo'],
}

export function loadWishlist() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      return []
    }

    const parsed = JSON.parse(saved)
    if (!Array.isArray(parsed)) {
      return []
    }

    return dedupeWishlist(parsed.map((record) => normalizeVinyl(record)).filter(Boolean))
  } catch {
    return []
  }
}

export function saveWishlist(records) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function normalizeVinyl(record) {
  if (!record || typeof record !== 'object') {
    return null
  }

  const album = readValue(record, 'album')
  const artist = readValue(record, 'artist')

  if (!album && !artist) {
    return null
  }

  const year = readValue(record, 'year').replace(/[^\d]/g, '').slice(0, 4)
  const genre = readValue(record, 'genre')
  const coverUrl = sanitizeCoverUrl(readValue(record, 'coverUrl'))
  const amazonUrl = sanitizeAmazonUrl(readValue(record, 'amazonUrl'))
  const notes = readValue(record, 'notes')

  return {
    id:
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : createRecordId(album || artist, artist),
    album: album || 'Untitled record',
    artist: artist || 'Unknown artist',
    year,
    genre,
    coverUrl,
    amazonUrl,
    notes,
  }
}

export function buildVinylFingerprint(record) {
  const normalized = normalizeVinyl(record)
  if (!normalized) {
    return ''
  }

  return [
    normalized.artist.toLowerCase(),
    normalized.album.toLowerCase(),
    normalized.year,
  ].join('::')
}

export function wishlistMatchesQuery(record, query) {
  if (!query) {
    return true
  }

  const haystack = [
    record.album,
    record.artist,
    record.year,
    record.genre,
    record.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(query.toLowerCase())
}

export function buildAmazonSearchUrl(record) {
  const query = [record.artist, record.album, 'vinyl'].filter(Boolean).join(' ')
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`
}

function readValue(record, field) {
  const aliases = FIELD_ALIASES[field]
  for (const alias of aliases) {
    if (alias in record && record[alias] != null) {
      return String(record[alias]).trim()
    }
  }

  return ''
}

function sanitizeCoverUrl(value) {
  if (!value) {
    return ''
  }

  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function sanitizeAmazonUrl(value) {
  if (!value) {
    return ''
  }

  try {
    const url = new URL(value)
    const isHttps = url.protocol === 'https:'
    const isAmazonHost = /(^|\.)amazon\.[a-z.]+$/i.test(url.hostname)

    return isHttps && isAmazonHost ? url.toString() : ''
  } catch {
    return ''
  }
}

function dedupeWishlist(records) {
  const seen = new Set()

  return records.filter((record) => {
    const key = buildVinylFingerprint(record)

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function createRecordId(album, artist) {
  return `vinyl-${slugify(artist || 'unknown')}-${slugify(album || 'record')}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
