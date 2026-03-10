"""Fix hasOwnProperty calls that break with Object.create(null).
For null-prototype objects, 'key in obj' is equivalent to hasOwnProperty since there's no prototype chain.
For inherited objects (defaults, options), use Object.prototype.hasOwnProperty.call().
"""
import re, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

base = r'C:\Users\onlin\.openclaw\workspace\temp-garden\src'
_hop = 'Object.prototype.hasOwnProperty'
total = 0

for fname in sorted(os.listdir(base)):
    if not fname.endswith('.js'):
        continue
    path = os.path.join(base, fname)
    with open(path, encoding='utf-8') as f:
        content = f.read()
    
    original = content
    
    # Replace obj.hasOwnProperty(key) with Object.prototype.hasOwnProperty.call(obj, key)
    # This is safe for both regular objects and Object.create(null) objects
    def replace_hop(m):
        obj = m.group(1)
        key = m.group(2)
        return _hop + '.call(' + obj + ', ' + key + ')'
    
    content = re.sub(
        r'(\w+(?:\.\w+)*)\.hasOwnProperty\((\w+)\)',
        replace_hop,
        content
    )
    
    if content != original:
        count = content.count(_hop + '.call') - original.count(_hop + '.call')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(fname + ': fixed ' + str(count) + ' hasOwnProperty calls')
        total += count

print('Total fixed:', total)
