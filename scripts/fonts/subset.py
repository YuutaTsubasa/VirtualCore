# 字型子集化（scripts/fonts/build.mjs 呼叫）：stdin 是 JSON [{ "src", "out", "text" }]，每個寫成只含 text 裡的字的 WOFF2。
# 需要 fonttools 與 brotli：python -m pip install fonttools brotli
import json
import sys

from fontTools import subset

# Windows 的 stdin／stdout 預設不是 UTF-8
sys.stdout.reconfigure(encoding='utf-8')
for job in json.loads(sys.stdin.buffer.read().decode('utf-8')):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    opts.hinting = False
    font = subset.load_font(job['src'], opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=job['text'])
    sub.subset(font)
    subset.save_font(font, job['out'], opts)
    print(job['out'])
