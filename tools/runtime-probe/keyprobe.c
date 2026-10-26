/* keyprobe: a tiny 32-bit X11 client used to test the arcade's Boxedwine integration
 * without Wine. It reports which injected files are visible in the guest file system,
 * paints the screen, and prints every key event that reaches the guest X server. */
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <stdlib.h>

static const char *GAME = "/home/username/.wine/drive_c/OpenMortal";

static void report_file(const char *rel) {
    char path[512];
    struct stat st;
    snprintf(path, sizeof(path), "%s/%s", GAME, rel);
    if (stat(path, &st) == 0) printf("PROBE file %s size=%ld\n", rel, (long)st.st_size);
    else printf("PROBE missing %s\n", rel);
}

static void report_ini(void) {
    char path[512], line[256];
    snprintf(path, sizeof(path), "%s/bin/OpenMortal.exe.ini", GAME);
    FILE *f = fopen(path, "r");
    if (!f) { printf("PROBE ini unreadable\n"); return; }
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = 0;
        if (!strncmp(line, "FULLSCREEN", 10) || !strncmp(line, "PLAYER0KEYS", 11) || !strncmp(line, "ROUNDLENGTH", 11) || !strncmp(line, "GAMESPEED", 9))
            printf("PROBE ini %s\n", line);
    }
    fclose(f);
}

// an RGB colour as a pixel value for the screen's visual (16 or 32 bits per pixel)
static unsigned long pix(Visual *v, unsigned long rgb) {
    unsigned long out = 0, masks[3] = { v->red_mask, v->green_mask, v->blue_mask };
    for (int i = 0; i < 3; i++) {
        unsigned long c = (rgb >> (16 - 8 * i)) & 0xff, m = masks[i];
        if (!m) return rgb;
        int shift = 0, bits = 0;
        while (!(m & 1)) { m >>= 1; shift++; }
        while (m & 1) { m >>= 1; bits++; }
        out |= (c >> (8 - bits)) << shift;
    }
    return out;
}

static Bool any_event(Display *d, XEvent *e, XPointer arg) { (void)d; (void)e; (void)arg; return True; }

int main(int argc, char **argv) {
    setvbuf(stdout, NULL, _IONBF, 0);
    { char cwd[512]; const char *v = getenv("SDL_VIDEODRIVER"); printf("PROBE argv0=%s cwd=%s SDL_VIDEODRIVER=%s\n", argv[0], getcwd(cwd, sizeof(cwd)) ? cwd : "?", v ? v : "(unset)"); }
    for (int i = 1; i < argc; i++) { struct stat st; if (stat(argv[i], &st) == 0) printf("PROBE cwd-file %s size=%ld\n", argv[i], (long)st.st_size); else report_file(argv[i]); }
    report_file("data/characters/zzRoster.pl"); report_file("data/gfx/level12.jpg");
    report_ini();

    Display *d = XOpenDisplay(NULL);
    if (!d) { printf("PROBE no display\n"); return 1; }
    int screen = DefaultScreen(d);
    Window root = RootWindow(d, screen);
    XSetWindowAttributes attr;
    memset(&attr, 0, sizeof(attr));
    attr.event_mask = KeyPressMask | KeyReleaseMask | ButtonPressMask | ExposureMask | StructureNotifyMask;
    attr.background_pixel = pix(DefaultVisual(d, screen), 0x400000);
    Window w = XCreateWindow(d, root, 0, 0, 640, 480, 0, CopyFromParent, InputOutput, CopyFromParent, CWEventMask | CWBackPixel, &attr);
    XSelectInput(d, w, attr.event_mask);
    XMapWindow(d, w);
    XSetInputFocus(d, w, RevertToParent, CurrentTime);
    GC gc = XCreateGC(d, w, 0, NULL);
    printf("PROBE window up\n");

    int presses = 0;
    unsigned long colors[] = { 0x7a0f0f, 0xc8a24a, 0x3ee05a, 0xff4fd8 };
    for (;;) {
        XEvent e;
        int got = 0;
        while (XCheckIfEvent(d, &e, any_event, NULL)) {
            got = 1;
            if (e.type == ButtonPress) printf("PROBE button %u at %d,%d\n", e.xbutton.button, e.xbutton.x, e.xbutton.y);
            if (e.type == KeyPress || e.type == KeyRelease) {
                KeySym ks = XLookupKeysym(&e.xkey, 0);
                const char *name = XKeysymToString(ks);
                printf("PROBE key %s keycode=%u keysym=%s\n", e.type == KeyPress ? "down" : "up", e.xkey.keycode, name ? name : "?");
                if (e.type == KeyPress) presses++;
            }
        }
        XSetForeground(d, gc, pix(DefaultVisual(d, screen), colors[presses % 4]));
        XFillRectangle(d, w, gc, 0, 0, 640, 480);
        XSetForeground(d, gc, pix(DefaultVisual(d, screen), 0xe8dcc0));
        XFillRectangle(d, w, gc, 20, 440, (presses * 24) % 600 + 8, 20);
        XFlush(d);
        usleep(got ? 5000 : 30000);
    }
    return 0;
}
