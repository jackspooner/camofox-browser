import gi,sys,time,json
gi.require_version('Atspi','2.0')
from gi.repository import Atspi
root=Atspi.get_desktop(0)
def descendants(n):
 yield n
 try:
  count=n.get_child_count()
 except Exception:return
 for i in range(count):
  try:child=n.get_child_at_index(i)
  except Exception:continue
  if child:yield from descendants(child)
def window():
 for i in range(root.get_child_count()):
  try:
   app=root.get_child_at_index(i)
   if len(sys.argv)>2 and app.get_process_id()!=int(sys.argv[2]):continue
   for n in descendants(app):
    try:
     if n.get_role_name()=='frame' and 'Control handoff acceptance' in n.get_name():return n
    except Exception:continue
  except Exception:continue
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
