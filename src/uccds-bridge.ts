// --- ChatGLM: chapters from UCCDS ---
// When the UCCDS dependency script is installed and enabled, chapters come from it, so they follow
// the rules (and the user's own header words) set in UCCDS's Config tab. Without UCCDS, ChatGLM
// falls back to its built-in detection (detectChapters in context.ts), exactly as before UCCDS support.

const uccdsLink: {
    last: UccdsResult | null;
    /** UCCDS chapter names by key, for the chapter dropdown */
    names: Record<number, string>;
    source: 'uccds' | 'builtin';
} = { last: null, names: {}, source: 'builtin' };

function chapterKindFromUccds(kind: UccdsChapterKind): ChapterSectionKind {
    return kind === 'untitled' ? 'chapter' : kind;
}

/** UCCDS chapters in ChatGLM's DetectedChapter shape */
function chaptersFromUccds(result: UccdsResult): DetectedChapter[] {
    uccdsLink.names = {};
    return result.chapters.map((ch: UccdsChapter, i: number) => {
        uccdsLink.names[ch.key] = ch.name;
        const body = ch.paragraphs.map((p: string) => p.trim()).filter((p: string) => p.length > 0);
        const text = (ch.rawHeader ? [ch.rawHeader, ...body] : body).join("\n\n");
        // Chapter numbers can repeat across Books, so name the book (unless the header already does)
        const inlineDivision = !!(ch.header && ch.header.divisionLabel);
        const title = ch.division && ch.kind !== 'division' && !inlineDivision ? `${ch.division}, ${ch.title}` : ch.title;
        return {
            key: ch.key,
            index: i,
            // ChatGLM uses this for "Chapters 1 to N-1": the running count fits that best
            number: ch.sequence,
            title,
            label: ch.label,
            text,
            kind: chapterKindFromUccds(ch.kind),
            isPrologue: ch.kind === 'prologue' || ch.kind === 'opening',
            isEpilogue: ch.kind === 'epilogue'
        };
    });
}

/** Used by getActiveStoryContext in place of detectChapters */
async function resolveChapters(sections: ScannedSection[]): Promise<DetectedChapter[]> {
    if (uccdsDependencyInfo()) {
        try {
            const next = await uccdsGetChaptersIfChanged(uccdsLink.last, {}, 3000);
            if (next) uccdsLink.last = next;
            if (uccdsLink.last) {
                uccdsLink.source = 'uccds';
                return chaptersFromUccds(uccdsLink.last);
            }
        } catch (err: any) {
            api.v1.log("ChatGLM: UCCDS request failed, using built-in detection: " + formatError(err));
            uccdsLink.last = null;
        }
    }
    uccdsLink.source = 'builtin';
    uccdsLink.names = {};
    return detectChapters(sections, chat.breakToken, chat.detectBracketedTitles);
}

/** Chapter name for the dropdown: UCCDS's own name when it supplied the chapter */
function chapterDisplayName(ch: DetectedChapter): string {
    if (uccdsLink.source === 'uccds' && uccdsLink.names[ch.key] !== undefined) return uccdsLink.names[ch.key];
    return ch.title.replace(/^(?:Chapter\s*\d*|Prologue\s*(?:\/\s*Introduction)?|Epilogue|Interlude)[:\s-]*/i, "").trim();
}

function chapterSourceNote(): string {
    const info = uccdsDependencyInfo();
    return uccdsLink.source === 'uccds' && info
        ? `Chapters from UCCDS v${info.version} (rules in UCCDS's Config tab)`
        : "Built-in chapter detection (UCCDS not found)";
}

/** Finds UCCDS (it may load after ChatGLM) and refreshes when its chapters change. Called once ChatGLM is up. */
async function startUccdsLink(): Promise<void> {
    const refresh = async (): Promise<void> => {
        if (chat.generating) return;
        await refreshStatus();
        if (chat.dropdown === 'chapter') await updatePanel();
        else await paintStatus();
    };
    const info = await uccdsConnect(4000);
    if (info) {
        api.v1.log(`ChatGLM: using UCCDS v${info.version} for chapters`);
        await refresh();
    } else {
        api.v1.log("ChatGLM: UCCDS not found, using built-in chapter detection");
    }
    // Kept even when UCCDS isn't there yet: it starts working as soon as UCCDS loads
    await uccdsOnChaptersChanged(async () => { await refresh(); }, { waitForService: true });
}
