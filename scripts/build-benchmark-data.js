// Regenerates the data bundled with the app from the files in benchmark/.
//
//   node scripts/build-benchmark-data.js
//
// benchmark/ holds the reference material exported from the training pipeline
// (corpora, stop-words, test questions, reference prompts). The app cannot read
// .jsonl/.txt through Metro, so they are converted to JSON here — contents are
// copied as-is, only unused fields are dropped.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'benchmark');

const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');
const readJsonl = (file) =>
  read(file).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const readLines = (file) =>
  read(file).split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);

function write(rel, data) {
  const dest = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(data));
  console.log(`${rel}  (${Array.isArray(data) ? data.length + ' items' : 'object'})`);
}

for (const lang of ['it', 'en']) {
  // `concept` is indexed together with `text`; only `text` goes in the prompt.
  const passages = readJsonl(`passages_${lang}.jsonl`).map((p) => ({
    passage_id: p.passage_id,
    concept: p.concept,
    text: p.text,
    source_url: p.source_url,
  }));
  write(`lib/corpus/passages_${lang}.json`, passages);
  write(`lib/corpus/stopwords_${lang}.json`, readLines(`stopwords_${lang}.txt`));
  write(`lib/benchmark/data/domande_${lang}.json`, readJsonl(`domande_${lang}.jsonl`));
}

// Reference chat prompts rendered with the original tokenizers: the benchmark
// renders the same messages through llama.rn and compares byte for byte.
const references = ['gemma3_it', 'gemma3_en', 'smollm3_it'].map((name) => ({
  name,
  messages: JSON.parse(read(`riferimento_${name}_messaggi.json`)).messages,
  prompt: read(`riferimento_${name}_prompt.txt`).replace(/\r\n/g, '\n'),
}));
write('lib/benchmark/data/riferimenti.json', references);

// Recorded in every benchmark row. Run this script right before building the
// benchmark APK so the commit matches the code being measured.
const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
};
write('lib/benchmark/data/build-info.json', {
  commit: git('rev-parse --short HEAD'),
  // Uncommitted changes other than this file itself.
  dirty: !!git('status --porcelain -- . ":!lib/benchmark/data/build-info.json"'),
  generatedAt: new Date().toISOString(),
  llamaRnVersion: require(path.join(ROOT, 'node_modules', 'llama.rn', 'package.json')).version,
});
