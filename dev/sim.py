"""Симуляция баланса: python dev/sim.py D:8 A:8 D:3:arm=III,kit=rand (вариант:противников[:параметры]; см. dev/tests/sim.js)."""
import sys, os, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tests as rt
from urllib.parse import quote
chrome = rt.find_chrome()
def one(c):
    parts = c.split(':')
    q = 'bots=1&cfg=' + parts[0] + '&n=' + (parts[1] if len(parts) > 1 else '8')
    if len(parts) > 2:
        q += '&' + parts[2].replace(',', '&')          # доп. параметры: arm=III,kit=rand,runs=24
    url = (rt.TOOLS / 'unit.html').as_uri() + '?test=sim&q=' + quote(q)
    return c, rt.dump_dom(chrome, url, 1200000, 1500)
with cf.ThreadPoolExecutor(4) as ex:
    for c, res in ex.map(one, sys.argv[1:]):
        print(c, res[0]['got'] if res else None)
