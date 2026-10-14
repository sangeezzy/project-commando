"""Симуляция баланса: python dev/sim.py D:8 A:8 D:3 (вариант:противников; варианты — в dev/tests/sim.js)."""
import sys, os, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tests as rt
from urllib.parse import quote
chrome = rt.find_chrome()
def one(c):
    q = 'bots=1&cfg=' + c.split(':')[0] + '&n=' + (c.split(':')[1] if ':' in c else '8')
    url = (rt.TOOLS / 'unit.html').as_uri() + '?test=sim&q=' + quote(q)
    return c, rt.dump_dom(chrome, url, 1200000, 1500)
with cf.ThreadPoolExecutor(4) as ex:
    for c, res in ex.map(one, sys.argv[1:]):
        print(c, res[0]['got'] if res else None)
