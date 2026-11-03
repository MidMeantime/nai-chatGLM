// --- ChatGLM Story Context: chapters, lorebooks, assembly and fitting to the token budget ---

interface ScannedSection {
    sectionId: number;
    text: string;
}

async function getDocumentSections(): Promise<ScannedSection[]> {
    try {
        const scanned = await api.v1.document.scan();
        return (scanned || []).map((s: { sectionId: number; section: Section }) => ({
            sectionId: s.sectionId,
            text: (s.section && s.section.text) || ""
        }));
    } catch (err: any) {
        api.v1.log("ChatGLM: error scanning document: " + formatError(err));
        return [];
    }
}

async function loadDetectionConfig(): Promise<void> {
    try {
        const token = await api.v1.config.get("chapter_break_token");
        chat.breakToken = typeof token === "string" && token.trim() ? token.trim() : "***";
        const bracketed = await api.v1.config.get("chapter_title_bracketed");
        chat.detectBracketedTitles = typeof bracketed === "boolean" ? bracketed : true;
    } catch {
        // keep defaults
    }
}

/** Cheap fingerprint (FNV-1a over ids + text) so the status poll can skip unchanged documents */
function documentSignature(sections: ScannedSection[]): string {
    let hash = 0x811c9dc5;
    const mix = (str: string): void => {
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        hash ^= 0x1f;
        hash = Math.imul(hash, 0x01000193);
    };
    for (const s of sections) {
        mix(String(s.sectionId));
        mix(s.text);
    }
    return `${sections.length}:${(hash >>> 0).toString(16)}`;
}

function chapterLabel(kind: ChapterSectionKind, header: ParsedHeader | null, num: number | null): string {
    if (kind === 'opening' || kind === 'prologue') return header && header.keyword ? capitalize(header.keyword) : "Prologue";
    if (kind === 'epilogue') return "Epilogue";
    if (kind === 'interlude') return "Interlude";
    if (kind === 'division' && header) return header.labelText || "Part";
    return `Ch. ${num !== null ? num : "?"}`;
}

