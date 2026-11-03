// --- ChatGLM Panel ---

function truncateLabel(value: string, max: number): string {
    return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function selectedChapters(): DetectedChapter[] {
    return chat.chapters.filter((c: DetectedChapter) => chat.chapterKeys.includes(c.key));
}

/** Status line text + accent colour: what the AI will read */
function statusInfo(): { text: string; color: string } {
    const lore = chat.loreIds.length > 0 ? ` (+${chat.loreIds.length} Lore)` : "";
    const pct = chat.status.percentage;
    const partial = chat.status.ok && pct < 100;
    if (!chat.status.ok) return { text: chat.status.reason || "Not enough room for the story.", color: COLOR.danger };

    if (chat.selectedContextText) {
        const preview = chat.selectedContextText.slice(0, 24).trim().replace(/\s+/g, " ");
        return { text: `Selection: "${preview}..."${lore}`, color: COLOR.selection };
    }
    const picked = selectedChapters();
    if (picked.length > 0) {
        const prev = chat.usePreviousContext && picked[0].index > 0 ? " (+Prev)" : "";
        let label: string;
        if (picked.length === 1) {
            const ch = picked[0];
            const name = chapterDisplayName(ch);
            label = `${ch.label}${prev}${name ? `: ${truncateLabel(name, 14)}` : ""}`;
        } else {
            const labels = picked.map((c: DetectedChapter) => c.label).join(", ");
            label = `${labels.length > 22 ? `${picked.length} Chapters` : labels}${prev}`;
        }
        return { text: partial ? `~${pct}% of ${label}${lore}` : `${label}${lore}`, color: partial ? COLOR.danger : COLOR.chapter };
    }
    if (partial) return { text: `AI will read ~${pct}% of document${lore}.`, color: COLOR.danger };
    return chat.loreIds.length > 0
        ? { text: `Document${lore}`, color: COLOR.lore }
        : { text: "AI will read the current document.", color: COLOR.muted };
}

function chapterButtonLabel(): string {
    const picked = selectedChapters();
    if (picked.length === 0) return "Full Doc";
    if (picked.length === 1) return picked[0].label;
    const short = `Ch. ${picked.map((c: DetectedChapter) => c.isPrologue ? "P" : c.isEpilogue ? "E" : String(c.number === null ? "?" : c.number)).join(",")}`;
    return short.length <= 12 ? short : `${picked.length} Chapters`;
}

function loreButtonLabel(): string {
    if (chat.loreIds.length === 0) return "Lore";
    if (chat.loreIds.length > 1) return `${chat.loreIds.length} Lore`;
    const entry = chat.loreEntries.find((e: LorebookEntry) => e.id === chat.loreIds[0]);
    return entry ? `Lore: ${truncateLabel(lorebookEntryName(entry), 10)}` : "1 Lore";
}

// --- Selection changes (button callbacks, so full re-renders are safe) ---

async function afterSelectionChange(toast?: string): Promise<void> {
    await saveSelections();
    await refreshStatus();
    await updatePanel();
    if (toast) await api.v1.ui.toast(toast, { type: "info" });
}

async function toggleDropdown(which: ChatDropdown): Promise<void> {
    chat.dropdown = chat.dropdown === which ? 'none' : which;
    if (chat.dropdown === 'lore') await fetchLorebookData();
    if (chat.dropdown === 'model') await getAvailableModels();
    if (chat.dropdown === 'chapter') await getActiveStoryContext();
    await updatePanel();
}

async function clearContextOverrides(): Promise<void> {
    chat.selectedContextText = null;
    chat.chapterKeys = [];
    chat.loreIds = [];
    await afterSelectionChange();
}

async function togglePreviousContext(): Promise<void> {
    chat.usePreviousContext = !chat.usePreviousContext;
    await afterSelectionChange(chat.usePreviousContext ? "Previous Context: Enabled" : "Previous Context: Disabled");
}

function toggleLoreIds(ids: string[], on: boolean): void {
    const set = new Set<string>(chat.loreIds);
    for (const id of ids) {
        if (on) set.add(id);
        else set.delete(id);
    }
    chat.loreIds = Array.from(set);
}

// --- View pieces ---

function messageViews(): UIPart[] {
    const parts: UIPart[] = [];
    chat.history.forEach((msg: ChatMessage, index: number) => {
        parts.push(text(formatMessageText(msg), {
            id: messagePartId(index),
            style: { marginBottom: '2px', color: msg.role === "user" ? COLOR.muted : COLOR.body, userSelect: 'text', cursor: 'text' }
        }));
        if (chat.generating) return;

        if (msg.role === "user") {
            parts.push(row([
                button("Edit & Retry", async () => editAndRetryUserMessage(index), { icon: 'edit-2', variant: 'small' }),
                button("Delete", async () => deleteUserMessage(index), { icon: 'trash', variant: 'small' })
            ], S.actionRow));
            return;
        }

        const controls: UIPart[] = [];
        const alt = chat.alternatives[index];
        if (alt && alt.versions.length > 1) {
            const current = alt.versions[alt.activeVersionIndex];
            const models = new Set<string>(alt.versions.map((v: ResponseVersion) => (v.modelDisplayName || v.modelId || "").trim()).filter((v: string) => v.length > 0));
            const label = models.size > 1 && current && current.modelDisplayName
                ? `${alt.activeVersionIndex + 1}/${alt.versions.length} (${current.modelDisplayName})`
                : `${alt.activeVersionIndex + 1}/${alt.versions.length}`;
            controls.push(
                button("", async () => switchResponseVersion(index, -1), { icon: 'chevron-left', variant: 'small', disabled: alt.activeVersionIndex === 0 }),
                text(label, { markdown: false, style: { fontSize: '0.72em', color: COLOR.chapter, padding: '0 2px', userSelect: 'none' } }),
                button("", async () => switchResponseVersion(index, 1), { icon: 'chevron-right', variant: 'small', disabled: alt.activeVersionIndex >= alt.versions.length - 1 })
            );
        }
        controls.push(
            button("Redo", async () => redoResponse(index), { icon: 'refresh-cw', variant: 'small' }),
            button("Delete", async () => deleteResponse(index), { icon: 'trash', variant: 'small' })
        );
        parts.push(row(controls, S.actionRow));
    });
    if (chat.history.length === 0) {
        parts.push(text("Ask about your story. The AI reads the document (or the chapters, selection and lorebook entries you pick below).", { style: S.muted }));
    }
    return parts;
}

function statusRow(): UIPart {
    const info = statusInfo();
    const hasOverride = chat.selectedContextText !== null || chat.chapterKeys.length > 0 || chat.loreIds.length > 0;
    const content: UIPart[] = [
        text(info.text, {
            id: STATUS_ID,
            markdown: false,
            style: { color: info.color, fontSize: '0.82em', marginRight: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto' }
        })
    ];
    if (hasOverride) {
        content.push(button("", clearContextOverrides, { icon: 'x', variant: 'subtle', style: { width: '20px', height: '20px', padding: '0' } }));
    }
    if (chat.chapterKeys.length > 0) {
        content.push(button("Prev chapters", togglePreviousContext, {
            icon: chat.usePreviousContext ? 'check-square' : 'square', variant: 'small',
            style: chat.usePreviousContext ? { color: COLOR.chapter, borderColor: COLOR.chapter } : {}
        }));
    }
    content.push(
        button(chapterButtonLabel(), async () => toggleDropdown('chapter'), {
            icon: chat.dropdown === 'chapter' ? 'chevron-down' : 'chevron-up', variant: 'small',
            style: chat.chapterKeys.length > 0 ? { color: COLOR.chapter, borderColor: COLOR.chapter } : {}
        }),
        button(loreButtonLabel(), async () => toggleDropdown('lore'), {
            icon: chat.dropdown === 'lore' ? 'chevron-down' : 'chevron-up', variant: 'small',
            style: chat.loreIds.length > 0 ? { color: COLOR.lore, borderColor: COLOR.lore } : {}
        })
    );
    return row(content, { marginBottom: '2px', marginLeft: '4px', marginRight: '4px', justifyContent: 'space-between', gap: '4px' });
}

function chapterDropup(): UIPart {
    const items: UIPart[] = [
        button("Full Document", async () => {
            chat.chapterKeys = [];
            chat.selectedContextText = null;
            chat.dropdown = 'none';
            await afterSelectionChange("Targeting: Full Document");
        }, { icon: chat.chapterKeys.length === 0 ? 'check' : 'file', variant: 'subtle', style: sx(S.dropupRow, chat.chapterKeys.length === 0 ? { fontWeight: 'bold', backgroundColor: COLOR.raised } : {}) })
    ];
    if (chat.chapterKeys.length > 0) {
        items.push(button("Include earlier chapters as background", togglePreviousContext, {
            icon: chat.usePreviousContext ? 'check-square' : 'square', variant: 'subtle', style: S.dropupRow
        }));
    }
    items.push(text(chapterSourceNote(), { markdown: false, style: sx(S.muted, { padding: '4px 8px', fontSize: '0.85em' }) }));
    if (chat.chapters.length === 0) {
        items.push(text(`No chapters found (${chat.breakToken})`, { markdown: false, style: sx(S.muted, { padding: '6px 8px', fontStyle: 'italic' }) }));
    }
    for (const ch of chat.chapters) {
        const checked = chat.chapterKeys.includes(ch.key);
        const sole = checked && chat.chapterKeys.length === 1;
        const name = chapterDisplayName(ch);
        const full = name && name !== ch.label ? `${ch.label}: ${name}` : ch.label;
        items.push(row([
            button("", async () => {
                chat.chapterKeys = checked
                    ? chat.chapterKeys.filter((k: number) => k !== ch.key)
                    : chat.chapters.filter((c: DetectedChapter) => c.key === ch.key || chat.chapterKeys.includes(c.key)).map((c: DetectedChapter) => c.key);
                chat.selectedContextText = null;
                const n = chat.chapterKeys.length;
                await afterSelectionChange(n === 0 ? "Targeting: Full Document" : `Targeting ${n} Chapter${n > 1 ? "s" : ""}`);
            }, { icon: checkIcon(checked ? 'all' : 'none'), variant: 'small', style: sx({ width: '28px', justifyContent: 'center', flexShrink: '0' }, checked ? { color: COLOR.chapter } : {}) }),
            button(truncateLabel(full, 26), async () => {
                chat.chapterKeys = [ch.key];
                chat.selectedContextText = null;
                chat.dropdown = 'none';
                await afterSelectionChange(`Targeting: ${full}`);
            }, { variant: 'subtle', style: sx(S.dropupRow, { flex: '1 1 auto', paddingLeft: '6px', overflow: 'hidden', textOverflow: 'ellipsis' },
                checked ? { fontWeight: 'bold', color: sole ? COLOR.heading : COLOR.chapter } : {}, sole ? { backgroundColor: COLOR.raised } : {}) })
        ], { gap: '4px', height: '28px' }));
    }
    return column(items, S.dropup);
}

function loreDropup(): UIPart {
    const items: UIPart[] = [
        button("None (no lorebook entries attached)", async () => {
            chat.loreIds = [];
            chat.dropdown = 'none';
            await afterSelectionChange("No Lorebooks attached");
        }, { icon: chat.loreIds.length === 0 ? 'check' : 'slash', variant: 'subtle', style: sx(S.dropupRow, chat.loreIds.length === 0 ? { fontWeight: 'bold', backgroundColor: COLOR.raised } : {}) })
    ];
    if (chat.loreEntries.length === 0) {
        items.push(text("No lorebook entries found in story", { markdown: false, style: sx(S.muted, { padding: '6px 8px', fontStyle: 'italic' }) }));
        return column(items, S.dropup);
    }

    const groups: { id: string; name: string; entries: LorebookEntry[] }[] = chat.loreCategories
        .filter((c: LorebookCategory) => c && c.id)
        .map((c: LorebookCategory) => ({ id: c.id, name: c.name || "Category", entries: [] as LorebookEntry[] }));
    const uncategorized: LorebookEntry[] = [];
    for (const entry of chat.loreEntries) {
        if (!entry || !entry.id) continue;
        const group = entry.category ? groups.find((g: { id: string }) => g.id === entry.category) : undefined;
        if (group) group.entries.push(entry);
        else uncategorized.push(entry);
    }
    if (uncategorized.length > 0) groups.push({ id: "uncategorized", name: "General / Uncategorized", entries: uncategorized });

    for (const group of groups) {
        if (group.entries.length === 0) continue;
        const ids = group.entries.map((e: LorebookEntry) => e.id);
        const all = ids.every((id: string) => chat.loreIds.includes(id));
        const some = ids.some((id: string) => chat.loreIds.includes(id));
        const toggleGroup = async (): Promise<void> => {
            toggleLoreIds(ids, !all);
            await afterSelectionChange(`${group.name}: ${all ? "Deselected" : "Selected"} (${ids.length} entries)`);
        };
        items.push(row([
            button("", toggleGroup, { icon: checkIcon(all ? 'all' : some ? 'some' : 'none'), variant: 'small', style: sx({ width: '26px', justifyContent: 'center', flexShrink: '0' }, some ? { color: COLOR.lore } : {}) }),
            button(`${group.name} (${ids.length})`, toggleGroup, { icon: 'folder', variant: 'subtle', style: sx(S.dropupRow, { flex: '1 1 auto', paddingLeft: '4px' }, some ? { fontWeight: 'bold', color: COLOR.lore } : {}) })
        ], { gap: '4px', marginTop: '4px', backgroundColor: some ? COLOR.raised : 'transparent', borderRadius: '4px', padding: '0 2px' }));

        for (const entry of group.entries) {
            const checked = chat.loreIds.includes(entry.id);
            const sole = checked && chat.loreIds.length === 1;
            const name = lorebookEntryName(entry);
            items.push(row([
                button("", async () => {
                    toggleLoreIds([entry.id], !checked);
                    const n = chat.loreIds.length;
                    await afterSelectionChange(n === 0 ? "No Lorebooks attached" : `Targeting ${n} Lorebook${n > 1 ? "s" : ""}`);
                }, { icon: checkIcon(checked ? 'all' : 'none'), variant: 'small', style: sx({ width: '26px', justifyContent: 'center', flexShrink: '0' }, checked ? { color: COLOR.lore } : {}) }),
                button(truncateLabel(name, 24), async () => {
                    chat.loreIds = [entry.id];
                    chat.dropdown = 'none';
                    await afterSelectionChange(`Attached Lorebook: ${name}`);
                }, { variant: 'subtle', style: sx(S.dropupRow, { flex: '1 1 auto', paddingLeft: '6px', overflow: 'hidden', textOverflow: 'ellipsis' },
                    checked ? { fontWeight: 'bold', color: sole ? COLOR.heading : COLOR.lore } : {}) })
            ], { gap: '4px', marginLeft: '12px' }));
        }
    }
    return column(items, S.dropup);
}

function modelDropup(): UIPart {
    return column(chat.models.map((model: ChatModel) => button(model.name, async () => {
        chat.modelId = model.id;
        chat.dropdown = 'none';
        await api.v1.storage.set(MODEL_KEY, model.id);
        await refreshActiveModel();
        await refreshStatus();
        await updatePanel();
        await api.v1.ui.toast(`Model: ${chat.modelName}`, { type: "info" });
    }, {
        icon: model.id === chat.modelId ? 'check' : 'user', variant: 'subtle',
        style: sx(S.dropupRow, model.id === chat.modelId ? { fontWeight: 'bold', backgroundColor: COLOR.raised } : {})
    })), S.dropup);
}

/** Export / import / clear: each row closes the dropup, then acts */
function chatDropup(): UIPart {
    const hasChat = chat.history.length > 0;
    const item = (label: string, icon: IconId, action: () => Promise<void>, enabled: boolean = true, danger: boolean = false): UIPart =>
        button(label, async () => {
            chat.dropdown = 'none';
            await updatePanel();
            await action();
        }, { icon, variant: 'subtle', disabled: !enabled, style: sx(S.dropupRow, danger ? { color: COLOR.danger } : {}) });
    return column([
        item("Export as JSON", 'download', async () => exportChat('json'), hasChat),
        item("Export as Markdown", 'file-text', async () => exportChat('markdown'), hasChat),
        item("Export both", 'download', async () => exportChat('both'), hasChat),
        item("Copy as Markdown", 'copy', copyChatMarkdown, hasChat),
        item("Import from JSON...", 'upload', importChat),
        item("Clear chat", 'trash-2', clearChat, hasChat, true)
    ], S.dropup);
}

function toolbarRow(): UIPart {
    if (chat.generating) {
        return row([
            button(chat.stopRequested ? "Stopping..." : "Stop Generating", stopGeneration, {
                id: "btn-stop-generating-primary", icon: 'stop-circle', variant: 'danger', disabled: chat.stopRequested, style: S.toolbarButton
            })
        ]);
    }
    return row([
        button("Chat", async () => toggleDropdown('chat'), {
            icon: chat.dropdown === 'chat' ? 'chevron-down' : 'chevron-up', style: S.toolbarButton
        }),
        button("Compact", compactChatHistory, { icon: 'message-circle', style: S.toolbarButton }),
        button("Instruct", generateInstruction, { icon: 'terminal', style: S.toolbarButton }),
        button(truncateLabel(chat.modelName, 9), async () => toggleDropdown('model'), {
            icon: chat.dropdown === 'model' ? 'chevron-down' : 'chevron-up', style: S.toolbarButton
        })
    ]);
}

function inputRow(): UIPart {
    return row([
        {
            type: 'textInput',
            id: "chat-input-bar",
            storageKey: INPUT_KEY,
            placeholder: chat.generating ? "Generating response..." : "Type your message...",
            onSubmit: (value: string) => { if (!chat.generating) handleSubmit(value).catch((err: any) => api.v1.log("ChatGLM: submit error: " + formatError(err))); },
            disabled: chat.generating,
            style: { flex: '1 1 0', marginRight: '0', paddingRight: '0' }
        },
        button("", chat.generating ? stopGeneration : openMultilineInputModal, {
            id: "btn-input-action",
            icon: chat.generating ? 'stop-circle' : 'edit-3',
            variant: chat.generating ? 'danger' : 'default',
            style: { width: '38px', height: '38px', marginLeft: '0', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }
        })
    ]);
}

function getUiContent(): UIPart[] {
    const parts: UIPart[] = [
        column(messageViews(), { flex: '1 1 0', overflowY: 'auto', justifyContent: 'flex-start', padding: '4px 8px' }),
        statusRow()
    ];
    if (chat.dropdown === 'chapter') parts.push(chapterDropup());
    if (chat.dropdown === 'lore') parts.push(loreDropup());
    if (chat.dropdown === 'model') parts.push(modelDropup());
    if (chat.dropdown === 'chat') parts.push(chatDropup());
    if (chat.hasCutOffResponse && !chat.generating) {
        parts.push(row([
            button("Continue Response", continueResponse, { icon: 'play', variant: 'primary', style: { flex: '1 1 auto', height: '30px', fontSize: '0.85em', justifyContent: 'center' } }),
            button("", async () => { chat.hasCutOffResponse = false; await updatePanel(); }, { icon: 'x', variant: 'small', style: { width: '28px', height: '30px', justifyContent: 'center' } })
        ], { marginBottom: '6px', gap: '4px' }));
    }
    parts.push(toolbarRow(), inputRow());
    return parts;
}

// --- Rendering ---

let isPanelUpdateInProgress = false;
let hasPendingPanelUpdate = false;

/** Coalesced: while one update is in flight, further calls collapse into one follow-up update */
async function updatePanel(): Promise<void> {
    if (isPanelUpdateInProgress) {
        hasPendingPanelUpdate = true;
        return;
    }
    isPanelUpdateInProgress = true;
    try {
        do {
            hasPendingPanelUpdate = false;
            await api.v1.ui.update([{
                type: 'sidebarPanel',
                id: PANEL_ID,
                name: "Chat",
                iconId: 'message-square',
                content: [column(getUiContent(), { height: '100%', display: 'flex', flexDirection: 'column' })]
            }]);
        } while (hasPendingPanelUpdate);
    } catch (err: any) {
        api.v1.log("ChatGLM: error updating panel: " + formatError(err));
    } finally {
        isPanelUpdateInProgress = false;
    }
}

/** Refreshes only the status line (used by the background poll so typing isn't disturbed) */
async function paintStatus(): Promise<void> {
    const info = statusInfo();
    try {
        await api.v1.ui.updateParts([{ type: 'text', id: STATUS_ID, text: info.text, style: { color: info.color, fontSize: '0.82em', marginRight: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto' } }]);
    } catch {
        // not mounted yet
    }
}

/** Writer's Toolbox option and editor context-menu button ("Add to Chat") */
async function registerStaticExtensions(): Promise<void> {
    try {
        // ui.update creates them if missing and survives the script being disabled/re-enabled
        await api.v1.ui.update([
            {
                type: 'toolboxOption',
                id: "chat-toolbox-add-context",
                name: "Add to Chat",
                description: "Select this as context for the sidebar chat.",
                iconId: 'message-square',
                callback: ({ text: selected }: { selection: DocumentSelection; text: string }) => {
                    setSelectedContext(selected).catch((err: any) => api.v1.log("ChatGLM: add to chat failed: " + formatError(err)));
                    // Returning the same text leaves the story unchanged
                    return { text: selected };
                }
            },
            {
                type: 'contextMenuButton',
                id: "chat-context-menu-add-context",
                text: "Add to Chat",
                callback: ({ selection }: { selection: DocumentSelection }) => {
                    (async () => {
                        if (!selection || selection.from === undefined) {
                            await api.v1.ui.toast("Issue with text selection. Please reselect it.", { type: "warning" });
                            return;
                        }
                        await setSelectedContext(await api.v1.document.textFromSelection(selection));
                    })().catch(async (err: any) => {
                        await api.v1.ui.toast("Error adding selection: " + formatError(err), { type: "error" });
                    });
                }
            }
        ]);
    } catch (err: any) {
        api.v1.log("ChatGLM: static extensions registration error: " + formatError(err));
    }
}
