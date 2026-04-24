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

export function createEmptyDraft() {
  return {
    album: '',
    artist: '',
    year: '',
    genre: '',
    coverUrl: '',
    amazonUrl: '',
    notes: '',
  }
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

export function serializeWishlist(records) {
  return `${JSON.stringify(records, null, 2)}\n`
}

export function parseWishlistImport(text, filename = 'wishlist') {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error(`${filename} is empty, so there was nothing to import.`)
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed)
    const collection = Array.isArray(parsed)
      ? parsed
      : parsed.records || parsed.vinyls || parsed.wishlist || []

    const normalized = dedupeWishlist(
      collection.map((record) => normalizeVinyl(record)).filter(Boolean),
    )

    if (normalized.length === 0) {
      throw new Error('The JSON loaded, but no vinyl records were found inside it.')
    }

    return normalized
  }

  const csvRows = parseCsv(trimmed)
  if (csvRows.length > 1) {
    const headers = csvRows[0].map((value) => normalizeHeader(value))
    const normalized = dedupeWishlist(
      csvRows
        .slice(1)
        .map((row, index) => normalizeVinyl(mapCsvRow(headers, row, index)))
        .filter(Boolean),
    )

    if (normalized.length > 0) {
      return normalized
    }
  }

  const lineItems = dedupeWishlist(
    trimmed
      .split(/\r?\n/)
      .map((line, index) => parseWishlistLine(line, index))
      .filter(Boolean),
  )

  if (lineItems.length === 0) {
    throw new Error(
      'Nothing importable showed up. Try JSON, CSV, or one record per line in "Artist - Album (Year)" format.',
    )
  }

  return lineItems
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

function mapCsvRow(headers, row) {
  const draft = {}

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const index = headers.findIndex((header) => aliases.includes(header))
    if (index >= 0) {
      draft[field] = row[index] ?? ''
    }
  }

  return draft
}

function parseWishlistLine(line, index) {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  const match = trimmed.match(/^(.*?)\s*[-:]\s*(.*?)(?:\s+\((\d{4})\))?$/)
  if (!match) {
    return normalizeVinyl({
      id: `line-${index}`,
      album: trimmed,
    })
  }

  return normalizeVinyl({
    id: `line-${index}`,
    artist: match[1],
    album: match[2],
    year: match[3] || '',
  })
}

function normalizeHeader(value) {
  return String(value).replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, '')
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

function parseCsv(text) {
  const rows = []
  let currentRow = []
  let currentValue = ''
  let insideQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const nextCharacter = text[index + 1]

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentValue += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }

      continue
    }

    if (character === ',' && !insideQuotes) {
      currentRow.push(currentValue)
      currentValue = ''
      continue
    }

    if ((character === '\n' || character === '\r') && !insideQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1
      }

      currentRow.push(currentValue)
      rows.push(currentRow)
      currentRow = []
      currentValue = ''
      continue
    }

    currentValue += character
  }

  if (currentValue || currentRow.length > 0) {
    currentRow.push(currentValue)
    rows.push(currentRow)
  }

  return rows
}