function capitalize(word: string): string {
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

/**
 * Splits the story into chapters with the shared header parser (same rules as Chapter Linter).
 * Untitled text before the first header becomes "Prologue / Introduction". With no headers at
 * all, the story is split on scene-break dividers instead.
 */
function detectChapters(sections: ScannedSection[], breakToken: string, detectBracketedTitles: boolean): DetectedChapter[] {
    const detection: HeaderDetectionOptions = { detectionMode: 'auto', detectBracketedTitles, breakToken };
    const items = sections
        .map((s: ScannedSection) => ({ id: s.sectionId, text: s.text.trim() }))
        .filter((s: { id: number; text: string }) => s.text.length > 0);
    if (items.length === 0) return [];

    const headerAt: number[] = [];
    const parsed: ParsedHeader[] = [];
    items.forEach((item: { id: number; text: string }, i: number) => {
        const h = chParseHeader(item.text, detection);
        if (h.isHeader) {
            headerAt.push(i);
            parsed.push(h);
        }
    });

    const chapters: DetectedChapter[] = [];
    const isDivider = (t: string): boolean => chIsDivider(t, breakToken);

    if (headerAt.length > 0) {
        const opening = items.slice(0, headerAt[0]).filter((s: { text: string }) => !isDivider(s.text));
        if (opening.length > 0) {
            chapters.push({
                key: items[0].id, index: 0, number: null,
                title: "Prologue / Introduction", label: "Prologue",
                text: opening.map((s: { text: string }) => s.text).join("\n\n"),
                kind: 'opening', isPrologue: true, isEpilogue: false
            });
        }
        const numbers = chFillNumbers(parsed);
        const divisions = chDivisionContext(parsed);
        headerAt.forEach((start: number, h: number) => {
            const end = h + 1 < headerAt.length ? headerAt[h + 1] : items.length;
            let stop = end;
            // Dividers right before the next header separate chapters; they aren't chapter text
            while (h + 1 < headerAt.length && stop > start + 1 && isDivider(items[stop - 1].text)) stop--;
            const header = parsed[h];
            const kind: ChapterSectionKind = header.kind;
            const num = numbers[h];
            let title: string;
            // In a story with Books/Parts, chapter numbers can repeat, so name the book too
            const division = kind !== 'division' ? divisions[h] : "";
            let label = chapterLabel(kind, header, num);
            if (kind === 'chapter' || kind === 'title') {
                title = header.cleanName ? `Chapter ${num}: ${header.cleanName}` : `Chapter ${num}`;
            } else {
                title = chDisplayTitle(header) || capitalize(header.keyword);
            }
            if (division) {
                title = `${division}, ${title}`;
                label = `${division} ${label}`;
            }
            chapters.push({
                key: items[start].id,
                index: chapters.length,
                number: num,
                title,
                label,
                text: items.slice(start, stop).map((s: { text: string }) => s.text).join("\n\n"),
                kind,
                isPrologue: kind === 'prologue',
                isEpilogue: kind === 'epilogue'
            });
        });
        return chapters;
    }

    // No headers: split on dividers
    let parts: string[] = [];
    let firstId = items[0].id;
    const flush = (): void => {
        if (parts.length === 0) return;
        const n = chapters.length + 1;
        chapters.push({
            key: firstId, index: chapters.length, number: n,
            title: `Chapter ${n}`, label: `Ch. ${n}`,
            text: parts.join("\n\n"), kind: 'chapter', isPrologue: false, isEpilogue: false
        });
        parts = [];
    };
    for (const item of items) {
        if (isDivider(item.text)) {
            flush();
        } else {
            if (parts.length === 0) firstId = item.id;
            parts.push(item.text);
        }
    }
    flush();
    return chapters;
}

// --- Lorebook ---

async function fetchLorebookData(): Promise<void> {
    try {
        chat.loreCategories = (await api.v1.lorebook.categories()) || [];
        chat.loreEntries = (await api.v1.lorebook.entries()) || [];
    } catch (err: any) {
        api.v1.log("ChatGLM: error fetching lorebook: " + formatError(err));
    }
}

function lorebookEntryName(entry: LorebookEntry): string {
    if (entry.displayName && entry.displayName.trim()) return entry.displayName.trim();
    if (entry.keys && entry.keys.length > 0 && entry.keys[0].trim()) return entry.keys[0].trim();
    return "Lorebook Entry";
}

function formatLorebookContext(entries: LorebookEntry[], categories: LorebookCategory[], selectedIds: string[]): string {
    if (selectedIds.length === 0 || entries.length === 0) return "";
    const categoryNames: Record<string, string> = {};
    for (const cat of categories) {
        if (cat && cat.id) categoryNames[cat.id] = cat.name || "Category";
    }
    const parts: string[] = [];
    for (const id of selectedIds) {
        const entry = entries.find((e: LorebookEntry) => e && e.id === id);
        if (!entry || !entry.text || !entry.text.trim()) continue;
        const catName = entry.category ? categoryNames[entry.category] : undefined;
        const name = lorebookEntryName(entry);
        parts.push(`--- [${catName ? `${catName}: ${name}` : name}] ---\n${entry.text.trim()}`);
    }
    if (parts.length === 0) return "";
    return `### ATTACHED LOREBOOK & REFERENCE CONTEXT:\n${parts.join("\n\n")}`;
}

// --- Context assembly: highlighted selection > targeted chapter(s) > full document ---

function chapterHeading(ch: DetectedChapter): string {
    return ch.title;
}

async function getActiveStoryContext(): Promise<StoryContext> {
    await loadDetectionConfig();
    const sections = await getDocumentSections();
    chat.chapters = await resolveChapters(sections);

    // Drop picks for chapters that no longer exist
    const liveKeys = new Set<number>(chat.chapters.map((c: DetectedChapter) => c.key));
    chat.chapterKeys = chat.chapterKeys.filter((k: number) => liveKeys.has(k));
    if (chat.loreEntries.length > 0) {
        chat.loreIds = chat.loreIds.filter((id: string) => chat.loreEntries.some((e: LorebookEntry) => e.id === id));
    }

    const fullText = sections.filter((s: ScannedSection) => s.text).map((s: ScannedSection) => s.text + "\n").join("");
    let baseText = "";
    let baseType = "Full Document";
    let isSelection = false;
    let isChapter = false;
    let hasPreviousContext = false;
    let chapterTitle: string | null = null;

    if (chat.selectedContextText) {
        baseText = chat.selectedContextText;
        baseType = "Specific Excerpt (Highlighted Selection)";
        isSelection = true;
    } else if (chat.chapterKeys.length > 0) {
        const selected = chat.chapters.filter((c: DetectedChapter) => chat.chapterKeys.includes(c.key));
        const oldest = selected[0];
        const prior = chat.usePreviousContext ? chat.chapters.slice(0, oldest.index) : [];
        const priorText = prior.map((c: DetectedChapter) => `--- [${chapterHeading(c)}] ---\n${c.text}`).join("\n\n");
        isChapter = true;

        if (selected.length === 1) {
            const ch = selected[0];
            chapterTitle = ch.title;
            if (prior.length > 0) {
                const priorDesc = (ch.isPrologue || ch.isEpilogue || ch.number === null || ch.kind !== 'chapter' && ch.kind !== 'title')
                    ? "Preceding Content"
                    : `Chapters 1 to ${ch.number - 1}`;
                baseText = `### PRIOR STORY CONTEXT (Background Reference — ${priorDesc}):\n${priorText}\n\n### TARGET CHAPTER FOCUS (${ch.title} — Primary Workshop Text):\n${ch.text}`;
                baseType = `${ch.title} (+ Prev Chapters)`;
                hasPreviousContext = true;
            } else {
                baseText = ch.text;
                baseType = ch.title;
            }
        } else {
            const labels = selected.map((c: DetectedChapter) => c.label).join(", ");
            chapterTitle = labels;
            const targetText = selected.map((c: DetectedChapter) => `=== [${chapterHeading(c)}] ===\n${c.text}`).join("\n\n");
            if (prior.length > 0) {
                baseText = `### PRIOR STORY CONTEXT (Background Reference — Chapters prior to ${oldest.isPrologue || oldest.isEpilogue ? oldest.label : `Chapter ${oldest.number}`}):\n${priorText}\n\n### TARGET CHAPTER FOCUS (${labels} — Primary Workshop Text):\n${targetText}`;
                baseType = `${labels} (+ Prev Chapters)`;
                hasPreviousContext = true;
            } else {
                baseText = `### TARGET CHAPTER FOCUS (${labels} — Primary Workshop Text):\n${targetText}`;
                baseType = labels;
            }
        }
    } else {
        baseText = fullText;
    }

    let finalText = baseText;
    let finalType = baseType;
    const lorebookText = formatLorebookContext(chat.loreEntries, chat.loreCategories, chat.loreIds);
    if (lorebookText) {
        const count = chat.loreIds.length;
        finalType = `${baseType} (+ ${count} Lorebook${count > 1 ? "s" : ""})`;
        if (baseText.trim()) {
            let storySection = baseText;
            if (isSelection) {
                storySection = `### TARGET EXCERPT (Highlighted Selection — Primary Workshop Text):\n${baseText}`;
            } else if (isChapter && !baseText.startsWith("### ")) {
                storySection = `### TARGET CHAPTER FOCUS (${chapterTitle || "Selected Chapter"} — Primary Workshop Text):\n${baseText}`;
            } else if (!isSelection && !isChapter) {
                storySection = `### FULL STORY DOCUMENT (Primary Workshop Text):\n${baseText}`;
            }
            finalText = `${lorebookText}\n\n***\n\n${storySection}`;
        } else {
            finalText = lorebookText;
        }
    }

    return {
        text: finalText,
        contextType: finalType,
        isSelection,
        isChapter,
        hasPreviousContext,
        chapterTitle,
        hasLorebook: !!lorebookText,
        lorebookCount: lorebookText ? chat.loreIds.length : 0,
        lorebookText,
        baseStoryText: baseText
    };
}

// --- Fitting the prompt to the model's context ---

async function countTokens(text: string): Promise<number> {
    if (!text) return 0;
    return (await api.v1.tokenizer.encode(text, MODEL_NAME)).length;
}

async function countMessageTokens(messages: Message[]): Promise<number> {
    let total = 0;
    for (const m of messages) total += (await countTokens(m.content || "")) + MESSAGE_OVERHEAD_TOKENS;
    return total;
}

/** Keeps the last `keep` tokens of a text */
async function keepTail(text: string, keep: number): Promise<string> {
    if (keep <= 0 || !text) return "";
    const tokens = await api.v1.tokenizer.encode(text, MODEL_NAME);
    if (tokens.length <= keep) return text;
    return api.v1.tokenizer.decode(tokens.slice(tokens.length - keep), MODEL_NAME);
}

/** Context type label once the story had to be cut to fit */
function describeTruncated(ctx: StoryContext): string {
    const lore = ctx.hasLorebook ? ` (+ ${ctx.lorebookCount} Lorebook${ctx.lorebookCount > 1 ? "s" : ""})` : "";
    if (ctx.isSelection) return `Selected Excerpt (Truncated to fit)${lore}`;
    if (ctx.isChapter) {
        return ctx.hasPreviousContext
            ? `${ctx.chapterTitle || "Chapter"} (+ Prev Chapters, Truncated)${lore}`
            : `${ctx.chapterTitle || "Chapter"} (Truncated from start)${lore}`;
    }
    return `Document Excerpt (Truncated from start)${lore}`;
}

/**
 * Cuts the story context to `available` tokens, removing from the start of the story first so
 * attached lorebook entries stay intact at the top.
 */
async function fitStoryContext(ctx: StoryContext, available: number): Promise<string> {
    if (available <= 0) return "";
    if (!ctx.lorebookText) return keepTail(ctx.baseStoryText, available);
    const header = `\n\n***\n\n### ACTIVE STORY CONTEXT (Truncated from start to fit token budget):\n`;
    const loreTokens = await countTokens(ctx.lorebookText);
    const headerTokens = await countTokens(header);
    const forStory = available - loreTokens - headerTokens;
    if (forStory > 0) {
        const story = await keepTail(ctx.baseStoryText, forStory);
        return story ? `${ctx.lorebookText}${header}${story}` : ctx.lorebookText;
    }
    return keepTail(ctx.lorebookText, available);
}

/**
 * Builds the exact messages for a generation and checks they fit the model's context, counting
 * the system prompt, the whole chat, the new message and the reply. Nothing is sent (and no
 * tokens are spent) when it doesn't fit. This replaces v2.0's 15-second cached estimate.
 */
async function planPrompt(history: ChatMessage[], trailingUser: string | null, outputTokens: number): Promise<PromptPlan> {
    await refreshActiveModel();
    const ctx = await getActiveStoryContext();
    const maxContext = await api.v1.maxTokens(MODEL_NAME);
    const budget = maxContext - outputTokens - PROMPT_SAFETY_TOKENS;

    const chatMessages: Message[] = history.map((m: ChatMessage) => ({ role: m.role, content: m.content }));
    if (trailingUser !== null) chatMessages.push({ role: "user", content: trailingUser });

    const fixed = (await countTokens(formatSystemPromptWithContext(chat.activePrompt, ctx.contextType, ""))) + MESSAGE_OVERHEAD_TOKENS
        + (await countMessageTokens(chatMessages));
    const fail = (reason: string): PromptPlan => ({
        ok: false, reason, messages: [], contextType: ctx.contextType, storyTokens: 0, keptStoryTokens: 0, percentage: 0
    });
    if (fixed > budget) {
        return fail("The chat is too long to fit in the model's context. Compact or clear the chat first.");
    }

    const storyTokens = await countTokens(ctx.text);
    let storyText = ctx.text;
    let contextType = ctx.contextType;
    let kept = storyTokens;
    const available = budget - fixed;
    if (storyTokens > available) {
        storyText = await fitStoryContext(ctx, available);
        if (!storyText) return fail("Token budget too low for any story text. Try compacting chat history.");
        kept = Math.min(storyTokens, await countTokens(storyText));
        contextType = describeTruncated(ctx);
    }

    const messages: Message[] = [
        { role: "system", content: formatSystemPromptWithContext(chat.activePrompt, contextType, storyText) },
        ...chatMessages
    ];
    return {
        ok: true,
        reason: "",
        messages,
        contextType,
        storyTokens,
        keptStoryTokens: kept,
        percentage: storyTokens === 0 ? 100 : Math.max(0, Math.min(100, Math.round(kept / storyTokens * 100)))
    };
}

/** Recomputes how much of the story the next message would include (shown in the status line) */
async function refreshStatus(): Promise<void> {
    try {
        const plan = await planPrompt(chat.history, null, CHAT_OUTPUT_TOKENS);
        chat.status = { percentage: plan.ok ? plan.percentage : 0, ok: plan.ok, reason: plan.reason };
    } catch (err: any) {
        api.v1.log("ChatGLM: status refresh failed: " + formatError(err));
    }
}

/** "Add to Chat": rejects a selection that wouldn't fit whole */
async function setSelectedContext(text: string): Promise<boolean> {
    if (!text || !text.trim()) {
        await api.v1.ui.toast("Selected text is empty.", { type: "warning" });
        return false;
    }
    const previous = chat.selectedContextText;
    chat.selectedContextText = text;
    const plan = await planPrompt(chat.history, null, CHAT_OUTPUT_TOKENS);
    if (!plan.ok || plan.percentage < 100) {
        chat.selectedContextText = previous;
        await api.v1.ui.toast("Selected text exceeds the token budget. Please select less text.", { type: "warning" });
        await refreshStatus();
        await updatePanel();
        return false;
    }
    // The selection takes priority over chapter picks while it is set (same as v2.0)
    chat.status = { percentage: 100, ok: true, reason: "" };
    await updatePanel();
    await api.v1.ui.toast("Selection added to the chat context.", { type: "info" });
    return true;
}
