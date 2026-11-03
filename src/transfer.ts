// --- ChatGLM Chat Import / Export ---
// Export saves the story's chat as JSON (read back by Import) and/or a Markdown transcript, or
// copies the transcript to the clipboard. Import reads a JSON export (or a bare message array)
// and replaces or appends to the current chat. Redo alternatives are session-only and not exported.

const CHAT_EXPORT_FORMAT = "chatglm-chat";
const CHAT_EXPORT_VERSION = 1;

type ExportKind = 'json' | 'markdown' | 'both';

interface ChatExportFile {
    format: string;
    version: number;
    exportedAt: string;
    story: string;
    messages: ChatMessage[];
}

interface ParsedImport {
    messages: ChatMessage[];
    story: string;
    skipped: number;
}

async function currentStoryTitle(): Promise<string> {
    try {
        return String((await api.v1.story.title.get()) || "").trim();
    } catch {
        return "";
    }
}

function datestamp(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "ChatGLM - My Story - 2026-11-03", minus characters file systems reject */
function exportFileBase(storyTitle: string, date: Date): string {
    const safeTitle = storyTitle.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    return safeTitle ? `ChatGLM - ${safeTitle} - ${datestamp(date)}` : `ChatGLM chat - ${datestamp(date)}`;
}

/** Only the known message fields, so stray data in the history never leaks into a file */
function cleanMessage(msg: ChatMessage): ChatMessage {
    const out: ChatMessage = { role: msg.role, content: msg.content };
    if (typeof msg.modelDisplayName === "string" && msg.modelDisplayName) out.modelDisplayName = msg.modelDisplayName;
    if (typeof msg.modelId === "string" && msg.modelId) out.modelId = msg.modelId;
    return out;
}

function chatToJson(storyTitle: string, date: Date): string {
    const file: ChatExportFile = {
        format: CHAT_EXPORT_FORMAT,
        version: CHAT_EXPORT_VERSION,
        exportedAt: date.toISOString(),
        story: storyTitle,
        messages: chat.history.map(cleanMessage)
    };
    return JSON.stringify(file, null, 2);
}

function chatToMarkdown(storyTitle: string, date: Date): string {
    const count = chat.history.length;
    const lines: string[] = [
        `# ChatGLM chat${storyTitle ? `: ${storyTitle}` : ""}`,
        "",
        `_Exported ${datestamp(date)} · ${count} message${count === 1 ? "" : "s"}_`
    ];
    for (const msg of chat.history) {
        const speaker = msg.role === "user" ? "You" : (msg.modelDisplayName || "Assistant");
        lines.push("", "---", "", `### ${speaker}`, "", msg.content.trim());
    }
    return lines.join("\n") + "\n";
}

async function exportChat(kind: ExportKind): Promise<void> {
    if (chat.history.length === 0) {
        await api.v1.ui.toast("Nothing to export: this story's chat is empty.", { type: "warning" });
        return;
    }
    try {
        if (!(await api.v1.permissions.request("fileDownload", "ChatGLM needs to save your chat as a file."))) {
            await api.v1.ui.toast("Export needs permission to save files.", { type: "warning" });
            return;
        }
        const date = new Date();
        const title = await currentStoryTitle();
        const base = exportFileBase(title, date);
        if (kind !== 'markdown') await api.v1.file.save(`${base}.json`, chatToJson(title, date));
        if (kind !== 'json') await api.v1.file.save(`${base}.md`, chatToMarkdown(title, date));
        const what = kind === 'both' ? "JSON and Markdown" : kind === 'json' ? "JSON" : "Markdown";
        await api.v1.ui.toast(`Exported ${chat.history.length} messages (${what}).`, { type: "success" });
    } catch (err: any) {
        await api.v1.ui.toast("Export failed: " + formatError(err), { type: "error" });
    }
}

async function copyChatMarkdown(): Promise<void> {
    if (chat.history.length === 0) {
        await api.v1.ui.toast("Nothing to copy: this story's chat is empty.", { type: "warning" });
        return;
    }
    try {
        if (!(await api.v1.permissions.request("clipboardWrite", "ChatGLM needs to copy your chat to the clipboard."))) {
            await api.v1.ui.toast("Copying needs clipboard permission.", { type: "warning" });
            return;
        }
        await api.v1.clipboard.writeText(chatToMarkdown(await currentStoryTitle(), new Date()));
        await api.v1.ui.toast(`Copied ${chat.history.length} messages as Markdown.`, { type: "success" });
    } catch (err: any) {
        await api.v1.ui.toast("Copy failed: " + formatError(err), { type: "error" });
    }
}

/**
 * Reads a ChatGLM JSON export, or a bare array of {role, content} messages. Invalid messages are
 * skipped and counted. Throws a user-facing message when nothing usable is in the file.
 */
function parseChatImport(raw: string): ParsedImport {
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error("That file isn't valid JSON. Import reads the .json file from Export.");
    }
    let list: any[];
    let story = "";
    if (Array.isArray(data)) {
        list = data;
    } else if (data && typeof data === "object" && Array.isArray(data.messages)) {
        if (data.format !== undefined && data.format !== CHAT_EXPORT_FORMAT) throw new Error(`Not a ChatGLM chat export (format "${String(data.format)}").`);
        if (typeof data.version === "number" && data.version > CHAT_EXPORT_VERSION) throw new Error("This chat was exported by a newer ChatGLM. Update ChatGLM to import it.");
        list = data.messages;
        if (typeof data.story === "string") story = data.story;
    } else {
        throw new Error("No chat messages found in that file.");
    }
    const messages = list.filter(isChatMessage).map(cleanMessage);
    if (messages.length === 0) throw new Error("No chat messages found in that file.");
    return { messages, story, skipped: list.length - messages.length };
}

async function importChat(): Promise<void> {
    if (chat.generating) return;
    let parsed: ParsedImport;
    try {
        if (!(await api.v1.permissions.request("fileInput", "ChatGLM needs to open the chat file you pick."))) {
            await api.v1.ui.toast("Import needs permission to open files.", { type: "warning" });
            return;
        }
        const raw = await api.v1.file.prompt({ accept: ".json,application/json" });
        if (typeof raw !== "string") return; // picker cancelled
        parsed = parseChatImport(raw);
    } catch (err: any) {
        await api.v1.ui.toast("Import failed: " + formatError(err), { type: "error" });
        return;
    }

    const count = parsed.messages.length;
    const from = parsed.story ? ` from **${parsed.story}**` : "";
    let mode = "replace";
    if (chat.history.length > 0) {
        const picked = await choiceDialog("Import chat",
            `Import **${count}** messages${from}. This story's chat already has **${chat.history.length}** messages: replace them, or add the imported ones after them?`, [
                { value: "append", label: "Append", icon: 'plus', variant: 'default' },
                { value: "replace", label: "Replace", icon: 'trash-2', variant: 'danger' }
            ]);
        if (!picked) return;
        mode = picked;
    }
    // The chat may have started generating while the dialog was open
    if (chat.generating) return;

    if (mode === "replace") {
        chat.history = parsed.messages;
        chat.alternatives = {};
    } else {
        // Existing indices don't move, so their redo versions stay valid
        chat.history = chat.history.concat(parsed.messages);
    }
    refreshCutOffFlag();
    await saveChatHistory();
    await refreshStatus();
    await updatePanel();
    const skipped = parsed.skipped > 0 ? ` (${parsed.skipped} unreadable skipped)` : "";
    await api.v1.ui.toast(`Imported ${count} messages${skipped}.`, { type: "success" });
}
