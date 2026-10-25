package com.app.lifetracker;
// Версия: 1.0 (25.10)

import java.io.IOException;

/**
 * Разбор контейнера MP4/M4A: находит звуковую дорожку и, если это ALAC, строит таблицу пакетов (смещение и размер каждого).
 * Читает только нужные боксы (moov → trak → mdia → minf → stbl: stsd, stsz, stsc, stco/co64), поэтому обложка и теги в
 * память не попадают. Без зависимостей от Android.
 */
final class AlacMp4 {

    /** Источник байт с произвольным доступом (в приложении — файл по content://, в тестах — RandomAccessFile). */
    interface ByteSource {
        long length() throws IOException;

        /** Читает до len байт с позиции pos; возвращает прочитанное число или -1 в конце файла. */
        int readAt(long pos, byte[] dst, int off, int len) throws IOException;
    }

    /** true — звуковая дорожка файла закодирована в ALAC. */
    boolean alac;
    /** 24 байта ALACSpecificConfig. */
    byte[] config;
    long[] sampleOffset;
    int[] sampleSize;
    int maxSampleSize;

    private static final class Trak {
        boolean sound;
        String codec = "";
        byte[] config;
        int[] sizes;
        int constSize;
        int sampleCount;
        long[] chunkOffsets;
        int[] stscFirst, stscPer;
    }

    private final ByteSource src;
    private Trak chosen;

    private AlacMp4(ByteSource src) {
        this.src = src;
    }

    /** Разбирает файл. Не бросает исключений на «чужих» файлах: у результата просто {@code alac == false}. */
    static AlacMp4 parse(ByteSource src) {
        AlacMp4 r = new AlacMp4(src);
        try {
            long len = src.length();
            r.scan(0, len, 0, null);
            r.finish();
        } catch (Exception e) {
            r.alac = false;
        }
        return r;
    }

    private void finish() {
        Trak t = chosen;
        if (t == null || !"alac".equals(t.codec) || t.config == null || t.chunkOffsets == null || t.stscFirst == null) {
            alac = false;
            return;
        }
        int n = t.sampleCount;
        if (n <= 0) {
            alac = false;
            return;
        }
        long[] offs = new long[n];
        int[] sizes = new int[n];
        int sample = 0;
        int chunks = t.chunkOffsets.length;
        for (int ci = 0; ci < chunks && sample < n; ci++) {
            int chunkNo = ci + 1;
            int per = 0;
            for (int e = 0; e < t.stscFirst.length; e++) {
                if (t.stscFirst[e] <= chunkNo) per = t.stscPer[e];
                else break;
            }
            long pos = t.chunkOffsets[ci];
            for (int j = 0; j < per && sample < n; j++) {
                int sz = (t.constSize != 0) ? t.constSize : t.sizes[sample];
                offs[sample] = pos;
                sizes[sample] = sz;
                if (sz > maxSampleSize) maxSampleSize = sz;
                pos += sz;
                sample++;
            }
        }
        if (sample != n) {
            alac = false;
            return;
        }
        sampleOffset = offs;
        sampleSize = sizes;
        config = t.config;
        alac = true;
    }

    // ---------- обход боксов ----------

    private byte[] readBytes(long pos, int len) throws IOException {
        byte[] b = new byte[len];
        int got = 0;
        while (got < len) {
            int r = src.readAt(pos + got, b, got, len - got);
            if (r <= 0) throw new IOException("eof");
            got += r;
        }
        return b;
    }

    private static int be32(byte[] b, int o) {
        return ((b[o] & 0xFF) << 24) | ((b[o + 1] & 0xFF) << 16) | ((b[o + 2] & 0xFF) << 8) | (b[o + 3] & 0xFF);
    }

    private static String type(byte[] b, int o) {
        return new String(new char[]{(char) (b[o] & 0xFF), (char) (b[o + 1] & 0xFF), (char) (b[o + 2] & 0xFF), (char) (b[o + 3] & 0xFF)});
    }

