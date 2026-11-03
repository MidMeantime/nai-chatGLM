// --- ChatGLM Startup ---

const STATUS_POLL_MS = 15000;

/**
 * Typing in the story has no hook, so the status line is refreshed on a timer. It only
 * re-tokenizes when the document actually changed, and only repaints the status text (a full
 * re-render every 15s could interrupt typing in the chat box).
 */
function startStatusPoll(): void {
    if (chat.pollStarted) return;
    chat.pollStarted = true;
    (async () => {
        while (true) {
            await api.v1.timers.sleep(STATUS_POLL_MS);
            if (chat.generating) continue;
            try {
                const signature = documentSignature(await getDocumentSections());
                if (signature === chat.docSignature) continue;
                chat.docSignature = signature;
                await refreshStatus();
                await paintStatus();
            } catch (err: any) {
                api.v1.log("ChatGLM: status poll error: " + formatError(err));
            }
        }
    })().catch((err: any) => api.v1.log("ChatGLM: status poll stopped: " + formatError(err)));
}

async function initChatGLM(): Promise<void> {
    try {
        await registerStaticExtensions();
        await loadPersistedState();
        await updatePanel();
        await fetchLorebookData();
        await refreshActiveModel();
        chat.docSignature = documentSignature(await getDocumentSections());
        await refreshStatus();
        await updatePanel();
        await api.v1.ui.openPanel(PANEL_ID);
        startStatusPoll();
        startUccdsLink().catch((err: any) => api.v1.log("ChatGLM: UCCDS start failed: " + formatError(err)));
        api.v1.log("ChatGLM v2 initialized");
    } catch (err: any) {
        api.v1.error("ChatGLM: initialization failed", err);
    }
}

initChatGLM().catch((err: any) => api.v1.error("ChatGLM: init error", err));
