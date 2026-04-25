import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { searchAlbumCatalog } from './lib/albumCatalog.js'
import {
  buildAmazonSearchUrl,
  buildBeatnikSearchUrl,
  buildThirdEarSearchUrl,
  buildVinylFingerprint,
  loadWishlist,
  normalizeVinyl,
  saveWishlist,
  wishlistMatchesQuery,
} from './lib/vinylWishlist.js'

const EMPTY_STATUS =
  'Search for an album, choose the best match, and it joins your wall.'

function App() {
  const [wishlist, setWishlist] = useState(() => loadWishlist())
  const [selectedId, setSelectedId] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogResults, setCatalogResults] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [statusMessage, setStatusMessage] = useState(EMPTY_STATUS)
  const [draggedId, setDraggedId] = useState('')
  const [dragTargetId, setDragTargetId] = useState('')
  const [newRecordId, setNewRecordId] = useState('')
  const abortRef = useRef(null)
  const requestRef = useRef(0)
  const newRecordTimeoutRef = useRef(0)

  const deferredFilter = useDeferredValue(filterQuery.trim())
  const filteredWishlist = useMemo(
    () => wishlist.filter((record) => wishlistMatchesQuery(record, deferredFilter)),
    [deferredFilter, wishlist],
  )
  const selectedRecord =
    filteredWishlist.find((record) => record.id === selectedId) ??
    wishlist.find((record) => record.id === selectedId) ??
    filteredWishlist[0] ??
    wishlist[0] ??
    null
  const headerRecords =
    wishlist.slice(0, 5).length > 0
      ? wishlist.slice(0, 5)
      : Array.from({ length: 4 }, (_, index) => ({
          id: `placeholder-${index}`,
          album: '',
          coverUrl: '',
        }))

  useEffect(() => {
    saveWishlist(wishlist)
  }, [wishlist])

  useEffect(() => {
    if (!wishlist.length) {
      setSelectedId('')
      return
    }

    if (!wishlist.some((record) => record.id === selectedId)) {
      setSelectedId(wishlist[0].id)
    }
  }, [selectedId, wishlist])

  useEffect(() => {
    const query = catalogQuery.trim()

    if (!query) {
      abortRef.current?.abort()
      setCatalogResults([])
      setCatalogError('')
      setCatalogLoading(false)
      return
    }

    const timeoutId = window.setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      const requestId = requestRef.current + 1
      abortRef.current = controller
      requestRef.current = requestId

      setCatalogLoading(true)
      setCatalogError('')

      try {
        const results = await searchAlbumCatalog(query, { signal: controller.signal })

        if (requestRef.current === requestId) {
          setCatalogResults(results)
        }
      } catch (error) {
        if (error.name !== 'AbortError' && requestRef.current === requestId) {
          setCatalogResults([])
          setCatalogError('Search is unavailable for a moment. Try again shortly.')
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }

        if (requestRef.current === requestId) {
          setCatalogLoading(false)
        }
      }
    }, 260)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [catalogQuery])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      window.clearTimeout(newRecordTimeoutRef.current)
    }
  }, [])

  function handleAddResult(result) {
    const nextRecord = normalizeVinyl(result)
    if (!nextRecord) {
      return
    }

    const existingRecord = wishlist.find(
      (record) => buildVinylFingerprint(record) === buildVinylFingerprint(nextRecord),
    )

    if (existingRecord) {
      setSelectedId(existingRecord.id)
      setCatalogQuery('')
      setCatalogResults([])
      setCatalogError('')
      setStatusMessage(`${existingRecord.album} is already on the wall.`)
      return
    }

    setWishlist((current) => [nextRecord, ...current])
    setSelectedId(nextRecord.id)
    window.clearTimeout(newRecordTimeoutRef.current)
    setNewRecordId(nextRecord.id)
    newRecordTimeoutRef.current = window.setTimeout(() => {
      setNewRecordId((current) => (current === nextRecord.id ? '' : current))
    }, 900)
    setCatalogQuery('')
    setCatalogResults([])
    setCatalogError('')
    setStatusMessage(`Added ${nextRecord.album}.`)
  }

  function handleRemove(recordId) {
    const record = wishlist.find((item) => item.id === recordId)
    setWishlist((current) => current.filter((item) => item.id !== recordId))

    if (record) {
      setStatusMessage(`Removed ${record.album}.`)
    }
  }

  function handleDragStart(event, recordId) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', recordId)
    setDraggedId(recordId)
    setDragTargetId(recordId)
  }

  function handleDragOver(event, recordId) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragTargetId !== recordId) {
      setDragTargetId(recordId)
    }
  }

  function handleDrop(event, targetId) {
    event.preventDefault()
    const sourceId = draggedId || event.dataTransfer.getData('text/plain')

    if (!sourceId || sourceId === targetId) {
      clearDragState()
      return
    }

    const visibleIds = filteredWishlist.map((record) => record.id)
    setWishlist((current) => reorderVisibleRecords(current, visibleIds, sourceId, targetId))
    setSelectedId(sourceId)
    clearDragState()
    setStatusMessage('Updated the wall order.')
  }

  function clearDragState() {
    setDraggedId('')
    setDragTargetId('')
  }

  return (
    <main className="app-shell">
      <header className="app-header" aria-label="Vinyl Wishlist">
        <div className="brand-lockup">
          <MiniRecord />
          <div>
            <p className="eyebrow">Vinyl Wishlist</p>
            <h1>Wax Wishlist</h1>
          </div>
        </div>
        <div className="top-vinyl-strip" aria-hidden="true">
          {headerRecords.map((record, index) => (
            <MiniRecord
              key={record.id}
              coverUrl={record.coverUrl}
              label={record.album?.slice(0, 1)}
              variant={(index % 4) + 1}
            />
          ))}
        </div>
      </header>

      <section className="workspace">
        <section className="wall-panel" aria-label="Wishlist records">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">The stack</p>
              <h2>Wishlist wall</h2>
            </div>
            <div className="wall-tools">
              <p className="wall-copy">
                Drag cards to rank them. Search a store from any record, or keep
                the best one glowing in Side A.
              </p>
              <label className="filter-field">
                <span>Filter wall</span>
                <input
                  type="search"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  placeholder="Search wall"
                />
              </label>
            </div>
          </div>

          {filteredWishlist.length ? (
            <div className="record-grid" role="list">
              {filteredWishlist.map((record, index) => (
                <RecordCard
                  key={record.id}
                  index={index}
                  isDragging={draggedId === record.id}
                  isDragTarget={
                    Boolean(draggedId) && dragTargetId === record.id && draggedId !== record.id
                  }
                  isNew={newRecordId === record.id}
                  isSelected={selectedRecord?.id === record.id}
                  onDragEnd={clearDragState}
                  onDragOver={(event) => handleDragOver(event, record.id)}
                  onDragStart={(event) => handleDragStart(event, record.id)}
                  onDrop={(event) => handleDrop(event, record.id)}
                  onRemove={() => handleRemove(record.id)}
                  onSelect={() => setSelectedId(record.id)}
                  record={record}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title={wishlist.length ? 'No matches on the wall.' : 'Your wall is empty.'}
              copy={
                wishlist.length
                  ? 'Try a different filter, or add a new record from search.'
                  : 'Search for an album and choose a result to start the wall.'
              }
            />
          )}
        </section>

        <aside className="side-rail">
          <SearchPanel
            catalogError={catalogError}
            catalogLoading={catalogLoading}
            catalogQuery={catalogQuery}
            catalogResults={catalogResults}
            onAddResult={handleAddResult}
            onQueryChange={setCatalogQuery}
            statusMessage={statusMessage}
          />
          <Spotlight record={selectedRecord} />
        </aside>
      </section>
    </main>
  )
}

function RecordCard({
  index,
  isDragging,
  isDragTarget,
  isNew,
  isSelected,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onRemove,
  onSelect,
  record,
}) {
  return (
    <article
      className={`record-card${isSelected ? ' is-selected' : ''}${
        isDragging ? ' is-dragging' : ''
      }${isDragTarget ? ' is-drag-target' : ''}${isNew ? ' is-new' : ''}`}
      draggable
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
      role="listitem"
    >
      <button className="record-main" type="button" onClick={onSelect}>
        <span className="rank-badge">#{String(index + 1).padStart(2, '0')}</span>
        <AlbumDisplay record={record} size="card" />
        <span className="record-copy">
          <strong>{record.album}</strong>
          <span>{record.artist || 'Unknown artist'}</span>
          <span>
            {record.year || 'Year unknown'}
            {record.genre ? ` - ${record.genre}` : ''}
          </span>
        </span>
      </button>

      <div className="record-actions">
        <a
          href={record.amazonUrl || buildAmazonSearchUrl(record)}
          target="_blank"
          rel="noreferrer"
          referrerPolicy="no-referrer"
        >
          Amazon
        </a>
        <a
          href={buildBeatnikSearchUrl(record)}
          target="_blank"
          rel="noreferrer"
          referrerPolicy="no-referrer"
        >
          Beatnik
        </a>
        <a
          href={buildThirdEarSearchUrl(record)}
          target="_blank"
          rel="noreferrer"
          referrerPolicy="no-referrer"
        >
          Third Ear
        </a>
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      </div>
    </article>
  )
}

function SearchPanel({
  catalogError,
  catalogLoading,
  catalogQuery,
  catalogResults,
  onAddResult,
  onQueryChange,
  statusMessage,
}) {
  return (
    <section className="search-panel">
      <div className="panel-heading panel-heading--stacked">
        <p className="eyebrow">Search and add</p>
        <h2>Find a record</h2>
      </div>

      <label className="search-field">
        <span className="sr-only">Search the album catalog</span>
        <input
          type="text"
          value={catalogQuery}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search artist or album..."
          autoComplete="off"
        />
      </label>

      {catalogQuery.trim() ? (
        <div className="result-list" role="listbox" aria-label="Album results">
          {catalogLoading ? <p className="result-status">Searching...</p> : null}
          {!catalogLoading && catalogError ? (
            <p className="result-status is-error">{catalogError}</p>
          ) : null}
          {!catalogLoading && !catalogError && catalogResults.length
            ? catalogResults.map((result) => (
                <button
                  key={result.id}
                  className="result-option"
                  type="button"
                  onClick={() => onAddResult(result)}
                >
                  <CoverThumb record={result} />
                  <span>
                    <strong>{result.album}</strong>
                    <span>{result.artist || 'Unknown artist'}</span>
                    <span>
                      {result.year || 'Year unknown'}
                      {result.genre ? ` - ${result.genre}` : ''}
                    </span>
                  </span>
                </button>
              ))
            : null}
          {!catalogLoading && !catalogError && !catalogResults.length ? (
            <p className="result-status">No matches yet.</p>
          ) : null}
        </div>
      ) : (
        <p className="search-hint">Type to open album results.</p>
      )}

      <p className="status-line">{statusMessage}</p>
    </section>
  )
}

function Spotlight({ record }) {
  return (
    <section className="spotlight-panel" aria-label="Featured record">
      <div className="panel-heading panel-heading--stacked">
        <p className="eyebrow">Featured record</p>
        <h2>Side A Spotlight</h2>
      </div>

      {record ? (
        <article className="spotlight-content">
          <AlbumDisplay record={record} size="spotlight" />
          <div className="spotlight-copy">
            <p className="artist-kicker">{record.artist || 'Unknown artist'}</p>
            <h3>{record.album}</h3>
            <div className="tag-row">
              <span>{record.year || 'Year unknown'}</span>
              <span>{record.genre || 'Genre TBD'}</span>
            </div>
            <p>
              {record.notes ||
                'No notes yet. This space keeps the cover and album details front and center.'}
            </p>
          </div>
          <div className="store-links" aria-label="Search record stores">
            <a
              className="primary-link"
              href={record.amazonUrl || buildAmazonSearchUrl(record)}
              target="_blank"
              rel="noreferrer"
              referrerPolicy="no-referrer"
            >
              Amazon
            </a>
            <a
              href={buildBeatnikSearchUrl(record)}
              target="_blank"
              rel="noreferrer"
              referrerPolicy="no-referrer"
            >
              Beatnik
            </a>
            <a
              href={buildThirdEarSearchUrl(record)}
              target="_blank"
              rel="noreferrer"
              referrerPolicy="no-referrer"
            >
              Third Ear
            </a>
          </div>
        </article>
      ) : (
        <EmptyState
          title="Ready for the first record."
          copy="Search the catalog and add a match to spotlight it here."
        />
      )}
    </section>
  )
}

function AlbumDisplay({ record, size }) {
  return (
    <span className={`album-display album-display--${size}`} aria-hidden="true">
      <span className="vinyl-disc">
        <span className="vinyl-label"></span>
      </span>
      <CoverThumb record={record} />
    </span>
  )
}

function CoverThumb({ record }) {
  return record.coverUrl ? (
    <img
      className="cover-thumb"
      src={record.coverUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="cover-thumb cover-thumb--fallback">
      {record.album?.slice(0, 1) || '?'}
    </span>
  )
}

function MiniRecord({ coverUrl = '', label = '', variant = 1 }) {
  return (
    <span className={`mini-record mini-record--${variant}`} aria-hidden="true">
      <span>
        {coverUrl ? <img src={coverUrl} alt="" referrerPolicy="no-referrer" /> : label}
      </span>
    </span>
  )
}

function EmptyState({ title, copy }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  )
}

function reorderVisibleRecords(records, visibleIds, sourceId, targetId) {
  const visibleIdSet = new Set(visibleIds)
  const visibleRecords = records.filter((record) => visibleIdSet.has(record.id))
  const sourceIndex = visibleRecords.findIndex((record) => record.id === sourceId)
  const targetIndex = visibleRecords.findIndex((record) => record.id === targetId)

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return records
  }

  const nextVisible = [...visibleRecords]
  const [movedRecord] = nextVisible.splice(sourceIndex, 1)
  nextVisible.splice(targetIndex, 0, movedRecord)

  let nextIndex = 0
  return records.map((record) => {
    if (!visibleIdSet.has(record.id)) {
      return record
    }

    const nextRecord = nextVisible[nextIndex]
    nextIndex += 1
    return nextRecord
  })
}

export default App