    private void scan(long start, long end, int depth, Trak trak) throws IOException {
        long pos = start;
        while (pos + 8 <= end) {
            byte[] h = readBytes(pos, 8);
            long size = be32(h, 0) & 0xFFFFFFFFL;
            String t = type(h, 4);
            long hdr = 8;
            if (size == 1) {
                byte[] ext = readBytes(pos + 8, 8);
                size = ((long) be32(ext, 0) << 32) | (be32(ext, 4) & 0xFFFFFFFFL);
                hdr = 16;
            } else if (size == 0) {
                size = end - pos;
            }
            if (size < hdr || pos + size > end) size = end - pos;
            long body = pos + hdr;
            long bodyEnd = pos + size;

            if (depth == 0) {
                if (t.equals("moov")) scan(body, bodyEnd, 1, null);
            } else if (t.equals("trak") && depth == 1) {
                Trak tr = new Trak();
                scan(body, bodyEnd, 2, tr);
                if (chosen == null && tr.sound) chosen = tr;
            } else if (trak != null) {
                if (t.equals("mdia") || t.equals("minf") || t.equals("stbl")) {
                    scan(body, bodyEnd, depth + 1, trak);
                } else if (t.equals("hdlr")) {
                    byte[] d = readBytes(body, (int) Math.min(24, bodyEnd - body));
                    if (d.length >= 12 && type(d, 8).equals("soun")) trak.sound = true;
                } else if (t.equals("stsd")) {
                    parseStsd(trak, body, bodyEnd);
                } else if (t.equals("stsz")) {
                    byte[] d = readBytes(body, 12);
                    trak.constSize = be32(d, 4);
                    trak.sampleCount = be32(d, 8);
                    if (trak.constSize == 0) {
                        byte[] tbl = readBytes(body + 12, trak.sampleCount * 4);
                        int[] s = new int[trak.sampleCount];
                        for (int i = 0; i < s.length; i++) s[i] = be32(tbl, i * 4);
                        trak.sizes = s;
                    }
                } else if (t.equals("stsc")) {
                    byte[] d = readBytes(body, 8);
                    int cnt = be32(d, 4);
                    byte[] tbl = readBytes(body + 8, cnt * 12);
                    trak.stscFirst = new int[cnt];
                    trak.stscPer = new int[cnt];
                    for (int i = 0; i < cnt; i++) {
                        trak.stscFirst[i] = be32(tbl, i * 12);
                        trak.stscPer[i] = be32(tbl, i * 12 + 4);
                    }
                } else if (t.equals("stco")) {
                    byte[] d = readBytes(body, 8);
                    int cnt = be32(d, 4);
                    byte[] tbl = readBytes(body + 8, cnt * 4);
                    trak.chunkOffsets = new long[cnt];
                    for (int i = 0; i < cnt; i++) trak.chunkOffsets[i] = be32(tbl, i * 4) & 0xFFFFFFFFL;
                } else if (t.equals("co64")) {
                    byte[] d = readBytes(body, 8);
                    int cnt = be32(d, 4);
                    byte[] tbl = readBytes(body + 8, cnt * 8);
                    trak.chunkOffsets = new long[cnt];
                    for (int i = 0; i < cnt; i++) trak.chunkOffsets[i] = ((long) be32(tbl, i * 8) << 32) | (be32(tbl, i * 8 + 4) & 0xFFFFFFFFL);
                }
            }
            pos = bodyEnd;
        }
    }

    /** stsd: версия/флаги(4) + число записей(4), затем записи; нужна первая. Конфиг ALAC лежит в дочернем боксе 'alac'. */
    private void parseStsd(Trak trak, long body, long bodyEnd) throws IOException {
        long entry = body + 8;
        if (entry + 8 > bodyEnd) return;
        byte[] h = readBytes(entry, 8);
        long esize = be32(h, 0) & 0xFFFFFFFFL;
        trak.codec = type(h, 4);
        if (!trak.codec.equals("alac")) return;
        long entryEnd = Math.min(bodyEnd, entry + esize);
        long pos = entry + 8 + 28; // 8 байт заголовка записи + 28 байт полей звуковой записи
        while (pos + 8 <= entryEnd) {
            byte[] bh = readBytes(pos, 8);
            long bs = be32(bh, 0) & 0xFFFFFFFFL;
            String bt = type(bh, 4);
            if (bs < 8) break;
            if (bt.equals("alac") && bs >= 8 + 4 + 24) {
                byte[] d = readBytes(pos + 8 + 4, 24);
                trak.config = d;
                return;
            }
            pos += bs;
        }
    }
}
