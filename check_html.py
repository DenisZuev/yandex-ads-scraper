import re
with open('Яндекс выдача/пластиковые окна спб — Яндекс_ нашлось 5 тыс. результатов.html', 'r') as f:
    html = f.read()

# Find all snippetUrl occurrences (real landing URLs)
snippet_matches = list(re.finditer(r'snippetUrl"+\s*:\s*"+(https?://[^"]+)', html))
print(f'snippetUrl found: {len(snippet_matches)} times')
for i, m in enumerate(snippet_matches[:5]):
    url = m.group(1)
    # Check if yabs or real
    is_yabs = 'yabs.yandex' in url
    print(f'  #{i+1}: {"[YABS]" if is_yabs else "[REAL]"} {url[:120]}')

# Find how many yabs URLs exist on <a> tags
yabs_matches = list(re.finditer(r'href="(https://yabs\.yandex[^"]+)"', html))
print(f'\nhref yabs URLs on <a> tags: {len(yabs_matches)}')

# Find noRedirectUrl occurrences
no_redir = list(re.finditer(r'noRedirectUrl"+\s*:\s*"+(https?://[^"]+)', html))
print(f'noRedirectUrl: {len(no_redir)}')
for m in no_redir:
    print(f'  URL: {m.group(1)[:120]}')

# Find URL patterns in data-bem/data-state JSON that contain real domains
# Look for url":"https://" patterns that are NOT yabs
real_urls = list(re.finditer(r'\"url\"+\s*:\s*\"+(https://[a-zA-Z0-9.-]+\.[a-z]{2,}/[^"]*)', html))
real_non_yabs = [m.group(1) for m in real_urls if 'yabs.yandex' not in m.group(1) and 'yandex' not in m.group(1)]
print(f'\nReal non-yandex URLs in JSON: {len(real_non_yabs)}')
for u in real_non_yabs[:10]:
    print(f'  {u[:120]}')
