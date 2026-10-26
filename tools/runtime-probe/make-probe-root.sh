#!/bin/bash
# Builds public/game/probe-root.zip: a tiny 32-bit Linux root that Boxedwine can boot without
# Wine. It holds keyprobe, the C library and Boxedwine's X11 shim. Run on Linux or WSL with
# gcc-multilib and libx11-dev installed. Pass the path of a Boxedwine source checkout.
set -e
BW="${1:?usage: make-probe-root.sh /path/to/Boxedwine}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../public/game/probe-root.zip"
WORK="$(mktemp -d)"
mkdir -p "$WORK/root/bin" "$WORK/root/lib/i386-linux-gnu" "$WORK/root/usr/lib/i386-linux-gnu" "$WORK/root/etc" "$WORK/root/tmp" "$WORK/root/home/username"

gcc -c -w -fpic -m32 -march=i586 -o "$WORK/X11.o" "$BW/tools/x11/X11.c"
gcc -Wl,-soname,libX11.so.6 -shared -m32 -o "$WORK/root/usr/lib/i386-linux-gnu/libX11.so.6" "$WORK/X11.o"
ln -s "$WORK/root/usr/lib/i386-linux-gnu/libX11.so.6" "$WORK/libX11.so"
gcc -m32 -O2 -w -o "$WORK/root/bin/keyprobe" "$HERE/keyprobe.c" -L"$WORK" -lX11
cp "$WORK/root/bin/keyprobe" "$WORK/root/bin/wine"   # lets host.html boot it in place of Wine

cp -L /lib/ld-linux.so.2 "$WORK/root/lib/"
cp -L /lib/i386-linux-gnu/libc.so.6 "$WORK/root/lib/i386-linux-gnu/"
printf 'root:x:0:0:root:/root:/bin/sh\nusername:x:1000:1000:username:/home/username:/bin/sh\n' > "$WORK/root/etc/passwd"
printf 'root:x:0:\nusername:x:1000:\n' > "$WORK/root/etc/group"

rm -f "$OUT"
(cd "$WORK/root" && zip -qr "$OUT" .)
rm -rf "$WORK"
echo "Wrote $OUT"
