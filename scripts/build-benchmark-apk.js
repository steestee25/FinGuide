// Builds the release APK with the hidden benchmark screen enabled.
//
//   node scripts/build-benchmark-apk.js
//
// 1. regenerates the bundled benchmark data (corpora, questions, references,
//    build-info with the current commit);
// 2. runs `gradlew assembleRelease -PliraBenchmark=true`.
//
// Output: android/app/build/outputs/apk/release/app-release.apk
// Install: adb install -r android/app/build/outputs/apk/release/app-release.apk

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');

execFileSync(process.execPath, [path.join(__dirname, 'build-benchmark-data.js')], { stdio: 'inherit' });

// Absolute path: cmd.exe may be configured not to search the current directory.
const gradlew = path.join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
// arm64 only: every phone that can run these models is arm64, and building the
// native libraries for all four ABIs takes hours and a lot of RAM.
execFileSync(gradlew, ['assembleRelease', '-PliraBenchmark=true', '-PreactNativeArchitectures=arm64-v8a', '--no-daemon'], {
  cwd: ANDROID,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

console.log(`\nAPK: ${path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')}`);
