# docs/rea-evidence — REA CLI evidence export

## What was produced

1. **`rea-inspect-artifact.json`** (1,404,630 bytes) — a canonical REA **Evidence record** produced by:
   ```
   rea inspect-artifact docs/raw/desktop/ParakeetAI-3.9.126-universal-mac.zip --format json
   ```
   exit code 0. Envelope fields: `predicate_type: "rea.analysis"`, `provider.id: "rea-artifact-graph"`, provider version 1,
   `operation: "inspect_artifact"`.
   **Evidence IDs (cite these):**
   - `ev_14a1a121ebd69549f58b44eca2fd529074d9fbd0894fe6cf105f45e0e9ae8de2` — subject = the downloaded macOS universal zip, `subject.digest.sha256 = 72b894d1b8076dc5def3340591588ae228c52d67e58133672c0438651345dfa4` (matches the GitHub release asset digest; the artifact graph therefore verified provenance).
   - `ev_3c80498c904494e41bd0d766938f4ca12e5d0ad267ce7cff872e3a2d5e6ec597` — nested record in the same envelope.
   - `normalized_result.inspection_id = ai_b9aeba7987771fd07bee57f4d0fe1bc5038b4592b61e801a99c96bc4e042a61f`
   - `normalized_result.subject.manifest_id = agm_135ef98ec8e7f9cb62d55f986b3c84638f2…` (3 manifest ids in file)

2. **`artifact-hashes.md`** — SHA-256 table for every artifact cited in `docs/TARGET_VERIFIED.md`.

## Why there is no `evidence-bundle.json`

`rea evidence-export docs/rea-evidence/rea-inspect-artifact.json docs/rea-evidence/evidence-bundle.json --overwrite` **fails by design**:

```
code: evidence_integrity_mismatch
message: "Expected an Evidence bundle with records and manifest arrays, but this JSON is one Evidence
          record (ev_14a1a121...). Export a session bundle with the MCP export_evidence_bundle tool
          and supply that file."
```

The bundle format requires a **session** bundle (records + manifest arrays) that only the REA **MCP tool `export_evidence_bundle`** emits. The `mcp__rea__*` tools are not present in this session (the CLI is installed globally, the MCP server is not registered for this client), so the bundle cannot be produced from here. The canonical Evidence record above is the strongest export the CLI can make, and its `evidence_id` is stable and citable.

## Why deep (native/binary) REA analysis was not possible

`rea analyze docs/raw/desktop/.../parakeetai-native.win32-x64-msvc.node --format json` → **exit 1**:

```
code: provider_unavailable, category: unavailable
details.candidate_ids: ["ghidra","hopper","ida"]; all rejected "not_configured"
rejections[0]: ghidra — "Set GHIDRA_INSTALL_DIR to an extracted Ghidra 12.1.x release directory."
```
(full envelope: `rea-analyze-native-win32.json`)

`rea analyze-javascript-application <app.asar>` was started with `--analysis-timeout-ms 120000 --max-heap-mb 2048` and, after ~15 minutes, had emitted only the first progress event (`phase: analyze_javascript_application, completed: 0, total: 1, "Inventorying and parsing application artifacts"`) and **zero bytes** of output; it was stopped on the timebox. No partial Evidence was retained by the CLI.

`rea doctor --client dsh --json` → `VALIDATION_ERROR: Unsupported agent integration` (the CLI has no `dsh` client id; `rea setup --client dsh` would be rejected the same way). `rea doctor --target <app>` and `rea capabilities` work but require no evidence.

**Consequence:** rows T-01…T-16 cite raw file paths + byte offsets (and the two `ev_*` ids where the artifact graph applies), not per-mechanism REA evidence ids. Every byte offset is reproducible with the grep script `docs/raw/_scripts/grep-desktop.mjs`.
