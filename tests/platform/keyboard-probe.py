#!/usr/bin/python3
"""Observe native X keypresses on a disposable display; JSON commands over stdin."""
import ctypes as c
import json
import sys


class KeyEvent(c.Structure):
    _fields_ = [("type", c.c_int), ("serial", c.c_ulong), ("send_event", c.c_int),
                ("display", c.c_void_p), ("window", c.c_ulong), ("root", c.c_ulong),
                ("subwindow", c.c_ulong), ("time", c.c_ulong), ("x", c.c_int),
                ("y", c.c_int), ("x_root", c.c_int), ("y_root", c.c_int),
                ("state", c.c_uint), ("keycode", c.c_uint), ("same_screen", c.c_int)]


class Event(c.Union):
    _fields_ = [("type", c.c_int), ("key", KeyEvent), ("pad", c.c_long * 24)]


class KeyboardState(c.Structure):
    _fields_ = [("group", c.c_ubyte), ("locked_group", c.c_ubyte),
                ("base_group", c.c_ushort), ("latched_group", c.c_ushort),
                *[(name, c.c_ubyte) for name in ("mods", "base_mods", "latched_mods",
                  "locked_mods", "compat_state", "grab_mods", "compat_grab_mods",
                  "lookup_mods", "compat_lookup_mods")], ("ptr_buttons", c.c_ushort)]


x = c.CDLL('libX11.so.6')
xtest = c.CDLL('libXtst.so.6')


def bind(lib, name, result, *args):
    fn = getattr(lib, name)
    fn.restype, fn.argtypes = result, list(args)
    return fn


open_display = bind(x, 'XOpenDisplay', c.c_void_p, c.c_char_p)
close_display = bind(x, 'XCloseDisplay', c.c_int, c.c_void_p)
root_window = bind(x, 'XDefaultRootWindow', c.c_ulong, c.c_void_p)
create_window = bind(x, 'XCreateSimpleWindow', c.c_ulong, c.c_void_p, c.c_ulong,
                     c.c_int, c.c_int, c.c_uint, c.c_uint, c.c_uint, c.c_ulong, c.c_ulong)
select_input = bind(x, 'XSelectInput', c.c_int, c.c_void_p, c.c_ulong, c.c_long)
map_window = bind(x, 'XMapWindow', c.c_int, c.c_void_p, c.c_ulong)
focus = bind(x, 'XSetInputFocus', c.c_int, c.c_void_p, c.c_ulong, c.c_int, c.c_ulong)
sync = bind(x, 'XSync', c.c_int, c.c_void_p, c.c_int)
pending = bind(x, 'XPending', c.c_int, c.c_void_p)
next_event = bind(x, 'XNextEvent', c.c_int, c.c_void_p, c.POINTER(Event))
lookup = bind(x, 'XLookupString', c.c_int, c.POINTER(KeyEvent), c.c_char_p,
              c.c_int, c.POINTER(c.c_ulong), c.c_void_p)
lock = bind(x, 'XkbLockModifiers', c.c_int, c.c_void_p, c.c_uint, c.c_uint, c.c_uint)
get_state = bind(x, 'XkbGetState', c.c_int, c.c_void_p, c.c_uint, c.POINTER(KeyboardState))
keycode = bind(x, 'XKeysymToKeycode', c.c_ubyte, c.c_void_p, c.c_ulong)
fake_key = bind(xtest, 'XTestFakeKeyEvent', c.c_int, c.c_void_p, c.c_uint, c.c_int, c.c_ulong)
fake_motion = bind(xtest, 'XTestFakeMotionEvent', c.c_int, c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_ulong)
fake_button = bind(xtest, 'XTestFakeButtonEvent', c.c_int, c.c_void_p, c.c_uint, c.c_int, c.c_ulong)

display = open_display(sys.argv[1].encode())
assert display, 'Cannot open isolated display'
try:
    # The injection-only mode is used for physical input to an isolated viewer.
    if '--input-only' not in sys.argv:
        window = create_window(display, root_window(display), 0, 0, 640, 480, 0, 0, 0)
        select_input(display, window, 1)  # KeyPressMask: releases must not count as text.
        map_window(display, window)
        focus(display, window, 1, 0)
    sync(display, 0)
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        command = json.loads(line)
        if 'focus' in command:
            focus(display, command['focus'], 1, 0)
        if 'click' in command:
            fake_motion(display, -1, *command['click'], 0)
            fake_button(display, 1, True, 0)
            fake_button(display, 1, False, 0)
        if 'locks' in command:
            assert lock(display, 0x100, 0xff, command['locks'])
        for keysym, down in command.get('keys', []):
            code = keycode(display, keysym)
            assert code, f'No keycode for {keysym}'
            assert fake_key(display, code, down, 0)
        sync(display, 0)
        events = []
        while pending(display):
            event = Event()
            next_event(display, c.byref(event))
            if event.type == 2:
                text, symbol = c.create_string_buffer(64), c.c_ulong()
                count = lookup(c.byref(event.key), text, 64, c.byref(symbol), None)
                events.append({'text': text.raw[:count].decode('utf-8', errors='replace'),
                               'keysym': symbol.value, 'state': event.key.state})
        state = KeyboardState()
        assert get_state(display, 0x100, c.byref(state)) == 0
        print(json.dumps({'events': events, 'locks': state.locked_mods,
                          'held': state.base_mods}), flush=True)
finally:
    close_display(display)
