// --- ChatGLM Types ---
// Header parsing types (ParsedHeader, ChapterKind, HeaderDetectionOptions) come from Editorial/shared/chapter-headers.ts

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
    role: ChatRole;
    content: string;
    /** Model persona that wrote an assistant message */
    modelDisplayName?: string;
    modelId?: string;
}

interface ResponseVersion {
    content: string;
    modelDisplayName: string;
    modelId: string;
}

/** Redo alternatives for one assistant message (kept for this session only) */
interface ResponseAlternatives {
    versions: ResponseVersion[];
    activeVersionIndex: number;
}

interface ChatModel {
    id: string;
    name: string;
}

type ChapterSectionKind = ChapterKind | 'opening';

/** One chapter found in the story document */
interface DetectedChapter {
    /** Stable identity: the header's section id (first section id for untitled text) */
    key: number;
    index: number;
    number: number | null;
    /** Full title, e.g. "Chapter 3: The Fall" or "Prologue: The Awakening" */
    title: string;
    /** Short label, e.g. "Ch. 3", "Prologue", "Part 2" */
    label: string;
    /** Header line + body, paragraphs separated by blank lines */
    text: string;
    kind: ChapterSectionKind;
    isPrologue: boolean;
    isEpilogue: boolean;
}

/** The story text the AI will see, before fitting it to the token budget */
interface StoryContext {
    text: string;
    contextType: string;
    isSelection: boolean;
    isChapter: boolean;
    hasPreviousContext: boolean;
    chapterTitle: string | null;
    hasLorebook: boolean;
    lorebookCount: number;
    lorebookText: string;
    baseStoryText: string;
}

/** A ready-to-send prompt, or the reason it can't be sent */
interface PromptPlan {
    ok: boolean;
    reason: string;
    messages: Message[];
    contextType: string;
    /** Story tokens before / after fitting */
    storyTokens: number;
    keptStoryTokens: number;
    /** Share of the story context that fits (100 = all of it) */
    percentage: number;
}

type ChatDropdown = 'none' | 'chapter' | 'lore' | 'model' | 'chat';

interface ChatState {
    history: ChatMessage[];
    alternatives: Record<number, ResponseAlternatives>;
    selectedContextText: string | null;
    generating: boolean;
    /** Stop was pressed: ignore further streamed text until the run ends */
    stopRequested: boolean;
    signal: CancellationSignal | null;
    hasCutOffResponse: boolean;

    modelId: string;
    modelName: string;
    models: ChatModel[];
    activePrompt: string;

    chapterKeys: number[];
    usePreviousContext: boolean;
    chapters: DetectedChapter[];
    breakToken: string;
    detectBracketedTitles: boolean;

    loreIds: string[];
    loreEntries: LorebookEntry[];
    loreCategories: LorebookCategory[];

    dropdown: ChatDropdown;
    status: { percentage: number; ok: boolean; reason: string };
    docSignature: string;
    pollStarted: boolean;
}
