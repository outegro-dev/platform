"""Rebuild only the derived full book from canonical chapter files."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
base=ROOT/'docs/01-specification'
files=sorted((base/'chapters').glob('*.md'))
parts=['# Nick Lukashik · outegro.dev\n\nСпецификация v0.3. Для исполнения использовать task cards; этот файл — цельное чтение предметных глав.']
for f in files:
    parts.append(f.read_text(encoding='utf-8').replace('](../../','](../'))
(base/'portfolio-plan.md').write_text('\n\n---\n\n'.join(parts)+'\n',encoding='utf-8')
print(f'Synchronized {len(files)} chapters.')
