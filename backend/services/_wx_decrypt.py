"""微信视频号视频解密：ISAAC64(decodeKey) 对前 131072 字节按 8 字节大端 XOR。

移植自 wx_channels_download 的 pkg/decrypt/decrypt.go（源自 Hanson/WechatSphDecrypt），
该算法与微信前端 wasm_video_decode 的 WxIsaac64 一致。
"""

MASK = (1 << 64) - 1
ENC_LEN = 131072  # 微信前端固定 decryptor.generate(131072)
_GOLDEN = 0x9E3779B97F4A7C13


def decrypt_inplace(data: bytearray, key: int, enc_len: int = ENC_LEN) -> bytearray:
    """对 data 前 enc_len 字节用 ISAAC64(key) 密钥流异或解密（原地）。"""
    ctx = _Isaac64(key)
    n = min(enc_len, len(data))
    i = 0
    while i < n:
        rnd = ctx.next()
        block = rnd.to_bytes(8, "big")
        for j in range(8):
            if i + j >= n:
                break
            data[i + j] ^= block[j]
        i += 8
    return data


class _Isaac64:
    def __init__(self, seed: int):
        self.randcnt = 255
        self.aa = 0
        self.bb = 0
        self.cc = 0
        self.mm = [0] * 256
        self.rs = [0] * 256  # Seed/randrsl
        self._init(seed & MASK)

    def next(self) -> int:
        result = self.rs[self.randcnt]
        if self.randcnt == 0:
            self._isaac()
            self.randcnt = 255
        else:
            self.randcnt -= 1
        return result

    def _init(self, key: int) -> None:
        a = b = c = d = e = f = g = h = _GOLDEN
        self.rs[0] = key
        for _ in range(4):
            a, b, c, d, e, f, g, h = _mix(a, b, c, d, e, f, g, h)
        for i in range(0, 256, 8):
            a = (a + self.rs[i]) & MASK
            b = (b + self.rs[i + 1]) & MASK
            c = (c + self.rs[i + 2]) & MASK
            d = (d + self.rs[i + 3]) & MASK
            e = (e + self.rs[i + 4]) & MASK
            f = (f + self.rs[i + 5]) & MASK
            g = (g + self.rs[i + 6]) & MASK
            h = (h + self.rs[i + 7]) & MASK
            a, b, c, d, e, f, g, h = _mix(a, b, c, d, e, f, g, h)
            self.mm[i:i + 8] = [a, b, c, d, e, f, g, h]
        for i in range(0, 256, 8):
            a = (a + self.mm[i]) & MASK
            b = (b + self.mm[i + 1]) & MASK
            c = (c + self.mm[i + 2]) & MASK
            d = (d + self.mm[i + 3]) & MASK
            e = (e + self.mm[i + 4]) & MASK
            f = (f + self.mm[i + 5]) & MASK
            g = (g + self.mm[i + 6]) & MASK
            h = (h + self.mm[i + 7]) & MASK
            a, b, c, d, e, f, g, h = _mix(a, b, c, d, e, f, g, h)
            self.mm[i:i + 8] = [a, b, c, d, e, f, g, h]
        self._isaac()

    def _isaac(self) -> None:
        mm, rs = self.mm, self.rs
        self.cc = (self.cc + 1) & MASK
        self.bb = (self.bb + self.cc) & MASK
        aa, bb = self.aa, self.bb
        for i in range(256):
            r = i % 4
            if r == 0:
                aa = (~(aa ^ ((aa << 21) & MASK))) & MASK
            elif r == 1:
                aa = (aa ^ (aa >> 5)) & MASK
            elif r == 2:
                aa = (aa ^ ((aa << 12) & MASK)) & MASK
            else:
                aa = (aa ^ (aa >> 33)) & MASK
            aa = (aa + mm[(i + 128) % 256]) & MASK
            x = mm[i]
            y = (mm[(x >> 3) % 256] + aa + bb) & MASK
            mm[i] = y
            bb = (mm[(y >> 11) % 256] + x) & MASK
            rs[i] = bb
        self.aa = aa
        self.bb = bb


def _mix(a, b, c, d, e, f, g, h):
    a = (a - e) & MASK
    f = (f ^ (h >> 9)) & MASK
    h = (h + a) & MASK
    b = (b - f) & MASK
    g = (g ^ ((a << 9) & MASK)) & MASK
    a = (a + b) & MASK
    c = (c - g) & MASK
    h = (h ^ (b >> 23)) & MASK
    b = (b + c) & MASK
    d = (d - h) & MASK
    a = (a ^ ((c << 15) & MASK)) & MASK
    c = (c + d) & MASK
    e = (e - a) & MASK
    b = (b ^ (d >> 14)) & MASK
    d = (d + e) & MASK
    f = (f - b) & MASK
    c = (c ^ ((e << 20) & MASK)) & MASK
    e = (e + f) & MASK
    g = (g - c) & MASK
    d = (d ^ (f >> 17)) & MASK
    f = (f + g) & MASK
    h = (h - d) & MASK
    e = (e ^ ((g << 14) & MASK)) & MASK
    g = (g + h) & MASK
    return a, b, c, d, e, f, g, h
