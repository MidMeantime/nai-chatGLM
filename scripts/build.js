// Builds chat_glm_v<version>.naiscript and type-checks it in strict mode.
// Chapters come from the UCCDS dependency script when it's installed (src/uccds-bridge.ts), falling
// back to the built-in detection when it isn't, so this bundles the UCCDS parser and client.
// UCCDS also supplies the build and type-check tools; scripts/deps.js fetches it on first run.
// Usage: node scripts/build.js [outputPath]
const path = require('path');
const { ensureDeps } = require('./deps.js');
const UCCDS = ensureDeps().uccds;
const { buildProject } = require(path.join(UCCDS, 'tools', 'bundle.js'));
const { typecheck } = require(path.join(UCCDS, 'tools', 'typecheck.js'));

const SRC = path.resolve(__dirname, '..', 'src');
const part = (name) => path.join(SRC, name);
const uccds = (name) => path.join(UCCDS, 'src', name);

const CHATGLM_PROJECT = {
    name: 'chat_glm',
    dir: path.resolve(__dirname, '..'),
    // Order matters: the /*--- header must come first
    parts: [
        part('header.ts'),
        uccds('chapter-headers.ts'),
        uccds('uccds-types.ts'),
        uccds('uccds-helpers.ts'),
        uccds(path.join('client', 'uccds-client.ts')),
        part('types.ts'),
        part('state.ts'),
        part('prompts.ts'),
        part('context.ts'),
        part('uccds-bridge.ts'),
        part('budget.ts'),
        part('ui-kit.ts'),
        part('generation.ts'),
        part('modals.ts'),
        part('transfer.ts'),
        part('ui.ts'),
        part('main.ts')
    ]
};

function build(outputPath) {
    const result = buildProject(CHATGLM_PROJECT, outputPath);
    if (!typecheck(result.target)) process.exitCode = 1;
    return result;
}

if (require.main === module) {
    build(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
}

module.exports = { build, CHATGLM_PROJECT };
