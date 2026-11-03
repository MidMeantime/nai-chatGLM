// Finds or fetches what the build and tests need, on first run:
// - UCCDS (parser, client, build/type-check/test tools, the dependency script used in tests),
//   shallow-cloned at UCCDS_REF into .deps/, with its own `npm install` for TypeScript
// - NovelAI's official script types, downloaded into the UCCDS checkout's types/ folder
// Set UCCDS_DIR to build against a local UCCDS checkout instead (it still gets the types if missing).
// Usage: node scripts/deps.js   (build.js and the tests call ensureDeps() themselves)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UCCDS_REPO = 'https://github.com/MidMeantime/nai-chapter-detection-uccds.git';
const UCCDS_REF = 'v1.0.0';
const TYPES_URL = 'https://novelai.net/scripting/types/script-types.d.ts';

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_UCCDS = path.join(ROOT, '.deps', 'nai-chapter-detection-uccds');

function run(cmd, args, cwd) {
    try {
        execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
    } catch (err) {
        throw new Error(`deps: \`${cmd} ${args.join(' ')}\` failed${err.code === 'ENOENT' ? ` (is ${cmd} installed?)` : ''}`);
    }
}

function fetchUccds(dir) {
    console.log(`deps: cloning UCCDS ${UCCDS_REF} into ${path.relative(ROOT, dir)}`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    // core.longpaths: Windows git otherwise fails inside deeply nested folders
    run('git', ['-c', 'core.longpaths=true', 'clone', '--depth', '1', '--branch', UCCDS_REF,
        '-c', 'advice.detachedHead=false', '-c', 'core.longpaths=true', UCCDS_REPO, dir], ROOT);
    // (set twice: the first applies while cloning, the second is saved in the clone's config)
}

/** Downloads the NovelAI types in a child process, so callers can stay synchronous */
function fetchTypes(target) {
    console.log(`deps: downloading NovelAI script types from ${TYPES_URL}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const script = `
        fetch(${JSON.stringify(TYPES_URL)}).then(async (res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const text = await res.text();
            if (!text.includes('namespace api')) throw new Error('unexpected content');
            require('fs').writeFileSync(${JSON.stringify(target)}, text);
        }).catch((err) => { console.error('deps: types download failed: ' + err.message); process.exit(1); });`;
    run(process.execPath, ['-e', script], ROOT);
}

let resolved = null;

/** Returns { uccds } (absolute path of the UCCDS checkout), fetching anything missing */
function ensureDeps() {
    if (resolved) return resolved;
    const fromEnv = process.env.UCCDS_DIR;
    const uccds = fromEnv ? path.resolve(fromEnv) : DEFAULT_UCCDS;
    if (!fs.existsSync(path.join(uccds, 'tools', 'bundle.js'))) {
        if (fromEnv) throw new Error(`deps: UCCDS_DIR=${fromEnv} doesn't look like a UCCDS checkout (no tools/bundle.js)`);
        if (fs.existsSync(uccds)) fs.rmSync(uccds, { recursive: true, force: true }); // half-finished clone
        fetchUccds(uccds);
    }
    if (!fs.existsSync(path.join(uccds, 'node_modules', 'typescript'))) {
        console.log('deps: installing UCCDS tooling (TypeScript)');
        run('npm', ['install', '--no-audit', '--no-fund'], uccds);
    }
    const types = path.join(uccds, 'types', 'NovelAI_Script_Types.d.ts');
    if (!fs.existsSync(types)) fetchTypes(types);
    resolved = { uccds };
    return resolved;
}

if (require.main === module) {
    try {
        console.log(`deps: ready (UCCDS at ${ensureDeps().uccds})`);
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    }
}

module.exports = { ensureDeps, UCCDS_REF };
