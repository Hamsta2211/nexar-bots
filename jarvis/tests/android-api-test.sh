#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk" ]]; then
  for candidate in "$HOME/Android/Sdk" /workspace/.android-sdk-nexar; do
    if [[ -f "$candidate/platforms/android-35/android.jar" ]]; then sdk="$candidate"; break; fi
  done
fi
android="$sdk/platforms/android-35/android.jar"
[[ -f "$android" ]] || { echo 'Android SDK 35 fehlt (ANDROID_SDK_ROOT setzen).' >&2; exit 1; }
cache="${XDG_CACHE_HOME:-$HOME/.cache}/jarvis-tests"
mkdir -p "$cache"
json="$cache/json-20240303.jar"
if [[ ! -s "$json" ]]; then
  curl --fail --silent --show-error --max-time 60 'https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar' -o "$json"
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
javac -cp "$json:$android" -d "$work" tests/AndroidApiTest.java android/app/src/main/java/im/nexar/jarvis/DesktopApi.java
java -cp "$work:$json:$android" im.nexar.jarvis.AndroidApiTest
