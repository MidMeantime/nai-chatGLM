// ChatGLM tests: build the real script, then run it against a mock NovelAI story.
// Run: node scripts/test.js   (fetches UCCDS and its tooling on first run, see scripts/deps.js)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ensureDeps } = require('./deps.js');
const { loadBundle, settle, createRunner, findParts } = require(path.join(ensureDeps().uccds, 'tools', 'harness.js'));
const { build } = require('./build.js');

const { target } = build();
const t = createRunner('ChatGLM v2');
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

// A short persona keeps token maths readable (the mock tokenizer counts characters)
const SHORT_PROMPT = { system_prompt_assistant: 'You are a test persona.\n- **Context Type:** {{contextType}}\n- **Current Text:** {{storyText}}' };

async function boot(options = {}) {
    const env = loadBundle(target, Object.assign({ maxTokens: 40000 }, options, { config: Object.assign({}, SHORT_PROMPT, options.config || {}) }));
    await settle(40);
    return env;
}
/** Auto-clicks the modal button whose text matches `label` */
const clickModal = (label) => (handle, find) => {
    const btn = find(handle.opts.content, (p) => p.type === 'button' && label.test(p.text || ''))[0];
    if (!btn) throw new Error(`No modal button ${label}`);
    btn.callback();
};

const STORY = [
    'Prose in the prologue before any header.',
    '***',
    '# Chapter 1: The Dark Forest',
    'Alice walked into the dark forest.',
    '***',
    '[ Chapter 2: The Haunted Cabin ]',
    'She kept walking, finding the old cabin.',
    '***',
    'Chapter 3: Whispers in the Mist',
    'Hearing strange whispers.',
    '***',
    '## Chapter 4: The Ancient Gate',
    'Then reaching the iron gate.'
];
const LORE = {
    loreCategories: [{ id: 'cat-chars', name: 'Characters' }],
    loreEntries: [
        { id: 'alice', displayName: 'Alice Vance', category: 'cat-chars', text: 'Alice is an intrepid archaeologist.' },
        { id: 'moon', displayName: 'The Blood Moon', text: 'Every century, the moon turns crimson.' }
    ]
};

// ---------- Prompts & heuristics (carried over from test_cutoff.js) ----------

t.test('system prompt placeholders, auto context block, and literal $ in story text', async () => {
    const { run } = await boot();
    const fmt = run('formatSystemPromptWithContext');
    const builtin = fmt(run('SYSTEM_PROMPT_DEF'), 'Chapter 1: The Beginning', 'It was a dark and stormy night.');
    assert.ok(builtin.includes('Chapter 1: The Beginning') && builtin.includes('It was a dark and stormy night.') && !builtin.includes('{{storyText}}'));
    const custom = fmt('You are a test persona.', 'Chapter 2: The Haunted Forest', 'The trees seemed to whisper in the wind.');
    assert.ok(custom.startsWith('You are a test persona.'));
    assert.ok(custom.includes('### CONTEXT (e.g. full outline, draft excerpt, scattered notes)'));
    assert.ok(custom.includes('- **Context Type:** Chapter 2: The Haunted Forest'));
    assert.ok(fmt('X {{storyText}}', 'T', 'The price was $50. It cost $100 and $& was fine with $1.').includes('$& was fine with $1.'));
});

t.test('cut-off detection and continuation cleanup', async () => {
    const { run } = await boot();
    const cut = run('isResponseLikelyCutOff');
    assert.strictEqual(cut('Done.', 'stop'), false);
    assert.strictEqual(cut('Half a', 'length'), true);
    assert.strictEqual(cut('```\ncode', 'stop'), true);
    assert.strictEqual(cut('and then,'), true);
    assert.strictEqual(cut('"Fine."'), false);
    assert.strictEqual(run('cleanContinuationText')('The cat sat on the', 'Continuing: sat on the mat.'), ' mat.', 'repeated tail removed');
    assert.strictEqual(run('cleanContinuationText')('The cat sat on the', 'Continuing: on the mat.'), ' mat.');
});

