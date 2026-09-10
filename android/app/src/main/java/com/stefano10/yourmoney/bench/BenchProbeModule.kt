package com.stefano10.yourmoney.bench

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.stefano10.yourmoney.BuildConfig

/**
 * Device probes for the benchmark screen (lib/benchmark/): process memory,
 * thermal state, battery, radio settings and why the previous process died.
 * JS cannot read any of these on its own. Everything is read-only except
 * setKeepScreenOn.
 */
class BenchProbeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "BenchProbe"

  override fun getConstants(): Map<String, Any> = mapOf(
    // Only builds made with `-PliraBenchmark=true` expose the benchmark screen.
    "benchmarkEnabled" to BuildConfig.LIRA_BENCHMARK,
    "buildType" to BuildConfig.BUILD_TYPE,
    "versionName" to BuildConfig.VERSION_NAME,
    "versionCode" to BuildConfig.VERSION_CODE,
  )

  /** Total PSS of this process in MB: the TOTAL PSS row of `dumpsys meminfo`. */
  @ReactMethod
  fun getPssMb(promise: Promise) {
    try {
      val info = Debug.MemoryInfo()
      Debug.getMemoryInfo(info)
      promise.resolve(info.totalPss / 1024.0)
    } catch (e: Exception) {
      promise.reject("E_PSS", e)
    }
  }

  @ReactMethod
  fun getThermalStatus(promise: Promise) {
    promise.resolve(thermalStatus())
  }

  /** Battery and the phone settings the measurement protocol fixes. */
  @ReactMethod
  fun getConditions(promise: Promise) {
    try {
      val battery = reactContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
      val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
      val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
      val power = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      val resolver = reactContext.contentResolver
      // 0 = off; other values mean on (possibly kept on while in airplane mode).
      val wifi = Settings.Global.getInt(resolver, "wifi_on", -1)
      val bluetooth = Settings.Global.getInt(resolver, "bluetooth_on", -1)

      promise.resolve(Arguments.createMap().apply {
        putDouble("battery", if (level >= 0 && scale > 0) level * 100.0 / scale else -1.0)
        putBoolean("plugged", plugged != 0)
        putBoolean(
          "charging",
          plugged != 0 || status == BatteryManager.BATTERY_STATUS_CHARGING,
        )
        putBoolean("powerSave", power.isPowerSaveMode)
        putBoolean("airplaneMode", Settings.Global.getInt(resolver, Settings.Global.AIRPLANE_MODE_ON, 0) == 1)
        putBoolean("wifiOn", wifi > 0)
        putBoolean("bluetoothOn", bluetooth > 0)
        putInt("brightness", Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, -1))
        putBoolean(
          "autoBrightness",
          Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, 0) ==
            Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC,
        )
        putInt("screenOffTimeoutMs", Settings.System.getInt(resolver, Settings.System.SCREEN_OFF_TIMEOUT, -1))
        putString("thermal", thermalStatus())
      })
    } catch (e: Exception) {
      promise.reject("E_CONDITIONS", e)
    }
  }

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    try {
      val activity = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memory = ActivityManager.MemoryInfo().also { activity.getMemoryInfo(it) }
      val storage = StatFs(reactContext.filesDir.absolutePath)
      val mb = 1024.0 * 1024.0

      promise.resolve(Arguments.createMap().apply {
        putString("manufacturer", Build.MANUFACTURER)
        putString("model", Build.MODEL)
        putString("device", Build.DEVICE)
        putString("socManufacturer", if (Build.VERSION.SDK_INT >= 31) Build.SOC_MANUFACTURER else "")
        putString("socModel", if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL else Build.HARDWARE)
        putString("hardware", Build.HARDWARE)
        putString("android", Build.VERSION.RELEASE)
        putInt("sdk", Build.VERSION.SDK_INT)
        putDouble("ramTotalMb", memory.totalMem / mb)
        putDouble("ramAvailMb", memory.availMem / mb)
        putDouble("freeStorageMb", storage.availableBytes / mb)
        putDouble("totalStorageMb", storage.totalBytes / mb)
        putInt("cpuCores", Runtime.getRuntime().availableProcessors())
        putString("abis", Build.SUPPORTED_ABIS.joinToString(","))
      })
    } catch (e: Exception) {
      promise.reject("E_DEVICE", e)
    }
  }

  /**
   * Why the last processes of this app ended, newest first (Android 11+). After
   * a run that never finished, this tells an out-of-memory kill from a crash.
   */
  @ReactMethod
  fun getRecentExitReasons(promise: Promise) {
    val result = Arguments.createArray()
    if (Build.VERSION.SDK_INT < 30) {
      promise.resolve(result)
      return
    }
    try {
      val activity = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      for (exit in activity.getHistoricalProcessExitReasons(reactContext.packageName, 0, 5)) {
        result.pushMap(Arguments.createMap().apply {
          putString("reason", exitReason(exit.reason))
          putDouble("timestamp", exit.timestamp.toDouble())
          putInt("status", exit.status)
          putString("description", exit.description ?: "")
          putDouble("pssMb", exit.pss / 1024.0)
          putDouble("rssMb", exit.rss / 1024.0)
        })
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("E_EXIT", e)
    }
  }

  @ReactMethod
  fun setKeepScreenOn(on: Boolean) {
    val activity = reactContext.currentActivity ?: return
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  private fun thermalStatus(): String {
    if (Build.VERSION.SDK_INT < 29) return "UNSUPPORTED"
    val power = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    return when (power.currentThermalStatus) {
      PowerManager.THERMAL_STATUS_NONE -> "THERMAL_STATUS_NONE"
      PowerManager.THERMAL_STATUS_LIGHT -> "THERMAL_STATUS_LIGHT"
      PowerManager.THERMAL_STATUS_MODERATE -> "THERMAL_STATUS_MODERATE"
      PowerManager.THERMAL_STATUS_SEVERE -> "THERMAL_STATUS_SEVERE"
      PowerManager.THERMAL_STATUS_CRITICAL -> "THERMAL_STATUS_CRITICAL"
      PowerManager.THERMAL_STATUS_EMERGENCY -> "THERMAL_STATUS_EMERGENCY"
      PowerManager.THERMAL_STATUS_SHUTDOWN -> "THERMAL_STATUS_SHUTDOWN"
      else -> "THERMAL_STATUS_UNKNOWN"
    }
  }

  private fun exitReason(reason: Int): String = when (reason) {
    1 -> "EXIT_SELF"
    2 -> "SIGNALED"
    3 -> "LOW_MEMORY"
    4 -> "CRASH"
    5 -> "CRASH_NATIVE"
    6 -> "ANR"
    7 -> "INITIALIZATION_FAILURE"
    8 -> "PERMISSION_CHANGE"
    9 -> "EXCESSIVE_RESOURCE_USAGE"
    10 -> "USER_REQUESTED"
    11 -> "USER_STOPPED"
    12 -> "DEPENDENCY_DIED"
    13 -> "OTHER"
    14 -> "FREEZER"
    15 -> "PACKAGE_STATE_CHANGE"
    16 -> "PACKAGE_UPDATED"
    else -> "UNKNOWN"
  }
}
