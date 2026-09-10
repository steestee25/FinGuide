// Adds clearCache() to llama.rn's old-architecture Android bridge.
//
// The app runs with newArchEnabled=false. llama.rn 0.9.5 implements
// clearCache in RNLlama.java but exposes it only in the new-architecture
// module, so on the old architecture LlamaContext.clearCache() throws
// "undefined is not a function". lib/chatTurn.ts needs it: see the KV cache
// note there. Idempotent; runs on postinstall.

const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname, '..', 'node_modules', 'llama.rn', 'android', 'src', 'oldarch',
  'java', 'com', 'rnllama', 'RNLlamaModule.java',
);

if (!fs.existsSync(file)) {
  console.warn('[patch-llama-rn] llama.rn old-arch module not found, skipping');
  process.exit(0);
}

const source = fs.readFileSync(file, 'utf8');
if (source.includes('public void clearCache(')) {
  console.log('[patch-llama-rn] clearCache already present');
  process.exit(0);
}

const nl = source.includes('\r\n') ? '\r\n' : '\n';
const anchor = `  @ReactMethod${nl}  public void releaseContext(`;
if (!source.includes(anchor)) {
  console.error('[patch-llama-rn] releaseContext not found: llama.rn changed, update this script');
  process.exit(1);
}

const method = [
  '  @ReactMethod',
  '  public void clearCache(double id, boolean clearData, final Promise promise) {',
  '    rnllama.clearCache(id, clearData, promise);',
  '  }',
  '',
  '',
].join(nl);

fs.writeFileSync(file, source.replace(anchor, method + anchor));
console.log('[patch-llama-rn] added clearCache to the old-arch bridge');
