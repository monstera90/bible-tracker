package com.app.lifetracker;
// Версия: 1.0 (25.10)

/**
 * Декодер Apple Lossless (ALAC): моно и стерео, 16/20/24/32 бита. Без зависимостей от Android — проверяется на компьютере.
 * Алгоритм повторяет открытую реализацию Apple (ALACDecoder / ag_dec / dp_dec / matrix_dec): адаптивный Голомб-Райс,
 * линейный предсказатель с адаптацией коэффициентов, обратное стерео-матрицирование и «сдвинутые» младшие байты.
 *
 * Использование: {@code new AlacDecoder(config24)}, затем для каждого пакета {@link #decode}.
 * На выходе — целые отсчёты в диапазоне разрядности потока ({@link #bitDepth}), каналы чередуются.
 */
final class AlacDecoder {

    private static final int ID_SCE = 0, ID_CPE = 1, ID_LFE = 3, ID_DSE = 4, ID_FIL = 6, ID_END = 7;

    private static final int QBSHIFT = 9;
    private static final int QB = 1 << QBSHIFT;
    private static final int MMULSHIFT = 2;
    private static final int MDENSHIFT = QBSHIFT - MMULSHIFT - 1;
    private static final int MOFF = 1 << (MDENSHIFT - 2);
    private static final int BITOFF = 24;
    private static final int N_MAX_MEAN_CLAMP = 0xFFFF;
    private static final int MAX_PREFIX_16 = 9;
    private static final int MAX_PREFIX_32 = 9;
    private static final int MAX_DATATYPE_BITS_16 = 16;

    final int frameLength;
    final int bitDepth;
    final int channels;
    final int sampleRate;
    private final int pbConf, mbConf, kbConf, maxRun;

    private final int[] predictor;
    private final int[] mixU;
    private final int[] mixV;
    private final int[] shiftBuf;
    private final short[] coefsU = new short[32];
    private final short[] coefsV = new short[32];

    private byte[] buf;
    private int bitPos;
    private int endBit;

    /** @param cfg 24 байта ALACSpecificConfig (после версии/флагов внутри бокса 'alac'). */
    AlacDecoder(byte[] cfg) {
        if (cfg == null || cfg.length < 24) throw new IllegalArgumentException("ALAC: короткий конфиг");
        frameLength = be32(cfg, 0);
        int compat = cfg[4] & 0xFF;
        bitDepth = cfg[5] & 0xFF;
        pbConf = cfg[6] & 0xFF;
        mbConf = cfg[7] & 0xFF;
        kbConf = cfg[8] & 0xFF;
        channels = cfg[9] & 0xFF;
        maxRun = ((cfg[10] & 0xFF) << 8) | (cfg[11] & 0xFF);
        sampleRate = be32(cfg, 20);
        if (compat != 0) throw new IllegalArgumentException("ALAC: неизвестная версия");
        if (frameLength <= 0 || frameLength > 16384) throw new IllegalArgumentException("ALAC: длина кадра");
        if (channels < 1 || channels > 2) throw new IllegalArgumentException("ALAC: каналов " + channels + " (поддержаны 1-2)");
        if (bitDepth != 16 && bitDepth != 20 && bitDepth != 24 && bitDepth != 32) throw new IllegalArgumentException("ALAC: разрядность " + bitDepth);
        predictor = new int[frameLength];
        mixU = new int[frameLength];
        mixV = new int[frameLength];
        shiftBuf = new int[frameLength * 2];
    }

    private static int be32(byte[] b, int o) {
        return ((b[o] & 0xFF) << 24) | ((b[o + 1] & 0xFF) << 16) | ((b[o + 2] & 0xFF) << 8) | (b[o + 3] & 0xFF);
    }

    // ---------- чтение битов ----------

    /** Следующие 32 бита без сдвига позиции (за концом данных — нули). */
    private int peek32() {
        int bi = bitPos >> 3;
        long w = 0;
        int end = (endBit + 7) >> 3;
        for (int i = 0; i < 5; i++) {
            int idx = bi + i;
            w = (w << 8) | (idx < end ? (buf[idx] & 0xFF) : 0);
        }
        return (int) (w >>> (8 - (bitPos & 7)));
    }

