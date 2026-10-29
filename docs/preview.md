# Public review preview

The preview is one static, server-rendered HTML file from `/digest/2026-10-28`, using only
this repository's read-only sample `runs/`. It is not the live lane. Follow ADRs 0001 and 0003;
issue #6 is not done until the public HTTPS link and plan issues reach the reviewer.

## Capture locally

From the repository root, with Node 24 and the pinned pnpm 12.16.1:

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
corepack pnpm typecheck
corepack pnpm exec tsx --env-file-if-exists=.env scripts/capture-preview.ts
```

The command creates the real Hono application and calls `app.request()` for the same SSR
route used by the service. It runs the page handler in-process: **no listening socket, live
HTTP request, heartbeat, or server restart**. This is a command capture of the service's
response, not a duplicate template or browser “save as”. It fails closed until the digest
route exists and returns a complete, successful HTML response with its lane banner.

Output defaults to ignored `previews/index.html`. An optional output argument must name an
`.html` file directly inside that repository's `previews/`; traversal outside it, nested
paths, symlink directories/files and hard-linked files are rejected. The capture always
uses the sample runs even if local `rig.json` points elsewhere. Files are written with mode
0600; no response body, environment values or marker are printed. Validation rejects
scripts, event handlers, resource tags, CSS asset loads and refresh redirects. Review the
rendered content before uploading; the checks are a guard for this trusted SSR template,
not a general-purpose sanitizer for arbitrary HTML.

## Secret and data boundaries

- Keep the issued public-designated marker in ignored `.env` / the process environment only
  for local capture, or in the GitHub repository Actions secret `LANE_MARKER` for publication.
  Do not put it in workflow inputs, Git, issues, command arguments, logs, screenshots or
  attachments. The marker is intentionally visible on the temporary public page; it is not
  an authentication credential. Never supply credentials as marker values.
- The workflow has no `.env` file and injects `LANE_MARKER` only into the capture step. Its
  `include_marker` boolean defaults to `false`. A requested marker publication with a missing
  or blank secret fails instead of silently publishing an unmarked review copy.
- Only the ignored `previews/` directory is uploaded, and the workflow requires it to contain
  exactly `index.html`. No run logs, `.env`, source tree, environment dump or hidden files
  are included. Capture writes private-mode files; the publication step changes only the
  selected HTML to 0644 and its directory to 0755 for static hosting. Do not add preview
  HTML or the marker to Git even temporarily.
- Do not share a marked artifact download URL. Share only the replaceable Pages HTTPS URL.
  Removing an artifact is not removal of a deployed page, and neither erases third-party
  browser caches or copies. The marker must not be relied on as a secret after publication.

## Publish (operator approval required)

1. Review and merge the implementation on the default branch, including the generated
   page's sample-only content and escaping. Configure Pages to use **GitHub Actions** and
   the `github-pages` environment to allow only the reviewed default branch; add required
   reviewer protection if available. This workflow does not create or enable a site.
2. Store the marker via the repository's encrypted secret UI or approved private injection,
   never a shell argument. The operator owns this step; no credentials are part of this repo.
3. After approval, manually dispatch **Publish review preview** on the default branch with
   `include_marker=true`. There are no push, pull-request or fork triggers. Dispatches from
   other refs are skipped. Treat edits to this workflow and capture code as privileged:
   review them before dispatching with a marker.
4. Wait for build, deploy **and cleanup** to succeed. All actions are pinned to reviewed
   commit SHAs. Build has only `contents: read`; deploy has `pages: write` and
   `id-token: write`; the separate cleanup job alone has `actions: write`. Checkout does
   not persist its token. Installation uses the frozen lockfile and disables lifecycle
   scripts; no dependency cache containing generated previews is saved.
5. Verify the reported environment URL is a public HTTPS host (not an IP or localhost),
   the response is the intended self-contained digest, and the banner contains the expected
   marker. Do not log the page or marker while verifying. Send that URL and the issue links
   to the reviewer. Record URL, workflow run, reviewed commit, result and issue delivery,
   not a copy of marked HTML.

Only one workflow runs at a time; it is not cancelled by newer dispatches. Avoid manual
cancellation while the marked copy is awaiting cleanup.

### Artifact removal

The Pages upload uses `retention-days: 1`. After successful deployment, cleanup waits at
least five seconds and deletes **only that upload's artifact ID** using:

```text
DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
Expected response: 204 No Content
Required repository permission: Actions (write)
```

Contract: <https://docs.github.com/en/rest/actions/artifacts#delete-an-artifact>.
The upload action supplies `artifact_id`; there is no repository-wide search or delete.
This endpoint does **not** delete the Pages site. If deployment, cleanup or the workflow
fails/is cancelled, the artifact may remain until its one-day expiry. Inspect the run and,
with approval, remove that exact artifact via the same endpoint (wait at least five seconds
between GitHub API actions); do not retry an ambiguous write without reconciliation.
Artifact expiry never replaces the marker-cleanup step below.

## Replace after review (issue #7)

After the reviewer responds and replacement is approved, dispatch the same workflow on the
same default branch with **`include_marker=false`**. It explicitly supplies an empty marker,
so capture cannot inherit one. For local inspection without reading `.env`:

```sh
LANE_MARKER= corepack pnpm exec tsx scripts/capture-preview.ts
```

The new HTML must say **“no marker set”**. Deploy it to the **same Pages URL**; do not delete
the site or change its URL. Wait for all three jobs, then fetch the public URL afresh and
check the unmarked banner and absence of the issued marker without printing either page.
A stale browser/CDN result is not proof of removal: wait and recheck before closing #7.
Record verification and retire the marker secret when no longer needed. Never close
cleanup on the strength of a successful build or artifact deletion alone.

## Rollback

Keep the current site if capture, tests or deployment fail; investigate before retrying.
If a deployed preview is wrong, prefer a reviewed fix or revert on the default branch and
manually re-render/redeploy **without** the marker to the same URL. Do not recover from old
marked artifacts or commit a backup HTML copy. The workflow only accepts default-branch
code, so an arbitrary old-ref dispatch is deliberately not a rollback mechanism. Public
HTTP/banner verification is required after rollback as after replacement.