// ---------- Chapters (shared parser) ----------

t.test('chapter detection uses the shared parser: prose and ATTG lines are not chapters', async () => {
    const { run } = await boot();
    const sections = ['[ Author: Me; Tags: noir ]', 'Part of me wanted to run.', '# Chapter 5', 'a', '## The Gathering', 'b', 'Interlude', 'c']
        .map((text, i) => ({ sectionId: i + 1, text }));
    const chapters = plain(run('detectChapters')(sections, '***', true));
    assert.deepStrictEqual(chapters.map((c) => c.title), ['Prologue / Introduction', 'Chapter 5', 'Chapter 6: The Gathering', 'Interlude']);
    assert.deepStrictEqual(chapters.map((c) => c.label), ['Prologue', 'Ch. 5', 'Ch. 6', 'Interlude']);
    // No headers: split on dividers
    const plainDoc = ['One.', '***', 'Two.'].map((text, i) => ({ sectionId: i + 1, text }));
    assert.deepStrictEqual(plain(run('detectChapters')(plainDoc, '***', true)).map((c) => c.title), ['Chapter 1', 'Chapter 2']);
});

t.test('books: chapter labels name the book so repeated numbers stay distinct', async () => {
    const { run } = await boot();
    const sections = ['Book 1:', 'Chapter: 1', 'a', 'Chapter: 2', 'b', 'Book 2:', 'Chapter: 1', 'c'].map((text, i) => ({ sectionId: i + 1, text }));
    const chapters = plain(run('detectChapters')(sections, '***', true));
    assert.deepStrictEqual(chapters.map((c) => c.label), ['Book 1', 'Book 1 Ch. 1', 'Book 1 Ch. 2', 'Book 2', 'Book 2 Ch. 1']);
    assert.strictEqual(chapters[4].title, 'Book 2, Chapter 1');
});

t.test('chapter context: single, previous chapters, multi-select (formats from v2.0 tests)', async () => {
    const env = await boot({ doc: STORY });
    const keyOf = (i) => plain(env.run('chat.chapters'))[i].key;
    await env.run('getActiveStoryContext()');
    env.run('chat').chapterKeys = [keyOf(2)];
    let ctx = plain(await env.run('getActiveStoryContext()'));
    assert.strictEqual(ctx.contextType, 'Chapter 2: The Haunted Cabin');
    assert.ok(ctx.text.includes('finding the old cabin') && !ctx.text.includes('dark forest.'));

    env.run('chat').usePreviousContext = true;
    ctx = plain(await env.run('getActiveStoryContext()'));
    assert.strictEqual(ctx.hasPreviousContext, true);
    assert.ok(ctx.text.indexOf('### PRIOR STORY CONTEXT') < ctx.text.indexOf('### TARGET CHAPTER FOCUS'));
    assert.ok(ctx.text.includes('Prologue / Introduction') && ctx.text.includes('Chapter 1: The Dark Forest'));
    assert.ok(!ctx.text.includes('Whispers in the Mist'));

    env.run('chat').usePreviousContext = false;
    env.run('chat').chapterKeys = [keyOf(2), keyOf(4)];
    ctx = plain(await env.run('getActiveStoryContext()'));
    assert.strictEqual(ctx.contextType, 'Ch. 2, Ch. 4');
    assert.ok(ctx.text.includes('reaching the iron gate') && !ctx.text.includes('Hearing strange whispers'));
});