    /** Читает n бит (0..32) как беззнаковое значение в int. */
    private int read(int n) {
        if (n == 0) return 0;
        int v = peek32() >>> (32 - n);
        bitPos += n;
        return v;
    }

    // ---------- адаптивный Голомб-Райс ----------

    private int dynGet(int m, int k) {
        int s = peek32();
        int pre = Integer.numberOfLeadingZeros(~s);
        int result;
        if (pre >= MAX_PREFIX_16) {
            bitPos += MAX_PREFIX_16;
            result = read(MAX_DATATYPE_BITS_16);
        } else {
            bitPos += pre + 1;
            int v = read(k);
            result = pre * m + v - 1;
            if (v < 2) {
                result -= v - 1;
                bitPos -= 1;
            }
        }
        return result;
    }

    private int dynGet32(int m, int k, int maxBits) {
        int s = peek32();
        int pre = Integer.numberOfLeadingZeros(~s);
        int result;
        if (pre >= MAX_PREFIX_32) {
            bitPos += MAX_PREFIX_32;
            result = read(maxBits);
        } else {
            bitPos += pre + 1;
            int v = read(k);
            result = pre * m + v - 1;
            if (v < 2) {
                result -= v - 1;
                bitPos -= 1;
            }
        }
        return result;
    }

    private static int lg3a(int x) {
        x += 3;
        return 31 - Integer.numberOfLeadingZeros(x);
    }

    /** @return false при ошибке потока. */
    private boolean dynDecomp(int pbParam, int[] pc, int numSamples, int maxSize) {
        int mb = mbConf;
        int pb = pbParam;
        int kb = kbConf;
        int wb = (1 << kbConf) - 1;
        int zmode = 0;
        int c = 0;
        int outIdx = 0;
        while (c < numSamples) {
            if (bitPos >= endBit) return false;
            int m = mb >>> QBSHIFT;
            int k = lg3a(m);
            if (k > kb) k = kb;
            m = (1 << k) - 1;

            int n = dynGet32(m, k, maxSize);

            int ndecode = n + zmode;
            int multiplier = -(ndecode & 1);
            multiplier |= 1;
            int del = ((ndecode + 1) >>> 1) * multiplier;

            pc[outIdx++] = del;
            c++;

            mb = pb * (n + zmode) + mb - ((pb * mb) >>> QBSHIFT);

            if (Integer.compareUnsigned(n, N_MAX_MEAN_CLAMP) > 0) mb = 0xFFFF;

            zmode = 0;
            if (c > numSamples) return false;

            if (Integer.compareUnsigned(mb << MMULSHIFT, QB) < 0 && c < numSamples) {
                zmode = 1;
                int kk = Integer.numberOfLeadingZeros(mb) - BITOFF + ((mb + MOFF) >>> MDENSHIFT);
                int mz = ((1 << kk) - 1) & wb;

                int nz = dynGet(mz, kk);
                if (Integer.compareUnsigned(nz, numSamples - c) > 0) return false;

                for (int j = 0; j < nz; j++) {
                    pc[outIdx++] = 0;
                    c++;
                }
                if (nz >= 65535) zmode = 0;
                mb = 0;
            }
        }
        return true;
    }

    // ---------- предсказатель ----------

    private static int sign(int x) {
        return (x > 0) ? 1 : ((x < 0) ? -1 : 0);
    }

