# OpenDirector for Windows — Flagship Desktop Client

OpenDirector for Windows builds directly on upstream `ThinkFlowLab/OpenDirector` (`#362` Desktop RFC) to deliver a native Windows 10/11 omni-domain AI video & storyboard creation studio.

## Highlights

- **Windows 10/11 Native Shell (`apps/desktop/`)**:
  - Fluent Windows `titleBarOverlay` synchronized with theme, persistent multi-monitor window bounds (`window-state.mjs`), single-instance focus & deep-link routing (`opendirector://project/<id>` and `.odcanvas` file association).
  - Native Windows Taskbar progress overlay during MP4 timeline export, system tray + minimize-to-tray, `powerSaveBlocker` during active exports, Windows Jump List (Recent Projects / New Project), and native completion toast notifications.
  - Multi-window project editing (open projects in dedicated Windows desktop windows via `ProjectSelector` or `Ctrl+N`).
  - Automatic update checker (`D5 / #367`) with SemVer comparison against GitHub Releases and one-click release notes / download.
  - Built-in redacted Support Diagnostics Bundle (`Help -> Copy Diagnostics Summary`).
  - Atomic `opendirector.cmd` CLI installation into `%LOCALAPPDATA%\OpenDirector\bin` with automatic User `PATH` registration and collision protection (`#475`).
- **Import Media by Reference (`#473`)**:
  - Zero-copy linking of large local video/image/audio files without duplicating gigabytes into the project folder.
  - Full HTTP `Range` (`206`) streaming directly from the external source file.
  - Live availability detection (`Online`, `Offline`, `Changed`), SHA-256 verified **Relink** after drive/folder moves, and one-click **Consolidate** into managed storage for portable project archiving.
- **Bidirectional System Clipboard (`#474`)**:
  - `Ctrl+C` on text or image canvas nodes writes plain Unicode text or native Windows PNG/DIB bitmaps directly to the OS clipboard while keeping internal canvas node copy/paste intact, with clear fallback guidance for raw video nodes on Web.
- **OpenCode-Class Agent Harness**:
  - **Build / Plan Mode Toggle**: Plan mode enforces a real server-side `403 plan_mode_read_only` write lock so the Agent can design storyboards and critique compositions without touching a single canvas node.
  - **Round Review & One-Click Undo Ledger**: Every Build turn captures an authoritative canvas diff (`+added / ~updated / -removed`) and supports atomic LIFO `history.undo` rollback in one click.
- **One-Click Production Workflow Templates**:
  - 4 curated bilingual pipelines (*Short Film Storyboard*, *Product Commercial*, *Character-Consistent Series*, *Music Beat Reel*) inspired by Dreamina Story Mode and TapNow recipes.
- **v0.3 Ultimate Flagship Additions**:
  - **Global Director Command Palette (`Ctrl+K`)**: OpenCode-grade bilingual fuzzy-search keyboard harness (`src/canvas/CommandPalette.tsx`) for projects (including multi-window launch), Director Storyboard Sheet, templates, Reference Media, Agent Plan/Build switching, Desktop Health Center, bilingual/theme toggles, updater, and diagnostics.
  - **Director Storyboard Sheet (`src/canvas/StoryboardSheetDialog.tsx`)**: Structured editable multi-shot storyboard matrix (shot title, camera move, visual prompt, duration, voiceover/SFX) that scaffolds a master script node, connected shot nodes, and an assembly timeline node in one click.
  - **Reference Media Canvas Integration (`#473`)**: One-click **Place on canvas** directly from the Reference Media dialog plus a live topbar **Linked / Offline** status pill with click-to-relink.
  - **Full Bidirectional Windows Media Clipboard (`#474`)**: `Ctrl+V` pastes Windows `Win+Shift+S` / OS clipboard screenshots straight into the canvas; `Ctrl+C` copies text scripts, raster images, and native video/audio files via Windows `CF_HDROP` (`GET /api/creation/projects/{id}/assets/{id}/local-path` + Electron `clipboardWriteFile`).
  - **Windows Desktop Runtime Health Center & Agent Observability (`#476` / `#481`)**: Real-time diagnostics dialog backed by `GET /api/desktop/runtime-health` (Python Host, FFmpeg engine, WebCodecs H.264, D5 updater, sanitized diagnostics copy) plus per-turn Agent duration, tool call count, and estimated cost metrics in the Round Review bar.
