// JS side of the native BenchProbe module
// (android/app/src/main/java/com/stefano10/yourmoney/bench/BenchProbeModule.kt)
// and a counter of the network requests started from JS.

import { NativeModules } from 'react-native';

export type Conditions = {
  battery:            number;   // %
  plugged:            boolean;
  charging:           boolean;  // plugged in, or battery reports charging
  powerSave:          boolean;
  airplaneMode:       boolean;
  wifiOn:             boolean;
  bluetoothOn:        boolean;
  brightness:         number;   // 0–255 system setting
  autoBrightness:     boolean;
  screenOffTimeoutMs: number;
  thermal:            string;   // THERMAL_STATUS_*
};

export type DeviceInfo = {
  manufacturer:    string;
  model:           string;
  device:          string;
  socManufacturer: string;
  socModel:        string;
  hardware:        string;
  android:         string;
  sdk:             number;
  ramTotalMb:      number;
  ramAvailMb:      number;
  freeStorageMb:   number;
  totalStorageMb:  number;
  cpuCores:        number;
  abis:            string;
};

export type ExitReason = {
  reason:      string;  // LOW_MEMORY, CRASH, CRASH_NATIVE, SIGNALED, …
  timestamp:   number;  // wall-clock ms
  status:      number;
  description: string;
  pssMb:       number;
  rssMb:       number;
};

const Native = NativeModules.BenchProbe;

export const probe = {
  available:    !!Native,
  /** Gradle build type of the running APK: "release" or "debug". */
  buildType:    (Native?.buildType as string | undefined) ?? (__DEV__ ? 'debug' : 'release'),
  versionName:  (Native?.versionName as string | undefined) ?? 'unknown',
  pssMb:        (): Promise<number> => Native.getPssMb(),
  thermal:      (): Promise<string> => Native.getThermalStatus(),
  conditions:   (): Promise<Conditions> => Native.getConditions(),
  deviceInfo:   (): Promise<DeviceInfo> => Native.getDeviceInfo(),
  exitReasons:  (): Promise<ExitReason[]> => Native.getRecentExitReasons(),
  keepScreenOn: (on: boolean): void => Native?.setKeepScreenOn(on),
};

/**
 * Samples the process PSS every `intervalMs` from the JS thread while native
 * code generates, keeping the maximum. A sample still in flight is not stacked.
 */
export function startPeakSampler(intervalMs = 250) {
  let peakMb = 0;
  let samples = 0;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      peakMb = Math.max(peakMb, await probe.pssMb());
      samples++;
    } catch {
      // A failed sample is skipped; `samples` shows how many succeeded.
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setInterval(tick, intervalMs);

  return {
    async stop(): Promise<{ peakMb: number; samples: number }> {
      clearInterval(timer);
      await tick();
      return { peakMb, samples };
    },
  };
}

export type NetworkRequest = { t: number; kind: 'xhr' | 'websocket'; url: string };

/**
 * Records every XMLHttpRequest and WebSocket opened from JS until uninstalled.
 * React Native's fetch is built on XMLHttpRequest, and Supabase keeps its own
 * reference to fetch, so patching XHR catches all of them without double counts.
 * Requests made by native code (react-native-fs downloads, images) are not seen.
 */
export function installNetworkCounter() {
  const requests: NetworkRequest[] = [];
  const g = globalThis as any;

  const XHR = g.XMLHttpRequest;
  const open = XHR.prototype.open;
  XHR.prototype.open = function (method: string, url: string, ...rest: unknown[]) {
    requests.push({ t: performance.now(), kind: 'xhr', url: String(url) });
    return open.call(this, method, url, ...rest);
  };

  const WebSocketImpl = g.WebSocket;
  class CountingWebSocket extends WebSocketImpl {
    constructor(url: string, ...rest: unknown[]) {
      requests.push({ t: performance.now(), kind: 'websocket', url: String(url) });
      super(url, ...rest);
    }
  }
  g.WebSocket = CountingWebSocket;

  return {
    /** Requests started at or after `t0` (a performance.now() value). */
    since: (t0: number) => requests.filter(r => r.t >= t0),
    uninstall() {
      XHR.prototype.open = open;
      g.WebSocket = WebSocketImpl;
    },
  };
}
