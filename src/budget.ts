// --- ChatGLM Script Token Budget (rate limits) ---
// Two separate limits apply to scripts: output tokens, and *uncached* input tokens over a rolling
// 6-minute window. v2.0 only checked output, so a huge prompt could still burn the input
// allowance. Both are checked here, after the prompt is built and before anything is sent.

async function waitOrRefuse(kind: "output" | "input", waitMs: number, wait: () => Promise<void>): Promise<boolean> {
    if (waitMs > MAX_BUDGET_WAIT_MS) {
        const seconds = Math.ceil(waitMs / 1000);
        const when = seconds < 60 ? `${seconds} seconds` : `about ${Math.ceil(seconds / 60)} minutes`;
        await api.v1.ui.toast(`Script ${kind} token limit reached. Please wait ${when}, then retry.`, { type: "warning" });
        return false;
    }
    if (waitMs > 0) {
        await api.v1.ui.toast(`Waiting for token budget (${Math.ceil(waitMs / 1000)}s)...`, { type: "info" });
        await wait();
    }
    return true;
}

/** True when both budgets allow this request now (or after a short wait) */
async function ensureTokenBudget(messages: Message[], outputTokens: number): Promise<boolean> {
    if (api.v1.script.getAllowedOutput() < outputTokens) {
        const waitMs = api.v1.script.getTimeUntilAllowedOutput(outputTokens);
        if (!(await waitOrRefuse("output", waitMs, () => api.v1.script.waitForAllowedOutput(outputTokens)))) return false;
    }
    if (messages.length > 0) {
        const uncached = api.v1.script.countUncachedInputTokens(messages);
        if (uncached > api.v1.script.getAllowedInput()) {
            const waitMs = api.v1.script.getTimeUntilAllowedInput(uncached);
            if (!(await waitOrRefuse("input", waitMs, () => api.v1.script.waitForAllowedInput(uncached)))) return false;
        }
    }
    return true;
}
