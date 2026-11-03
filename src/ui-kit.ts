// --- ChatGLM UI Kit: theme tokens, presets, component factories, dialogs ---

/** Semantic names for NovelAI theme tokens (no hardcoded hex/rgba colours) */
const COLOR = {
    canvas: 'bg0',
    surface: 'bg1',
    raised: 'bg2',
    selected: 'bg3',
    heading: 'textHeadings',
    body: 'textMain',
    muted: 'textDisabled',
    danger: 'warning',
    /** Story text colours double as accents for the three context kinds */
    selection: 'textHighlight',
    chapter: 'textAI',
    lore: 'textEdit'
} as const;

type Style = Record<string, string>;

const sx = (...styles: (Style | undefined | false)[]): Style => Object.assign({}, ...styles.filter(Boolean));

const S: Record<string, Style> = {
    smallButton: {
        height: '22px', padding: '0 6px', margin: '0', fontSize: '0.75em',
        backgroundColor: COLOR.raised, border: `1px solid ${COLOR.raised}`, borderRadius: '4px',
        color: COLOR.muted, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap'
    },
    toolbarButton: { flex: '1', height: '32px', margin: '0', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    dropup: {
        marginBottom: '4px', padding: '4px', backgroundColor: COLOR.surface, border: `1px solid ${COLOR.raised}`,
        borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '200px', overflowY: 'auto'
    },
    dropupRow: { textAlign: 'left', justifyContent: 'flex-start', paddingLeft: '8px', margin: '0', height: '26px', border: 'none', fontSize: '0.82em' },
    actionRow: { gap: '4px', marginTop: '0', marginBottom: '10px', justifyContent: 'flex-end', alignItems: 'center' },
    muted: { color: COLOR.muted, fontSize: '0.8em' }
};

type ButtonVariant = 'default' | 'primary' | 'danger' | 'subtle' | 'small';

const BUTTON_VARIANTS: Record<ButtonVariant, Style> = {
    default: {},
    primary: { backgroundColor: COLOR.selected, color: COLOR.heading, fontWeight: 'bold' },
    danger: { backgroundColor: COLOR.raised, color: COLOR.danger, border: `1px solid ${COLOR.danger}`, fontWeight: 'bold' },
    subtle: { backgroundColor: 'transparent', border: 'none', color: COLOR.body },
    small: S.smallButton
};

interface ButtonOpts {
    id?: string;
    icon?: IconId;
    variant?: ButtonVariant;
    disabled?: boolean;
    style?: Style;
}

function button(text: string, onClick: () => void | Promise<void>, opts: ButtonOpts = {}): UIPart {
    return {
        type: 'button',
        id: opts.id,
        text,
        iconId: opts.icon,
        disabled: !!opts.disabled,
        disabledWhileCallbackRunning: true,
        callback: onClick,
        style: sx(BUTTON_VARIANTS[opts.variant || 'default'], opts.style)
    };
}

function text(value: string, opts: { id?: string; markdown?: boolean; style?: Style } = {}): UIPart {
    return { type: 'text', id: opts.id, text: value, markdown: opts.markdown !== false, noTemplate: true, style: opts.style };
}

function row(children: UIPart[], style: Style = {}): UIPart {
    return { type: 'row', content: children, style: sx({ alignItems: 'center' }, style) };
}

function column(children: UIPart[], style: Style = {}): UIPart {
    return { type: 'column', content: children, style };
}

/** Checkbox-style icon for an on / partly on / off state */
function checkIcon(state: 'all' | 'some' | 'none'): IconId {
    return state === 'all' ? 'check-square' : state === 'some' ? 'minus-square' : 'square';
}

interface DialogChoice {
    value: string;
    label: string;
    icon: IconId;
    variant: ButtonVariant;
}

/**
 * Dialog with a Cancel button plus `choices`; resolves to the picked value, or null for Cancel.
 * Resolves before closing so the closed-handler fallback never wins, and treats the X button as "cancel".
 */
async function choiceDialog(title: string, message: string, choices: DialogChoice[]): Promise<string | null> {
    return new Promise<string | null>(async (resolve: (value: string | null) => void) => {
        let done = false;
        const finish = (value: string | null): void => {
            if (!done) {
                done = true;
                resolve(value);
            }
        };
        const modal = await api.v1.ui.modal.open({
            title,
            size: 'small',
            content: [
                text(message),
                row([
                    button("Cancel", async () => { finish(null); await modal.close(); }, { icon: 'x', variant: 'subtle' }),
                    ...choices.map((c: DialogChoice) => button(c.label, async () => { finish(c.value); await modal.close(); }, { icon: c.icon, variant: c.variant }))
                ], { justifyContent: 'flex-end', gap: '8px', marginTop: '12px' })
            ]
        });
        modal.closed.then(() => finish(null));
    });
}

/** Yes/no dialog */
async function confirmDialog(title: string, message: string, confirmText: string, danger: boolean): Promise<boolean> {
    const picked = await choiceDialog(title, message, [
        { value: "yes", label: confirmText, icon: danger ? 'trash-2' : 'check', variant: danger ? 'danger' : 'primary' }
    ]);
    return picked === "yes";
}

// --- Chat message rendering helpers ---

function messagePartId(index: number): string {
    return `msg-${index}`;
}

function formatMessageText(msg: ChatMessage): string {
    if (msg.role === "user") return `**You:** ${msg.content}`;
    return `**${msg.modelDisplayName || chat.modelName}:** ${msg.content}`;
}
