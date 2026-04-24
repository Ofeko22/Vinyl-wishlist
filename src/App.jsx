import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react'
import './App.css'
import { findAlbumCatalogMatch, searchAlbumCatalog } from './lib/albumCatalog.js'
import {
  buildVinylFingerprint,
  buildAmazonSearchUrl,
  loadWishlist,
  normalizeVinyl,
  saveWishlist,
  wishlistMatchesQuery,
} from './lib/vinylWishlist.js'

const STATUS_HINT =
  'Search for an album, click the one you want, and it drops straight onto your wall.'

function App() {
  const [wishlist, setWishlist] = useState(() => loadWishlist())
  const [selectedVinylId, setSelectedVinylId] = useState('')
  const [wallFilterQuery, setWallFilterQuery] = useState('')
  const [draggedVinylId, setDraggedVinylId] = useState('')
  const [dragTargetVinylId, setDragTargetVinylId] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogResults, setCatalogResults] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [statusMessage, setStatusMessage] = useState(STATUS_HINT)
  const catalogAbortRef = useRef(null)
  const catalogRequestRef = useRef(0)
  const repairAbortRef = useRef(null)
  const attemptedRepairsRef = useRef(new Set())

  const deferredWallFilterQuery = useDeferredValue(wallFilterQuery.trim())
  const filteredWishlist = wishlist.filter((record) =>
    wishlistMatchesQuery(record, deferredWallFilterQuery),
  )
  const selectedVinyl =
    filteredWishlist.find((record) => record.id === selectedVinylId) ??
    filteredWishlist[0] ??
    (deferredWallFilterQuery
      ? null
      : wishlist.find((record) => record.id === selectedVinylId) ?? wishlist[0] ?? null)

  useEffect(() => {
    saveWishlist(wishlist)
  }, [wishlist])

  useEffect(() => {
    return () => {
      catalogAbortRef.current?.abort()
      repairAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (wishlist.length === 0) {
      if (selectedVinylId) {
        setSelectedVinylId('')
      }

      return
    }

    const selectionStillExists = wishlist.some((record) => record.id === selectedVinylId)
    if (!selectionStillExists) {
      setSelectedVinylId(wishlist[0].id)
    }
  }, [wishlist, selectedVinylId])

  useEffect(() => {
    const trimmedQuery = catalogQuery.trim()

    if (!trimmedQuery) {
      catalogAbortRef.current?.abort()
      setCatalogResults([])
      setCatalogError('')
      setCatalogLoading(false)
      return
    }

    const timeoutId = window.setTimeout(async () => {
      catalogAbortRef.current?.abort()
      const controller = new AbortController()
      const requestId = catalogRequestRef.current + 1
      catalogAbortRef.current = controller
      catalogRequestRef.current = requestId

      setCatalogLoading(true)
      setCatalogError('')

      try {
        const results = await searchAlbumCatalog(trimmedQuery, {
          signal: controller.signal,
        })

        if (catalogRequestRef.current !== requestId) {
          return
        }

        setCatalogResults(results)
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }

        if (catalogRequestRef.current !== requestId) {
          return
        }

        setCatalogResults([])
        setCatalogError('Search hit a snag. Try that album again in a second.')
      } finally {
        if (catalogAbortRef.current === controller) {
          catalogAbortRef.current = null
        }

        if (catalogRequestRef.current === requestId) {
          setCatalogLoading(false)
        }
      }
    }, 280)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [catalogQuery])

  useEffect(() => {
    const candidate = wishlist.find(
      (record) =>
        !record.coverUrl &&
        !attemptedRepairsRef.current.has(record.id) &&
        (record.album || record.artist),
    )

    if (!candidate) {
      return
    }

    attemptedRepairsRef.current.add(candidate.id)
    repairAbortRef.current?.abort()
    const controller = new AbortController()
    repairAbortRef.current = controller

    findAlbumCatalogMatch(candidate, { signal: controller.signal })
      .then((match) => {
        if (!match?.coverUrl) {
          return
        }

        setWishlist((current) =>
          current.map((record) => {
            if (record.id !== candidate.id) {
              return record
            }

            return {
              ...record,
              coverUrl: record.coverUrl || match.coverUrl,
              year: record.year || match.year,
              genre: record.genre || match.genre,
            }
          }),
        )
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          // Ignore silent repair misses and leave the card as-is.
        }
      })

    return () => {
      controller.abort()
    }
  }, [wishlist])

  function handleDeleteVinyl(vinylId) {
    const vinyl = wishlist.find((record) => record.id === vinylId)
    if (!vinyl) {
      return
    }

    startTransition(() => {
      setWishlist((current) => current.filter((record) => record.id !== vinylId))
    })

    setStatusMessage(`Removed ${vinyl.album} from the wishlist.`)
  }

  function handleAddCatalogResult(result) {
    const nextVinyl = normalizeVinyl(result)
    if (!nextVinyl) {
      return
    }

    const existingVinyl = wishlist.find(
      (record) => buildVinylFingerprint(record) === buildVinylFingerprint(nextVinyl),
    )

    if (existingVinyl) {
      setSelectedVinylId(existingVinyl.id)
      setCatalogQuery('')
      setCatalogResults([])
      setCatalogError('')
      setStatusMessage(`${existingVinyl.album} is already on your wall.`)
      return
    }

    startTransition(() => {
      setWishlist((current) => [nextVinyl, ...current])
      setSelectedVinylId(nextVinyl.id)
    })

    setCatalogQuery('')
    setCatalogResults([])
    setCatalogError('')
    setStatusMessage(`Added ${nextVinyl.album} to the wall.`)
  }

  function handleRecordClick(record) {
    if (record.amazonUrl) {
      window.open(record.amazonUrl, '_blank', 'noopener,noreferrer')
      return
    }

    setSelectedVinylId(record.id)
  }

  function handleDragStart(event, vinylId) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', vinylId)
    setDraggedVinylId(vinylId)
    setDragTargetVinylId(vinylId)
  }

  function handleDragOver(event, vinylId) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (dragTargetVinylId !== vinylId) {
      setDragTargetVinylId(vinylId)
    }
  }

  function handleDrop(event, targetVinylId) {
    event.preventDefault()

    const sourceVinylId = draggedVinylId || event.dataTransfer.getData('text/plain')
    if (!sourceVinylId || sourceVinylId === targetVinylId) {
      clearDragState()
      return
    }

    const visibleVinylIds = filteredWishlist.map((record) => record.id)
    if (
      !visibleVinylIds.includes(sourceVinylId) ||
      !visibleVinylIds.includes(targetVinylId)
    ) {
      clearDragState()
      return
    }

    setWishlist((current) =>
      reorderVisibleSubset(current, visibleVinylIds, sourceVinylId, targetVinylId),
    )
    setSelectedVinylId(sourceVinylId)
    setStatusMessage('Updated your ranking on the wall.')
    clearDragState()
  }

  function handleDragEnd() {
    clearDragState()
  }

  function clearDragState() {
    setDraggedVinylId('')
    setDragTargetVinylId('')
  }

  const wishlistCount = wishlist.length
  const coverCount = wishlist.filter((record) => Boolean(record.coverUrl)).length
  const amazonReadyCount = wishlist.filter((record) => Boolean(record.amazonUrl)).length

  return (
    <main className="page-shell">
      <div className="blog-frame">
        <header className="browser-bar">
          <div className="browser-lights" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <p>vinyl-wishlist.exe</p>
        </header>

        <section className="priority-layout">
          <section className="widget-card search-priority-card">
            <div className="search-priority-copy">
              <p className="eyebrow">Search and add</p>
              <h1>Wax Wishlist</h1>
              <p className="hero-copy">
                Search first, pick the right album, and drop it onto the wall in one
                click.
              </p>
            </div>

            <div className="search-stack search-stack--priority">
              <label className="sr-only" htmlFor="catalog-search-input">
                Search the album catalog
              </label>
              <input
                id="catalog-search-input"
                name="catalogQuery"
                type="text"
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                placeholder="Search artist or album..."
                autoComplete="off"
              />

              {catalogQuery.trim() ? (
                <div className="search-dropdown" role="listbox" aria-label="Album results">
                  {catalogLoading ? (
                    <p className="dropdown-status">Searching the stacks...</p>
                  ) : null}

                  {!catalogLoading && catalogError ? (
                    <p className="dropdown-status is-error">{catalogError}</p>
                  ) : null}

                  {!catalogLoading && !catalogError && catalogResults.length > 0
                    ? catalogResults.map((result) => (
                        <button
                          key={result.id}
                          className="dropdown-option"
                          type="button"
                          onClick={() => handleAddCatalogResult(result)}
                        >
                          {result.coverUrl ? (
                            <img
                              className="dropdown-cover"
                              src={result.coverUrl}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div
                              className="dropdown-cover fallback-cover"
                              aria-hidden="true"
                            >
                              <span>{result.album.slice(0, 1)}</span>
                            </div>
                          )}

                          <span className="dropdown-copy">
                            <strong>{result.album}</strong>
                            <span>{result.artist || 'Unknown artist'}</span>
                            <span>
                              {result.year || 'Year unknown'}
                              {result.genre ? ` • ${result.genre}` : ''}
                            </span>
                          </span>
                        </button>
                      ))
                    : null}

                  {!catalogLoading &&
                  !catalogError &&
                  catalogQuery.trim() &&
                  catalogResults.length === 0 ? (
                    <p className="dropdown-status">No matches yet for that search.</p>
                  ) : null}
                </div>
              ) : (
                <p className="catalog-prompt">
                  Start typing and the drop list opens here.
                </p>
              )}
            </div>
          </section>

          <aside className="hero-card hero-card--compact">
            <p className="eyebrow">Wall status</p>
            <div className="marquee marquee--compact" aria-label="Moving status banner">
              <div className="marquee-track">
                <span>MORE RECORDS</span>
                <span>FASTER SEARCH</span>
                <span>RETRO BLOG MODE</span>
                <span>MORE RECORDS</span>
                <span>FASTER SEARCH</span>
                <span>RETRO BLOG MODE</span>
              </div>
            </div>

            <div className="hero-stats hero-stats--compact">
              <article>
                <span>{wishlistCount}</span>
                <p>Records on deck</p>
              </article>
              <article>
                <span>{coverCount}</span>
                <p>With cover art</p>
              </article>
              <article>
                <span>{amazonReadyCount}</span>
                <p>Direct Amazon links</p>
              </article>
            </div>

            <div className="status-note">
              <strong>Status:</strong> {statusMessage}
            </div>
          </aside>
        </section>

        <section className="toolbar-card toolbar-card--single">
          <label className="filter-field">
            <span>Filter your wall</span>
            <input
              type="search"
              value={wallFilterQuery}
              onChange={(event) => setWallFilterQuery(event.target.value)}
              placeholder="Search album, artist, genre, or notes"
            />
          </label>
        </section>

        <section className="content-layout content-layout--compact">
          <section className="record-list-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">The stack</p>
                <h2>Wishlist wall</h2>
              </div>
              <p>
                Drag cards to rank them. If a record has a direct Amazon URL,
                clicking its card opens Amazon right away.
              </p>
            </div>

            {filteredWishlist.length > 0 ? (
              <div className="record-grid" role="list">
                {filteredWishlist.map((record, index) => {
                  const isSelected = selectedVinyl?.id === record.id
                  const isDragging = draggedVinylId === record.id
                  const isDragTarget =
                    draggedVinylId && dragTargetVinylId === record.id && !isDragging

                  return (
                    <article
                      key={record.id}
                      className={`record-card${isSelected ? ' is-selected' : ''}${
                        isDragging ? ' is-dragging' : ''
                      }${isDragTarget ? ' is-drag-target' : ''}`}
                      draggable
                      onDragStart={(event) => handleDragStart(event, record.id)}
                      onDragOver={(event) => handleDragOver(event, record.id)}
                      onDrop={(event) => handleDrop(event, record.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <button
                        className="record-select"
                        type="button"
                        onClick={() => handleRecordClick(record)}
                      >
                        <span className="record-badge">
                          #{String(index + 1).padStart(2, '0')}
                        </span>
                        {record.coverUrl ? (
                          <img
                            className="record-cover"
                            src={record.coverUrl}
                            alt={`${record.album} cover`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="record-cover fallback-cover" aria-hidden="true">
                            <span>{record.album.slice(0, 1)}</span>
                          </div>
                        )}
                        <div className="record-meta">
                          <h3>{record.album}</h3>
                          <p>{record.artist || 'Unknown artist'}</p>
                          <p>
                            {record.year || 'Year unknown'}
                            {record.genre ? ` • ${record.genre}` : ''}
                          </p>
                        </div>
                      </button>

                      <div className="record-actions">
                        {record.amazonUrl ? (
                          <button type="button" onClick={() => setSelectedVinylId(record.id)}>
                            Spotlight
                          </button>
                        ) : (
                          <a
                            href={buildAmazonSearchUrl(record)}
                            target="_blank"
                            rel="noreferrer"
                            referrerPolicy="no-referrer"
                          >
                            Search Amazon
                          </a>
                        )}
                        <button type="button" onClick={() => handleDeleteVinyl(record.id)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="empty-state">
                <h3>No records match that filter yet.</h3>
                <p>
                  Try a different keyword, or use the album search above to add
                  something new to the wall.
                </p>
              </div>
            )}
          </section>

          <aside className="spotlight-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Featured record</p>
                <h2>Side A Spotlight</h2>
              </div>
            </div>

            {selectedVinyl ? (
              <article className="spotlight-body">
                {selectedVinyl.coverUrl ? (
                  <img
                    className="spotlight-cover"
                    src={selectedVinyl.coverUrl}
                    alt={`${selectedVinyl.album} cover`}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="spotlight-cover fallback-cover" aria-hidden="true">
                    <span>{selectedVinyl.album.slice(0, 1)}</span>
                  </div>
                )}

                <div className="spotlight-copy">
                  <p className="spotlight-kicker">{selectedVinyl.artist || 'Unknown artist'}</p>
                  <h3>{selectedVinyl.album}</h3>
                  <div className="spotlight-tags">
                    <span>{selectedVinyl.year || 'Year unknown'}</span>
                    <span>{selectedVinyl.genre || 'Genre TBD'}</span>
                  </div>
                  <p>
                    {selectedVinyl.notes ||
                      'No notes yet. This card is now mainly here to spotlight the cover and the basic album info.'}
                  </p>
                </div>

                <div className="spotlight-actions">
                  <a
                    className="primary-button"
                    href={selectedVinyl.amazonUrl || buildAmazonSearchUrl(selectedVinyl)}
                    target="_blank"
                    rel="noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {selectedVinyl.amazonUrl ? 'Open Amazon listing' : 'Search Amazon'}
                  </a>
                </div>
              </article>
            ) : (
              <div className="empty-state spotlight-empty">
                <h3>Your wall is ready for its first record.</h3>
                <p>Search for an album above and click a match to add it instantly.</p>
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  )
}

export default App

function reorderVisibleSubset(records, visibleIds, sourceId, targetId) {
  const visibleIdSet = new Set(visibleIds)
  const visibleRecords = records.filter((record) => visibleIdSet.has(record.id))
  const sourceIndex = visibleRecords.findIndex((record) => record.id === sourceId)
  const targetIndex = visibleRecords.findIndex((record) => record.id === targetId)

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return records
  }

  const reorderedVisibleRecords = [...visibleRecords]
  const [movedRecord] = reorderedVisibleRecords.splice(sourceIndex, 1)
  reorderedVisibleRecords.splice(targetIndex, 0, movedRecord)

  let reorderedIndex = 0

  return records.map((record) => {
    if (!visibleIdSet.has(record.id)) {
      return record
    }

    const nextRecord = reorderedVisibleRecords[reorderedIndex]
    reorderedIndex += 1
    return nextRecord
  })
}
