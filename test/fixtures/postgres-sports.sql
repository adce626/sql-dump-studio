-- PostgreSQL dump fixture for SQL Dump Studio (COPY based)
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET client_encoding = 'UTF8';

CREATE TABLE public.teams (
    id integer NOT NULL,
    name character varying(80) NOT NULL,
    city character varying(60),
    founded integer,
    CONSTRAINT teams_pkey PRIMARY KEY (id)
);

CREATE TABLE public.players (
    id integer NOT NULL,
    team_id integer,
    full_name character varying(120) NOT NULL,
    position character varying(30),
    salary numeric(10,2),
    CONSTRAINT players_pkey PRIMARY KEY (id),
    CONSTRAINT players_team_fkey FOREIGN KEY (team_id) REFERENCES public.teams (id) ON DELETE SET NULL
);

CREATE TABLE public.matches (
    id bigint NOT NULL,
    home_team_id integer NOT NULL,
    away_team_id integer NOT NULL,
    home_score integer DEFAULT 0,
    away_score integer DEFAULT 0,
    played_on date,
    CONSTRAINT matches_pkey PRIMARY KEY (id)
);

COPY public.teams (id, name, city, founded) FROM stdin;
1	الهلال	الرياض	1957
2	النصر	الرياض	1955
3	الاتحاد	جدة	1927
4	الأهلي	مكة	1937
\.

COPY public.players (id, team_id, full_name, position, salary) FROM stdin;
1	1	سالم الدوسري	مهاجم	45000.00
2	1	سعود الحربي	وسط	32000.50
3	2	كريستيانو	مهاجم	90000.00
4	2	سعود الشهري	حارس	28000.00
5	3	كريم بنزيما	مهاجم	75000.25
6	3	محمد كنو	وسط	31000.00
7	4	حسين الشحات	جناح	26000.00
\.

COPY public.matches (id, home_team_id, away_team_id, home_score, away_score, played_on) FROM stdin;
1	1	2	2	1	2024-09-01
2	3	4	0	0	2024-09-07
3	2	3	3	2	2024-09-14
4	4	1	1	4	2024-09-21
\.

--
-- PostgreSQL database dump complete
--
