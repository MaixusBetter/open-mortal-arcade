# Runtime probe

A way to check the browser side of the arcade without the 100 MB Wine file system: the Boxedwine runtime, the overlay zips the server builds, the key path from controllers into the emulator, and the canvas.

`keyprobe` is a tiny 32-bit Linux X11 program. Boxedwine boots it instead of Wine. It prints which injected files it can see in `C:\OpenMortal`, which `OpenMortal.exe.ini` won (the injected one must), and every key that reaches the guest X server. It also paints the screen and changes colour on each key press, so the picture path is visible too.

## Build the probe root (Linux or WSL)

Needs `gcc-multilib`, `libx11-dev`, `zip` and a Boxedwine source checkout (for its X11 shim).

```
bash tools/runtime-probe/make-probe-root.sh /path/to/Boxedwine
```

This writes `public/game/probe-root.zip`.

## Run it

Start the server, then make a roster to get an overlay address:

```
curl -s -X POST -H "content-type: application/json" -d "{\"fighters\":[],\"stages\":[]}" http://localhost:8080/api/roster
```

Pass the `overlay` value it returns:

```
node tools/runtime-probe/probe-web.mjs http://localhost:8080 /api/overlay/abc123/ probe.png
```

It ends with `12 of 12 key presses reached the guest`. Add `runtime-mt` after the screenshot name to test the multi-threaded build instead of the default `runtime`. A 404 for `wasm-jit-modules.zip` is normal: that optional JIT cache is not shipped.

## The whole big screen

`make-probe-root.sh` also copies keyprobe to `/bin/wine`. To rehearse the full flow (Power on, phones, gamepads) without the real file system, copy the probe root under the file system's name:

```
cp public/game/probe-root.zip public/game/TinyCore15Wine11.0-web.zip
```

Start the server directly (the launchers would set the small probe aside as an incomplete download):

```
node server/server.mjs
```

Use the big screen as usual and watch the browser console for `PROBE` lines. Delete the copy before the event.
