"""Диагностическая ортографическая проекция реально сгенерированных мешей.
Вход создаёт LANDMARK_PROFILE=1 в landmark-budget.local.test.ts.
Это не авторские модели и не скриншоты Babylon; здесь нет текстур и рельефа.
"""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path('work/landmark-inventory')
cases = [('3224486', 'Василий Блаженный'), ('11763697', 'Казанский собор, Петербург'),
         ('19710429', 'Ростральная колонна'), ('1360656', 'Спасская башня')]
image = Image.new('RGB', (1400, 1100), '#e5e9ed')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 22)

def project(p):
    x, y, z = p
    return (x-z)*.707, -y*.85+(x+z)*.37, y*.52+(x+z)*.60

for number, (osm_id, name) in enumerate(cases):
    meshes = json.loads((root / f'preview-relation-{osm_id}.json').read_text())
    projected = [project(m['positions'][i:i+3]) for m in meshes for i in range(0, len(m['positions']), 3)]
    xmin, xmax = min(p[0] for p in projected), max(p[0] for p in projected)
    ymin, ymax = min(p[1] for p in projected), max(p[1] for p in projected)
    scale = min(640/(xmax-xmin), 450/(ymax-ymin))
    ox, oy = number % 2*700+350, number//2*550+295
    faces = []
    for mesh in meshes:
        positions = [mesh['positions'][i:i+3] for i in range(0, len(mesh['positions']), 3)]
        screen = list(map(project, positions))
        for i in range(0, len(mesh['indices']), 3):
            indices = mesh['indices'][i:i+3]
            vertices = [positions[j] for j in indices]
            uv = [screen[j] for j in indices]
            a = [vertices[1][k]-vertices[0][k] for k in range(3)]
            b = [vertices[2][k]-vertices[0][k] for k in range(3)]
            normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
            length = math.sqrt(sum(v*v for v in normal)) or 1
            light = .55+.45*abs(sum(v*l for v, l in zip(normal, [.3, .85, .4]))/length)
            colour = tuple(min(255, int(v*255*light)) for v in mesh['colors'][indices[0]*4:indices[0]*4+3])
            faces.append((sum(t[2] for t in uv)/3, [(ox+(t[0]-(xmin+xmax)/2)*scale, oy+(t[1]-(ymin+ymax)/2)*scale) for t in uv], colour))
    for _, uv, colour in sorted(faces):
        draw.polygon(uv, fill=colour)
    draw.text((number % 2*700+25, number//2*550+15), name, fill='black', font=font)
    draw.text((number % 2*700+25, number//2*550+45), f'relation/{osm_id} — процедурное приближение', fill='#58646d', font=font)
image.save(root / 'preview.png')
