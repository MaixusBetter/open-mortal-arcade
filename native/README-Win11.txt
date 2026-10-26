OPENMORTAL ON WINDOWS 11: THE FIX
==================================

WHY IT WOULD NOT BOOT
Your stderr.txt says:
  SDL_SetVideoMode( 640, 480, 16, FULLSCREEN ) failed.
  DirectDrawSurface::Release: Unknown DirectDraw error
OpenMortal 0.7 (2004) uses SDL 1.2, which by default asks DirectDraw for a
640x480, 16-bit fullscreen screen mode. Windows 11 no longer hands out that
mode, so the game dies before the title screen. Compatibility mode and
"Run as administrator" do not change which driver SDL picks, which is why
they did not help.

WHAT THE LAUNCHER DOES
1. Tells SDL to use its GDI video driver (SDL_VIDEODRIVER=windib) instead
   of DirectDraw, and the classic waveOut sound driver.
2. Gives the game a settings file (OpenMortal.exe.ini, saved next to
   OpenMortal.exe) so it starts in a window.
No game file is modified. Delete the launcher and everything is as before.

HOW TO USE
1. Copy your whole OpenMortal folder (the one with "bin" and "data" inside)
   somewhere you own, like Documents\OpenMortal. Program Files is
   write-protected, and the game saves its settings next to the .exe.
2. Put these files in that folder, next to "bin" and "data":
     Play OpenMortal.bat
     Play OpenMortal (Fullscreen).bat
     OpenMortal.exe.ini.win11
3. Double-click "Play OpenMortal.bat".
   The fullscreen launcher also works now, because the GDI driver can
   switch screen modes. If your monitor refuses 640x480, use the window.

KEYS (defaults, change them in Options)
             Player A        Player B
  Move       Arrow keys      W A S D
  High punch Insert          R
  Low punch  Delete          F
  High kick  Home            T
  Low kick   End             G
  Block      Page Down       X
Esc opens the menu. F1 skips scenes.
Gamepads: SDL 1.2 sees Xbox-style controllers through Windows' joystick
API. Plug them in before launching and bind buttons in Options.

TESTED
Verified with the real OpenMortal.exe 0.7 under Wine 9: the GDI driver
starts in both windowed and fullscreen modes, and the settings file is
read and written next to the .exe.
