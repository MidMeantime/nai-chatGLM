# ChatGLM

A sidebar chat for [NovelAI](https://novelai.net/) that lets you workshop your story with the AI. Ask for line edits, talk through structure, or plan the next scene. ChatGLM reads your story (all of it, a chapter, or a highlighted passage) along with any lorebook entries you attach, and answers with GLM-4.6. Each story keeps its own chat.

## Features

- **Personas:** *Assistant* is a prose and craft editor, and *Architect* is a structure and narrative strategist (Both appended from the og script). You can add up to five custom personas with their own names and prompts.
- **Choose what the AI reads:** Great for working through an entire manuscript that doesn’t fit the token budget! Highlight sections, specific chapters (or multiple!) while keeping the others as background with zero context bleed, or the entire document.
- **Lorebook context:** Attach entries or whole categories, and they go at the top of the context. When the story has to be cut to fit, lorebook entries are kept.
- **Fits the model's context:** Before anything is sent, ChatGLM counts the real prompt and trims the story to fit. A chat too long to send is refused before any tokens are spent. The status line shows how much of the story the model will read.
- **Message control:** Redo a reply and flip between versions, continue a reply that was cut off, edit and retry or delete your own messages, and stop a reply while it's being written.
	- **Compact** summarizes a long chat to free up room. 
	- **Instruct** turns the conversation into a `{ Write ... }` instruction at the end of your story.

## Install

1. Download `chat_glm_v2.0.0.naiscript` from this repository.
2. In NovelAI, open **User Scripts**, import the file, and enable it.
3. Open a story. The **Chat** panel appears in the sidebar.

If you’re upgrading from ChatGLM 1.1.0, your most recent chat will be appended to your first open story.
If you already have ChatGLM v2 installed, importing any 2.x.x version updates it in place, and your chats are kept in their respective stories.



## Using it

```
[ Ch. 3 (+Prev) (+1 Lore)       ][x][ prev chs][ Ch. 3 ][ 1 Lore ]   context bar
[ Continue Response                                   ][x]          only after a cut-off reply
[ Chat ][ Compact ][ Instruct ][ Assistant ]                         toolbar (Stop while generating)
[ Type your message...                               ][ edit ]
```

- **Context bar:** shows what the AI will read, with pickers for chapters and lorebook entries. The **x** clears your picks.
- **Add to Chat:** highlight text in the editor and use **Add to Chat** from the context menu or the Writer's Toolbox to make that passage the context.
- **Persona menu** (the last toolbar button): switch personas. Your choice applies to every story.
- **Edit button** next to the input: opens a larger window for writing long messages.

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

Prompts can use `{{contextType}}` and `{{storyText}}`. A custom prompt without `{{storyText}}` gets a standard context block added, so the persona always sees the story. The [`examples/`](examples) folder has more prompts to try.

## Links

- My other scripts: https://storyscriptvault.com/users/MidMeantime
- Like my work? https://buymeacoffee.com/midmeantime

## License
[MIT](LICENSE)
