# Changelog

All notable changes to ChatGLM are listed here, newest first. Versions follow the `version:` field in `src/header.ts`.

---

## [2.1.0]

### Chapters from UCCDS

When the **UCCDS** dependency script is installed and enabled, ChatGLM takes its chapters from it, so they follow the rules (and your own header words) set in UCCDS's Config tab. Without UCCDS, the built-in detection is used exactly as in v2.0.1. The chapter picker shows which source is in use.

- `scripts/build.js` now bundles the UCCDS parser and client from the [latest release of UCCDS](https://github.com/MidMeantime/nai-chapter-detection-uccds/releases/latest) ` plus `src/uccds-bridge.ts`.

### Chat import / export

- **Chat import / export** (`src/transfer.ts`): the toolbar's **Chat** menu (which replaces the Clear button) exports the story's chat as JSON, Markdown or both, copies it to the clipboard as Markdown, imports a JSON export (asking whether to replace or append when the story already has a chat), and still holds Clear. Files are named `ChatGLM - <story> - <date>`. NovelAI asks for file and clipboard permission the first time each one is used. Redo versions are kept for the session only and aren't exported.

### Tests

- `npm test` runs `scripts/test.js` (26 tests, no UCCDS) and `scripts/test-uccds.js` (5 tests next to the real UCCDS script).

---

## [2.0.0]

A modular, sidebar-based writing assistant, manuscript workshop, and developmental editor for [NovelAI](https://novelai.net/).

This entry outlines the major architectural, structural, and feature changes introduced between **v1.1.0** and **v2.0.0**.

### High-Level Comparison Summary

| Feature / Area | v1.1.0 | v2.0.0 |
| :--- | :--- | :--- |
| **Architecture** | Monolithic single file (`918` lines, ~40 KB) | Modular, strictly typed TypeScript in `src/` (~120 KB built) via `scripts/build.js`, type-checked with `tsc --strict` on every build |
| **Script Configuration** | Hardcoded prompts in script; modal edit dialog | Native YAML frontmatter config (`system_prompt_*`, custom models, break tokens) |
| **Instruction Models & Personas** | Fixed 2 hardcoded modes (Assistant & Architect) | Assistant, Architect + up to **5 Custom Models/Personas** selectable via UI dropup |
| **Context Selection** | Binary: Full Document or Highlighted Selection | **Hierarchy**: Selection > Targeted Chapter(s) (+ optional Prev Chapters) > Full Document |
| **Chapter Detection** | None | The **shared Editorial parser** (same as Chapter Linter / Markdown Manager): Markdown headings, bracketed titles, Roman numerals, number words, Prologue/Interlude/Epilogue, Part/Book/Act; ATTG lines and prose are never chapters |
| **Multi-Chapter Targeting** | None | Multi-chapter selection with checkboxes, individual chapter focus, and previous-context chaining |
| **Lorebook Integration** | None | Category-grouped Lorebook selector; attaches to context top; prioritized retention during truncation |
| **Generation Cancellation** | None (runs until completion) | Full abort support via `createCancellationSignal()` with UI **Stop Generating** button |
| **Streaming UI Performance** | Re-renders panel on every token chunk (laggy) | Repaints only the streaming message (`updateParts`) at most every 100ms; no timers |
| **Chat Storage** | One chat shared by every story | **Per-story chats**: history, chapter picks and lorebook picks are saved with each story (the persona choice stays script-wide) |
| **Context Size Check** | Only checked remaining *output* tokens (huge stories failed and still used tokens) | Counts the real prompt (system prompt + story + whole chat + your message + reply room) before sending, trims the story to fit, and checks both the output and input rate limits. Nothing is sent when it can't fit |
| **Cut-off / Truncation Recovery** | None (user manually prompts to continue) | Automated cut-off heuristic detection + seamless **Continue Response** action |
| **AI Message Redo & History** | None | **Redo** action with interactive **Version Carousel** (`◀ 1/3 ▶`) and per-version model tracking |
| **User Message Actions** | None | **Edit & Retry** (restores prompt into input bar) & **Delete** with confirmation modals |
| **Individual Message Deletion** | Clear all only | Delete individual AI responses or user messages (+ subsequent thread context) |
| **Testing & CI** | No tests | `scripts/test.js` runs the real built script against a mock NovelAI story (19 tests: context formats, size checks, rate limits, streaming, stop, redo, per-story storage, UI contract) |

### Fixes from the v2.0 health check

These were found in the v2.0 preview build and fixed before launch:

- **Reported v1.1.0 bugs**: the prompt is now sized right before sending (your actual message included, not an estimate), so oversized stories are trimmed instead of failing, a chat too long to fit is refused *before* any tokens are used, and the input always unlocks afterwards. Instruct now tells NovelAI to leave room for the chat (`contextLimitReduction`), and Compact keeps the newest messages that fit, so it works even on a chat too long to send.
- **Streaming crash**: the throttle used the global `setTimeout`, which doesn't exist in NovelAI's script worker.
- **Rate limits**: both the output and the *uncached input* limits are checked; long waits are reported instead of silently spending tokens.
- **Chats were shared across stories**: chat history, chapter picks and lorebook picks are now saved per story. A chat saved by the preview build moves into the first story you open after updating.
- **Chapter detection**: replaced with the shared parser, so lines like "Part of me wanted to..." and `[ Author: X; Tags: Y ]` no longer count as chapters, and an untitled chapter after "Chapter 5" is numbered 6. Chapter picks survive edits (they follow the chapter, not its position).
- **15-second refresh**: only re-tokenizes when the story changed, and only repaints the status line (it used to rebuild the whole panel, which could interrupt typing).
- **Stop**: the panel stays locked until the stopped run has finished, so a quick resend can't overlap it.
- **Smaller fixes**: misspelled `disabledWhileCallbackRunning`, `ui.register` replaced by `ui.update` for the Toolbox / context-menu entries, a stray blank line Instruct added on failure, the Instruct prompt is now a real Config option, and Clear asks before deleting the chat.
- **UI**: theme colours and icons instead of hardcoded colours and emoji.

### Key Feature Additions in v2.0.0

#### 1. Modular TypeScript Build System
- **v1.1.0** was maintained as a single monolithic script file (`chat_glm_v1.1.0.naiscript`).
- **v2.0.0** introduces a structured `src/` codebase compiled with `scripts/build.js` (which also bundles `Editorial/shared/chapter-headers.ts` and runs a strict type check):
  - `src/header.ts`: Script metadata and YAML frontmatter configuration schema.
  - `src/types.ts`: Shared types for messages, chapters, context and state.
  - `src/state.ts`: State, per-story storage, and the one-time move of a v2.0 preview chat into the first story opened.
  - `src/prompts.ts`: Persona prompts, `{{contextType}}` / `{{storyText}}` placeholders, and auto-context injection.
  - `src/context.ts`: Chapter detection, lorebook integration, context assembly, and fitting the prompt to the model's context.
  - `src/budget.ts`: Output and input rate-limit checks.
  - `src/ui-kit.ts`: Theme tokens, style presets, button/text factories, confirm dialog.
  - `src/generation.ts`: Send, continue, redo (version history), compact, instruct, stop, delete/edit.
  - `src/modals.ts`: Multi-line message window.
  - `src/ui.ts`: Panel rendering, dropups (Models, Chapters, Lorebooks), Toolbox / context-menu "Add to Chat".
  - `src/main.ts`: Startup and the change-aware status refresh.

#### 2. Multi-Model Support & Custom Personas
- **Configuration Frontmatter**: v2 declares configuration parameters directly in the script header, enabling configuration directly in NovelAI's User Script settings.
- **5 Custom Models**: In addition to the built-in *Assistant* (prose and craft editor) and *Architect* (narrative strategist and outliner), users can configure up to 5 custom personas (`custom_model_1` through `custom_model_5`) with custom names and system prompts.
- **Model Selector Dropup**: Switch models instantly from the bottom toolbar (`▾ Assistant`).
- **Context Injection Fallback**: If a custom model prompt omits `{{storyText}}`, ChatGLM automatically appends a standardized context block to guarantee story awareness.

#### 3. Smart Chapter Detection & Multi-Chapter Targeting
- **Chapter Linter Integration**: Automatically scans document sections to identify chapters using multiple conventions:
  - Markdown headings (`# Chapter 1`, `## Prologue`)
  - Bracketed titles (`[Chapter 1: The Crossing]`, `[Act I]`)
  - Keyword patterns (`Chapter`, `Act`, `Book`, `Part`, `Volume`, `Prologue`, `Epilogue`)
  - Roman numerals (`Chapter IV`) and word numerals (`Chapter Two`)
  - Custom scene break divider tokens (default: `***`, configurable via script settings)
- **Multi-Selection & Focus Modes**:
  - Focus a single chapter by clicking its title.
  - Select multiple chapters concurrently via checkboxes.
- **Previous Chapters Context ("Prev chapters" toggle)**:
  - Allows injecting all preceding chapters into context as background reference while keeping the selected chapter(s) as the primary focus.

#### 4. Lorebook Integration
- **Category-Grouped Selection**: Connects directly to `api.v1.lorebook` to display all story lorebook entries grouped by category in an interactive dropup.
- **Tri-State Category Checkboxes**: Toggle entire categories on/off (all / some / none checkbox icons) or select specific entries.
- **Prioritized Context Header**: Attached lorebook entries are formatted at the very top of context (`### ATTACHED LOREBOOK & REFERENCE CONTEXT`).
- **Protected Truncation**: When token budget constraints force context truncation, story prose is truncated first from the start, preserving lorebook reference entries at the top.

#### 5. Response Cut-off Detection & Continuation
- **Heuristic Truncation Detection**: Automatically detects when an AI response was cut short due to token limits (`finish_reason === "length"`, unclosed code blocks, trailing connectors like `,` or `-`, or lack of terminal punctuation).
- **"Continue Response" Action**: Displays a prominent button above the input bar when cut-off is detected.
- **Preamble & Seam Cleaning**: Automatically trims model conversational filler (e.g., *"Continuing from where I left off..."*) and deduplicates overlapping boundary text.

#### 6. Interactive Message Actions & History
- **Redo with Alternative History**:
  - Regenerating an AI response preserves prior versions in a candidate carousel (`< 1/3 >`).
  - Tracks which model persona generated each version (e.g., `1/2 (Architect)`).
- **User Message Edit & Retry**:
  - Restores a previous user prompt back into the input field for easy editing.
  - Irreversible context wipe confirmation modal alerts users when clearing subsequent messages.
- **Granular Message Deletion**:
  - Delete individual AI responses without clearing the entire session.
  - Delete specific user messages and their downstream conversation branch.

#### 7. Performance & Stability Overhaul
- **Cancellation Signals**: Immediate generation abortion via `stopGeneration()` and `api.v1.createCancellationSignal()`.
- **Light Streaming**: Only the message being written is repainted (`api.v1.ui.updateParts`), at most every 100ms, instead of rebuilding the whole panel per token.
- **Coalesced Panel Updates**: Eliminates UI update race conditions using `isPanelUpdateInProgress` with a pending update queue.

### Detailed Code & Configuration Diff

#### 1. Frontmatter Configuration Schema

##### Before (v1.1.0)
```yaml
/*---
compatibilityVersion: naiscript-1.0
id: a61df34f-dcd4-476c-891a-afcadd6b1c61
name: ChatGLM
createdAt: 1766448000000
updatedAt: 1766880000000
version: 1.1.0
author: piersf
description: A chat in the sidebar to workshop your story with the AI.
memoryLimit: 16
---*/
```

##### After (v2.0.0)
```yaml
/*---
compatibilityVersion: naiscript-1.0
id: a61df34f-dcd4-476c-891a-afcadd6b1c61
name: ChatGLM
createdAt: 1766448000000
updatedAt: 1788920000000
version: 2.0.0
author: piersf
description: A chat in the sidebar to workshop your story with the AI.
memoryLimit: 16
config:
  - name: system_prompt_assistant
    prettyName: Assistant Prompt
    type: string
    default: |- ...
    description: System prompt for the default Assistant model (prose and craft editor).
    multiline: true
  - name: system_prompt_architect
    prettyName: Architect Prompt
    type: string
    default: |- ...
    description: System prompt for the Architect model (structure and narrative strategist).
    multiline: true
  - name: custom_model_1_name
    prettyName: Custom Model 1 Name
    type: string
    default: ""
  - name: custom_model_1_prompt
    prettyName: Custom Model 1 Prompt
    type: string
    default: ""
    multiline: true
  # [... custom models 2 through 5 ...]
  - name: chapter_break_token
    prettyName: Chapter Break Token
    type: string
    default: "***"
    description: "Token on its own line that separates chapters or scenes (default: ***)."
  - name: chapter_title_bracketed
    prettyName: Detect Bracketed Chapter Titles
    type: boolean
    default: true
---*/
```

#### 2. Context Building & Truncation Logic

##### Before (v1.1.0)
```javascript
// Binary selection: either raw selection or full document scan
if (selectedContextText) {
  storyText = selectedContextText;
  contextType = "Specific Excerpt (Highlighted Selection)";
} else {
  contextType = "Full Document";
  const sections = await api.v1.document.scan();
  for (const item of sections) {
    if (item.section && item.section.text) storyText += item.section.text + "\n";
  }
}

// Simple truncation: slice from start of story
if (cachedTruncationInfo.tokensToRemove > 0) {
  const storyTokens = await api.v1.tokenizer.encode(storyText, MODEL_NAME);
  const tokensToKeep = storyTokens.length - cachedTruncationInfo.tokensToRemove;
  const truncatedStoryTokens = storyTokens.slice(storyTokens.length - tokensToKeep);
  storyText = await api.v1.tokenizer.decode(truncatedStoryTokens, MODEL_NAME);
}
```

##### After (v2.0.0)
```typescript
// Hierarchical resolution: Selection > Chapter Focus (+ Prev Context) > Full Document
const activeContext = await getActiveStoryContext();
// - Detects and parses chapter structures
// - Injects prior chapters under '### PRIOR STORY CONTEXT' if usePreviousContext is enabled
// - Prepends attached lorebooks under '### ATTACHED LOREBOOK & REFERENCE CONTEXT'

// Lorebook-protective truncation
if (storyText.length > 0 && cachedTruncationInfo.tokensToRemove > 0) {
  const truncatedStoryText = await truncateStoryContext(activeContext, cachedTruncationInfo.tokensToRemove);
  // Truncates prose first; only truncates lorebook entries if story is completely exhausted
}
```

#### 3. Generation Execution & Cancellation

##### Before (v1.1.0)
```javascript
// Direct unthrottled streaming; no cancellation support
await api.v1.generate(
  messages,
  { model: MODEL_NAME, max_tokens: 1024 },
  (choices, final) => {
    for (let choice of choices) {
      chatHistory[assistantIndex].content += choice.text;
    }
    updatePanel(); // Called on every streaming token!
  }
);
```

##### After (v2.0.0)
```typescript
// Cancellation signal creation
if (typeof api.v1.createCancellationSignal === "function") {
  activeCancellationSignal = await api.v1.createCancellationSignal();
}

// 100ms throttled UI updates during stream
await api.v1.generate(
  messages,
  { model: MODEL_NAME, max_tokens: 1024 },
  (choices, final) => {
    if (!isGenerating) return;
    for (let choice of choices) {
      if (chatHistory[assistantIndex]) {
        chatHistory[assistantIndex].content += choice.text;
      }
    }
    throttlePanelUpdate(final); // Debounced/throttled UI update
  },
  "background",
  activeCancellationSignal || undefined
);

// Cut-off response detection & continuation flag
const finishReason = response?.choices?.[0]?.finish_reason;
hasCutOffResponse = isResponseLikelyCutOff(chatHistory[assistantIndex].content, finishReason);
```

#### 4. Interactive Bottom Toolbar & Context Bar

##### Before (v1.1.0)
```
[👁 AI will read the current document.            ]
[ Clear ] [ Compact ] [ Instruct ] [ Settings ]
[ Type your message...                     ] [ 📝 ]
```

##### After (v2.0.0)
```
[👁 Ch. 3 (+Prev) (+1 Lore)       ][x][☑ prev chs][▾ Ch. 3][▾ 1 Lore]
[ Continue Response                             ] [x]  <-- (when cut off)
[ Clear ] [ Compact ] [ Instruct ] [▾ Assistant ]      <-- (or [Stop Generating])
[ Type your message...                     ] [ 📝 ]
```

### Testing & Verification Suite
v2 includes automated verification scripts in `scripts/`:
- `test_cutoff.js`: Validates cut-off heuristics and continuation preamble/overlap removal.
- `test_previous_context.js`: Tests multi-chapter context prefixing and labeling.
- `test_delete_redo.js`: Tests response deletion and redo mechanics.
- `test_linter_detection.js`: Tests detection of headers, Roman numerals, words, bracketed titles, and dividers.
- `test_multi_chapter_selection.js`: Validates multi-chapter checkbox toggling and target resolution.
- `test_user_delete_edit.js`: Tests prompt restoration to input and downstream context wiping.
- `test_temporary_redo_history.js`: Tests version carousel cycling and per-version model tags.
- `test_stop_callback.js`: Tests cancellation signals and graceful termination.
- `test_lorebook_selection.js`: Tests category grouping and lorebook context assembly.
- `verify.js`: Verifies build bundle syntax and component completeness.

---

## [1.1.0]

The original single-file ChatGLM by piersf (`archive/chat_glm_v1.1.0.naiscript`): a sidebar chat with Assistant and Architect modes that reads the full document or a highlighted selection, with Clear, Compact and Instruct.
