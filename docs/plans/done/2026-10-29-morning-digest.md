---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Completed outcomes

The task sections above are preserved as historical requirements. The implementation,
review, and same-link marker cleanup are complete; verification is recorded below.
Plan completion is distinct from the course's final claim acceptance.

| Section | Issue | Outcome |
|---------|-------|---------|
| 1. Run log reader | [#1](https://github.com/MMZ993/mega-s01e04-rig/issues/1) | Implemented the shared digest types and run-log reader, with malformed-line handling and reader tests. |
| 2a. Page | [#2](https://github.com/MMZ993/mega-s01e04-rig/issues/2) | Added the server-rendered digest page, sorted jobs, status highlighting, missing-night and empty-night handling. |
| 2b. JSON | [#3](https://github.com/MMZ993/mega-s01e04-rig/issues/3) | Added the JSON digest endpoint using the same reader and ordering as the page. |
| 2c. Board link | [#4](https://github.com/MMZ993/mega-s01e04-rig/issues/4) | Added night-to-digest links and ok / retry / fail counts on the board. |
| 2d. Route tests | [#5](https://github.com/MMZ993/mega-s01e04-rig/issues/5) | Added route coverage for successful, missing, empty and malformed-line nights using temporary fixtures. |
| 3. Preview for review | [#6](https://github.com/MMZ993/mega-s01e04-rig/issues/6) | Published the static HTTPS preview and sent its link and plan issues for review; the reviewer confirmed seeing it. |
| 4. Clean up | [#7](https://github.com/MMZ993/mega-s01e04-rig/issues/7) | Replaced the same public preview with an unmarked copy, verified its HTTP response and banner, and archived this plan with all issue links. |

### Human approval and publication lifecycle

The user approved replacing the preview with an unmarked copy at the same link. After
confirming that the preview had been seen, the reviewer explicitly requested marker removal,
plan completion and the same answer again. The coordinator completed the unmarked replacement
workflow and verified the public result. No preview HTML or marker value is stored in this archive.

### Cleanup verification

- Workflow [40827973337](https://github.com/MMZ993/mega-s01e04-rig/actions/runs/40827973337)
  completed successfully, including deployment and temporary artifact cleanup.
- At 2026-10-29T06:15:20Z, the unchanged public URL
  <https://mmz993.github.io/mega-s01e04-rig/> returned HTTP 200 and was byte-identical to the
  locally regenerated HTML with `LANE_MARKER` unset.
- The issued marker was absent and the banner read "no marker set". Browser verification
  also showed that banner, five data rows, and no scripts.
- Final answer handoff: after publishing this archive, send the same repository and preview
  URLs for course acceptance. Do not infer acceptance from deployment or plan status alone.
