"""Read-only context bundle for one task; Python stdlib only."""
from pathlib import Path
import argparse, json, sys
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('task_id')
parser.add_argument('--bundle',action='store_true',help='Include AGENTS and required shared context, not the full book.')
parser.add_argument('--max-chars',type=int,default=70000)
args=parser.parse_args()
if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
tasks=json.loads((ROOT/'docs/04-delivery/task-index.json').read_text(encoding='utf-8'))['tasks']
by_id={t['id']:t for t in tasks}
task=by_id.get(args.task_id.upper())
if not task: raise SystemExit('Unknown task ID: '+args.task_id)
lines=[f'# Execution context: {task["id"]}',f'Status: {task["status"]}; scope: {task["scope"]}',
 'Hard dependencies: '+(', '.join(f'{d}={by_id[d]["status"]}' for d in task['dependencies']) or 'none'),
 'External inputs: '+(', '.join(task['external']) or 'none explicit'),
 'This helper is read-only. It does not execute the task, approve deployment or prove dependencies complete.']
files=(['AGENTS.md']+task['required_docs'] if args.bundle else [])+[task['path']]
for rel in dict.fromkeys(files):
    file=(ROOT/rel).resolve()
    if ROOT not in file.parents: raise SystemExit('Path outside project: '+rel)
    lines.extend([f'\n---\nSOURCE: {rel}\n',file.read_text(encoding='utf-8')])
output='\n\n'.join(lines)
if len(output)>args.max_chars:
    raise SystemExit(f'Bundle has {len(output)} chars; limit {args.max_chars}. Read the card first, then referenced documents separately or set a deliberate higher limit. No silent truncation.')
print(output)