t.test('lorebook block sits on top with a divider (format from v2.0 tests)', async () => {
    const env = await boot(Object.assign({ doc: STORY }, LORE));
    env.run('chat').loreIds = ['alice', 'moon'];
    const ctx = plain(await env.run('getActiveStoryContext()'));
    assert.strictEqual(ctx.contextType, 'Full Document (+ 2 Lorebooks)');
    assert.ok(ctx.text.startsWith('### ATTACHED LOREBOOK & REFERENCE CONTEXT:'));
    assert.ok(ctx.text.includes('--- [Characters: Alice Vance] ---') && ctx.text.includes('--- [The Blood Moon] ---'));
    assert.ok(ctx.text.includes('\n\n***\n\n### FULL STORY DOCUMENT (Primary Workshop Text):'));
});

// ---------- The reported v1.1.0 bugs ----------

t.test('a message too big for the context is refused before anything is sent, and the input unlocks', async () => {
    const env = await boot({ doc: ['Short story.'], maxTokens: 3000 });
    await env.mock.storage.set('chat-input-value', 'x'.repeat(5000));
    await env.run(`handleSubmit("${'x'.repeat(5000)}")`);
    assert.strictEqual(env.mock.gen.calls.length, 0, 'no tokens spent');
    assert.strictEqual(plain(env.run('chat.history')).length, 0, 'message not added');
    assert.strictEqual(env.run('chat.generating'), false, 'input re-enabled');
    assert.strictEqual(await env.mock.storage.get('chat-input-value'), 'x'.repeat(5000), 'draft kept');
    assert.ok(env.mock.ui.toasts.some((x) => /too long/.test(x.message)));
});

