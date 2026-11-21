#!/usr/bin/env bash
# Builds android/build/BearWall.apk without Gradle: javac -> d8 -> aapt2 -> zipalign -> apksigner.
# Needs a JDK (8+) and, in $ANDROID_HOME (default ~/Android/sdk): platforms;android-32 and build-tools;34.0.0.
# The web files in prototype/ go into the APK as its first copy (the app copies them out on first start).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Android/sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-32/android.jar"
OUT="$HERE/build"
KS="$HERE/debug.keystore"   # stays on this PC (gitignored); reinstalls must be signed with the same key
# JDK 17: JDK 21's javac writes nameless parameter info for inner-class constructors, which this d8 crashes on
JDK="${JDK:-$(ls -d "/c/Program Files/Java/jdk-17"* 2>/dev/null | head -1)}"
[ -n "$JDK" ] || { echo "Set JDK to a JDK 17 folder."; exit 1; }
javac() { "$JDK/bin/javac" "$@"; }
jar() { "$JDK/bin/jar" "$@"; }
keytool() { "$JDK/bin/keytool" "$@"; }

for f in "$JAR" "$BT/aapt2.exe" "$BT/d8.bat" "$BT/zipalign.exe" "$BT/apksigner.bat"; do
  [ -e "$f" ] || { echo "Missing $f - install platforms;android-32 and build-tools;34.0.0 with sdkmanager."; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/pkg/assets/web"

echo "Compiling Java..."
mapfile -t SRC < <(find "$HERE/src" -name '*.java')   # arrays keep paths with spaces in one piece
javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 -bootclasspath "$JAR" -d "$OUT/classes" "${SRC[@]}"

echo "Converting to dex..."
mapfile -t CLS < <(find "$OUT/classes" -name '*.class')
"$BT/d8.bat" --release --min-api 29 --lib "$JAR" --output "$OUT/pkg" "${CLS[@]}"

echo "Packing the web files and the manifest..."
cp -r "$ROOT/prototype/." "$OUT/pkg/assets/web/"
"$BT/aapt2.exe" link -o "$OUT/base.apk" -I "$JAR" --manifest "$HERE/AndroidManifest.xml"
# jar, not aapt2 -A: on Windows aapt2 writes asset paths with backslashes, which Android can't find
jar uf "$OUT/base.apk" -C "$OUT/pkg" .

echo "Aligning and signing..."
"$BT/zipalign.exe" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias bearwall \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=BearWall" >/dev/null
"$BT/apksigner.bat" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out "$OUT/BearWall.apk" "$OUT/aligned.apk"
"$BT/apksigner.bat" verify "$OUT/BearWall.apk"
echo "Built $OUT/BearWall.apk ($(du -k "$OUT/BearWall.apk" | cut -f1) KB)"
