-- =====================================================================
--  02_sweep : จำลองการจองทีละวันเข้าพัก 2000-01-01 .. 2026-12-30
--  ต่อวัน: สุ่มจำนวนคำขอ (Poisson รอบค่า h_day.lam) -> แต่ละคำขอมี lead time,
--  จำนวนคืน, ประเภทห้อง, จำนวนห้อง/แขก -> หาห้องว่างจริง ถ้าเต็มลองประเภทใกล้เคียง
--
--  ห้องว่าง = (1) แขกคนก่อนออกแล้ว  (2) ไม่ติดช่วงปิดห้อง (h_block)
--            (3) ถ้าห้องเคยถูกจองแล้วยกเลิก ในคืนที่ซ้อนกัน การจองใหม่ต้องเกิด "หลัง"
--                เวลายกเลิก - เรียงเหตุการณ์ตามเวลาจริงแล้ว trigger BR-5 จะไม่มีวันเด้ง
--  ผลลัพธ์: h_bk (การจอง), h_bkroom (ห้อง), h_newcust (ลูกค้าใหม่), h_fault (ของเสีย)
-- =====================================================================
\echo '>> 02 sweep (day-by-day booking simulation)'

CREATE TEMP TABLE h_bk (
    k          int PRIMARY KEY,     -- ลำดับในการจำลอง (แปลงเป็น booking_id ตามเวลาจองทีหลัง)
    cust       int NOT NULL,
    b_at       timestamptz NOT NULL,
    ci         date NOT NULL,
    co         date NOT NULL,
    guests     int NOT NULL,
    rtype      int NOT NULL,
    lead       int NOT NULL,
    walkin     boolean NOT NULL,
    cancelled  boolean NOT NULL,
    noshow     boolean NOT NULL,
    cancel_at  timestamptz
);
CREATE TEMP TABLE h_bkroom (k int NOT NULL, room_id int NOT NULL, seq int NOT NULL);
CREATE TEMP TABLE h_newcust (cust int PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TEMP TABLE h_fault (
    k int NOT NULL, room_id int NOT NULL, found text NOT NULL,   -- checkout | stay
    d date NOT NULL, dur int NOT NULL, prio text NOT NULL
);

DO $sweep$
DECLARE
    d0        constant date := DATE '2000-01-01';
    d_end     constant date := DATE '2026-12-31';
    t_now     timestamptz;
    today     date;
    -- ห้อง
    rt_of     int[];
    cap_of    int[];
    trooms    int[];          -- ห้องของแต่ละประเภท เรียงต่อกัน: ประเภท t อยู่ที่ tfirst[t] .. tfirst[t]+tn[t]-1
    tfirst    int[] := ARRAY[0,0,0,0,0];
    tn        int[] := ARRAY[0,0,0,0,0];
    busy      date[];         -- ห้องว่างตั้งแต่วันนี้ (แขกล่าสุดเช็คเอาท์ / ซ่อมเสร็จ)
    soft_to   date[];         -- ช่วงที่มีการจองซึ่งถูกยกเลิกทับอยู่ ...
    soft_aft  timestamptz[];  -- ... จองใหม่ได้เฉพาะหลังเวลายกเลิกนี้
    -- ช่วงปิดห้อง (เรียงตามห้อง, วันเริ่ม) + pointer ต่อห้อง
    bl_from   date[];
    bl_to     date[];
    bp        int[];
    be        int[];
    -- ลูกค้า
    c_busy    date[];
    c_made    timestamptz[];
    pool      int[] := '{}';  -- ลูกค้าต่อการเข้าพักแต่ละครั้ง (คนมาบ่อย = มีหลายช่อง)
    npool     int := 0;
    sq_id     int[];          -- ลูกค้า seed ที่ยังไม่เคยพัก เรียงตามวันสมัคร
    sq_at     timestamptz[];
    sq_i      int := 1;
    sq_n      int;
    next_cust int;
    -- ต่อวัน / ต่อคำขอ
    day       date;
    di        int;
    lam       float8;
    n_req     int;
    i         int;
    j         int;
    u         float8;
    lead      int;
    b_at      timestamptz;
    los       int;
    co        date;
    t         int;
    t_try     int;
    nr        int;
    g         int;
    guests    int;
    cancelled boolean;
    noshow    boolean;
    cancel_at timestamptz;
    got       int[];
    r         int;
    st        int;
    cust      int;
    k         int := 0;
    n_lost    int := 0;
    pr        text;
    dur       int;
    x         float8;
BEGIN
    SELECT p.t_now, p.today, p.cust_base INTO t_now, today, next_cust FROM h_param p;
    PERFORM setseed(((current_setting('hist.seed')::bigint % 1999) - 999) / 1000.0);

    -- ห้อง
    SELECT array_agg(room_type_id ORDER BY room_id), array_agg(cap ORDER BY room_id)
      INTO rt_of, cap_of FROM h_room;
    SELECT array_agg(room_id ORDER BY room_type_id, room_id) INTO trooms FROM h_room;
    FOR t IN 1..5 LOOP
        tn[t]     := (SELECT count(*) FROM h_room WHERE room_type_id = t);
        tfirst[t] := (SELECT count(*) + 1 FROM h_room WHERE room_type_id < t);
    END LOOP;
    busy     := array_fill(d0, ARRAY[155]);
    soft_to  := array_fill(d0, ARRAY[155]);
    soft_aft := array_fill('-infinity'::timestamptz, ARRAY[155]);

    -- ช่วงปิดห้อง
    SELECT array_agg(d_from ORDER BY room_id, d_from, d_to),
           array_agg(d_to   ORDER BY room_id, d_from, d_to)
      INTO bl_from, bl_to FROM h_block;
    bp := array_fill(1, ARRAY[155]);
    be := array_fill(0, ARRAY[155]);
    FOR r, st, j IN
        SELECT room_id, min(rn), max(rn)
        FROM (SELECT room_id, row_number() OVER (ORDER BY room_id, d_from, d_to) AS rn
              FROM h_block) z
        GROUP BY room_id
    LOOP
        bp[r] := st;
        be[r] := j;
    END LOOP;

    -- ลูกค้าจาก seed (id > 12) ที่ยังไม่มีการจอง: ใช้เป็น "ลูกค้าใหม่" เมื่อถึงวันสมัครของเขา
    -- (1..12 เป็นชุดทดสอบของ seed - 11, 12 ต้องไม่มีการจองเลย)
    SELECT array_agg(c.customer_id ORDER BY c.created_at, c.customer_id),
           array_agg(c.created_at  ORDER BY c.created_at, c.customer_id)
      INTO sq_id, sq_at
    FROM customer c
    WHERE c.customer_id > 12
      AND NOT EXISTS (SELECT 1 FROM booking b WHERE b.customer_id = c.customer_id);
    sq_n := COALESCE(cardinality(sq_id), 0);

    FOR di, day, lam IN SELECT h.di, h.d, h.lam FROM h_day h ORDER BY h.di LOOP
        -- จำนวนคำขอของวันนี้ ~ Poisson(lam)
        IF lam <= 0 THEN
            CONTINUE;
        ELSIF lam < 12 THEN
            n_req := 0; x := exp(-lam); u := random();
            WHILE u > x LOOP n_req := n_req + 1; u := u * random(); END LOOP;
        ELSE
            n_req := greatest(0, round(lam + sqrt(lam)
                     * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())))::int;
        END IF;

        FOR i IN 1..n_req LOOP
            -- จองล่วงหน้ากี่วัน (0 = walk-in)
            u := random();
            lead := CASE WHEN u < 0.06 THEN 0
                         WHEN u < 0.30 THEN 1  + floor(random() * 7)
                         WHEN u < 0.62 THEN 8  + floor(random() * 23)
                         WHEN u < 0.88 THEN 31 + floor(random() * 60)
                         ELSE 91 + floor(random() * 180) END;
            lead := least(lead, day - d0);
            IF lead = 0 THEN
                b_at := pg_temp.bkk(day, 600 + floor(random() * 540)::int);
            ELSE
                b_at := pg_temp.bkk(day - lead, 480 + floor(random() * 840)::int);
            END IF;
            CONTINUE WHEN b_at > t_now;              -- ยังไม่ถึงเวลาที่คำขอนี้เกิด

            -- ประเภทห้อง, จำนวนห้อง, จำนวนคืน
            u := random();
            t := CASE WHEN u < 0.27 THEN 1 WHEN u < 0.67 THEN 2 WHEN u < 0.88 THEN 3
                      WHEN u < 0.93 THEN 4 ELSE 5 END;
            u := random();
            nr := CASE WHEN u < 0.91 THEN 1 WHEN u < 0.975 THEN 2 WHEN u < 0.993 THEN 3 ELSE 4 END;
            IF t >= 4 THEN nr := least(nr, 2); END IF;
            u := random();
            IF t <= 3 THEN
                los := CASE WHEN u < 0.32 THEN 1 WHEN u < 0.58 THEN 2 WHEN u < 0.75 THEN 3
                            WHEN u < 0.84 THEN 4 WHEN u < 0.90 THEN 5 WHEN u < 0.93 THEN 6
                            WHEN u < 0.97 THEN 7 ELSE 8 + floor(random() * 7) END;
            ELSE
                los := CASE WHEN u < 0.15 THEN 1 WHEN u < 0.37 THEN 2 WHEN u < 0.57 THEN 3
                            WHEN u < 0.70 THEN 4 WHEN u < 0.80 THEN 5 WHEN u < 0.86 THEN 6
                            WHEN u < 0.94 THEN 7 ELSE 8 + floor(random() * 7) END;
            END IF;
            co := least(day + los, d_end);

            -- ยกเลิก / ไม่มาเข้าพัก (walk-in ไม่มี)
            cancelled := FALSE; noshow := FALSE; cancel_at := NULL;
            IF lead > 0 THEN
                u := random();
                IF u < 0.03 + 0.12 * least(lead, 180) / 180.0 THEN
                    cancelled := TRUE;
                    IF random() < 0.25 OR pg_temp.bkk(day, 0) - interval '48 hours' <= b_at THEN
                        -- ยกเลิกช้า (ภายใน 48 ชม. ก่อนเข้าพัก)
                        cancel_at := greatest(b_at + interval '5 minutes',
                                              pg_temp.bkk(day, 0) - random() * interval '48 hours');
                    ELSE
                        cancel_at := b_at + random()
                                     * (pg_temp.bkk(day, 0) - interval '48 hours' - b_at);
                    END IF;
                ELSIF u < 0.03 + 0.12 * least(lead, 180) / 180.0 + 0.012 THEN
                    cancelled := TRUE; noshow := TRUE;
                    cancel_at := pg_temp.bkk(day + 1, 600 + floor(random() * 120)::int);
                END IF;
                IF cancel_at > t_now THEN       -- ยังไม่ได้ยกเลิก ณ ตอนนี้ = ยังเป็นการจองปกติ
                    cancelled := FALSE; noshow := FALSE; cancel_at := NULL;
                END IF;
            END IF;

            -- หาห้อง: ประเภทที่ขอ -> ถ้าไม่พอ ลองประเภทใกล้เคียงครึ่งหนึ่งของกรณี
            got := NULL;
            t_try := t;
            FOR g IN 1..2 LOOP
                got := '{}';
                st := floor(random() * tn[t_try])::int;
                FOR j IN 0 .. tn[t_try] - 1 LOOP
                    r := trooms[tfirst[t_try] + (st + j) % tn[t_try]];
                    CONTINUE WHEN busy[r] > day;
                    WHILE bp[r] <= be[r] AND bl_to[bp[r]] <= day LOOP
                        bp[r] := bp[r] + 1;
                    END LOOP;
                    CONTINUE WHEN bp[r] <= be[r] AND bl_from[bp[r]] < co;
                    CONTINUE WHEN soft_to[r] > day AND b_at <= soft_aft[r];
                    got := got || r;
                    EXIT WHEN cardinality(got) = nr;
                END LOOP;
                EXIT WHEN cardinality(got) = nr;
                got := NULL;
                EXIT WHEN g = 2 OR random() < 0.5;
                t_try := CASE t_try WHEN 1 THEN 2 WHEN 2 THEN (CASE WHEN random() < 0.5 THEN 1 ELSE 3 END)
                                    WHEN 3 THEN 2 ELSE 3 END;
            END LOOP;
            IF got IS NULL THEN
                n_lost := n_lost + 1;
                CONTINUE;
            END IF;

            -- แขกต่อห้อง: 1 .. ความจุ (BR-7: อย่างน้อย 1 คนต่อห้อง)
            guests := 0;
            FOREACH r IN ARRAY got LOOP
                u := random();
                guests := guests + CASE cap_of[r]
                    WHEN 2 THEN (CASE WHEN rt_of[r] = 5 THEN (CASE WHEN u < 0.85 THEN 2 ELSE 1 END)
                                      ELSE (CASE WHEN u < 0.40 THEN 1 ELSE 2 END) END)
                    WHEN 3 THEN (CASE WHEN u < 0.25 THEN 1 WHEN u < 0.85 THEN 2 ELSE 3 END)
                    ELSE        (CASE WHEN u < 0.25 THEN 2 WHEN u < 0.60 THEN 3 ELSE 4 END) END;
            END LOOP;

            -- ลูกค้า: ~28% เป็นแขกเก่า (โอกาสตามจำนวนครั้งที่เคยพักใน ~5 ปีล่าสุด)
            cust := NULL;
            IF npool > 50 AND random() < 0.28 THEN
                cust := pool[npool - floor(random() * least(npool, 60000))::int];
                IF c_made[cust] > b_at OR COALESCE(c_busy[cust], d0) > day THEN
                    cust := NULL;
                END IF;
            END IF;
            IF cust IS NULL THEN
                IF sq_i <= sq_n AND sq_at[sq_i] <= b_at THEN
                    cust := sq_id[sq_i];
                    c_made[cust] := sq_at[sq_i];
                    sq_i := sq_i + 1;
                ELSE
                    next_cust := next_cust + 1;
                    cust := next_cust;
                    c_made[cust] := b_at;
                    INSERT INTO h_newcust VALUES (cust, b_at);
                END IF;
            END IF;

            k := k + 1;
            INSERT INTO h_bk VALUES (k, cust, b_at, day, co, guests, t_try, lead, lead = 0,
                                     cancelled, noshow, cancel_at);
            j := 0;
            FOREACH r IN ARRAY got LOOP
                j := j + 1;
                INSERT INTO h_bkroom VALUES (k, r, j);
                IF cancelled THEN
                    soft_to[r]  := greatest(soft_to[r], co);
                    soft_aft[r] := greatest(soft_aft[r], cancel_at);
                ELSE
                    busy[r] := co;
                    -- ของเสียที่แม่บ้านพบตอนทำความสะอาดหลังเช็คเอาท์ (อดีตเท่านั้น)
                    IF co < today AND random() < 0.03 THEN
                        u := random();
                        pr  := CASE WHEN u < 0.08 THEN 'urgent' WHEN u < 0.30 THEN 'high'
                                    WHEN u < 0.80 THEN 'normal' ELSE 'low' END;
                        dur := CASE pr WHEN 'urgent' THEN 1 + floor(random() * 3)
                                       WHEN 'high'   THEN 1 + floor(random() * 2)
                                       WHEN 'normal' THEN floor(random() * 2)
                                       ELSE 0 END;
                        IF co < DATE '2020-07-01' AND co + dur >= DATE '2020-04-01' THEN
                            dur := 0;                -- ซ่อมให้เสร็จก่อนปิดโรงแรมช่วงโควิด
                        END IF;
                        INSERT INTO h_fault VALUES (k, r, 'checkout', co, dur, pr);
                        busy[r] := co + dur;         -- ห้องปิดขายระหว่างซ่อม
                    END IF;
                END IF;
            END LOOP;

            IF NOT cancelled THEN
                c_busy[cust] := co;
                npool := npool + 1;
                pool[npool] := cust;
                -- แขกแจ้งปัญหาระหว่างพัก (ซ่อมเสร็จในวันเดียวขณะแขกออกไปข้างนอก)
                IF co < today AND co - day >= 2 AND random() < 0.015 THEN
                    INSERT INTO h_fault VALUES (k, got[1], 'stay',
                        day + 1 + floor(random() * (co - day - 1))::int, 0,
                        CASE WHEN random() < 0.3 THEN 'high' ELSE 'normal' END);
                END IF;
            END IF;
        END LOOP;

        IF extract(doy FROM day) = 1 THEN
            RAISE NOTICE '   % : % bookings so far', extract(year FROM day), k;
        END IF;
    END LOOP;

    RAISE NOTICE '   sweep done: % bookings, % requests turned away (sold out), % seed guests placed of %',
        k, n_lost, sq_i - 1, sq_n;
    IF sq_i - 1 < sq_n THEN
        RAISE EXCEPTION 'only % of % seed customers got a stay', sq_i - 1, sq_n;
    END IF;
END
$sweep$;

CREATE INDEX ON h_bkroom (k);
CREATE INDEX ON h_bkroom (room_id);
ANALYZE h_bk; ANALYZE h_bkroom; ANALYZE h_newcust; ANALYZE h_fault;
