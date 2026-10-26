# Building the Boxedwine runtime

The arcade ships two WebAssembly builds of Boxedwine, so you only need this page to update or rebuild them:

* `public/runtime/`: the single-threaded JIT build (`make jit`). The big screen always uses this one. Running the real game in Chromium, it booted Windows in about half the time of the multi-threaded build, fought faster, and its memory stayed flat.
* `public/runtime-mt/`: the multi-threaded JIT build (`make multiThreadedJit`), kept for testing with `host.html?runtime=mt`. With OpenMortal its memory grew by 12 to 20 MB a second during fights (outside the emulator's own heap) until the browser tab ran out of memory, so it is not the default. It needs cross-origin isolation (SharedArrayBuffer), which `server/server.mjs` sets up; browsers allow it on `localhost` and on https.

## What was built

* Source: https://github.com/danoon2/Boxedwine (master, October 2026)
* Targets: `make multiThreadedJit` and `make jit` in `project/emscripten`
* Toolchain: Emscripten 4.0.1, LLVM 20, Binaryen 121
* One fix on top of upstream, in `project/emscripten/boxedwine-audio-worklet.js` (see below)
* Each folder holds `boxedwine.js`, `boxedwine.wasm`, `boxedwine-shell.js`, `boxedwine.css`, `fsfs.js` from the build, plus `arcade.html`, our skin of the shell (the same file in both folders): only the game canvas shows, and it exposes `window.arcade` to the big screen (key injection, the game's status file, the sound nudge).

## Rebuild (Linux or WSL)

Install the Emscripten SDK the normal way (https://emscripten.org/docs/getting_started/downloads.html), then:

```
git clone https://github.com/danoon2/Boxedwine
```

```
cd Boxedwine/project/emscripten
```

```
source ~/emsdk/emsdk_env.sh
```

```
make multiThreadedJit
```

```
make jit
```

Before `make`, apply the sound fix. Emscripten copies library objects as if they were JSON, so the `devices: new Map()` in `boxedwine-audio-worklet.js` arrives in `boxedwine.js` as `devices: {}`. Opening the sound device then fails, the game falls back to the old ScriptProcessor sound, and the AudioWorklet timer throws `audio.devices.values is not a function` 100 times a second, which floods the console and slows the page. Add this line inside `addToLibrary({ ... })`, after the `$BoxedwineAudio` object:

```
$BoxedwineAudio__postset: 'BoxedwineAudio.devices = new Map();',
```

A good build logs `Audio output: AudioWorklet` in the browser console when the game opens its sound.

Copy `boxedwine.js`, `boxedwine.wasm`, `boxedwine-shell.js`, `boxedwine.css` and `fsfs.js` from `Build/Jit/` into `public/runtime/`, and from `Build/MultiThreadedJit/` into `public/runtime-mt/`.

## The Windows file system

Boxedwine boots a small Linux (TinyCore) with Wine 11 inside. That file system is published by the Boxedwine project at boxedwine.org and is about 100 MB, so it is not in this repository. The launchers (`Start Arcade.cmd`, `start.sh`) fetch `TinyCore15Wine11.0-web.zip` into `public/game/` on first run and check it (`tools/setup.mjs`, which also recognises Boxedwine's published SHA-256 sums for revisions 19 to 21). By hand, put `TinyCore15Wine11.0-web.zip` (or the full `TinyCore15Wine11.0.zip`) in `public/game/`. The server picks up whichever is there.

## How the arcade launches the game

`js/host.js` loads `runtime/arcade.html` (or `runtime-mt/arcade.html` with `?runtime=mt`) with these URL parameters (all standard Boxedwine shell options):

| Parameter | Value | Why |
|---|---|---|
| `root` | `TinyCore15Wine11.0-web.zip` | the Linux + Wine file system |
| `overlay` | `custom.zip;openmortal.zip` | first zip wins: injected fighters/stages/ini, then the stock game |
| `overlayBase` | `/api/overlay/<roster id>/` | the server builds `custom.zip` for the chosen roster |
| `p` | `OpenMortal.exe` | the untouched 2004 executable |
| `w` | `/home/username/.wine/drive_c/OpenMortal/bin` | the game expects `../data` next to `bin` |
| `env` | `"WINEDEBUG:-all"` | Wine's log off, so it costs nothing in the browser console. With **Graphics: GDI** this is `"SDL_VIDEODRIVER:windib"` instead |
| `resolution` | `640x480` | the game's own resolution, so the canvas is exactly the game |
| `storage` | `memory` | every boot starts clean |

The shell reads its URL by hand: the overlay list must keep a raw `;` and `env` must be a quoted `NAME:value`, so `host.js` builds the query itself instead of using `URLSearchParams` (which would encode both).

Graphics: by default SDL 1.2 picks its DirectDraw driver, which Boxedwine's web build routes to its WebGL Direct3D, so the browser's GPU converts the 16-bit frames. Profiled natively under Wine, the GDI driver (`windib`) spent over half of the game's CPU time converting and copying frames in Wine's GDI code (`win32u`), which in the emulator is emulated x86. **Graphics: GDI** in the cabinet setup (or `host.html?sdl=windib`) is kept for machines where DirectDraw shows a black picture.

The game's own speed shows on the big screen during fights (**Game speed**): `server/zzArcade.pl` writes the game's tick to the status file about once a second, and full speed is 1000 / GAMESPEED ticks per second.

Sound: the web build keeps the guest's sound off until the first mouse click on the game, and browsers keep audio paused until someone interacts with the page. Players here use keys, phones and gamepads, so `arcade.html` clicks the game's top-left corner itself (`nudgeAudio`): when the emulator starts, when the game's status file first appears, and on the big screen's own clicks and key presses.

`arcade.html` keeps the shell's two stacked canvases: `#canvas` receives input, and the frame canvas on top of it (`boxedwine-webgl-canvas-0`, `pointer-events: none`) shows the picture. Hiding either one breaks the game.

## How it was tested

* The overlay zips, the key path and the canvas were checked in Chromium with the real WebAssembly build and a stand-in Linux program instead of Wine: injected fighters and stages are visible in `C:\OpenMortal`, the injected `OpenMortal.exe.ini` wins over the stock one, and every key from a phone, the big-screen keyboard and a gamepad reaches the guest. `tools/runtime-probe/` has the probe and the steps to repeat it.
* The fighter and stage files themselves were checked in the real OpenMortal 0.7 under Wine on Linux, as were the stage order (custom stages first) and the computer opponent (`server/zzArcade.pl`): it fights, blocks and counters, steps aside when a Player 2 key is pressed, and follows `arcade/control.txt` while the game runs.
* The status and control files were checked in both WebAssembly builds with a stand-in program: the page reads what the guest writes and the guest sees what the page writes, while it runs.
* The whole arcade was then run with the real file system (`TinyCore15Wine11.0-web.zip`) in headless Chromium: Windows boots, the injected stages and fighters load, the menus answer the big screen's keys, the computer picks its fighter and fights, sound opens through the AudioWorklet, and the page's memory stays flat over several minutes of fighting. That machine had two CPU cores and no graphics card, so its speeds are far below a normal PC's; they were used only to compare settings with each other.
* Do a full rehearsal on the event PC the day before (see `EVENT-GUIDE.md`).
