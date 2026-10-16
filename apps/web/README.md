# Faultline Lab web console

The investigation console is a React + Vite + TypeScript single-page app. It
uses a small utility-style CSS layer in `src/styles.css` (class names follow
Tailwind's composable utility spirit) to keep the offline demo dependency
footprint small; no Tailwind build step is required.

```sh
npm install
npm run dev
# open http://localhost:4173
npm run build
npm test
```

Set `VITE_API_BASE_URL` to the API origin to use the API boundary. The client
requests the incident summary and opens `GET /api/incidents/:id/events` as an
`EventSource` when configured. If the API cannot be reached, deterministic
cached demo data is shown with a visible **Cached demo** badge.
