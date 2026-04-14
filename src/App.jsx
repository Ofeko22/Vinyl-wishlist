import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import './App.css'
import {
  buildBackdropUrl,
  buildPosterUrl,
  enrichDiaryEntries,
  fetchMovieRecommendations,
  parseLetterboxdCsv,
} from './lib/movieData.js'

const DEFAULT_MOVIE_COUNT = 50
const TMDB_TOKEN_STORAGE_KEY = 'after-credits.tmdb-read-access-token'
const PAGE_STORAGE_KEY = 'after-credits.active-page'

function App() {
  const [currentPage, setCurrentPage] = useState(() => {
    return window.localStorage.getItem(PAGE_STORAGE_KEY) ?? 'movies'
  })
  const [tmdbToken, setTmdbToken] = useState(() => {
    return (
      window.localStorage.getItem(TMDB_TOKEN_STORAGE_KEY) ??
      import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN ??
      ''
    )
  })
  const [movieCount, setMovieCount] = useState(DEFAULT_MOVIE_COUNT)
  const [entries, setEntries] = useState([])
  const [enrichedMovies, setEnrichedMovies] = useState([])
  const [importMessage, setImportMessage] = useState(
    'Import your Letterboxd export to build the wall.',
  )
  const [importError, setImportError] = useState('')
  const [loadingState, setLoadingState] = useState({
    loading: false,
    complete: 0,
    total: 0,
  })
  const [selectedMovieKey, setSelectedMovieKey] = useState('')
  const [recommendationsByMovie, setRecommendationsByMovie] = useState({})
  const [recommendationError, setRecommendationError] = useState('')
  const [recommendationStatus, setRecommendationStatus] = useState('')

  const deferredMovieCount = useDeferredValue(movieCount)
  const visibleEntries = entries.slice(0, deferredMovieCount)
  const selectedMovie =
    enrichedMovies.find((movie) => movie.entryKey === selectedMovieKey) ?? null
  const selectedRecommendations = selectedMovie
    ? recommendationsByMovie[selectedMovie.entryKey] ?? []
    : []

  useEffect(() => {
    window.localStorage.setItem(PAGE_STORAGE_KEY, currentPage)
  }, [currentPage])

  useEffect(() => {
    if (tmdbToken.trim()) {
      window.localStorage.setItem(TMDB_TOKEN_STORAGE_KEY, tmdbToken.trim())
      return
    }

    window.localStorage.removeItem(TMDB_TOKEN_STORAGE_KEY)
  }, [tmdbToken])

  useEffect(() => {
    if (!tmdbToken.trim() || entries.length === 0) {
      startTransition(() => {
        setEnrichedMovies([])
        setSelectedMovieKey('')
        setRecommendationsByMovie({})
      })
      setLoadingState({ loading: false, complete: 0, total: 0 })
      return
    }

    const currentEntries = entries.slice(0, deferredMovieCount)
    let cancelled = false

    setLoadingState({
      loading: true,
      complete: 0,
      total: currentEntries.length,
    })
    setImportError('')

    enrichDiaryEntries(currentEntries, tmdbToken.trim(), ({ complete, total }) => {
      if (cancelled) {
        return
      }

      setLoadingState({ loading: complete < total, complete, total })
    })
      .then((movies) => {
        if (cancelled) {
          return
        }

        startTransition(() => {
          setEnrichedMovies(movies)
          setRecommendationsByMovie({})
          setSelectedMovieKey((currentKey) => {
            const stillExists = movies.some((movie) => movie.entryKey === currentKey)
            return stillExists ? currentKey : (movies[0]?.entryKey ?? '')
          })
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setImportError(error.message)
        startTransition(() => {
          setEnrichedMovies([])
          setSelectedMovieKey('')
          setRecommendationsByMovie({})
        })
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingState((state) => ({
            ...state,
            loading: false,
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [entries, deferredMovieCount, tmdbToken])

  useEffect(() => {
    if (!selectedMovie || !selectedMovie.tmdbId || !tmdbToken.trim()) {
      setRecommendationError('')
      setRecommendationStatus(
        selectedMovie && !selectedMovie.tmdbId
          ? 'No TMDb match for this diary entry yet.'
          : '',
      )
      return
    }

    if (recommendationsByMovie[selectedMovie.entryKey]) {
      setRecommendationError('')
      setRecommendationStatus(
        recommendationsByMovie[selectedMovie.entryKey].length === 0
          ? 'No fresh recommendations came back for this pick.'
          : '',
      )
      return
    }

    let cancelled = false
    setRecommendationError('')
    setRecommendationStatus('Loading similar films...')

    fetchMovieRecommendations(selectedMovie.tmdbId, tmdbToken.trim(), enrichedMovies)
      .then((recommendations) => {
        if (cancelled) {
          return
        }

        setRecommendationsByMovie((current) => ({
          ...current,
          [selectedMovie.entryKey]: recommendations,
        }))
        setRecommendationStatus(
          recommendations.length === 0
            ? 'No fresh recommendations came back for this pick.'
            : '',
        )
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setRecommendationError(error.message)
        setRecommendationStatus('')
      })

    return () => {
      cancelled = true
    }
  }, [enrichedMovies, recommendationsByMovie, selectedMovie, tmdbToken])

  async function handleFileImport(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsedEntries = parseLetterboxdCsv(text)

      if (parsedEntries.length === 0) {
        throw new Error('The file loaded, but no watch entries were found.')
      }

      startTransition(() => {
        setEntries(parsedEntries)
        setEnrichedMovies([])
        setSelectedMovieKey('')
        setRecommendationsByMovie({})
      })
      setImportError('')
      setRecommendationError('')
      setRecommendationStatus('')
      setImportMessage(
        `Loaded ${parsedEntries.length} watch entries from ${file.name}.`,
      )
      setCurrentPage('movies')
    } catch (error) {
      setImportError(error.message)
      setImportMessage('Import another Letterboxd CSV to try again.')
    } finally {
      event.target.value = ''
    }
  }

  const hasImportedEntries = entries.length > 0
  const hasTmdbToken = Boolean(tmdbToken.trim())
  const selectedBackdrop = buildBackdropUrl(selectedMovie?.backdropPath)

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local movie companion</p>
          <h1 className="topbar-title">After Credits</h1>
        </div>
        <nav className="page-nav" aria-label="Primary">
          <button
            className={`nav-button${currentPage === 'movies' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setCurrentPage('movies')}
          >
            Movies
          </button>
          <button
            className={`nav-button${currentPage === 'settings' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setCurrentPage('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      {currentPage === 'movies' ? (
        <>
          <section className="hero-panel">
            <div className="hero-copy">
              <p className="eyebrow">Your latest watches</p>
              <h1>Cinematic wall, then what next.</h1>
              <p className="hero-text">
                Browse your recent Letterboxd watches, pick a movie, and let the
                app suggest nearby films you have not logged yet.
              </p>
              <div className="hero-metrics" aria-label="Import summary">
                <article>
                  <span>{entries.length}</span>
                  <p>Imported diary entries</p>
                </article>
                <article>
                  <span>{visibleEntries.length}</span>
                  <p>Shown on the wall</p>
                </article>
                <article>
                  <span>{selectedRecommendations.length}</span>
                  <p>Live recommendations</p>
                </article>
              </div>
            </div>

            <div className="summary-panel">
              <div className="panel-card">
                <p className="eyebrow">Library status</p>
                <div className="summary-list">
                  <article>
                    <span>{hasTmdbToken ? 'Ready' : 'Missing'}</span>
                    <p>TMDb token</p>
                  </article>
                  <article>
                    <span>{hasImportedEntries ? 'Loaded' : 'Waiting'}</span>
                    <p>Letterboxd export</p>
                  </article>
                  <article>
                    <span>{loadingState.total > 0 ? `${loadingState.complete}/${loadingState.total}` : '--'}</span>
                    <p>Matched entries</p>
                  </article>
                </div>
              </div>

              <div className="status-strip">
                <p>{importMessage}</p>
                {!hasTmdbToken && (
                  <p>Add your TMDb token in Settings to unlock posters and recommendations.</p>
                )}
                {!hasImportedEntries && (
                  <p>Import your Letterboxd export in Settings to populate the movie wall.</p>
                )}
                {loadingState.total > 0 && (
                  <p>
                    Matching {loadingState.complete} of {loadingState.total}
                    {loadingState.loading ? '...' : '.'}
                  </p>
                )}
                {importError && <p className="error-text">{importError}</p>}
              </div>
            </div>
          </section>

          <section className="content-grid">
            <div className="movie-wall">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Watch history</p>
                  <h2>Interactive wall</h2>
                </div>
                <p>
                  Select any title to see similar films filtered against what you
                  already watched.
                </p>
              </div>

              {hasImportedEntries ? (
                <div className="movie-grid" role="list">
                  {enrichedMovies.map((movie, index) => {
                    const poster = buildPosterUrl(movie.posterPath)
                    const isSelected = selectedMovieKey === movie.entryKey

                    return (
                      <button
                        key={movie.entryKey}
                        className={`movie-card${isSelected ? ' is-selected' : ''}`}
                        type="button"
                        onClick={() => setSelectedMovieKey(movie.entryKey)}
                      >
                        <span className="movie-index">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        {poster ? (
                          <img
                            className="movie-poster"
                            src={poster}
                            alt={`${movie.title} poster`}
                            loading="lazy"
                          />
                        ) : (
                          <div className="poster-fallback" aria-hidden="true">
                            <span>{movie.title.slice(0, 1)}</span>
                          </div>
                        )}
                        <div className="movie-meta">
                          <h3>{movie.title}</h3>
                          <p>
                            {movie.releaseYear ?? movie.year ?? 'Year unknown'}
                            {' · '}
                            {movie.watchedDateLabel ?? 'Watch date unknown'}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <p>Import a Letterboxd CSV in Settings to populate the wall.</p>
                  <p>This local app does not need a Letterboxd API key for the core flow.</p>
                  <button
                    className="action-button"
                    type="button"
                    onClick={() => setCurrentPage('settings')}
                  >
                    Open settings
                  </button>
                </div>
              )}
            </div>

            <aside className="detail-panel">
              {selectedMovie ? (
                <article className="detail-card">
                  <div
                    className="detail-hero"
                    style={
                      selectedBackdrop
                        ? { backgroundImage: `linear-gradient(180deg, rgba(8, 13, 21, 0.15), rgba(8, 13, 21, 0.88)), url(${selectedBackdrop})` }
                        : undefined
                    }
                  >
                    <p className="eyebrow">Selected film</p>
                    <h2>
                      {selectedMovie.title}
                      {selectedMovie.releaseYear ? ` (${selectedMovie.releaseYear})` : ''}
                    </h2>
                    <p>
                      {selectedMovie.overview ||
                        'No overview came back from TMDb for this title.'}
                    </p>
                  </div>

                  <div className="detail-copy">
                    <div className="detail-stats">
                      <article>
                        <span>{selectedMovie.voteAverage?.toFixed(1) ?? '--'}</span>
                        <p>TMDb score</p>
                      </article>
                      <article>
                        <span>{selectedMovie.watchedDateLabel ?? '--'}</span>
                        <p>Watched on</p>
                      </article>
                      <article>
                        <span>{selectedMovie.matchSource}</span>
                        <p>Match source</p>
                      </article>
                    </div>

                    <div className="recommendation-block">
                      <div className="section-heading compact">
                        <div>
                          <p className="eyebrow">Next watch</p>
                          <h2>Because you watched this</h2>
                        </div>
                        <p>
                          TMDb recommendations and similar titles, minus your imported watches.
                        </p>
                      </div>

                      {recommendationStatus && (
                        <p className="status-note">{recommendationStatus}</p>
                      )}
                      {recommendationError && (
                        <p className="error-text">{recommendationError}</p>
                      )}

                      {selectedRecommendations.length > 0 ? (
                        <div className="recommendation-list">
                          {selectedRecommendations.map((movie) => {
                            const poster = buildPosterUrl(movie.posterPath)

                            return (
                              <a
                                key={movie.id}
                                className="recommendation-card"
                                href={`https://www.themoviedb.org/movie/${movie.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {poster ? (
                                  <img
                                    className="recommendation-poster"
                                    src={poster}
                                    alt={`${movie.title} poster`}
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="recommendation-fallback" aria-hidden="true">
                                    <span>{movie.title.slice(0, 1)}</span>
                                  </div>
                                )}
                                <div>
                                  <h3>{movie.title}</h3>
                                  <p>
                                    {movie.releaseYear ?? 'Year unknown'}
                                    {' · '}
                                    {movie.voteAverage?.toFixed(1) ?? '--'} TMDb
                                  </p>
                                  <p>{movie.overview || 'No synopsis available.'}</p>
                                </div>
                              </a>
                            )
                          })}
                        </div>
                      ) : (
                        !recommendationStatus &&
                        !recommendationError && (
                          <p className="status-note">
                            Pick a matched movie and recommendations will appear here.
                          </p>
                        )
                      )}
                    </div>
                  </div>
                </article>
              ) : (
                <div className="detail-placeholder">
                  <p>Select a movie from the wall once the import finishes.</p>
                  <p>
                    If a title does not match automatically, the wall still keeps it visible
                    as a diary card.
                  </p>
                </div>
              )}
            </aside>
          </section>
        </>
      ) : (
        <section className="settings-shell">
          <div className="settings-hero">
            <p className="eyebrow">Project setup</p>
            <h1>Settings</h1>
            <p className="hero-text">
              Keep credentials and imports here, so the main page stays focused on
              the movies themselves.
            </p>
          </div>

          <div className="settings-grid">
            <div className="control-panel">
              <div className="panel-card">
                <label className="field-label" htmlFor="tmdb-token">
                  TMDb read access token
                </label>
                <input
                  id="tmdb-token"
                  className="text-input"
                  type="password"
                  placeholder="Paste your TMDb v4 read access token"
                  value={tmdbToken}
                  onChange={(event) => setTmdbToken(event.target.value)}
                  spellCheck="false"
                />
                <p className="helper-text">
                  Stored only in your browser on this machine. You can also set
                  `VITE_TMDB_READ_ACCESS_TOKEN` in a local `.env`.
                </p>
              </div>

              <div className="panel-card">
                <label className="field-label" htmlFor="letterboxd-file">
                  Letterboxd export
                </label>
                <input
                  id="letterboxd-file"
                  className="file-input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileImport}
                />
                <p className="helper-text">
                  Import `diary.csv`, `watched.csv`, or another exported Letterboxd CSV
                  that includes film names and watched dates.
                </p>
              </div>

              <div className="panel-card">
                <div className="slider-row">
                  <label className="field-label" htmlFor="movie-count">
                    Wall size
                  </label>
                  <span>{movieCount} movies</span>
                </div>
                <input
                  id="movie-count"
                  className="range-input"
                  type="range"
                  min="12"
                  max="80"
                  step="1"
                  value={movieCount}
                  onChange={(event) => setMovieCount(Number(event.target.value))}
                />
                <p className="helper-text">
                  The app loads the most recent watched entries first, then enriches them
                  with TMDb posters, backdrops, and recommendation data.
                </p>
              </div>
            </div>

            <div className="settings-side">
              <div className="panel-card">
                <p className="eyebrow">Current status</p>
                <div className="summary-list">
                  <article>
                    <span>{hasTmdbToken ? 'Ready' : 'Missing'}</span>
                    <p>TMDb token</p>
                  </article>
                  <article>
                    <span>{entries.length}</span>
                    <p>Imported entries</p>
                  </article>
                  <article>
                    <span>{movieCount}</span>
                    <p>Wall size</p>
                  </article>
                </div>
              </div>

              <div className="status-strip">
                <p>{importMessage}</p>
                {loadingState.total > 0 && (
                  <p>
                    Matched {loadingState.complete} of {loadingState.total} entries
                    {loadingState.loading ? '...' : '.'}
                  </p>
                )}
                {importError && <p className="error-text">{importError}</p>}
              </div>

              <button
                className="action-button"
                type="button"
                onClick={() => setCurrentPage('movies')}
              >
                Back to movies
              </button>
            </div>
          </div>
        </section>
      )}

      <footer className="footer-note">
        <p>
          Letterboxd history is imported from your local export. Metadata,
          posters, and recommendations are powered by{' '}
          <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
            TMDb
          </a>
          .
        </p>
      </footer>
    </main>
  )
}

export default App
