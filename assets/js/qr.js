/* ==========================================================================
   assets/js/qr.js · 极简二维码编码器（只做这一件事：把一行 URL 画成方阵）
   ---------------------------------------------------------------------------
   为什么自己写：本站的硬约束是「零依赖、file:// 直接打开也能跑」。
   为了一个登录二维码去引第三方库，等于把这条约束拆掉。
   这里只实现扫码登录需要的那个子集：
     · 字节模式（8-bit byte），模式指示符 0100
     · 纠错等级 L（15%）——二维码只给手机扫一次，不需要抗污损
     · 版本 1–9 自动挑选（URL 约 55 字节，版本 5 就够）
     · 固定的掩码 0 + 标准格式信息，因此不需要跑掩码罚分评估
   尺寸足够时（≥2 像素/模块）任何主流扫码器都能读；见 tools/check-qr.mjs 的实测。
   参考：ISO/IEC 18004 的码字/分块表，与 nayuki/QR-Code-generator 的值逐一核对过。
   ========================================================================== */

(function (global) {
  'use strict';

  /* 版本 → 每块纠错码字数（仅纠错等级 L，下标即版本号） */
  var ECC_PER_BLOCK_L = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30];
  /* 版本 → 纠错块数（仅纠错等级 L） */
  var BLOCKS_L = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  /* 纠错等级 L 在格式信息里的两位编码 */
  var ECC_FORMAT_BITS_L = 1;
  var MAX_VERSION = 9;
  var MASK = 0;

  /* ------------------------------------------------------------ GF(256) */
  /* 本原多项式 0x11D（x^8+x^4+x^3+x^2+1），生成元 0x02 */
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >> 7) * 0x11d);
      z ^= ((y >> i) & 1) * x;
    }
    return z & 0xff;
  }

  /* 生成多项式 (x-r^0)(x-r^1)…(x-r^{degree-1})，最高次项恒为 1，故省略 */
  function rsDivisor(degree) {
    var result = new Array(degree);
    for (var i = 0; i < degree; i++) result[i] = 0;
    result[degree - 1] = 1;
    var root = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = new Array(divisor.length);
    for (var i = 0; i < divisor.length; i++) result[i] = 0;
    for (var b = 0; b < data.length; b++) {
      var factor = data[b] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }

  /* ------------------------------------------------------ 版本与容量计算 */

  /* 数据区比特数（含剩余比特），纯粹由版本推出 */
  function rawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function dataCodewords(ver) {
    return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_L[ver] * BLOCKS_L[ver];
  }

  /* 对齐图案中心坐标（标准里的那个步长公式） */
  function alignPositions(ver) {
    if (ver === 1) return [];
    var size = ver * 4 + 17;
    var numAlign = Math.floor(ver / 7) + 2;
    var step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    /* 先按「大 → 小」生成，6 放最后，再整体反转成升序 */
    var result = [];
    for (var i = 0; i < numAlign - 1; i++) result.push(size - 7 - i * step);
    result.push(6);
    result.reverse();
    return result;
  }

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        /* 代理对 → 一个补充平面字符，4 字节 */
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /* ------------------------------------------------------------ 编码 */
  function encode(text) {
    var bytes = utf8Bytes(text);

    /* 1. 选版本：模式 4 bit + 计数 8 bit + 数据 + 终止符，必须塞得进数据码字 */
    var version = 0;
    for (var v = 1; v <= MAX_VERSION; v++) {
      if (4 + 8 + bytes.length * 8 <= dataCodewords(v) * 8) { version = v; break; }
    }
    if (!version) throw new Error('qr: 内容太长，超出版本 ' + MAX_VERSION);

    var total = dataCodewords(version);
    var bits = [];
    var push = function (val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };
    push(4, 4);                    /* 字节模式 */
    push(bytes.length, 8);         /* 计数指示符（版本 1–9 固定 8 bit） */
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    /* 终止符 + 补齐到字节边界 */
    var cap = total * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    /* 填充码字 0xEC / 0x11 交替 */
    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byteVal = 0;
      for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | bits[b + k];
      data.push(byteVal);
    }
    for (var pad = 0; data.length < total; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);

    /* 2. 分块 + RS 纠错 + 交织 */
    var numBlocks = BLOCKS_L[version];
    var blockEccLen = ECC_PER_BLOCK_L[version];
    var rawCodewords = Math.floor(rawDataModules(version) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);
    var divisor = rsDivisor(blockEccLen);

    var blocks = [];
    var offset = 0;
    for (var bi = 0; bi < numBlocks; bi++) {
      var datLen = shortBlockLen - blockEccLen + (bi < numShortBlocks ? 0 : 1);
      var dat = data.slice(offset, offset + datLen);
      offset += datLen;
      var ecc = rsRemainder(dat, divisor);
      if (bi < numShortBlocks) dat.push(0);        /* 占位，交织时跳过 */
      blocks.push(dat.concat(ecc));
    }

    var codewords = [];
    for (var ci = 0; ci < blocks[0].length; ci++) {
      for (var bj = 0; bj < blocks.length; bj++) {
        if (ci !== shortBlockLen - blockEccLen || bj >= numShortBlocks) codewords.push(blocks[bj][ci]);
      }
    }

    /* 3. 画功能图案 */
    var size = version * 4 + 17;
    var modules = [];
    var isFunction = [];
    for (var y = 0; y < size; y++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }
    var setFn = function (x, y, dark) {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };

    /* 先定时图案、后定位探测图案：两者在角上重叠，探测图案优先
       （标准就是这么定的——重放顺序反了，分隔带会被定时图案打穿） */
    for (var ti = 0; ti < size; ti++) {
      setFn(6, ti, ti % 2 === 0);
      setFn(ti, 6, ti % 2 === 0);
    }

    /* 定位探测图案（含分隔带）：切比雪夫距离 2 与 4 处为浅色 */
    var drawFinder = function (cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var xx = cx + dx, yy = cy + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
            var norm = Math.max(Math.abs(dx), Math.abs(dy));
            setFn(xx, yy, norm !== 2 && norm !== 4);
          }
        }
      }
    };
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    /* 对齐图案（三个定位角上不画） */
    var ap = alignPositions(version);
    var na = ap.length;
    for (var ai = 0; ai < na; ai++) {
      for (var aj = 0; aj < na; aj++) {
        var skipCorner = (ai === 0 && aj === 0) || (ai === 0 && aj === na - 1) || (ai === na - 1 && aj === 0);
        if (skipCorner) continue;
        for (var ay = -2; ay <= 2; ay++) {
          for (var ax = -2; ax <= 2; ax++) {
            setFn(ap[ai] + ax, ap[aj] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
          }
        }
      }
    }

    /* 格式信息：BCH(15,5)，生成多项式 0x537，掩码 0x5412 */
    var dataBits = (ECC_FORMAT_BITS_L << 3) | MASK;
    var rem = dataBits;
    for (var fi = 0; fi < 10; fi++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    var format = ((dataBits << 10) | rem) ^ 0x5412;
    var bitAt = function (val, i) { return ((val >> i) & 1) !== 0; };

    for (var i1 = 0; i1 < 6; i1++) setFn(8, i1, bitAt(format, i1));
    setFn(8, 7, bitAt(format, 6));
    setFn(8, 8, bitAt(format, 7));
    setFn(7, 8, bitAt(format, 8));
    for (var i2 = 9; i2 < 15; i2++) setFn(14 - i2, 8, bitAt(format, i2));

    for (var i3 = 0; i3 < 8; i3++) setFn(size - 1 - i3, 8, bitAt(format, i3));
    for (var i4 = 8; i4 < 15; i4++) setFn(8, size - 15 + i4, bitAt(format, i4));
    setFn(8, size - 8, true);   /* 恒为深色 */

    /* 版本信息：版本 ≥7 才需要，BCH(18,6)，生成多项式 0x1F25 */
    if (version >= 7) {
      var vrem = version;
      for (var vi = 0; vi < 12; vi++) vrem = (vrem << 1) ^ ((vrem >> 11) * 0x1f25);
      var vbits = (version << 12) | vrem;
      for (var i5 = 0; i5 < 18; i5++) {
        var bit = bitAt(vbits, i5);
        var a = size - 11 + (i5 % 3);
        var bco = Math.floor(i5 / 3);
        setFn(a, bco, bit);
        setFn(bco, a, bit);
      }
    }

    /* 4. 码字之字形填充 */
    var idx = 0;
    var totalBits = codewords.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right <= 6) right -= 1;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var yy = upward ? size - 1 - vert : vert;
          if (!isFunction[yy][x] && idx < totalBits) {
            modules[yy][x] = bitAt(codewords[idx >> 3], 7 - (idx & 7));
            idx++;
          }
        }
      }
    }

    /* 5. 加掩码（掩码 0：(x+y)%2==0 处翻转，功能模块不动） */
    for (var my = 0; my < size; my++) {
      for (var mx = 0; mx < size; mx++) {
        if (!isFunction[my][mx] && (mx + my) % 2 === 0) modules[my][mx] = !modules[my][mx];
      }
    }

    return { size: size, version: version, modules: modules };
  }

  /* 方阵 → SVG 字符串。quiet 为静默区宽度（模块数，标准要求 4）。 */
  function toSvg(qr, opts) {
    opts = opts || {};
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var dark = opts.dark || '#1a1c1e';
    var light = opts.light || '#ffffff';
    var total = qr.size + quiet * 2;
    var path = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) path.push('M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" width="100%" height="100%" shape-rendering="crispEdges" role="img" aria-label="登录二维码">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<path d="' + path.join('') + '" fill="' + dark + '"/></svg>';
  }

  global.CV01QR = { encode: encode, toSvg: toSvg };
})(typeof window !== 'undefined' ? window : globalThis);
