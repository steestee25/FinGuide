// Checks lib/retrieval.ts against the training pipeline: for every benchmark
// question the six paragraphs must be exactly `expected_passage_ids`, in order.
//
//   node scripts/check-retrieval.js
//
// Exits 1 on any mismatch. The same check runs on the phone from the benchmark
// screen, since the Hermes regex engine is what the app actually uses.

const Module = require('module');

// react-native-fs needs the native runtime; retrieval.ts already treats a failed
// require as "no disk cache", so make it fail cleanly under Node.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'react-native-fs') throw new Error('react-native-fs is not available in Node');
  return resolve.call(this, request, ...rest);
};
require('sucrase/register');

const { retrieveRelevant } = require('../lib/retrieval.ts');

const QUESTIONS = {
  it: require('../lib/benchmark/data/domande_it.json'),
  en: require('../lib/benchmark/data/domande_en.json'),
};

(async () => {
  const log = console.log;
  let mismatches = 0;

  for (const lang of ['it', 'en']) {
    const questions = QUESTIONS[lang];
    let identical = 0;
    let gold = 0;

    for (const q of questions) {
      console.log = () => {}; // retrieval logs every query
      const ids = (await retrieveRelevant(q.question, { k: 6, lang })).map((d) => d.id);
      console.log = log;

      if (JSON.stringify(ids) === JSON.stringify(q.expected_passage_ids)) {
        identical++;
      } else {
        mismatches++;
        log(`[${lang}] n=${q.n} differs\n  got      ${ids.join(', ')}\n  expected ${q.expected_passage_ids.join(', ')}`);
      }
      if (ids.includes(q.gold_passage_id)) gold++;
    }

    const expectedGold = questions.filter((q) => q.expected_gold_in_prompt).length;
    log(`${lang}: identical lists ${identical}/${questions.length}, gold_in_prompt ${gold}/${questions.length} (expected ${expectedGold})`);
  }

  process.exit(mismatches ? 1 : 0);
})();
