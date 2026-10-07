#!/usr/bin/python3
"""Ephemeral, managed desktop shell. Capabilities arrive only over private stdin."""
import json
import signal
import sys
import threading
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib
from urllib.parse import urlsplit

if not Gtk.init_check()[0]:
    raise SystemExit(1)
window = Gtk.Window()
window.set_default_size(1280, 820)
window.connect('destroy', Gtk.main_quit)
context = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView.new_with_context(context)
window.add(view)
allowed_origin = None

def policy(_view, decision, kind):
    if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
        uri = decision.get_navigation_action().get_request().get_uri()
        parsed = urlsplit(uri)
        if (parsed.scheme, parsed.netloc) != allowed_origin or parsed.path != '/viewer':
            decision.ignore()
            return True
    if kind == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION:
        decision.ignore()
        return True
    return False

view.connect('decide-policy', policy)
view.connect('permission-request', lambda _view, request: (request.deny(), True)[1])
view.connect('context-menu', lambda *_: True)
manager = view.get_user_content_manager()
manager.register_script_message_handler('viewer')
def message(_manager, result):
    value = result.get_js_value().to_string()
    if value == 'ready':
        print('ready', flush=True)
    elif value == 'close':
        window.destroy()
manager.connect('script-message-received::viewer', message)

def command(data):
    global allowed_origin
    action = data.get('action')
    if action == 'open':
        parsed = urlsplit(data['url'])
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path != '/viewer':
            window.destroy()
            return False
        allowed_origin = (parsed.scheme, parsed.netloc)
        window.set_title(data['title'])
        view.load_uri(data['url'])
        window.show_all()
    elif action == 'present':
        window.present()
    elif action == 'close':
        window.destroy()
    return False

def reader():
    try:
        for line in sys.stdin:
            GLib.idle_add(command, json.loads(line))
    finally:
        GLib.idle_add(window.destroy)
threading.Thread(target=reader, daemon=True).start()
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: (window.destroy(), False)[1])
Gtk.main()
