# Fork notes: adex Mastra Studio

This repository (`heyAuraDev/mastra-studio-admin`) is a fork of [`mastra-ai/mastra`](https://github.com/mastra-ai/mastra). The only thing it ships is the **Studio UI** (`packages/playground`), embedded in an iframe in the adex-mega-app admin panel. The fork is a thin layer on top of upstream; keep it thin, so every upstream sync stays a merge with a handful of conflicts.

Read this before syncing with upstream or touching any file listed below.

## Branches

| Branch     | What it is                                                                              |
| ---------- | --------------------------------------------------------------------------------------- |
| `deploy`   | The fork: upstream `main` plus the custom layer. All fork work lands here, through PRs. |
| `gh-pages` | Build output published by the deploy workflow. Never edit it by hand.                   |
| `main`     | A stale mirror of upstream (April 2026). Neither deploy uses it; don't base work on it. |

Pushing or merging into `deploy` immediately deploys to GitHub Pages, so changes go through a `sync/...` or feature branch and a PR with base `deploy`.

## The custom layer (the whole fork diff)

`git diff upstream/main origin/deploy --stat -- . ':!.agents' ':!.codex'` should list only these files. If anything else shows up, it is either new fork work (add it here) or a bad merge.

| File                                                                                                         | Purpose                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/playground/src/domains/configuration/context/studio-config-context.tsx`                            | **Iframe auth.** A `message` listener (marked `[adex fork]`) takes `{ type: 'localStorage-sync', baseUrl?, headers? }` from the admin panel, merges it into the Studio config and persists it to localStorage (`mastra-studio-config`).                              |
| `packages/playground/src/domains/configuration/context/__tests__/studio-config-context-iframe-sync.test.tsx` | Tests for that listener (MSW, stubs `GET /api/auth/capabilities`).                                                                                                                                                                                                   |
| `packages/playground/vite.config.ts`                                                                         | `studioStandalonePlugin` takes an options object and also runs on **production** builds, baking every `%%MASTRA_*%%` placeholder in `index.html` from env vars (upstream leaves them for the Mastra server to fill at runtime). Fork parts are marked `[adex fork]`. |
| `.github/workflows/deploy-studio-ghpages.yml`                                                                | On push to `deploy`: builds Studio and publishes `packages/playground/dist` to `gh-pages`. Uses upstream's `./.github/actions/setup-pnpm-node`, so Node and pnpm follow upstream.                                                                                    |
| `Dockerfile`, `.dockerignore`, `docker/studio/nginx.conf`, `docker/studio/docker-compose.yml`                | **Docker UI image** (published to Docker Hub; built outside this repo's CI). Builds Studio, serves `dist` with nginx (SPA fallback to `index.html`).                                                                                                                 |
| `package.json`                                                                                               | One extra script: `dev:studio`.                                                                                                                                                                                                                                      |
| `FORK.md`, the pointer at the top of `AGENTS.md`                                                             | These notes.                                                                                                                                                                                                                                                         |

`.agents/skills/*` and `.codex/migrate-to-codex-report.txt` are leftovers from an earlier Codex-driven sync. They do nothing; deleting them is fine.

The iframe message format is a contract with the adex-mega-app admin panel. Don't change it without changing that app too. Upstream's own `?auth_header=` URL handoff (since June 2026) is separate and coexists with it.

## Syncing with upstream

1. **Remote and branch.**

   ```bash
   git remote add upstream https://github.com/mastra-ai/mastra.git   # once
   git fetch upstream main --no-tags
   git fetch origin
   git switch -c sync/upstream-YYYY-MM-DD origin/deploy
   git merge --no-ff --no-commit upstream/main
   ```

   Merge, don't rebase: `deploy` history is a chain of upstream merges, and the GitHub Pages deploy runs from it.

2. **Resolve the expected conflicts.** Take upstream's version first, then put the fork's part back:
   - `package.json`: keep upstream's scripts and re-add `dev:studio`.
   - `studio-config-context.tsx`: take upstream's file and re-add the `[adex fork]` `useEffect` block before the `return`. Use upstream's storage-key constant (currently `MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY`).
   - `vite.config.ts`: take upstream's file, switch `studioStandalonePlugin` back to the options object, and re-add the production block before the final `return`. Then **compare every `%%...%%` in `packages/playground/index.html` with the plugin's `.replace` list** and add any new ones. Upstream adds placeholders regularly, and a missed one ships as the literal string.

3. **Check what upstream changed under the fork.** Each of these bit the 2026-11 sync:
   - **Node version:** `.github/actions/setup-pnpm-node/action.yaml` pins it (24.22.1 in 2026-11). The Dockerfile's `node:<major>-slim` must match its major. Node 22 fails to build (`rollup-plugin-node-externals` calls `RegExp.escape`).
   - **pnpm:** comes from `package.json#packageManager` everywhere: the action uses it and the Dockerfile runs `corepack install`. Nothing to bump.
   - **Studio status check:** `useMastraInstanceStatus` decides what the iframe test must stub (it was `GET {endpoint}` and is now `GET {endpoint}{apiPrefix}/auth/capabilities`). When the check says inactive, the provider falls back to the stored config, which the iframe listener writes; keep it that way.
   - **Exports that move:** `useStudioConfig` moved to `studio-config-state.ts`; the test imports have to follow.
   - **Docker install scope:** the Dockerfile installs only `@internal/playground...`, `@mastra/server...` and the root. `@mastra/server` is there because `client-sdks/client-js/turbo.json` depends on the task `@mastra/server#generate:route-types`, which pnpm's package graph doesn't see. Look for new cross-package task dependencies: `grep -rn '#' --include=turbo.json client-sdks packages | grep dependsOn`. Only packages in Studio's own dependency tree matter; as of 2026-11 that is just client-js. The `cli` and `mcp-docs-server` hits are outside it. A missing one shows up as `<tool>: command not found` in the build.

4. **Verify.** Use upstream's pinned Node (`nvm install <version>`), from the repository root:

   ```bash
   pnpm install --frozen-lockfile
   MASTRA_SERVER_HOST=probe.example.test pnpm turbo build --env-mode=loose --filter ./packages/playground
   grep -n "%%" packages/playground/dist/index.html          # must print nothing
   grep -n "probe.example.test" packages/playground/dist/index.html   # must match: env reached Vite
   (cd packages/playground && pnpm exec vitest run src/domains/configuration)
   docker build -t studio-sync-test .                          # needs ~10 GB of free Docker disk
   ```

   If Docker is short on space, replay the Dockerfile's `pnpm install --filter ...` and `turbo build` lines on a clean `git archive` copy with the `.dockerignore`d folders removed.

5. **Commit.** The pre-commit hook runs `lint-staged` (oxfmt, plus `oxlint --fix` in some packages) on every staged file, which in a sync is all of upstream. On ~24k files tsgolint crashes, and `--fix` would rewrite upstream code and cause conflicts on the next sync. With the user's OK, commit the merge with `git commit --no-verify`, after running `oxfmt --check` and `oxlint` on the fork-owned files yourself. The hook also needs Node ≥ 22.18. Commit later, small fork-only changes normally.

6. **Ship.** Push `sync/upstream-YYYY-MM-DD` and open a PR with **base `deploy`** in `heyAuraDev/mastra-studio-admin`. The repository is marked as a fork on GitHub, so pass `--repo heyAuraDev/mastra-studio-admin --base deploy` to `gh`. If `gh` lacks PR permission there, give the user the compare URL: `https://github.com/heyAuraDev/mastra-studio-admin/compare/deploy...<branch>?expand=1`. Merging deploys to GitHub Pages. The Docker image is built and pushed to Docker Hub outside this repository, so remind the user to rebuild it.

Don't add a changeset for fork work: the fork never publishes packages, and upstream's `AGENTS.md` changeset rule doesn't apply here.

## Gotchas

- **Turbo hides env vars.** Turbo runs tasks in strict env mode, so `MASTRA_SERVER_*` and the like never reach Vite unless the build runs with `--env-mode=loose`. The Dockerfile uses it. The GitHub Pages workflow does **not** (as of 2026-11), so the live gh-pages build bakes in `localhost:4111` and relies entirely on the iframe message for its server URL.
- **Server URL shape.** Studio calls `${MASTRA_SERVER_PROTOCOL}://${MASTRA_SERVER_HOST}:${MASTRA_SERVER_PORT}${MASTRA_API_PREFIX}`. The host is a bare hostname: no protocol, no path. A path such as `/mastra/api` goes in `MASTRA_API_PREFIX`.
- **Baking a real server URL changes startup.** Studio then calls the server before the iframe's auth headers arrive.
- **Upstream workflows.** All of upstream's GitHub workflows come along with each sync. Only `deploy-studio-ghpages.yml` matters to the fork.

## Open issues (known, not fixed yet)

- The iframe listener doesn't check `event.origin`. Any window that can post to Studio can change its server URL, and a `baseUrl`-only message sends the stored `Authorization` header to that server. An allowlist of the admin panel's origin would fix it.
- The listener `console.log`s the incoming message and the resulting config, bearer token included.

## Sync log

| Date       | Upstream commit | Notes                                                                                                                                                                               |
| ---------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-26 | `4dbeea2bc6`    | Codex-driven; left the `.agents` / `.codex` files.                                                                                                                                  |
| 2026-11-23 | `a6e1215000`    | 8,462 commits. Node 24 / pnpm 11. Workflow moved to upstream's setup action. Dockerfile: scoped install, `--env-mode=loose`, nginx SPA config, `$BUILDPLATFORM`. These notes added. |