t.test('story is trimmed from the start to fit, lorebook kept on top, real query counted', async () => {
    const big = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'word '.repeat(20)}`);
    const env = await boot(Object.assign({ doc: big, maxTokens: 2600 }, LORE));
    env.run('chat').loreIds = ['alice'];
    const plan = plain(await env.run(`planPrompt([], "${'q'.repeat(300)}", 1024)`));
    assert.strictEqual(plan.ok, true);
    assert.ok(plan.percentage > 0 && plan.percentage < 100);
    assert.strictEqual(plan.contextType, 'Document Excerpt (Truncated from start) (+ 1 Lorebook)');
    const system = plan.messages[0].content;
    assert.ok(system.includes('Alice is an intrepid archaeologist.'), 'lorebook survives');
    assert.ok(system.includes('Paragraph 39') && !system.includes('Paragraph 0 '), 'oldest text trimmed first');
    const total = plan.messages.reduce((n, m) => n + m.content.length + 6, 0);
    assert.ok(total <= 2600 - 1024, `prompt (${total}) fits next to the reply`);
});

t.test('input rate limit: long wait is refused without spending; short wait proceeds', async () => {
    const refused = await boot({ doc: ['Story.'], budget: { input: 10, waitInputMs: 60000 } });
    await refused.run('handleSubmit("hello")');
    assert.strictEqual(refused.mock.gen.calls.length, 0);
    assert.ok(refused.mock.ui.toasts.some((x) => /input token limit/.test(x.message)));
    const waits = await boot({ doc: ['Story.'], budget: { input: 10, waitInputMs: 2000 } });
    await waits.run('handleSubmit("hello")');
    assert.strictEqual(waits.mock.gen.calls.length, 1);
});

// ---------- Generation flow ----------

t.test('send streams via updateParts (no full re-render per chunk) and saves per story', async () => {
    const env = await boot({ doc: ['Story.'], reply: 'A long enough streamed reply for several chunks.' });
    const before = env.mock.ui.updatedParts.length;
    await env.run('handleSubmit("hello")');
    const history = plain(env.run('chat.history'));
    assert.deepStrictEqual(history.map((m) => m.role), ['user', 'assistant']);
    assert.strictEqual(history[1].content, 'A long enough streamed reply for several chunks.');
    assert.ok(env.mock.ui.updatedParts.slice(before).some((p) => p.id === 'msg-1'), 'streamed into msg-1');
    assert.strictEqual(plain(await env.mock.storyStorage.get('chat-history')).length, 2, 'saved in story storage');
    assert.strictEqual(await env.mock.storage.get('chat-history'), undefined, 'not script-wide');
});

t.test('stop keeps the lock until the run ends and drops an empty placeholder', async () => {
    let release;
    const env = await boot({
        doc: ['Story.'],
        generateImpl: (messages, params, cb, signal) => new Promise((resolve, reject) => { release = () => reject(new Error('cancelled')); })
    });
    const pending = env.run('handleSubmit("hello")');
    await settle(40);
    await env.run('stopGeneration()');
    assert.strictEqual(env.run('chat.generating'), true, 'still locked while stopping');
    release();
    await pending;
    assert.strictEqual(env.run('chat.generating'), false);
    assert.deepStrictEqual(plain(env.run('chat.history')).map((m) => m.role), ['user']);
});

t.test('redo keeps versions (label 2/2 with one model) and switching restores text', async () => {
    const env = await boot({ doc: ['Story.'], reply: 'First answer.' });
    await env.run('handleSubmit("hello")');
    env.mock.gen.reply = 'The stone tower looms into the clouds.';
    await env.run('redoResponse(1)');
    const alt = plain(env.run('chat.alternatives[1]'));
    assert.strictEqual(alt.versions.length, 2);
    assert.strictEqual(alt.activeVersionIndex, 1);
    assert.strictEqual(env.run('chat.history[1].content'), 'The stone tower looms into the clouds.');
    const panel = env.mock.ui.panels.get('story-chat-panel');
    assert.ok(findParts(panel.content, (p) => p.type === 'text' && p.text === '2/2').length === 1);
    await env.run('switchResponseVersion(1, -1)');
    assert.strictEqual(env.run('chat.history[1].content'), 'First answer.');
});

t.test('continue appends to a cut-off reply', async () => {
    const env = await boot({ doc: ['Story.'], reply: 'The cat sat on the', finishReason: 'length' });
    await env.run('handleSubmit("hello")');
    assert.strictEqual(env.run('chat.hasCutOffResponse'), true);
    env.mock.gen.reply = 'Continuing: on the mat.';
    env.mock.gen.finishReason = 'stop';
    await env.run('continueResponse()');
    assert.strictEqual(env.run('chat.history[1].content'), 'The cat sat on the mat.');
    assert.strictEqual(env.run('chat.hasCutOffResponse'), false);
});

t.test('delete / edit & retry confirm first and wipe what follows', async () => {
    const env = await boot({ doc: ['Story.'] });
    await env.run('handleSubmit("first")');
    await env.run('handleSubmit("second")');
    env.mock.ui.modalHandler = clickModal(/^Edit & Wipe Context$/);
    await env.run('editAndRetryUserMessage(0)');
    assert.strictEqual(plain(env.run('chat.history')).length, 0);
    assert.strictEqual(await env.mock.storage.get('chat-input-value'), 'first');
    await env.run('handleSubmit("again")');
    env.mock.ui.modalHandler = clickModal(/^Cancel$/);
    await env.run('clearChat()');
    assert.strictEqual(plain(env.run('chat.history')).length, 2, 'Clear asks first');
});

t.test('compact keeps the newest messages that fit', async () => {
    const env = await boot({ doc: ['Story.'], maxTokens: 3000, reply: 'Short summary.' });
    const history = [];
    for (let i = 0; i < 10; i++) history.push({ role: 'user', content: `q${i} ` + 'x'.repeat(300) }, { role: 'assistant', content: `a${i} ` + 'y'.repeat(300) });
    env.run('chat').history = history;
    await env.run('compactChatHistory()');
    const sent = env.mock.gen.calls[0].messages;
    assert.ok(sent.length < 21 && sent[sent.length - 2].content.startsWith('a9'), 'newest kept, oldest dropped');
    assert.strictEqual(env.run('chat.history[0].content'), 'Summary (last session): Short summary.');
});

t.test('instruct reserves room for the chat and only touches the story on success', async () => {
    const env = await boot({ doc: ['Story.'], reply: 'Write the next scene.' });
    env.run('chat').history = [{ role: 'user', content: 'Plan the scene.' }, { role: 'assistant', content: 'OK.' }];
    await env.run('generateInstruction()');
    const call = env.mock.gen.withStoryCalls[0];
    assert.ok(call.opts.contextLimitReduction > 0);
    assert.ok(env.mock.doc.ops.includes('append'));
    const empty = await boot({ doc: ['Story.'], reply: '' });
    empty.run('chat').history = [{ role: 'user', content: 'Plan.' }];
    await empty.run('generateInstruction()');
    assert.ok(!empty.mock.doc.ops.includes('append'), 'no stray blank line on empty output');
});

// ---------- Per-story storage ----------

t.test('legacy script-wide chat moves into the first story opened, then nowhere else', async () => {
    const env = loadBundle(target, { doc: ['Story.'], maxTokens: 40000 });
    // Simulate v2.0 data before init runs
    await env.mock.storage.set('chat-history', JSON.stringify([{ role: 'user', content: 'old q' }, { role: 'assistant', content: 'old a.' }]));
    await env.mock.storage.set('selected-chapter-indices', '[1]');
    await env.run('loadPersistedState()');
    assert.deepStrictEqual(plain(env.run('chat.history')).map((m) => m.content), ['old q', 'old a.']);
    assert.strictEqual(await env.mock.storage.get('chat-history'), undefined, 'removed script-wide');
    assert.strictEqual(await env.mock.storage.get('selected-chapter-indices'), undefined);
    assert.strictEqual(await env.mock.storyStorage.get('chatglm-per-story-v1'), true);
    // A second story: the script-wide copy is gone, so it starts empty
    env.mock.storyStorage.map.clear();
    env.run('chat').history = [];
    await env.run('loadPersistedState()');
    assert.strictEqual(plain(env.run('chat.history')).length, 0);
});

t.test('model choice stays script-wide; chapter and lore picks are per story', async () => {
    const env = await boot(Object.assign({ doc: STORY }, LORE));
    await env.run('getActiveStoryContext()');
    env.run('chat').loreIds = ['alice'];
    env.run('chat').chapterKeys = [plain(env.run('chat.chapters'))[1].key];
    await env.run('saveSelections()');
    assert.deepStrictEqual(plain(await env.mock.storyStorage.get('selected-lorebook-entry-ids')), ['alice']);
    assert.strictEqual(plain(await env.mock.storyStorage.get('selected-chapter-keys')).length, 1);
    const modelButton = findParts(env.mock.ui.panels.get('story-chat-panel').content, (p) => p.type === 'button' && /Assistant/.test(p.text || ''))[0];
    await modelButton.callback();
    await settle();
    const architect = findParts(env.mock.ui.panels.get('story-chat-panel').content, (p) => p.type === 'button' && p.text === 'Architect')[0];
    await architect.callback();
    assert.strictEqual(await env.mock.storage.get('selected-model-id'), 'architect');
});

// ---------- Chat import / export ----------

const SAMPLE_CHAT = [
    { role: 'user', content: 'How is the pacing?' },
    { role: 'assistant', content: 'Brisk. Maybe too brisk.', modelDisplayName: 'Architect', modelId: 'architect' }
];

t.test('export saves JSON and/or Markdown named after the story; empty chat saves nothing', async () => {
    const env = await boot({ doc: ['Story.'], title: 'The Long Road' });
    await env.run('exportChat("both")');
    assert.strictEqual(env.mock.files.saved.length, 0, 'empty chat: nothing saved');
    env.run('chat').history = SAMPLE_CHAT.map((m) => Object.assign({ stray: 1 }, m));
    await env.run('exportChat("both")');
    const [json, md] = env.mock.files.saved;
    assert.match(json.name, /^ChatGLM - The Long Road - \d{4}-\d{2}-\d{2}\.json$/);
    assert.match(md.name, /\.md$/);
    const file = JSON.parse(json.content);
    assert.strictEqual(file.format, 'chatglm-chat');
    assert.strictEqual(file.story, 'The Long Road');
    assert.deepStrictEqual(file.messages, SAMPLE_CHAT, 'only known message fields');
    assert.match(md.content, /^# ChatGLM chat: The Long Road/);
    assert.ok(md.content.includes('### You\n\nHow is the pacing?') && md.content.includes('### Architect\n\nBrisk.'));
    await env.run('exportChat("json")');
    assert.strictEqual(env.mock.files.saved.length, 3, 'JSON only adds one file');
    const odd = await boot({ doc: ['Story.'], title: 'What: A/B?' });
    odd.run('chat').history = SAMPLE_CHAT;
    await odd.run('exportChat("markdown")');
    assert.match(odd.mock.files.saved[0].name, /^ChatGLM - What AB - /, 'unsafe filename characters dropped');
});

t.test('copy puts the Markdown transcript on the clipboard', async () => {
    const env = await boot({ doc: ['Story.'] });
    const copied = [];
    env.mock.api.v1.clipboard = { writeText: async (s) => { copied.push(s); } };
    env.run('chat').history = SAMPLE_CHAT;
    await env.run('copyChatMarkdown()');
    assert.strictEqual(copied.length, 1);
    assert.ok(copied[0].includes('### Architect'));
});

t.test('import round-trips an export; into an empty chat it needs no dialog', async () => {
    const src = await boot({ doc: ['Story.'], title: 'Source' });
    src.run('chat').history = SAMPLE_CHAT.concat([{ role: 'assistant', content: 'And then,' }]);
    await src.run('exportChat("json")');
    const env = await boot({ doc: ['Story.'], filePrompt: src.mock.files.saved[0].content });
    await env.run('importChat()');
    assert.strictEqual(env.mock.ui.modals.length, 0);
    assert.strictEqual(plain(env.run('chat.history')).length, 3);
    assert.strictEqual(plain(await env.mock.storyStorage.get('chat-history')).length, 3, 'saved to the story');
    assert.strictEqual(env.run('chat.hasCutOffResponse'), true, 'cut-off flag follows the imported last message');
});

t.test('import into an existing chat asks: append, replace or cancel', async () => {
    const file = JSON.stringify([...SAMPLE_CHAT, { role: 'system', content: 'x' }, 'junk']);
    const run = async (choice) => {
        const env = await boot({ doc: ['Story.'], filePrompt: file });
        env.run('chat').history = [{ role: 'user', content: 'mine' }, { role: 'assistant', content: 'kept.' }];
        env.run('chat').alternatives = { 1: { versions: [{ content: 'kept.', modelDisplayName: 'A', modelId: 'a' }], activeVersionIndex: 0 } };
        env.mock.ui.modalHandler = clickModal(choice);
        await env.run('importChat()');
        return env;
    };
    const appended = await run(/^Append$/);
    assert.deepStrictEqual(plain(appended.run('chat.history')).map((m) => m.content), ['mine', 'kept.', 'How is the pacing?', 'Brisk. Maybe too brisk.']);
    assert.ok(plain(appended.run('chat.alternatives'))[1], 'append keeps redo versions');
    assert.ok(appended.mock.ui.toasts.some((x) => /Imported 2 messages \(2 unreadable skipped\)/.test(x.message)));
    const replaced = await run(/^Replace$/);
    assert.deepStrictEqual(plain(replaced.run('chat.history')).map((m) => m.content), ['How is the pacing?', 'Brisk. Maybe too brisk.']);
    assert.deepStrictEqual(plain(replaced.run('chat.alternatives')), {});
    const cancelled = await run(/^Cancel$/);
    assert.strictEqual(plain(cancelled.run('chat.history')).length, 2);
});

t.test('import rejects bad files and leaves the chat alone', async () => {
    const cases = [
        ['not json', /isn't valid JSON/],
        [JSON.stringify({ hello: 1 }), /No chat messages/],
        [JSON.stringify([{ role: 'narrator', content: 'x' }]), /No chat messages/],
        [JSON.stringify({ format: 'other-tool', messages: SAMPLE_CHAT }), /Not a ChatGLM chat export/],
        [JSON.stringify({ format: 'chatglm-chat', version: 99, messages: SAMPLE_CHAT }), /newer ChatGLM/]
    ];
    for (const [content, message] of cases) {
        const env = await boot({ doc: ['Story.'], filePrompt: content });
        env.run('chat').history = [{ role: 'user', content: 'mine' }];
        await env.run('importChat()');
        assert.strictEqual(plain(env.run('chat.history')).length, 1);
        assert.ok(env.mock.ui.toasts.some((x) => x.type === 'error' && message.test(x.message)), `toast for ${content.slice(0, 20)}`);
    }
    const cancelled = await boot({ doc: ['Story.'] }); // picker closed: no file
    await cancelled.run('importChat()');
    assert.strictEqual(cancelled.mock.ui.toasts.length, 0);
});

t.test('Chat dropup holds export, import and clear', async () => {
    const env = await boot({ doc: ['Story.'] });
    const panelButtons = () => findParts(env.mock.ui.panels.get('story-chat-panel').content, (p) => p.type === 'button');
    await panelButtons().find((p) => p.text === 'Chat').callback();
    await settle();
    const labels = panelButtons().map((p) => p.text);
    for (const l of ['Export as JSON', 'Export as Markdown', 'Export both', 'Copy as Markdown', 'Import from JSON...', 'Clear chat']) assert.ok(labels.includes(l), l);
    assert.ok(panelButtons().find((p) => p.text === 'Export both').disabled, 'export disabled on an empty chat');
    assert.ok(!panelButtons().find((p) => p.text === 'Import from JSON...').disabled);
});

// ---------- Build / UI contract ----------

t.test('panel and extensions: theme tokens, icons, no emoji, update() not register()', async () => {
    const env = await boot(Object.assign({ doc: STORY }, LORE));
    await env.run('handleSubmit("hello")');
    for (const which of ['chapter', 'lore', 'model', 'chat']) {
        await env.run(`toggleDropdown('${which}')`);
        const json = JSON.stringify(env.mock.ui.panels.get('story-chat-panel'));
        assert.ok(!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(json), `${which}: no hardcoded colours`);
        assert.ok(!/[←-⇿⌀-➿\u{1F300}-\u{1FAFF}]/u.test(json), `${which}: no emoji/arrows`);
        await env.run(`toggleDropdown('${which}')`);
    }
    assert.ok(env.mock.ui.panels.has('chat-toolbox-add-context') && env.mock.ui.panels.has('chat-context-menu-add-context'));
    const src = fs.readFileSync(target, 'utf-8');
    assert.ok(!/disableWhileCallbackRunning/.test(src), 'prop spelled disabledWhileCallbackRunning');
    assert.ok(!/ui\.register\(/.test(src));
    assert.ok(!/(^|[^.\w])(setTimeout|clearTimeout)\(/m.test(src), 'no worker-missing global timers');
    assert.ok(src.startsWith('/*---'));
});

t.test('add to chat via context menu sets the selection context', async () => {
    const env = await boot({ doc: STORY, selectionText: 'A highlighted passage.' });
    const menu = env.mock.ui.panels.get('chat-context-menu-add-context');
    menu.callback({ selection: { from: { sectionId: 1, offset: 0 }, to: { sectionId: 1, offset: 5 } } });
    await settle(40);
    assert.strictEqual(env.run('chat.selectedContextText'), 'A highlighted passage.');
    const ctx = plain(await env.run('getActiveStoryContext()'));
    assert.strictEqual(ctx.contextType, 'Specific Excerpt (Highlighted Selection)');
});

t.run();
