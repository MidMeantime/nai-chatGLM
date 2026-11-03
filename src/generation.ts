// --- ChatGLM Generation Actions ---

const STREAM_PAINT_INTERVAL_MS = 100;
const CONTINUE_DIRECTIVE = "Continue your previous response directly from where you left off. Do not repeat any part of what you already wrote, and do not include any conversational preamble, filler, or explanation. Resume immediately from the exact point of interruption.";

/** Heuristic: did this assistant response stop mid-thought? */
function isResponseLikelyCutOff(text: string, finishReason?: string): boolean {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (finishReason === "length") return true;
    // Unclosed code block (odd number of ```)
    if ((trimmed.match(/```/g) || []).length % 2 === 1) return true;
    if (finishReason === "stop") return false;
    if (trimmed.endsWith("```")) return false;
    // Dangling punctuation or connectors
    if (/[,;:\-—–(\[\{<]\s*$/.test(trimmed)) return true;
    // Ends with terminal punctuation (optionally wrapped in quotes/brackets/emphasis)
    if (/[.!?…。！？]["'”’\)\]\}*_`]*$/.test(trimmed)) return false;
    return true;
}

/** Strips "Continuing:"-style preambles and any overlap with the end of the previous text */
function cleanContinuationText(previousText: string, newText: string): string {
    if (!newText) return "";
    let text = newText.replace(/^(?:Continuing (?:where (?:I|we) left off|from before|from where I left off):?\s*|Here is the continuation:?\s*|Continuing:?\s*)/i, "");
    if (previousText && text) {
        const maxOverlap = Math.min(previousText.length, text.length, 60);
        for (let len = maxOverlap; len >= 4; len--) {
            if (text.startsWith(previousText.slice(previousText.length - len))) {
                text = text.slice(len);
                break;
            }
        }
    }
    return text;
}

function refreshCutOffFlag(): void {
    const last = chat.history[chat.history.length - 1];
    chat.hasCutOffResponse = !!last && last.role === "assistant" && isResponseLikelyCutOff(last.content);
}

/**
 * Runs one generation with the panel locked. Always unlocks, disposes the cancel signal and
 * saves, whichever way it ends (v1.1.0 left the input disabled on some early returns).
 */
async function runLocked(label: string, work: (signal: CancellationSignal | null) => Promise<void>): Promise<void> {
    if (chat.generating) {
        await api.v1.ui.toast("Already generating...", { type: "warning" });
        return;
    }
    chat.generating = true;
    chat.stopRequested = false;
    chat.dropdown = 'none';
    try {
        try {
            chat.signal = await api.v1.createCancellationSignal();
        } catch {
            chat.signal = null;
        }
        await updatePanel();
        await work(chat.signal);
    } catch (err: any) {
        if ((chat.signal && chat.signal.cancelled) || chat.stopRequested) {
            await api.v1.ui.toast(`${label} stopped.`, { type: "info" });
        } else {
            const message = formatError(err);
            await api.v1.ui.toast(`${label} failed: ${message}`, { type: "error" });
            api.v1.log(`ChatGLM: ${label} error: ${message}`);
        }
    } finally {
        if (chat.signal) {
            try {
                chat.signal.dispose();
            } catch {
                // already disposed
            }
        }
        chat.signal = null;
        chat.generating = false;
        chat.stopRequested = false;
        await saveChatHistory();
        await refreshStatus();
        await updatePanel();
    }
}

/** Repaints one streaming message without rebuilding the panel (no timers needed) */
function makeStreamPainter(index: number): (final: boolean) => void {
    let lastPaint = 0;
    return (final: boolean): void => {
        const now = Date.now();
        if (!final && now - lastPaint < STREAM_PAINT_INTERVAL_MS) return;
        lastPaint = now;
        const msg = chat.history[index];
        if (!msg) return;
        api.v1.ui.updateParts([{ type: 'text', id: messagePartId(index), text: formatMessageText(msg) }])
            .catch((err: any) => api.v1.log("ChatGLM: stream paint failed: " + formatError(err)));
    };
}

/** Streams a reply into chat.history[index]; returns the finish reason */
async function streamReply(index: number, messages: Message[], signal: CancellationSignal | null, previous: string): Promise<string | undefined> {
    const paint = makeStreamPainter(index);
    let received = "";
    const response = await api.v1.generate(
        messages,
        { model: MODEL_NAME, max_tokens: CHAT_OUTPUT_TOKENS },
        (choices: GenerationChoice[], final: boolean) => {
            if (chat.stopRequested) return;
            for (const choice of choices) received += choice.text || "";
            const msg = chat.history[index];
            if (msg) msg.content = previous ? previous + cleanContinuationText(previous, received) : received;
            paint(final);
        },
        "background",
        signal || undefined
    );
    const msg = chat.history[index];
    if (msg && previous) msg.content = previous + cleanContinuationText(previous, received);
    return response && response.choices && response.choices[0] ? response.choices[0].finish_reason : undefined;
}

// --- Send ---

async function handleSubmit(value: string): Promise<void> {
    const query = (value || "").trim();
    if (!query || chat.generating) return;
    let assistantIndex = -1;
    await runLocked("Generation", async (signal: CancellationSignal | null) => {
        // Build and size-check the real prompt first; on failure nothing is sent or added to the chat
        const plan = await planPrompt(chat.history, query, CHAT_OUTPUT_TOKENS);
        if (!plan.ok) {
            await api.v1.ui.toast(plan.reason, { type: "warning" });
            return;
        }
        if (!(await ensureTokenBudget(plan.messages, CHAT_OUTPUT_TOKENS))) return;

        chat.alternatives = {};
        chat.hasCutOffResponse = false;
        chat.history.push({ role: "user", content: query });
        await api.v1.storage.set(INPUT_KEY, "");
        chat.history.push({ role: "assistant", content: "", modelDisplayName: chat.modelName, modelId: chat.modelId });
        assistantIndex = chat.history.length - 1;
        await saveChatHistory();
        await updatePanel();

        try {
            const finish = await streamReply(assistantIndex, plan.messages, signal, "");
            chat.hasCutOffResponse = isResponseLikelyCutOff(chat.history[assistantIndex].content, finish);
        } finally {
            // Drop the placeholder if nothing arrived (stopped or failed before the first token)
            const msg = chat.history[assistantIndex];
            if (msg && !msg.content.trim()) chat.history.splice(assistantIndex, 1);
        }
    });
}

// --- Continue a cut-off reply ---

async function continueResponse(): Promise<void> {
    const index = chat.history.length - 1;
    const last = chat.history[index];
    if (!last || last.role !== "assistant") {
        chat.hasCutOffResponse = false;
        await updatePanel();
        return;
    }
    const previous = last.content;
    await runLocked("Continue", async (signal: CancellationSignal | null) => {
        const plan = await planPrompt(chat.history, CONTINUE_DIRECTIVE, CHAT_OUTPUT_TOKENS);
        if (!plan.ok) {
            await api.v1.ui.toast(plan.reason, { type: "warning" });
            return;
        }
        if (!(await ensureTokenBudget(plan.messages, CHAT_OUTPUT_TOKENS))) return;
        await api.v1.ui.toast("Continuing response...", { type: "info" });
        const finish = await streamReply(index, plan.messages, signal, previous);
        chat.hasCutOffResponse = isResponseLikelyCutOff(chat.history[index].content, finish);
        await api.v1.ui.toast(chat.hasCutOffResponse ? "Response continued (token limit reached again)." : "Response completed!",
            { type: chat.hasCutOffResponse ? "info" : "success" });
    });
}

// --- Redo with version history ---

async function redoResponse(index: number): Promise<void> {
    const target = chat.history[index];
    if (!target || target.role !== "assistant") return;
    if (index === 0) {
        await api.v1.ui.toast("No user prompt to redo from.", { type: "warning" });
        return;
    }
    const backup: ResponseVersion = {
        content: target.content,
        modelDisplayName: target.modelDisplayName || chat.modelName,
        modelId: target.modelId || chat.modelId
    };
    await runLocked("Regeneration", async (signal: CancellationSignal | null) => {
        const plan = await planPrompt(chat.history.slice(0, index), null, CHAT_OUTPUT_TOKENS);
        if (!plan.ok) {
            await api.v1.ui.toast(plan.reason, { type: "warning" });
            return;
        }
        if (!(await ensureTokenBudget(plan.messages, CHAT_OUTPUT_TOKENS))) return;
        if (!chat.alternatives[index]) chat.alternatives[index] = { versions: [backup], activeVersionIndex: 0 };

        target.content = "";
        await updatePanel();
        let finish: string | undefined;
        try {
            finish = await streamReply(index, plan.messages, signal, "");
        } finally {
            if (!target.content.trim()) {
                // Stopped or failed before any text: put the old reply back
                target.content = backup.content;
                target.modelDisplayName = backup.modelDisplayName;
                target.modelId = backup.modelId;
            }
        }
        if (!target.content.trim() || target.content === backup.content) return;
        target.modelDisplayName = chat.modelName;
        target.modelId = chat.modelId;
        const alt = chat.alternatives[index];
        alt.versions.push({ content: target.content, modelDisplayName: chat.modelName, modelId: chat.modelId });
        alt.activeVersionIndex = alt.versions.length - 1;
        if (index === chat.history.length - 1) chat.hasCutOffResponse = isResponseLikelyCutOff(target.content, finish);
        await api.v1.ui.toast("Response regenerated", { type: "success" });
    });
}

async function switchResponseVersion(index: number, direction: number): Promise<void> {
    if (chat.generating) return;
    const entry = chat.alternatives[index];
    if (!entry || entry.versions.length <= 1) return;
    const next = entry.activeVersionIndex + direction;
    if (next < 0 || next >= entry.versions.length) return;
    entry.activeVersionIndex = next;
    const chosen = entry.versions[next];
    const msg = chat.history[index];
    if (msg) {
        msg.content = chosen.content;
        msg.modelDisplayName = chosen.modelDisplayName;
        msg.modelId = chosen.modelId;
    }
    if (index === chat.history.length - 1) chat.hasCutOffResponse = isResponseLikelyCutOff(chosen.content);
    await saveChatHistory();
    await refreshStatus();
    await updatePanel();
}

// --- Compact ---

async function compactChatHistory(): Promise<void> {
    if (chat.history.length < 2) {
        await api.v1.ui.toast("No conversation to Compact.", { type: "warning" });
        return;
    }
    await runLocked("Compacting", async (signal: CancellationSignal | null) => {
        // Keep the newest messages that fit, so a chat too long to send can still be compacted
        const maxContext = await api.v1.maxTokens(MODEL_NAME);
        const budget = maxContext - SIDE_OUTPUT_TOKENS - PROMPT_SAFETY_TOKENS - (await countTokens(COMPACT_SUMMARY_PROMPT)) - MESSAGE_OVERHEAD_TOKENS;
        const kept: Message[] = [];
        let used = 0;
        for (let i = chat.history.length - 1; i >= 0; i--) {
            const m = chat.history[i];
            const cost = (await countTokens(m.content)) + MESSAGE_OVERHEAD_TOKENS;
            if (used + cost > budget) break;
            used += cost;
            kept.unshift({ role: m.role, content: m.content });
        }
        if (kept.length === 0) {
            await api.v1.ui.toast("The latest message alone is too long to compact. Clear the chat instead.", { type: "warning" });
            return;
        }
        const messages: Message[] = [...kept, { role: "user", content: COMPACT_SUMMARY_PROMPT }];
        if (!(await ensureTokenBudget(messages, SIDE_OUTPUT_TOKENS))) return;
        await api.v1.ui.toast(kept.length < chat.history.length
            ? `Compacting the latest ${kept.length} messages (older ones don't fit)...`
            : "Compacting chat history...", { type: "info" });

        let summary = "";
        await api.v1.generate(messages, { model: MODEL_NAME, max_tokens: SIDE_OUTPUT_TOKENS },
            (choices: GenerationChoice[]) => {
                if (chat.stopRequested) return;
                for (const choice of choices) summary += choice.text || "";
            }, "background", signal || undefined);

        if (!summary.trim()) {
            await api.v1.ui.toast(signal && signal.cancelled ? "Compacting stopped." : "Failed to generate summary", { type: signal && signal.cancelled ? "info" : "error" });
            return;
        }
        chat.history = [{ role: "assistant", content: "Summary (last session): " + summary.trim(), modelDisplayName: chat.modelName, modelId: chat.modelId }];
        chat.alternatives = {};
        chat.hasCutOffResponse = false;
        await api.v1.ui.toast("Chat history compacted!", { type: "success" });
    });
}

// --- Instruct: turn the discussion into a { instruction } at the end of the story ---

async function generateInstruction(): Promise<void> {
    if (chat.history.length === 0) {
        await api.v1.ui.toast("No chat history to generate from.", { type: "warning" });
        return;
    }
    if (!(await api.v1.permissions.has("documentEdit"))) {
        const granted = await api.v1.permissions.request("documentEdit", "Needed to add the instruction to your story.");
        if (!granted) {
            await api.v1.ui.toast("The document edit permission is required for Instruct.", { type: "error" });
            return;
        }
    }
    await runLocked("Instruction", async (signal: CancellationSignal | null) => {
        const instructPrompt = await getInstructPrompt();
        const messages: Message[] = [
            ...chat.history.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
            { role: "user", content: instructPrompt }
        ];
        // generateWithStory adds the story itself; reserve room for our chat messages so it trims the story instead of overflowing
        const chatTokens = await countMessageTokens(messages);
        const maxContext = await api.v1.maxTokens(MODEL_NAME);
        if (chatTokens + SIDE_OUTPUT_TOKENS + PROMPT_SAFETY_TOKENS > maxContext * 0.75) {
            await api.v1.ui.toast("The chat is too long for Instruct to leave room for the story. Compact it first.", { type: "warning" });
            return;
        }
        if (!(await ensureTokenBudget(messages, SIDE_OUTPUT_TOKENS))) return;
        await api.v1.ui.toast("Generating instruction...", { type: "info" });

        const response = await api.v1.generateWithStory(
            messages,
            { model: MODEL_NAME, max_tokens: SIDE_OUTPUT_TOKENS },
            { contextLimitReduction: chatTokens + PROMPT_SAFETY_TOKENS },
            undefined,
            "background",
            signal || undefined
        );
        const text = response && response.choices && response.choices[0] ? (response.choices[0].text || "").trim() : "";
        if (!text) {
            await api.v1.ui.toast(signal && signal.cancelled ? "Instruction generation stopped." : "Generation completed but produced no output",
                { type: signal && signal.cancelled ? "info" : "warning" });
            return;
        }
        // Only touch the story once there is something to add (v2.0 added a blank line first)
        await api.v1.document.append("\n{" + text);
        await api.v1.ui.toast("Instruction added!", { type: "success" });
    });
}

// --- Stop ---

async function stopGeneration(): Promise<void> {
    if (!chat.generating) return;
    await api.v1.ui.toast("Stopping generation...", { type: "info" });
    if (chat.signal) {
        try {
            await chat.signal.cancel();
        } catch (err: any) {
            api.v1.log("ChatGLM: error cancelling: " + formatError(err));
        }
    }
    // Ignore chunks still in flight. The lock stays until the run ends (runLocked's finally),
    // so a quick resend can't overlap the stopping run.
    chat.stopRequested = true;
    chat.hasCutOffResponse = false;
    await updatePanel();
}

// --- Message edits ---

async function deleteResponse(index: number): Promise<void> {
    if (chat.generating || index < 0 || index >= chat.history.length) return;
    chat.history.splice(index, 1);
    // Alternatives are keyed by index, so later ones no longer line up
    chat.alternatives = {};
    refreshCutOffFlag();
    await saveChatHistory();
    await refreshStatus();
    await updatePanel();
    await api.v1.ui.toast("Response deleted", { type: "info" });
}

/** Removes a user message and everything after it; returns the removed prompt */
async function truncateHistoryAt(index: number): Promise<string> {
    const prompt = chat.history[index] ? chat.history[index].content : "";
    chat.history = chat.history.slice(0, index);
    chat.alternatives = {};
    refreshCutOffFlag();
    await saveChatHistory();
    await refreshStatus();
    return prompt;
}

async function deleteUserMessage(index: number): Promise<void> {
    if (chat.generating || index < 0 || index >= chat.history.length) return;
    const later = chat.history.length - 1 - index;
    if (later > 0) {
        const ok = await confirmDialog("Delete Message & Context",
            `This deletes this message and the **${later}** message${later > 1 ? "s" : ""} after it (yours and the AI's). This can't be undone.`,
            "Delete & Wipe Context", true);
        if (!ok) return;
    }
    await truncateHistoryAt(index);
    await updatePanel();
    await api.v1.ui.toast("Message and subsequent context deleted", { type: "info" });
}

async function editAndRetryUserMessage(index: number): Promise<void> {
    if (chat.generating || index < 0 || index >= chat.history.length) return;
    const later = chat.history.length - 1 - index;
    if (later > 0) {
        const ok = await confirmDialog("Edit & Retry Message",
            `The message goes back into the input box, and the **${later}** message${later > 1 ? "s" : ""} after it are removed. This can't be undone.`,
            "Edit & Wipe Context", false);
        if (!ok) return;
    }
    const prompt = await truncateHistoryAt(index);
    await api.v1.storage.set(INPUT_KEY, prompt);
    await updatePanel();
    await api.v1.ui.toast("Message restored to input for editing", { type: "info" });
}

async function clearChat(): Promise<void> {
    if (chat.generating) return;
    if (chat.history.length > 0) {
        const ok = await confirmDialog("Clear chat?", `This deletes all **${chat.history.length}** messages in this story's chat. This can't be undone.`, "Clear chat", true);
        if (!ok) return;
    }
    chat.history = [];
    chat.alternatives = {};
    chat.hasCutOffResponse = false;
    await saveChatHistory();
    await refreshStatus();
    await updatePanel();
}
