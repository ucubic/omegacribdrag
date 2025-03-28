import os

import base64
encoder = base64.b64encode
# import binascii
# encoder = binascii.hexlify

plaintexts = {}
with open("samples.txt", "rb") as f:
    for p in f.read().split(b"\n%%\n"):
        start, *other = p.strip().splitlines()
        plaintexts[start.decode("utf-8")] = other

ciphertexts = {}
for name, p in plaintexts.items():
    key = os.urandom(max(map(len, p)))
    ciphertexts[name] = ([str(encoder(bytes(x ^ y for x, y in zip(key, plain))), "utf-8") for plain in p])

with open("dist.json", "w") as f:
    import json
    json.dump(ciphertexts, f)
