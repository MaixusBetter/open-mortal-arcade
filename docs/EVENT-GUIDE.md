# Running the OpenMortal jam

A run sheet for the workshop, the character modding week and the tournament.

## Kit

* Big-screen PC with current Chrome or Edge, a projector or TV, speakers.
* Wi-Fi that players' phones can join (the same network as the PC). Campus guest Wi-Fi often blocks device-to-device traffic: a cheap travel router or a phone hotspot avoids that.
* A filming corner: a plain wall (a green or blue sheet is even better), 3 to 4 m of floor, a soft mat for the knockdown pose, a phone tripod at hip height, and one bright light from the front.
* Optional: 2 to 4 USB or Bluetooth gamepads for the big-screen PC.

## The day before

1. On the big-screen PC, double-click **Start Arcade.cmd**. The first run fetches what is missing (Node.js and the Windows file system, about 130 MB together), then opens the title screen. Allow Node.js through Windows Firewall on Private networks when asked.
2. Choose **Start the big screen**, press **Power on**, and play one round with the keyboard. The first boot loads about 160 MB into the browser.
3. Join from a phone using the QR code. Then open the "Filming with a phone" address the launcher window shows, and accept the certificate warning once.
4. Make one fighter yourself with **Try sample footage** in the creator, send it to the arcade, and check it appears on the select screen after **Change fighters**.

On the day, double-click **Start Arcade.cmd** again. Nothing is downloaded a second time.

## Workshop (recorded)

1. **Why this game matters** (`history.html`): nine screens, arrow keys to advance, about 10 minutes. Tick "Attract mode" afterwards to loop it on a side screen.
2. **Live fighter in 10 minutes**: Easy mode, ten poses with the camera, Test and send, then fight it on the big screen.
3. **Under the hood** for the coders: switch to Hands-on. The lessons walk through the three files, the frame lookup, states and timing, hit boxes, combos and projectiles. The Code tab shows the exact Perl the game will run.

## Modding week: the filming booth

* Whole body in frame, feet near the bottom, nothing cut off when arms go up.
* In the camera screen, press **Shoot the empty background** first, with nobody in the picture.
* Face the right side of the screen, like the ghost outline.
* Knockdown: sit down, then lie back slowly. The creator speeds it up.
* Keep the camera still between poses so every move lines up.
* About 15 minutes per person: 5 filming, 10 touching up and painting on a laptop.
* People who would rather not be filmed can **Borrow** poses from stock fighters, or upload a GIF or video.

## Tournament

* On the big screen, **Change fighters**, tick up to 12 custom fighters and any stages, set round time, **Power on**.
* Two seats: phones join with the code; a third phone waits in the queue and the host promotes it with the P1 or P2 buttons.
* Gamepads on the big-screen PC: press any button to take a free seat.
* In OpenMortal's menu: Esc, then **Multi player game**. Each player picks a fighter with a punch button.
* Practice or one person alone: leave Player 2's seat empty and the computer plays it (skill level in **Change fighters**). It picks its fighter after Player 1.

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone says it cannot reach the arcade | Same Wi-Fi as the PC? Some campus networks isolate devices; use a travel router or hotspot. |
| Camera button says it needs https | Open the "Filming with a phone" address from the launcher window (it starts with `https://`). |
| The big screen stays on "Booting" | Check the launcher window for a file system message, and use Chrome or Edge 137+. |
| The game runs but the picture stays black | Press **Change fighters**, set **Graphics** to GDI, and press Power on again. |
| The game feels slow | Watch **Game speed** at the bottom of the big screen during a fight. Below 100% the computer can't emulate it at full speed: close other programs and browser tabs (keep the developer tools closed too, they slow the page), plug in the laptop, and keep **Graphics** on DirectDraw. |
| The fight freezes and the game window disappears | That was the original game's crash on a 5-hit combo, fixed since update 4. Make sure `server/zzArcade.pl` is the new one, then press Power on again. |
| No sound | Click once anywhere on the big screen. Browsers keep sound off until someone clicks or presses a key on that computer. |
| Single player game is greyed out in the game's menu | That is the original game. Use Multi player game; the computer plays Player 2 when the seat is empty. |
| The computer doesn't pick a fighter | Pick yours first (Player 1). If someone used Player 2's keys on the keyboard in the last 90 seconds, the arcade treats that person as Player 2. |
| Network game can't connect | It needs the internet, which the emulator doesn't have. Use phones instead. |
| A custom fighter is missing on the select screen | Only 12 fit next to the stock 18. Press Change fighters and check the ticks. |
| Cutout eats part of someone | Step 2, Keep brush. Or redo the pose with the empty-background shot. |
