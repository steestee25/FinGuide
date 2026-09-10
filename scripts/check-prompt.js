// Checks lib/chatPrompt.ts against the training records:
//  1. the PERSONA / LEVEL strings equal the table in benchmark/RISPOSTA_AGENTE.md;
//  2. rebuilding each reference system message from its document ids (looked up
//     in the bundled corpus) gives back the reference byte for byte.
//
//   node scripts/check-prompt.js
//
// The chat-template half (messages → formatted prompt) needs llama.rn and runs
// on the phone from the benchmark screen.

require('sucrase/register');
const fs = require('fs');
const path = require('path');

const prompt = require('../lib/chatPrompt.ts');
const references = require('../lib/benchmark/data/riferimenti.json');
const CORPUS = {
  it: require('../lib/corpus/passages_it.json'),
  en: require('../lib/corpus/passages_en.json'),
};

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

// 1. Strings in the RISPOSTA_AGENTE.md table: | `LIVELLO` base | `it` | `en` |
const md = fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'RISPOSTA_AGENTE.md'), 'utf8');
for (const line of md.split('\n')) {
  const m = line.match(/^\| `LIVELLO` (\w+) \| `(.+)` \| `(.+)` \|\s*$/);
  if (!m) continue;
  const [, level, it, en] = m;
  check(prompt.LEVEL_INSTRUCTIONS.it[level] === it, `level ${level} (it)`);
  check(prompt.LEVEL_INSTRUCTIONS.en[level] === en, `level ${level} (en)`);
}

// 2. Reference system messages (all at level "base").
for (const ref of references) {
  const lang = ref.name.endsWith('_it') ? 'it' : 'en';
  const family = ref.name.startsWith('smollm3') ? 'smollm3' : 'gemma3';
  const expected = ref.messages.find((m) => m.role === 'system').content;

  const ids = [...expected.matchAll(/^DOCUMENT[O]? \[(.+?)\]:$/gm)].map((m) => m[1]);
  const docs = ids.map((id) => {
    const p = CORPUS[lang].find((x) => x.passage_id === id);
    return { id, text: p ? p.text : '<missing from corpus>' };
  });

  const built = prompt.systemMessageForModel(prompt.buildRagSystemMessage(lang, 'base', docs), family);
  check(built === expected, `${ref.name}: system message (${ids.length} documents)`);
  if (built !== expected) {
    const i = [...built].findIndex((c, k) => c !== expected[k]);
    console.log(`     first difference at char ${i}:\n     got      ${JSON.stringify(built.slice(i, i + 60))}\n     expected ${JSON.stringify(expected.slice(i, i + 60))}`);
  }
}

process.exit(failures ? 1 : 0);
