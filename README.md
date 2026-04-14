# After Credits

Local web app for exploring your latest Letterboxd watches and getting similar movie recommendations.

## What it does

- Imports your exported Letterboxd `diary.csv` or `watched.csv`
- Sorts by most recently watched and shows the latest entries as an interactive wall
- Matches those films against TMDb for posters, backdrops, and metadata
- Fetches TMDb recommendations and similar titles when you click a movie
- Filters out titles that already appear in your imported watch history

## Why this uses exports instead of the Letterboxd API

This project is set up for a local personal workflow. Importing your Letterboxd export keeps the app usable without depending on beta API access.

## Setup

1. Create a TMDb account and generate a v4 read access token.
2. Either set the token in a local `.env` file or paste it into the app.
3. Run the app locally:

```bash
npm install
npm run dev
```

4. Export your Letterboxd data and import `diary.csv` or `watched.csv` into the app.

### Optional `.env`

```bash
VITE_TMDB_READ_ACCESS_TOKEN=your_tmdb_v4_read_access_token
```

## Notes

- The token is stored in `localStorage` if you paste it into the UI.
- Matching works best when your export includes an IMDb ID, but plain title + year searches are supported too.
- TMDb metadata, posters, and recommendation links are used for the discovery side of the app.
