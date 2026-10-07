import gi,sys,time,json
gi.require_version('Atspi','2.0')
from gi.repository import Atspi
root=Atspi.get_desktop(0)
def descendants(n):
 yield n
 for i in range(n.get_child_count()):
  child=n.get_child_at_index(i)
  if child: yield from descendants(child)
def window():
 for app in descendants(root):
  if app.get_role_name()=='frame' and 'Control handoff acceptance' in app.get_name():return app
 raise RuntimeError('Acceptance window not found')
for _ in range(60):
 try:
  nodes=list(descendants(window()))
  if sys.argv[1]=='inspect':
   items=[]
   for n in nodes:
    text=''
    try:
     ti=n.get_text_iface()
     if ti:text=ti.get_text(0,-1)
    except Exception:pass
    if n.get_name() or text:items.append((n.get_role_name(),n.get_name(),text))
   print(json.dumps(items[:100]));break
  match=next((n for n in nodes if n.get_role_name()=='button' and n.get_name()==sys.argv[1] and n.get_state_set().contains(Atspi.StateType.SENSITIVE)),None)
  if match:
   assert match.get_action_iface().do_action(0);print('Activated '+sys.argv[1]);break
 except RuntimeError: pass
 time.sleep(.1)
else:raise RuntimeError('Acceptance button not available: '+sys.argv[1])
