"""Drive only the disposable transfer acceptance window, scoped by process ID."""
import sys
import time
import gi

gi.require_version('Atspi', '2.0')
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Atspi, Gtk, Gdk


def descendants(node):
    yield node
    for index in range(node.get_child_count()):
        child = node.get_child_at_index(index)
        if child:
            yield from descendants(child)


def nodes():
    root = Atspi.get_desktop(0)
    for index in range(root.get_child_count()):
        app = root.get_child_at_index(index)
        if app.get_process_id() == int(sys.argv[1]):
            return list(descendants(app))
    return []


def click(label):
    for _ in range(100):
        for node in nodes():
            if (node.get_role_name() == 'button' and node.get_name() == label
                    and node.get_state_set().contains(Atspi.StateType.SENSITIVE)):
                assert node.get_action_iface().do_action(0)
                return
        time.sleep(.1)
    raise RuntimeError('Acceptance button unavailable: ' + label)


click('Create new viewer URL')
for _ in range(100):
    expected = None
    for node in nodes():
        if node.get_name() == 'New viewer URL':
            text = Atspi.Text.get_text(node, 0, -1)
            if text.startswith('http://127.0.0.1:'):
                expected = text
    if expected:
        break
    time.sleep(.1)
else:
    raise RuntimeError('Transfer URL not displayed')
click('Copy URL')
Gtk.init([])
for _ in range(100):
    # Read only after the explicit Copy action in our disposable viewer.
    if Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() == expected:
        break
    time.sleep(.1)
else:
    raise RuntimeError('Native clipboard did not contain the generated URL')
# Private subprocess pipe consumed by the fixture; never print this in test logs.
print(expected)