    private static void unpcBlock(int[] pc1, int[] out, int num, short[] coefs, int numActive, int chanBits, int denShift) {
        int chanShift = 32 - chanBits;
        int denHalf = (denShift > 0) ? (1 << (denShift - 1)) : 0;

        out[0] = pc1[0];
        if (numActive == 0) {
            if (num > 1 && pc1 != out) System.arraycopy(pc1, 1, out, 1, num - 1);
            return;
        }
        if (numActive == 31) {
            for (int i = 1; i < num; i++) {
                int del = pc1[i] + out[i - 1];
                out[i] = (del << chanShift) >> chanShift;
            }
            return;
        }
        for (int i = 1; i <= numActive && i < num; i++) {
            int del = pc1[i] + out[i - 1];
            out[i] = (del << chanShift) >> chanShift;
        }
        int lim = numActive + 1;
        for (int j = lim; j < num; j++) {
            int pin = j - 1;
            int top = out[j - lim];
            int sum1 = 0;
            for (int k = 0; k < numActive; k++) sum1 += coefs[k] * (out[pin - k] - top);

            int del = pc1[j];
            int del0 = del;
            int sg = sign(del);
            del += top + ((sum1 + denHalf) >> denShift);
            out[j] = (del << chanShift) >> chanShift;

            if (sg > 0) {
                for (int k = numActive - 1; k >= 0; k--) {
                    int dd = top - out[pin - k];
                    int sgn = sign(dd);
                    coefs[k] = (short) (coefs[k] - sgn);
                    del0 -= (numActive - k) * ((sgn * dd) >> denShift);
                    if (del0 <= 0) break;
                }
            } else if (sg < 0) {
                for (int k = numActive - 1; k >= 0; k--) {
                    int dd = top - out[pin - k];
                    int sgn = sign(dd);
                    coefs[k] = (short) (coefs[k] + sgn);
                    del0 -= (numActive - k) * ((-sgn * dd) >> denShift);
                    if (del0 >= 0) break;
                }
            }
        }
    }

    // ---------- пакет ----------

    /**
     * Декодирует один пакет ALAC.
     *
     * @param out куда писать отсчёты (чередуя каналы), размер не меньше {@code frameLength * channels}
     * @return число отсчётов на канал или -1 при ошибке данных
     */
    int decode(byte[] data, int off, int len, int[] out) {
        buf = data;
        bitPos = off * 8;
        endBit = (off + len) * 8;
        int channelIndex = 0;
        int numSamples = frameLength;
        try {
            while (true) {
                if (bitPos + 3 > endBit) return -1;
                int tag = read(3);
                if (tag == ID_SCE || tag == ID_LFE) {
                    if (channelIndex + 1 > channels) return -1;
                    numSamples = decodeElement(false, channelIndex, out);
                    if (numSamples < 0) return -1;
                    channelIndex += 1;
                } else if (tag == ID_CPE) {
                    if (channelIndex + 2 > channels) return -1;
                    numSamples = decodeElement(true, channelIndex, out);
                    if (numSamples < 0) return -1;
                    channelIndex += 2;
                } else if (tag == ID_DSE) {
                    read(4);
                    int align = read(1);
                    int count = read(8);
                    if (count == 255) count += read(8);
                    if (align != 0) bitPos = (bitPos + 7) & ~7;
                    bitPos += count * 8;
                } else if (tag == ID_FIL) {
                    int count = read(4);
                    if (count == 15) count += read(8) - 1;
                    bitPos += count * 8;
                } else if (tag == ID_END) {
                    break;
                } else {
                    return -1;
                }
                if (bitPos > endBit) return -1;
            }
        } catch (RuntimeException e) {
            return -1;
        }
        if (channelIndex != channels) return -1;
        return numSamples;
    }

