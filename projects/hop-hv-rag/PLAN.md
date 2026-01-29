# Plan: Improve Thumbnail Serving and URL Handling

This plan outlines the steps to refactor how thumbnails are served and how URLs are handled in the `hop-hv-rag` application. The goal is to improve security, performance, and developer experience by removing hardcoded absolute URLs and using a proxy for local development.

## 1. Frontend Configuration (`packages/ui/vite.config.ts`)

Configure Vite to proxy API and thumbnail requests to the backend server during development. This avoids CORS issues and allows the frontend to use relative URLs, making the build more production-ready.

- [ ] Update `vite.config.ts`:
    - Add a `proxy` configuration to `server`.
    - Proxy `/api` to `http://localhost:3200`.
    - Proxy `/thumbnails` to `http://localhost:3200`.
    - Ensure `changeOrigin: true` is set for both.

## 2. Frontend Logic (`packages/ui/src/hooks/useArchivistQuery.ts`)

Update the API client to use relative URLs, leveraging the new proxy configuration.

- [ ] Update `useArchivistQuery.ts`:
    - Change the `fetch` URL from `http://local.gnarlybox-ai:3200/api/query` to `/api/query`.
    - Ensure thumbnail URLs from the API are treated as relative paths (which they already are in the DB).

## 3. Backend Server (`packages/search/src/server.ts`)

Enhance the thumbnail serving endpoint to be more secure and performant.

- [ ] Update `/thumbnails/*` route handler:
    - **Security**: Sanitize the incoming path parameter to remove `..` segments, preventing directory traversal attacks.
    - **Performance**: Update `Cache-Control` headers to `public, max-age=31536000, immutable` since thumbnail content is static.
    - **Cleanup**: Remove verbose `console.log` statements for successful thumbnail requests to reduce log noise.

## 4. Backend RAG Logic (`packages/search/src/rag-query.ts`)

Simplify the RAG query logic by removing unnecessary URL construction.

- [ ] Refactor `FamilyArchivist` class:
    - Remove the `SERVER_BASE_URL` constant.
    - Remove logic that prepends `SERVER_BASE_URL` to the `thumbnailPath`.
    - Simply pass through the `thumbnailPath` from the database (e.g., `/thumbnails/...`).

## Context

- **Database**: The `scenes` table already contains relative paths like `/thumbnails/1996-97-1/1_00450.jpg`.
- **Data Directory**: Thumbnails are stored in `projects/hop-hv-rag/data/thumbnails`.
- **Current State**: Hardcoded absolute URLs (`http://local.gnarlybox-ai:3200`) are used in both frontend and backend.
