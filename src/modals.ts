// --- ChatGLM Multi-line Input Window ---

async function openMultilineInputModal(): Promise<void> {
    let wndw: { close: () => Promise<void> } | null = null;
    const send = async (value: string): Promise<void> => {
        if (!value || !value.trim()) return;
        await api.v1.storage.set(INPUT_KEY, "");
        if (wndw) await wndw.close();
        await updatePanel();
        await handleSubmit(value);
    };
    wndw = await api.v1.ui.window.open({
        title: "Chat Message",
        defaultHeight: 500,
        defaultWidth: 650,
        content: [
            column([
                {
                    type: 'multilineTextInput',
                    storageKey: INPUT_KEY,
                    style: { flex: '1 1 0', minHeight: '200px' },
                    onSubmit: (value: string) => { send(value).catch((err: any) => api.v1.log("ChatGLM: send failed: " + formatError(err))); }
                },
                row([
                    button("Close", async () => { if (wndw) await wndw.close(); }, { icon: 'x', variant: 'subtle' }),
                    button("Send", async () => send(String((await api.v1.storage.get(INPUT_KEY)) || "")), { icon: 'send', variant: 'primary' })
                ], { marginTop: '16px', justifyContent: 'flex-end', gap: '8px' })
            ], { height: '100%', display: 'flex', flexDirection: 'column' })
        ]
    });
}
