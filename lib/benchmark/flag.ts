import { NativeModules } from 'react-native';

/**
 * True only in APKs built with `-PliraBenchmark=true`
 * (scripts/build-benchmark-apk.js): the benchmark screen never exists in the
 * builds users get. It is a native BuildConfig field rather than an
 * EXPO_PUBLIC_ variable because Gradle rebuilds when it changes, while an
 * inlined JS variable could survive in the Metro cache into a normal build.
 */
export const BENCHMARK_ENABLED: boolean = NativeModules.BenchProbe?.benchmarkEnabled === true;