    /** Один элемент (SCE — один канал, CPE — пара); возвращает число отсчётов или -1. */
    private int decodeElement(boolean pair, int chIdx, int[] out) {
        read(4);          // elementInstanceTag
        read(12);         // unused
        int headerByte = read(4);
        int partialFrame = headerByte >> 3;
        int bytesShifted = (headerByte >> 1) & 3;
        int escapeFlag = headerByte & 1;
        int chans = pair ? 2 : 1;
        int chanBits = bitDepth - (bytesShifted * 8) + (pair ? 1 : 0);

        int numSamples = frameLength;
        if (partialFrame != 0) {
            numSamples = read(16) << 16;
            numSamples |= read(16);
        }
        if (numSamples <= 0 || numSamples > frameLength) return -1;

        int mixBits = 0, mixRes = 0;
        if (escapeFlag == 0) {
            // два байта mixBits/mixRes есть и у моно-элемента (там они не используются)
            mixBits = read(8);
            mixRes = (byte) read(8);
            if (!pair) {
                mixBits = 0;
                mixRes = 0;
            }
            int modeU, denShiftU, pbFactorU, numU;
            int modeV = 0, denShiftV = 0, pbFactorV = 0, numV = 0;
            headerByte = read(8);
            modeU = headerByte >> 4;
            denShiftU = headerByte & 0xF;
            headerByte = read(8);
            pbFactorU = headerByte >> 5;
            numU = headerByte & 0x1F;
            for (int i = 0; i < numU; i++) coefsU[i] = (short) read(16);
            if (pair) {
                headerByte = read(8);
                modeV = headerByte >> 4;
                denShiftV = headerByte & 0xF;
                headerByte = read(8);
                pbFactorV = headerByte >> 5;
                numV = headerByte & 0x1F;
                for (int i = 0; i < numV; i++) coefsV[i] = (short) read(16);
            }

            int shiftPos = 0;
            if (bytesShifted != 0) {
                shiftPos = bitPos;
                bitPos += bytesShifted * 8 * chans * numSamples;
            }

            if (!dynDecomp((pbConf * pbFactorU) / 4, predictor, numSamples, chanBits)) return -1;
            if (modeU == 0) {
                unpcBlock(predictor, mixU, numSamples, coefsU, numU, chanBits, denShiftU);
            } else {
                unpcBlock(predictor, predictor, numSamples, null, 31, chanBits, 0);
                unpcBlock(predictor, mixU, numSamples, coefsU, numU, chanBits, denShiftU);
            }
            if (pair) {
                if (!dynDecomp((pbConf * pbFactorV) / 4, predictor, numSamples, chanBits)) return -1;
                if (modeV == 0) {
                    unpcBlock(predictor, mixV, numSamples, coefsV, numV, chanBits, denShiftV);
                } else {
                    unpcBlock(predictor, predictor, numSamples, null, 31, chanBits, 0);
                    unpcBlock(predictor, mixV, numSamples, coefsV, numV, chanBits, denShiftV);
                }
            }

            if (bytesShifted != 0) {
                int save = bitPos;
                bitPos = shiftPos;
                int sh = bytesShifted * 8;
                int total = numSamples * chans;
                for (int i = 0; i < total; i++) shiftBuf[i] = read(sh);
                bitPos = save;
            }
        } else {
            // несжатый кадр: отсчёты лежат как есть
            chanBits = bitDepth;
            int shift = 32 - chanBits;
            for (int i = 0; i < numSamples; i++) {
                mixU[i] = (read(chanBits) << shift) >> shift;
                if (pair) mixV[i] = (read(chanBits) << shift) >> shift;
            }
            mixBits = 0;
            mixRes = 0;
            bytesShifted = 0;
        }

        // обратное матрицирование и сборка выхода
        int shift = bytesShifted * 8;
        int stride = channels;
        if (pair) {
            for (int i = 0; i < numSamples; i++) {
                int u = mixU[i], v = mixV[i];
                int l, r;
                if (mixRes != 0) {
                    l = u + v - ((mixRes * v) >> mixBits);
                    r = l - v;
                } else {
                    l = u;
                    r = v;
                }
                if (shift != 0) {
                    l = (l << shift) | shiftBuf[2 * i];
                    r = (r << shift) | shiftBuf[2 * i + 1];
                }
                out[i * stride + chIdx] = l;
                out[i * stride + chIdx + 1] = r;
            }
        } else {
            for (int i = 0; i < numSamples; i++) {
                int s = mixU[i];
                if (shift != 0) s = (s << shift) | shiftBuf[i];
                out[i * stride + chIdx] = s;
            }
        }
        return numSamples;
    }
}
