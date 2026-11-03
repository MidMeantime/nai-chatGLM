# ChatGLM

A sidebar chat for [NovelAI](https://novelai.net/) that lets you workshop your story with the AI. Ask for line edits, talk through structure, or plan the next scene. ChatGLM reads your story (all of it, a chapter, or a highlighted passage) along with any lorebook entries you attach, and answers with GLM-4.6. Each story keeps its own chat.

## Features

- **Personas:** *Assistant* is a prose and craft editor, and *Architect* is a structure and narrative strategist (Both appended from the og script). You can add up to five custom personas with their own names and prompts.
- **Choose what the AI reads:** Great for working through an entire manuscript that doesn’t fit the token budget! Highlight sections, specific chapters (or multiple!) while keeping the others as background with zero context bleed, or the entire document.
- **Chapter detection:** Sophisticated and customizable chapter detection curtosy of [UCCDS](https://github.com/MidMeantime/nai-chapter-detection-uccds).
- **Lorebook context:** Attach entries or whole categories, and they go at the top of the context. When the story has to be cut to fit, lorebook entries are kept.
- **Fits the model's context:** Before anything is sent, ChatGLM counts the real prompt and trims the story to fit. A chat too long to send is refused before any tokens are spent. The status line shows how much of the story the model will read.
- **Message control:** Redo a reply and flip between versions, continue a reply that was cut off, edit and retry or delete your own messages, and stop a reply while it's being written.
	- **Compact** summarizes a long chat to free up room. 
	- **Instruct** turns the conversation into a `{ Write ... }` instruction at the end of your story.
- **Import / export:** Save a chat as JSON or Markdown, copy it to the clipboard, or import it into another story.

## Install

1. Download `chat_glm_v2.1.0.naiscript` from the [latest releases](https://github.com/MidMeantime/nai-chatGLM/releases/latest).
2. In NovelAI, open **User Scripts**, import the file, and enable it.
3. Open a story. The **Chat** panel appears in the sidebar.

If you’re upgrading from ChatGLM 1.1.0, your most recent chat will be appended to your first open story.
If you already have ChatGLM v2 installed, importing any 2.x.x version updates it in place, and your chats are kept in their respective stories.


### Optional: [UCCDS](github.com/MidMeantime/nai-chapter-detection-uccds/releases/latest)

ChatGLM works on its own. If the **UCCDS: Universal Customizable Chapter Detection System** dependency script is also installed and enabled, ChatGLM takes its chapters from UCCDS, so they follow the rules and custom header words set in UCCDS's Config tab. ChatGLM picks UCCDS up even if it loads later, and falls back to its own detection if UCCDS goes away. The chapter picker shows which source is in use.

## Using it

```
[ Ch. 3 (+Prev) (+1 Lore)       ][x][ prev chs][ Ch. 3 ][ 1 Lore ]   context bar
[ Continue Response                                   ][x]          only after a cut-off reply
[ Chat ][ Compact ][ Instruct ][ Assistant ]                         toolbar (Stop while generating)
[ Type your message...                               ][ edit ]
```

- **Context bar:** shows what the AI will read, with pickers for chapters and lorebook entries. The **x** clears your picks.
- **Add to Chat:** highlight text in the editor and use **Add to Chat** from the context menu or the Writer's Toolbox to make that passage the context.
- **Chat menu:** Export as JSON, Export as Markdown, Export both, Copy as Markdown, Import from JSON, and Clear chat.
- **Persona menu** (the last toolbar button): switch personas. Your choice applies to every story.
- **Edit button** next to the input: opens a larger window for writing long messages.

### Importing and exporting chats

Exports are named `ChatGLM - <story title> - <date>`. The JSON file holds the messages and which persona wrote each reply. Redo versions and chapter or lorebook picks aren't included, because they only make sense in the story they came from. Import reads a ChatGLM JSON export, or a plain JSON list of `{ "role": "user" | "assistant", "content": "..." }` messages. If the story already has a chat, you choose whether to **Replace** it or **Append** the imported messages.

NovelAI asks for permission the first time ChatGLM saves a file, opens a file, copies to the clipboard, or (for Instruct) edits your story.

## Configuration

Every option is in the script's settings in NovelAI's User Scripts window.

| Setting | What it does |
| :--- | :--- |
| Assistant Prompt | System prompt for the Assistant persona |
| Architect Prompt | System prompt for the Architect persona |
| Custom Model 1-5 Name / Prompt | Adds a persona to the persona menu when both are filled in |
| Instruct Prompt | What the Instruct button asks for |
| Chapter Break Token | A line containing only this token separates chapters or scenes (default `***`). Ignored when UCCDS is in use |
| Detect Bracketed Chapter Titles | Treat `[ Chapter 1: Title ]` as a header (default on). Ignored when UCCDS is in use |

Prompts can use `{{contextType}}` and `{{storyText}}`. A custom prompt without `{{storyText}}` gets a standard context block added, so the persona always sees the story.

## Contribution

ChatGLM is written in strict TypeScript in `src/`, bundled into one `.naiscript` file, and type-checked against the official NovelAI script types.

### Requirements

- Node.js (tested with 22)
- git, and an internet connection the first time you build

On the first build or test run, [`scripts/deps.js`](scripts/deps.js) sets up everything else in `.deps/`, which git ignores:

- It clones [UCCDS](https://github.com/MidMeantime/nai-chapter-detection-uccds) at a pinned tag (`UCCDS_REF` in `deps.js`, currently `v1.0.0`). UCCDS supplies the chapter parser and client that get bundled in, the build, type-check and test tools, and the UCCDS script the tests run against.
- It runs `npm install` inside that clone to get TypeScript.
- It downloads NovelAI's official [script types](https://novelai.net/scripting/types/script-types.d.ts) for the type check.

Later runs reuse what's there. To start over, delete `.deps/`.

### Commands

```bash
npm run setup
```

```bash
npm run build
```

```bash
npm test
```

`npm run setup` only fetches the dependencies, which is optional because build and test do it anyway. `npm run build` writes `chat_glm_v<version>.naiscript` (the version comes from `src/header.ts`) and type-checks it. `npm test` builds the script and runs it against a mock NovelAI. `scripts/test.js` covers ChatGLM on its own, and `scripts/test-uccds.js` runs it next to the real UCCDS script.

### Layout

| Path | Contents |
| :--- | :--- |
| `src/header.ts` | Script metadata and the settings schema. Bump `version:` here for a release |
| `src/types.ts`, `src/state.ts` | Types, state, and per-story storage |
| `src/prompts.ts` | Persona prompts and placeholder filling |
| `src/context.ts` | Chapter detection, lorebook context, and fitting the prompt to the model |
| `src/uccds-bridge.ts` | Gets chapters from UCCDS when it's installed |
| `src/budget.ts` | Rate-limit checks |
| `src/generation.ts` | Send, continue, redo, compact, instruct, stop, delete and edit |
| `src/transfer.ts` | Chat import and export |
| `src/ui-kit.ts`, `src/ui.ts`, `src/modals.ts` | Theme tokens, UI parts, dialogs, and the panel |
| `src/main.ts` | Startup and the status refresh |
| `scripts/` | Build and test scripts |
| `archive/` | Earlier releases |
| `examples/` | Example prompts and related scripts |

The order of files in the bundle is set in `scripts/build.js`, and the `/*---` header has to come first. NovelAI runs scripts in a web worker with no DOM and no global `setTimeout`, so use `api.v1.timers` and build all UI from `api.v1.ui` parts.

## Links

- My other scripts: https://storyscriptvault.com/users/MidMeantime
- Like my work? https://buymeacoffee.com/midmeantime

## License
[MIT](LICENSE)
