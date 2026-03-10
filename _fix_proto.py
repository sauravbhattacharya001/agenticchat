"""Fix prototype pollution: replace {} maps with Object.create(null) where dynamic keys are used."""
import re, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

base = r'C:\Users\onlin\.openclaw\workspace\temp-garden\src'
total_fixed = 0

for fname in sorted(os.listdir(base)):
    if not fname.endswith('.js'):
        continue
    path = os.path.join(base, fname)
    with open(path, encoding='utf-8') as f:
        lines = f.readlines()
    
    # Find lines where var x = {} and x is used with dynamic bracket keys
    fix_lines = set()
    for i, line in enumerate(lines):
        s = line.strip()
        m = re.match(r'var\s+(\w+)\s*=\s*\{\s*\};?', s)
        if not m:
            continue
        var_name = m.group(1)
        
        for j in range(i+1, min(len(lines), i+40)):
            nl = lines[j].strip()
            bm = re.search(re.escape(var_name) + r'\[(\w+)\]', nl)
            if bm:
                key_var = bm.group(1)
                if key_var in ('i', 'j', 'k', 'idx', 'index'):
                    continue
                fix_lines.add(i)
                break
    
    if not fix_lines:
        continue
    
    # Apply fixes
    for line_idx in sorted(fix_lines):
        old_line = lines[line_idx]
        new_line = old_line.replace('= {};', '= Object.create(null);').replace('= {}', '= Object.create(null)')
        if new_line != old_line:
            lines[line_idx] = new_line
            total_fixed += 1
    
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(fname + ': fixed ' + str(len(fix_lines)) + ' instances')

print('Total fixed:', total_fixed)