- **v0.4 / v0.5 Omni-Studio Ecosystem Upgrades**:
  - **One-Click Virtual Film Crew (`VirtualCrewDialog.tsx` + `virtualCrew.ts`)**: Plain-language story box → 12 film style cards, `16:9`/`9:16`/`1:1` aspect ratio picker, and one-click **Auto-Direct** → Writers' Room self-review score & one-click patches → Casting/Art Bible (`@Character`/`@Location`/`@Prop` + voice bindings) → 1-click full canvas + timeline deployment.
  - **Cinema Director Camera/Lighting Studio & Smart Prompt Optimizer (`DirectorCameraDialog.tsx` + `cameraPresets.ts` + `promptStudio.ts`)**: 18 stackable camera moves (up to 3), ARRI/RED/Sony/Kodak/IMAX bodies, 6 cinema lenses, 6 lighting moods, 8-point key-light dial, plus 7-mode Prompt Optimizer (Cinematic, Character Lock, Physics & Lighting, Kling/Veo/Seedance/FLUX adapters) with automatic Negative Quality Guards.
  - **Local FFmpeg Smart Video Breakdown, Tail-Frame Extract & Zero-Cost Post (`media_probe.py` + `VideoBreakdownDialog.tsx`, `#487`)**: Local `ffprobe`/`ffmpeg` inspection, automatic scene-cut storyboard extraction, exact tail-frame capture for seamless continuation, and zero-API-cost local transforms (`reframe_9x16`, `reframe_16x9`, `cfr_24`, `film_grain`, `reverse`) with automatic cross-platform FFmpeg discovery (`PATH`, `OPENDIRECTOR_FFMPEG_PATH`, `~/bin`, `.toolchain`, `imageio-ffmpeg`) and `CREATE_NO_WINDOW` on Windows.
  - **Multi-Branch A/B Compare Lab (`MediaCompareDialog.tsx`)**: One-click 3-branch A/B/C experiment spawner, Split-Slider image compare, side-by-side video review, and one-click winner star tagging.
  - **Production Studio (`ProductionStudioDialog.tsx` + `nle_export.py` + `workflowRecipe.ts`)**: Unified `@Character`/`@Location`/`@Prop` Production Bible editor, industry NLE export (**Premiere Pro / DaVinci Resolve / CapCut FCP7 XML**, frame-accurate **`.srt`**, printable client **Pitch Deck HTML**), Project Budget Guard (`#481`), and credential-free **`.odflow.json`** workflow recipe export/import.

## Quick Start (One-Command Local Launch)

After pulling this branch locally:

### Windows (PowerShell)
```powershell
.\scripts\start-local.ps1
```

### macOS / Linux
```bash
./scripts/start-local.sh
```

The launcher automatically checks Python 3.11+, Node.js 22+, creates `.venv` if missing, installs `imageio-ffmpeg` automatically if system `ffmpeg` is absent, starts the persistent local FastAPI backend on `http://127.0.0.1:8000` and Vite Studio on `http://127.0.0.1:5173`, and opens your browser.

## Local Development & Packaging (Windows x64)

```powershell
# 1. Install frontend + desktop dependencies
npm ci
npm ci --prefix apps/desktop

# 2. Verify all tests & bilingual i18n
npm run build
npm run check:i18n
npm test
npm test --prefix apps/desktop
python -m pytest tests/test_media_probe_and_nle.py tests/test_desktop_host.py tests/test_reference_assets.py tests/test_agent_plan_and_undo.py tests/test_layer_boundary.py -q

# 3. Prepare bundled runtime (Python + FFmpeg + Vite UI) and build Windows NSIS installer
npm run prepare:runtime --prefix apps/desktop
npm run pack:windows --prefix apps/desktop
```
