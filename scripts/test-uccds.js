// Tests for ChatGLM next to the real UCCDS dependency script on a mock messaging bus.
// (scripts/test.js covers the no-UCCDS fallback: there the built-in detection must behave as before.)
// Run: node scripts/test-uccds.js   (fetches UCCDS and its tooling on first run, see scripts/deps.js)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const UCCDS = require('./deps.js').ensureDeps().uccds;
const { build } = require('./build.js');

(async () => {
    const target = path.join(require('os').tmpdir(), 'chat_glm_uccds_under_test.naiscript');
    build(target);

    const { loadBundle, createBus, createDocument, settle, createRunner } = require(path.join(UCCDS, 'tools', 'harness.js'));
    const SERVICE = path.join(UCCDS, 'dist', fs.readdirSync(path.join(UCCDS, 'dist')).find((f) => /^UCCDS_v.+\.naiscript$/.test(f)));
    const t = createRunner('ChatGLM + UCCDS');
    const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
    const STORY = ['[ Intro: ]', 'Before it all.', '[ Section 1: ]', 'a', '***', 'b', '[ Section 2: The Pass ]', 'c', '[ Intro: ]', 'after'];
    const WORDS = { chapter_custom_chapter_words: 'Section', chapter_custom_unnumbered_words: 'Intro' };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    function world(serviceConfig, startServiceFirst = true) {
        const bus = createBus();
        const doc = createDocument(STORY);
        const startService = () => loadBundle(SERVICE, { bus, sharedDoc: doc, scriptId: 'uccds', config: serviceConfig });
        const service = startServiceFirst ? startService() : null;
        const glm = loadBundle(target, { bus, sharedDoc: doc, scriptId: 'chatglm', maxTokens: 40000 });
        return { bus, doc, service, glm, startService };
    }

    t.test('uses UCCDS chapters, with the user\'s own words from the UCCDS config', async () => {
        const w = world(WORDS);
        await wait(300);
        await settle(60);
        await w.glm.run('getActiveStoryContext')();
        const chapters = plain(w.glm.run('chat.chapters'));
        assert.deepStrictEqual(chapters.map((c) => `${c.kind}|${c.label}|${c.title}`), [
            'prologue|Intro|Intro',
            'chapter|Section 1|Section 1',
            'chapter|Section 2|Section 2: The Pass',
            'epilogue|Intro|Intro'
        ]);
        assert.strictEqual(chapters[1].text, '[ Section 1: ]\n\na\n\n***\n\nb', 'header + body, like the built-in detection');
        assert.strictEqual(w.glm.run('chapterDisplayName')(chapters[2]), 'The Pass', 'dropdown shows "Section 2: The Pass", not the title twice');
        assert.match(w.glm.run('chapterSourceNote')(), /Chapters from UCCDS v/);
    });

    t.test('a picked chapter goes into the prompt with UCCDS boundaries', async () => {
        const w = world(WORDS);
        await wait(300);
        await settle(60);
        await w.glm.run('getActiveStoryContext')();
        const key = plain(w.glm.run('chat.chapters'))[2].key;
        w.glm.run(`chat.chapterKeys = [${key}]`);
        const ctx = plain(await w.glm.run('getActiveStoryContext')());
        assert.strictEqual(ctx.isChapter, true);
        assert.strictEqual(ctx.chapterTitle, 'Section 2: The Pass');
        assert.ok(ctx.text.includes('c') && !ctx.text.includes('Before it all.'));
    });

    t.test('without UCCDS: built-in detection (Section is a Part word, [ Intro: ] is not a header)', async () => {
        const bus = createBus();
        const glm = loadBundle(target, { bus, doc: STORY, scriptId: 'chatglm', maxTokens: 40000 });
        await settle(60);
        await glm.run('getActiveStoryContext')();
        const kinds = plain(glm.run('chat.chapters')).map((c) => c.kind);
        assert.ok(kinds.includes('division'), `built-in rules: ${kinds.join(',')}`);
        assert.match(glm.run('chapterSourceNote')(), /Built-in chapter detection/);
    });

    t.test('UCCDS loading after ChatGLM is picked up, and UCCDS chapter changes reach ChatGLM', async () => {
        const w = world(WORDS, false);
        await settle(40);
        await w.glm.run('getActiveStoryContext')();
        assert.match(w.glm.run('chapterSourceNote')(), /Built-in/);
        await wait(4500); // ChatGLM's 4 s search for UCCDS runs out
        const service = w.startService();
        await wait(300);
        await settle(80);
        assert.match(w.glm.run('chapterSourceNote')(), /Chapters from UCCDS/, 'switched once UCCDS announced itself');
        assert.strictEqual(plain(w.glm.run('chat.chapters'))[1].label, 'Section 1');
        await w.doc.api.appendParagraph({ text: '[ Section 3: ]' });
        await w.doc.api.appendParagraph({ text: 'd' });
        await service.mock.hooks.get('onGenerationEnd')();
        await wait(200);
        await settle(80);
        assert.ok(plain(w.glm.run('chat.chapters')).some((c) => c.label === 'Section 3'), 'refreshed from the change event');
    });

    t.test('UCCDS disappearing mid-session falls back without breaking', async () => {
        const w = world(WORDS);
        await wait(300);
        await settle(60);
        await w.glm.run('getActiveStoryContext')();
        w.bus.subs.splice(0, w.bus.subs.length, ...w.bus.subs.filter((s) => s.scriptId !== 'uccds'));
        await w.doc.api.appendParagraph({ text: 'more' });
        await w.glm.run('getActiveStoryContext')();
        assert.match(w.glm.run('chapterSourceNote')(), /Built-in/);
        assert.ok(plain(w.glm.run('chat.chapters')).length > 0);
    });

    await t.run();
})().catch((err) => { console.error(err); process.exitCode = 1; });
