// --- ChatGLM State & Per-Story Persistence ---

const MODEL_NAME = "glm-4-6";
const CHAT_OUTPUT_TOKENS = 1024;
const SIDE_OUTPUT_TOKENS = 512;
/** Room left for chat-format tokens the tokenizer doesn't see (role markers etc.) */
const PROMPT_SAFETY_TOKENS = 96;
const MESSAGE_OVERHEAD_TOKENS = 6;
/** Waits longer than this are reported instead of waited out */
const MAX_BUDGET_WAIT_MS = 10000;

const PANEL_ID = "story-chat-panel";
const INPUT_KEY = "chat-input-value";
const STATUS_ID = "chat-status";

/** Per-story keys (api.v1.storyStorage) */
const STORY_KEYS = {
    history: "chat-history",
    chapterKeys: "selected-chapter-keys",
    loreIds: "selected-lorebook-entry-ids",
    usePrev: "use-previous-context",
    migrated: "chatglm-per-story-v1"
} as const;

/** Script-wide keys (api.v1.storage) */
const MODEL_KEY = "selected-model-id";
/** v2.0 kept everything script-wide under these names */
const LEGACY_KEYS = ["chat-history", "selected-chapter-indices", "selected-chapter-index", "use-previous-context", "selected-lorebook-entry-ids"];

const chat: ChatState = {
    history: [],
    alternatives: {},
    selectedContextText: null,
    generating: false,
    stopRequested: false,
    signal: null,
    hasCutOffResponse: false,

    modelId: "assistant",
    modelName: "Assistant",
    models: [{ id: "assistant", name: "Assistant" }, { id: "architect", name: "Architect" }],
    activePrompt: "",

    chapterKeys: [],
    usePreviousContext: false,
    chapters: [],
    breakToken: "***",
    detectBracketedTitles: true,

    loreIds: [],
    loreEntries: [],
    loreCategories: [],

    dropdown: 'none',
    status: { percentage: 100, ok: true, reason: "" },
    docSignature: "",
    pollStarted: false
};

function formatError(err: any): string {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err.message) return String(err.message);
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

function isChatMessage(value: any): value is ChatMessage {
    return !!value && (value.role === "user" || value.role === "assistant") && typeof value.content === "string";
}

/** Storage values written by v2.0 were JSON strings; v2.1 stores plain values */
function parseStored(value: any): any {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

async function saveChatHistory(): Promise<void> {
    try {
        await api.v1.storyStorage.set(STORY_KEYS.history, chat.history);
    } catch (err: any) {
        api.v1.log("ChatGLM: could not save chat history: " + formatError(err));
    }
}

async function saveSelections(): Promise<void> {
    try {
        await api.v1.storyStorage.set(STORY_KEYS.chapterKeys, chat.chapterKeys);
        await api.v1.storyStorage.set(STORY_KEYS.loreIds, chat.loreIds);
        await api.v1.storyStorage.set(STORY_KEYS.usePrev, chat.usePreviousContext);
    } catch (err: any) {
        api.v1.log("ChatGLM: could not save selections: " + formatError(err));
    }
}

/**
 * v2.0 saved the chat script-wide, so every story showed the same chat. The first story opened
 * after updating adopts that chat, and the script-wide copy is removed so no other story gets it.
 * Chapter and lorebook picks belonged to whichever story they were made in, so they are dropped.
 */
async function migrateLegacyChat(): Promise<void> {
    try {
        if (await api.v1.storyStorage.get(STORY_KEYS.migrated)) return;
        const legacyHistory = parseStored(await api.v1.storage.get("chat-history"));
        const existing = await api.v1.storyStorage.get(STORY_KEYS.history);
        if (Array.isArray(legacyHistory) && legacyHistory.length > 0 && !(Array.isArray(existing) && existing.length > 0)) {
            await api.v1.storyStorage.set(STORY_KEYS.history, legacyHistory.filter(isChatMessage));
            const legacyPrev = await api.v1.storage.get("use-previous-context");
            if (typeof legacyPrev === "boolean") await api.v1.storyStorage.set(STORY_KEYS.usePrev, legacyPrev);
            api.v1.log("ChatGLM: moved the previous script-wide chat into this story.");
        }
        for (const key of LEGACY_KEYS) {
            if (await api.v1.storage.has(key)) await api.v1.storage.remove(key);
        }
        await api.v1.storyStorage.set(STORY_KEYS.migrated, true);
    } catch (err: any) {
        api.v1.log("ChatGLM: legacy chat migration failed: " + formatError(err));
    }
}

async function loadPersistedState(): Promise<void> {
    try {
        const savedModel = await api.v1.storage.get(MODEL_KEY);
        if (typeof savedModel === "string" && savedModel) chat.modelId = savedModel;
    } catch {
        // keep default model
    }

    await migrateLegacyChat();

    try {
        const history = parseStored(await api.v1.storyStorage.get(STORY_KEYS.history));
        chat.history = Array.isArray(history) ? history.filter(isChatMessage) : [];
        const keys = await api.v1.storyStorage.get(STORY_KEYS.chapterKeys);
        chat.chapterKeys = Array.isArray(keys) ? keys.filter((k: any) => typeof k === "number") : [];
        const lore = await api.v1.storyStorage.get(STORY_KEYS.loreIds);
        chat.loreIds = Array.isArray(lore) ? lore.filter((id: any) => typeof id === "string") : [];
        const prev = await api.v1.storyStorage.get(STORY_KEYS.usePrev);
        chat.usePreviousContext = prev === true;
    } catch (err: any) {
        api.v1.log("ChatGLM: could not load this story's chat: " + formatError(err));
    }

    const last = chat.history[chat.history.length - 1];
    chat.hasCutOffResponse = !!last && last.role === "assistant" && isResponseLikelyCutOff(last.content);
}
