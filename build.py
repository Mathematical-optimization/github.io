#!/usr/bin/env python3
"""Build the portable HTML using only the Python standard library."""
import argparse
import json
from pathlib import Path
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent

def json_for_script(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')

class DocumentCheck(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids = set(); self.duplicates = []; self.local_assets = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            if attrs['id'] in self.ids: self.duplicates.append(attrs['id'])
            self.ids.add(attrs['id'])
        if tag in ('script', 'img', 'link'):
            value = attrs.get('src') or (attrs.get('href') if tag == 'link' else '')
            if value and not value.startswith(('https:', 'http:', 'data:', '#')): self.local_assets.append(value)

def build(check_only=False):
    data = json.loads((ROOT / 'data/resources.json').read_text(encoding='utf-8'))
    meta = json.loads((ROOT / 'data/site-meta.json').read_text(encoding='utf-8'))
    ids = set()
    for category, rows in data.items():
        assert category in meta['categoryOrder'], f'Unknown category: {category}'
        for row in rows:
            assert row['id'] not in ids, f'Duplicate resource ID: {row["id"]}'
            ids.add(row['id'])
            assert row['category'] == category
            assert isinstance(row['title'], str) and row['title'].strip()
            assert row['year'] is None or isinstance(row['year'], int)
            assert row['access'] in ('Open', 'Publisher', 'Mixed')
            assert row['level'] in ('Intro', 'Intermediate', 'Advanced', 'Research')
            assert row['priority'] in ('Core', 'Recommended', 'Frontier', 'Practical')
            assert row['links'], row['title']
            for link in row['links']:
                url = urlparse(link['url'])
                assert url.scheme in ('https', 'http') and url.netloc, link['url']
    assert len(ids) == meta['sourceEntryCount']
    for name, route in meta['paths'].items():
        for item_id, label, goal in route['steps']:
            assert item_id in ids and label and goal, f'Invalid route step: {name}/{item_id}'
    template = (ROOT / 'src/index.template.html').read_text(encoding='utf-8')
    css = (ROOT / 'src/styles.css').read_text(encoding='utf-8')
    js = (ROOT / 'src/app.js').read_text(encoding='utf-8')
    assert not re.search(r'</script', js, re.I), 'Do not include raw script closing tags in JavaScript'
    output = template.replace('/*__STYLES__*/', css).replace('__SITE_META__', json_for_script(meta)).replace('__RESOURCE_DATA__', json_for_script(data)).replace('/*__APP__*/', js)
    assert not re.search(r'/\*__[A-Z_]+__\*/|__SITE_META__|__RESOURCE_DATA__', output)
    document = DocumentCheck(); document.feed(output)
    assert not document.duplicates, document.duplicates
    assert not document.local_assets, document.local_assets
    for referenced_id in re.findall(r"\$\('#([\w-]+)'\)", js):
        assert referenced_id in document.ids, f'Missing HTML element: {referenced_id}'
    destination = ROOT / 'index.html'
    if check_only:
        assert destination.read_text(encoding='utf-8') == output, 'index.html is stale. Run python3 build.py'
    else:
        destination.write_text(output, encoding='utf-8')
    print(f'{"Validated" if check_only else "Built"} index.html: {len(ids)} records, {len(meta["paths"])} study paths, {len(output.encode())} bytes')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate source and compare to the existing build')
    build(parser.parse_args().check)
