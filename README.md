# Open Mortal Arcade

The real OpenMortal 0.7 (2004, GPL) running unmodified in any browser, plus:

* **Make a fighter**: film yourself (camera, video or GIF), the background is removed automatically, touch it up, paint effects Mario Paint style, and get a real OpenMortal fighter (`.dat`, `.dat.txt`, `.pl`). Easy mode (ten poses, Photo Dojo style) or Hands-on mode (every animation, hit boxes, the Perl script, with lessons).
* **Build a stage**: a photo panorama or parallax layers.
* **Big screen + controllers**: the game runs on one machine; players join from phones or laptops with a 4-letter code, or plug gamepads into the big-screen PC.
* **Single player**: a computer opponent plays Player 2 whenever that seat is empty (OpenMortal 0.7 never finished its own single player mode).
* **Custom stages first**: the stages people send are played first, oldest first, then the stock stages.
* **Why this game matters**: attract-mode screens on Mortal Kombat, the ESRB, esports, and open source.

Nothing in OpenMortal is recreated or modified. The untouched `OpenMortal.exe` runs inside **Boxedwine** (Wine compiled to WebAssembly). Custom fighters and stages are *injected*: they are copied into the game's own `data` folder inside the emulated Windows before it boots, exactly where the original Character HOWTO says they go.

Made for the uOttawa Game Development Club.

---

## Start it

* **Windows:** double-click **Start Arcade.cmd**.
* **Mac:** double-click **Start Arcade.command**. The first time, right-click it and choose Open, because macOS asks about files from the internet.
* **Linux:** run `./start.sh` in a terminal.

The launcher does the setup for you, and only the first time:

