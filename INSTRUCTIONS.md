# Linux Switch Instructions for `schockboard-apk`

## Goal

Use Linux as the primary development environment for the APK fork because Android CLI tooling, Gradle, Java, emulator/device workflows, and CI-like test execution are usually more predictable there than on the current Windows ARM setup.

This file assumes a fresh Linux machine or VM and brings the project to a state where you can:

- run TypeScript and unit tests
- start the Expo app
- generate the native Android project
- build a local debug APK

## Recommended Host

- Ubuntu 24.04 LTS or Debian-based equivalent
- at least 16 GB RAM
- at least 30 GB free disk
- Android phone via USB is preferred over emulator for the first runs

## Project Facts You Need To Know

- The APK project lives in `schockboard-apk`
- This is an Expo + Expo Router app with local SQLite
- The native `android/` folder is generated and currently ignored by Git
- After cloning on Linux, you must run Expo prebuild again before Gradle builds
- Current Android target is portrait-only, but layouts are built to scale up to 7"+ tablets

## Required Toolchain

Install these first:

- `git`
- `curl`
- `unzip`
- `build-essential`
- `nodejs` 22.x
- `npm`
- `OpenJDK 21`
- Android SDK Command Line Tools
- Android platform tools
- Android platform `36`
- Android build-tools `36.0.0`

## 1. System Packages

```bash
sudo apt update
sudo apt install -y git curl unzip build-essential openjdk-21-jdk
```

Check Java:

```bash
java -version
javac -version
```

## 2. Node.js 22

If Node 22 is not already installed:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Check:

```bash
node -v
npm -v
```

## 3. Android SDK

Create a local SDK path:

```bash
mkdir -p "$HOME/Android/Sdk/cmdline-tools"
cd /tmp
curl -L "https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip" -o android-cmdline-tools.zip
unzip -q android-cmdline-tools.zip
mv cmdline-tools "$HOME/Android/Sdk/cmdline-tools/latest"
```

Add environment variables to `~/.bashrc` or `~/.zshrc`:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
```

Reload shell:

```bash
source ~/.bashrc
```

Accept licenses and install packages:

```bash
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

Check:

```bash
adb version
sdkmanager --list | head
```

## 4. Clone And Install

```bash
git clone <your-repo-url>
cd schockboard-apk
npm install --legacy-peer-deps
```

Why `--legacy-peer-deps`:

- Expo Router currently pulls a `react-dom` peer chain that is noisy in this setup
- the project is already known to install cleanly with this flag

## 5. Regenerate Native Android Project

Because `android/` is not committed, regenerate it after clone:

```bash
npx expo prebuild --platform android
```

After prebuild, verify these two project choices are still present:

- `app.json`: `"orientation": "portrait"`
- `android/gradle.properties`: `newArchEnabled=false`

If prebuild overwrites them, set them again before building.

## 6. Local Validation

Run these first:

```bash
npm run typecheck
npm test
npx expo export --platform android --output-dir dist
```

Expected:

- TypeScript passes
- Vitest passes
- Expo Android bundle export succeeds

## 7. Local APK Build

Create Android SDK pointer for Gradle:

```bash
cat > android/local.properties <<EOF
sdk.dir=$HOME/Android/Sdk
EOF
```

Build debug APK:

```bash
cd android
./gradlew assembleDebug --console=plain
```

Expected APK output:

```bash
android/app/build/outputs/apk/debug/app-debug.apk
```

## 8. Install On Device

Enable developer mode and USB debugging on the Android phone, then:

```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

If you prefer manual install:

- copy `app-debug.apk` to the device
- allow installs from unknown sources
- install it directly on the phone

## 9. Everyday Development Flow

From repo root:

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
npx expo start
```

For native Android rebuilds:

```bash
cd android
./gradlew assembleDebug
```

## 10. What To Prefer On Linux

Prefer these workflows:

- run unit tests locally with `npm test`
- run type checks before any native build
- test first on a real Android phone
- only use emulator after the app boots reliably on device
- regenerate `android/` with `npx expo prebuild --platform android` after plugin/native dependency changes

## 11. Known Repo-Specific Caveats

- The project uses local SQLite and Secure Store, so app state is device-local
- A fresh install starts with empty app data and requires initial setup again
- CSV export uses Android share/file APIs and should be tested on a real device
- Tablet support is layout-driven, not a separate APK flavor
- Portrait is locked globally; tablet use is therefore also portrait-first

## 12. First Smoke Test On Linux

Do this exact sequence after the switch:

1. `npm install --legacy-peer-deps`
2. `npx expo prebuild --platform android`
3. `npm run typecheck`
4. `npm test`
5. `cd android && ./gradlew assembleDebug`
6. install APK on phone
7. open app
8. create initial account
9. create a session
10. log a loss
11. record a payment
12. export CSV

## 13. If Something Fails

Quick resets:

```bash
rm -rf node_modules
rm -rf android
npm install --legacy-peer-deps
npx expo prebuild --platform android
```

Gradle reset:

```bash
cd android
./gradlew --stop
rm -rf ~/.gradle/caches
./gradlew assembleDebug
```

ADB reset:

```bash
adb kill-server
adb start-server
adb devices
```

## 14. Recommendation

For this project, Linux is the better default build host if the goal is:

- repeatable Android builds
- fewer Java/Gradle toolchain issues
- simpler device testing
- cleaner CI parity

Windows can still be used for light UI/code work, but native Android build verification should preferably happen on Linux.
