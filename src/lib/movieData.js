const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342'
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w780'

const movieLookupCache = new Map()
const recommendationsCache = new Map()

export function buildPosterUrl(path) {
  return path ? `${POSTER_BASE}${path}` : ''
}

export function buildBackdropUrl(path) {
  return path ? `${BACKDROP_BASE}${path}` : ''
}

export function parseLetterboxdCsv(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    throw new Error('That CSV does not look like a Letterboxd export.')
  }

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim())
  const dataRows = rows.slice(1)

  const entries = dataRows
    .map((row, index) => {
      const title = readColumn(row, headers, ['Name', 'Title', 'Film', 'name'])
      const watchedDateValue = readColumn(row, headers, [
        'Watched Date',
        'Date',
        'watched_date',
        'WatchedDate',
      ])

      if (!title || !watchedDateValue) {
        return null
      }

      const year = readColumn(row, headers, ['Year', 'Release Year', 'year'])
      const imdbId = readColumn(row, headers, ['IMDb ID', 'IMDb', 'imdbID'])
      const watchedDate = coerceDate(watchedDateValue)

      return {
        entryKey: `entry-${index}-${slugify(title)}-${watchedDateValue}`,
        title: title.trim(),
        year: year ? Number(year) || null : null,
        imdbId: imdbId?.trim() || '',
        watchedDate,
        watchedDateLabel: formatDate(watchedDate),
        watchedDateSortKey: watchedDate?.getTime() ?? 0,
        originalIndex: index,
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.watchedDateSortKey !== left.watchedDateSortKey) {
        return right.watchedDateSortKey - left.watchedDateSortKey
      }

      return right.originalIndex - left.originalIndex
    })

  return entries
}

export async function enrichDiaryEntries(entries, token, onProgress) {
  let complete = 0

  return mapWithConcurrency(entries, 4, async (entry) => {
    const match = await resolveMovie(entry, token)
    complete += 1
    onProgress?.({ complete, total: entries.length })
    return { ...entry, ...match }
  })
}

export async function fetchMovieRecommendations(tmdbId, token, watchedMovies) {
  if (recommendationsCache.has(tmdbId)) {
    return filterRecommendations(recommendationsCache.get(tmdbId), watchedMovies)
  }

  const [recommended, similar] = await Promise.all([
    tmdbGet(`/movie/${tmdbId}/recommendations`, token, {
      language: 'en-US',
      page: '1',
    }),
    tmdbGet(`/movie/${tmdbId}/similar`, token, {
      language: 'en-US',
      page: '1',
    }),
  ])

  const merged = dedupeById([
    ...(recommended.results ?? []),
    ...(similar.results ?? []),
  ]).map(mapTmdbMovie)

  recommendationsCache.set(tmdbId, merged)
  return filterRecommendations(merged, watchedMovies)
}

async function resolveMovie(entry, token) {
  const cacheKey = entry.imdbId
    ? `imdb:${entry.imdbId}`
    : `search:${slugify(entry.title)}:${entry.year ?? 'unknown'}`

  if (movieLookupCache.has(cacheKey)) {
    return movieLookupCache.get(cacheKey)
  }

  const matchPromise = (async () => {
    if (entry.imdbId) {
      const result = await tmdbGet(`/find/${entry.imdbId}`, token, {
        external_source: 'imdb_id',
      })
      const movie = result.movie_results?.[0]

      if (movie) {
        return {
          ...mapTmdbMovie(movie),
          matchSource: 'IMDb',
        }
      }
    }

    const result = await tmdbGet('/search/movie', token, {
      query: entry.title,
      include_adult: 'false',
      language: 'en-US',
      ...(entry.year ? { year: String(entry.year) } : {}),
    })
    const movie = pickBestSearchResult(result.results ?? [], entry)

    if (!movie) {
      return {
        tmdbId: null,
        releaseYear: entry.year,
        posterPath: '',
        backdropPath: '',
        overview: '',
        voteAverage: null,
        matchSource: 'Unmatched',
      }
    }

    return {
      ...mapTmdbMovie(movie),
      matchSource: 'Search',
    }
  })()

  movieLookupCache.set(cacheKey, matchPromise)
  return matchPromise
}

function filterRecommendations(recommendations, watchedMovies) {
  const watchedTmdbIds = new Set(
    watchedMovies.map((movie) => movie.tmdbId).filter(Boolean),
  )
  const watchedSignatures = new Set(
    watchedMovies.map((movie) => movieSignature(movie.title, movie.releaseYear ?? movie.year)),
  )

  return recommendations
    .filter((movie) => !watchedTmdbIds.has(movie.id))
    .filter(
      (movie) => !watchedSignatures.has(movieSignature(movie.title, movie.releaseYear)),
    )
    .slice(0, 12)
}

async function tmdbGet(path, token, params = {}) {
  const url = new URL(`${TMDB_API_BASE}${path}`)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    let message = 'TMDb request failed.'

    try {
      const body = await response.json()
      message = body.status_message || message
    } catch {
      // Ignore JSON parsing errors here and use the generic message.
    }

    throw new Error(message)
  }

  return response.json()
}

function pickBestSearchResult(results, entry) {
  const targetTitle = normalizeTitle(entry.title)

  return [...results].sort((left, right) => {
    return scoreMatch(right, entry, targetTitle) - scoreMatch(left, entry, targetTitle)
  })[0]
}

function scoreMatch(result, entry, targetTitle) {
  const resultTitle = normalizeTitle(result.title || result.original_title || '')
  const resultYear = getReleaseYear(result.release_date)
  let score = result.popularity ?? 0

  if (resultTitle === targetTitle) {
    score += 250
  } else if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) {
    score += 120
  }

  if (entry.year && resultYear === entry.year) {
    score += 300
  }

  return score
}

function mapTmdbMovie(movie) {
  return {
    id: movie.id,
    tmdbId: movie.id,
    title: movie.title,
    releaseYear: getReleaseYear(movie.release_date),
    posterPath: movie.poster_path || '',
    backdropPath: movie.backdrop_path || '',
    overview: movie.overview || '',
    voteAverage: typeof movie.vote_average === 'number' ? movie.vote_average : null,
  }
}

function movieSignature(title, year) {
  return `${normalizeTitle(title)}::${year ?? 'unknown'}`
}

function normalizeTitle(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function slugify(value) {
  return normalizeTitle(value).replace(/\s+/g, '-')
}

function getReleaseYear(value) {
  return value ? Number(String(value).slice(0, 4)) || null : null
}

function readColumn(row, headers, candidates) {
  for (const candidate of candidates) {
    const index = headers.findIndex(
      (header) => header.toLowerCase() === candidate.toLowerCase(),
    )

    if (index >= 0) {
      return row[index]?.trim() || ''
    }
  }

  return ''
}

function coerceDate(value) {
  if (!value) {
    return null
  }

  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(date) {
  if (!date) {
    return ''
  }

  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function dedupeById(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false
    }

    seen.add(item.id)
    return true
  })
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function consume() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => consume()),
  )
  return results
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(value)
      value = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }

      row.push(value)
      rows.push(row)
      row = []
      value = ''
      continue
    }

    value += char
  }

  if (value || row.length > 0) {
    row.push(value)
    rows.push(row)
  }

  return rows.filter((currentRow) => currentRow.some((cell) => cell.trim() !== ''))
}