* **Node.js:** if the computer doesn't have Node.js 20 or newer, it downloads a private copy into a `.runtime` folder inside the arcade and checks it against Node's published checksum. Nothing is installed on the computer and no admin rights are needed.
* **The Windows file system** (Boxedwine's, about 100 MB): if it isn't in `public/game/` yet, it copies it from your Downloads folder or downloads it from boxedwine.org, then checks that the file is complete.
* **Starting up:** it starts the arcade on a free port (8080 if it can), turns on https for phone cameras and opens the title screen in your browser.

Keep the launcher window open while you play. Close it or press Ctrl+C to stop the arcade. Double-clicking it again while the arcade is running just opens the browser.

The first time Windows runs it, two things may ask for permission:

* Windows may say the publisher could not be verified. Choose **Run** (or **More info**, then **Run anyway**).
* Windows Firewall will ask about Node.js. Allow **Private networks** so phones can connect. The Wi-Fi should be set to Private in Windows settings, not Public.

**From Git Bash** (or any terminal) the same launcher runs with:

```
npm start
```

Or start only the server, with no setup steps:

```
node server/server.mjs
```

### If the automatic download doesn't work

Download the file system in your browser and put it in `public/game/` without unzipping it:

https://boxedwine.org/v2/21/TinyCore15Wine11.0-web.zip

If that address doesn't work, change `21` to `20`, or use the full version: `https://boxedwine.org/v2/latest/TinyCore15Wine11.0.zip`. A name like `TinyCore15Wine11.0-web (1).zip` is fine; the launcher renames it.

### Phones

Players open the address shown on the big screen (or scan the QR code) on the same Wi-Fi, type the 4-letter code, and play. Controllers work on plain http.

Filming with a phone camera in the fighter creator needs https. The launcher turns it on and prints the address (`https://<this PC>:8443/create.html`). Each phone accepts the certificate warning once. The certificate is made by the arcade itself, so no openssl is needed.

## Controls

| | Player 1 | Player 2 |
|---|---|---|
| Move | Arrow keys | W A S D |
| High punch | Insert (or U) | R |
| Low punch | Delete (or J) | F |
| High kick | Home (or I) | T |
| Low kick | End (or K) | G |
| Block | Page Down (or L) | X |

Menu: Esc. Confirm: Enter. Skip replays: F1.

**Gamepads** (standard layout): X / Square low punch, Y / Triangle high punch, A / Cross low kick, B / Circle high kick, shoulders and right trigger block, d-pad or left stick moves, Start confirms, Back/Select opens the menu. Press any button to take a free seat.

**Phones**: d-pad on the left, punches and kicks on the right, block in the middle. Thumbs can slide between buttons.

## Single player

OpenMortal 0.7's own **Single player game** menu item is greyed out: the original developers never finished it. The arcade adds a computer opponent instead, written into the game's own Perl fighter scripts (`server/zzArcade.pl`, injected like a fighter file), so it fights with each fighter's real move table.

1. In the game's menu choose **Multi player game**, then **Start game**.
2. Pick your fighter as Player 1. The computer picks Player 2's fighter right after you.
3. Fight. The skill level (easy, normal, hard) is set in **Change fighters**.

The computer only plays while Player 2's seat is empty. When a phone or gamepad takes that seat, or someone presses a Player 2 key on the keyboard, a person plays instead.

### A bug in the original game, fixed

OpenMortal 0.7 quits in the middle of a fight whenever someone lands a 5-hit combo (the "MAX COMBO!!!"): a line in its `Fighter.pl` leaves out who did the hitting, and the error stops the game. People rarely manage five hits in a row, but the computer opponent does it often, so the screen froze within a few fights. `server/zzArcade.pl` fills in the missing fighter at runtime, so the max combo plays out as the game's own code describes it. It also keeps the game running if any other Perl error turns up during a fight, and notes it in `stderr.txt`. The original files stay untouched.

## What doesn't work in the browser

* **Network game** (MortalNet): the emulator has no internet access. Use phones as controllers instead; everyone plays on the one big screen.

## How a custom fighter gets into the real game

1. The creator writes the three files OpenMortal uses: `Name.dat` (an Allegro 4 datafile: one 63-colour palette and one 8-bit RLE sprite per frame), `Name.dat.txt` (each frame's offset and head/body/legs/hit polygons) and `Name.pl` (the Perl move set, built on OpenMortal's own `DataHelper.pl`), plus portraits.
2. "Send to the arcade" uploads them. The server gives every fighter a unique codename and an ID from 200 up.
3. On Power on, the server builds an overlay zip that places the chosen fighters in `C:\OpenMortal\data\characters`, custom stages in `data\gfx` (with the stage list rewritten so they come first, in the order they were sent), the key bindings in `bin\OpenMortal.exe.ini`, and `zzRoster.pl`, which hides the three stock fighters that never shipped playable (their red X portraits). Boxedwine layers it over the stock game.
4. The unmodified `OpenMortal.exe` boots and loads them like any other fighter.

The select screen fits 30 portraits, so up to 12 custom fighters join the 18 stock ones per session.

Fighter packs also work in a normal OpenMortal install: unzip into `data/characters`. Stage packs include a README with the file names to use.

## Windows 11 (native, outside the browser)

`native/` has the fix for "OpenMortal won't start on Windows 11": SDL 1.2's DirectDraw driver asks for a 640x480 16-bit fullscreen mode that Windows 11 refuses. Its `Play OpenMortal.bat` switches SDL to the GDI driver and starts windowed. See `native/README-Win11.txt`.

## Folder layout

```
Start Arcade.cmd         Windows launcher (double-click)
Start Arcade.command     Mac launcher (double-click)
start.sh                 Mac and Linux launcher
server/server.mjs        web server, controller relay (WebSocket), fighter/stage storage, overlay builder
server/selfcert.mjs      makes the https certificate for phone cameras
server/zzArcade.pl       the computer opponent and status files, injected into the game's Perl scripts
public/                  everything the browser loads
  index.html             title screen
  host.html, js/host.js  big screen
  pad.html, js/pad.js    phone / laptop controller
  create.html, js/creator/   fighter creator
  stage.html, js/stage.js    stage builder
  history.html           Mortal Kombat, the ESRB, esports, open source
  js/omformat.js         OpenMortal file formats (datafile writer/reader, .dat.txt, .pl generator)
  js/fighterbuild.js     frames -> palette -> sprites -> hit boxes -> fighter
  runtime/               Boxedwine (WebAssembly) and arcade.html, the skinned shell
  runtime-mt/            the multi-threaded build, for testing only (host.html?runtime=mt)
  game/openmortal.zip    the stock game, laid out for the emulated C: drive
  game/TinyCore15Wine11.0-web.zip   fetched by the launcher (or added by hand)
  vendor/                MediaPipe selfie segmentation (background removal), QR code generator
data/                    fighters and stages people send, and the https certificate (created on first run)
.runtime/                the private Node.js, if the launcher had to fetch one
tools/setup.mjs          what the launchers run: file system check or download, then start
tools/get-node.ps1       fetches a private Node.js on Windows when needed
tools/                   build scripts (game zip, art, tests)
tools/runtime-probe/     checks the browser runtime, overlays and controls without Wine
native/                  Windows 11 launcher fix
```

## Rebuilding things

* Game zip from an OpenMortal folder: `node tools/build-game-zip.mjs "C:/path/to/OpenMortal"`
* Title-screen sprites and pose guides: `node tools/extract-attract.mjs <OpenMortal>/data/characters` and `node tools/extract-guides.mjs <OpenMortal>/data/characters`
* Textures and emblem: `python tools/gen-art.py`
* Boxedwine runtime: see `docs/BUILDING-BOXEDWINE.md`.

## Browsers

The big screen needs a current Chrome or Edge (137+), Firefox (131+) or Safari (18.4+): the Boxedwine build uses WebAssembly exception handling. The creator, controllers and history screens work in any current browser. The AI background removal runs locally on the device; nothing is uploaded until someone presses "Send to the arcade".

## Licences

* Mortal Arcade code: GNU GPL version 2 or later (see `LICENSE`), to match the projects it builds on.
* OpenMortal 0.7: GPL v2, by UPi and the OpenMortal team. https://openmortal.sourceforge.net/ (source code is available there).
* Boxedwine: GPL v2. https://github.com/danoon2/Boxedwine . Wine: LGPL.
* MediaPipe Selfie Segmentation: Apache 2.0. qrcode-generator: MIT. Jacquard 24 and Pixelify Sans fonts: SIL Open Font License.
* The sample footage in `public/samples/` comes from OpenMortal's own character footage.

Mortal Kombat is a trademark of Warner Bros. Entertainment. OpenMortal is an independent parody and this project is not affiliated with Midway, Warner Bros. or the ESRB.
