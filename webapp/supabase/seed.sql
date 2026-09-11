-- ============================================================================
-- JobCRM - Seed / demo data
-- Run AFTER schema.sql. Safe to run once. You can delete all demo data later
-- with the cleanup script at the bottom of the deployment guide (README_DEPLOY.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Job statuses (editable later from Settings -> סטטוסים)
-- ----------------------------------------------------------------------------
insert into job_statuses (name, color, sort_order, is_success, is_terminal) values
  ('חדשה',            '#3b82f6', 1, false, false),
  ('נשלחה לקבלן',      '#6172f3', 2, false, false),
  ('הקבלן אישר',       '#06b6d4', 3, false, false),
  ('בדרך ללקוח',       '#8b5cf6', 4, false, false),
  ('בטיפול',           '#f59e0b', 5, false, false),
  ('ממתינה',           '#64748b', 6, false, false),
  ('לקוח לא ענה',      '#f97316', 7, false, false),
  ('נסגרה בהצלחה',     '#10b981', 8, true,  true),
  ('לא נסגרה',         '#ef4444', 9, false, true),
  ('בוטלה',            '#6b7280', 10, false, true);

-- ----------------------------------------------------------------------------
-- Payment methods (editable later from Settings)
-- ----------------------------------------------------------------------------
insert into payment_methods (name, sort_order) values
  ('מזומן', 1),
  ('אשראי', 2),
  ('Bit', 3),
  ('PayBox', 4);

-- ----------------------------------------------------------------------------
-- Lead sources
-- ----------------------------------------------------------------------------
insert into lead_sources (name, sort_order) values
  ('Google', 1),
  ('Facebook', 2),
  ('Instagram', 3),
  ('אורגני', 4),
  ('המלצה', 5),
  ('WhatsApp', 6),
  ('אחר', 7);

-- ----------------------------------------------------------------------------
-- Professions + job types
-- ----------------------------------------------------------------------------
-- technician_label is what the customer reads: "טכנאי האינסטלציה כבר בדרך אליך"
insert into professions (name, technician_label, sort_order) values
  ('אינסטלציה', 'טכנאי האינסטלציה', 1),
  ('חשמל', 'החשמלאי', 2),
  ('מנעולנות', 'המנעולן', 3),
  ('מזגנים', 'טכנאי המזגנים', 4);

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('פתיחת סתימה', 1, 35000),
  ('פיצוץ בצינור', 2, 60000),
  ('החלפת ברז', 3, 25000),
  ('נזילה', 4, 38000),
  ('החלפת אסלה', 5, 45000)
) as jt(name, sort_order, base_price)
where professions.name = 'אינסטלציה';

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('קצר חשמלי', 1, 30000),
  ('החלפת לוח חשמל', 2, 90000),
  ('תקלת תאורה', 3, 18000),
  ('התקנת נקודות חשמל', 4, 50000)
) as jt(name, sort_order, base_price)
where professions.name = 'חשמל';

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('פתיחת דלת נעולה', 1, 22000),
  ('החלפת צילינדר', 2, 28000),
  ('שכפול מפתחות', 3, 9000),
  ('פריצת רכב', 4, 25000)
) as jt(name, sort_order, base_price)
where professions.name = 'מנעולנות';

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('ניקוי וטיפול', 1, 20000),
  ('תיקון מזגן לא מקרר', 2, 35000),
  ('הוספת גז', 3, 28000),
  ('התקנת מזגן חדש', 4, 65000)
) as jt(name, sort_order, base_price)
where professions.name = 'מזגנים';

-- ----------------------------------------------------------------------------
-- Cities
-- ----------------------------------------------------------------------------
-- The full list lives in seed_cities.sql (200 localities, tagged by region).
-- Run that file too — everything arrives switched off except the four below, so
-- the job form stays short until you switch more on from the Cities screen.
insert into cities (name, region, is_active) values
  ('באר שבע', 'דרום', true),
  ('אשקלון', 'דרום', true),
  ('אשדוד', 'דרום', true),
  ('נתיבות', 'דרום', true)
on conflict (name) do update set region = excluded.region, is_active = true;

-- ----------------------------------------------------------------------------
-- Demo contractors
-- ----------------------------------------------------------------------------
insert into contractors (name, phone, whatsapp, default_commission_pct, active, notes) values
  ('דוד כהן',   '050-1112222', '972501112222', 60, true, 'קבלן לדוגמה - אינסטלציה'),
  ('יוסי לוי',  '052-3334444', '972523334444', 55, true, 'קבלן לדוגמה - חשמל ומזגנים'),
  ('אבי מזרחי', '054-5556666', '972545556666', 65, true, 'קבלן לדוגמה - מנעולנות'),
  ('משה פרץ',   '053-7778888', '972537778888', 60, true, 'קבלן לדוגמה - אינסטלציה ומנעולנות');

-- contractor <-> professions
insert into contractor_professions (contractor_id, profession_id)
select c.id, p.id from contractors c, professions p
where (c.name = 'דוד כהן' and p.name = 'אינסטלציה')
   or (c.name = 'יוסי לוי' and p.name in ('חשמל', 'מזגנים'))
   or (c.name = 'אבי מזרחי' and p.name = 'מנעולנות')
   or (c.name = 'משה פרץ' and p.name in ('אינסטלציה', 'מנעולנות'));

-- contractor <-> cities
insert into contractor_cities (contractor_id, city_id)
select c.id, ci.id from contractors c, cities ci
where (c.name = 'דוד כהן' and ci.name in ('באר שבע', 'אשדוד'))
   or (c.name = 'יוסי לוי' and ci.name in ('באר שבע', 'אשקלון', 'נתיבות'))
   or (c.name = 'אבי מזרחי' and ci.name in ('אשקלון', 'אשדוד'))
   or (c.name = 'משה פרץ' and ci.name in ('באר שבע', 'נתיבות'));

-- contractor <-> job types (all job types of their professions)
insert into contractor_job_types (contractor_id, job_type_id)
select cp.contractor_id, jt.id
from contractor_professions cp
join job_types jt on jt.profession_id = cp.profession_id;

-- ----------------------------------------------------------------------------
-- Demo jobs (spread across the last 6 days, mixed statuses/results)
-- ----------------------------------------------------------------------------
create temporary table tmp_demo_jobs as
  select * from (
  values
    ('אינסטלציה','פתיחת סתימה','באר שבע','ישראל ישראלי','050-1000001','רחוב הרצל 12, באר שבע',35000,'מזומן','דוד כהן','Google', 'נסגרה בהצלחה', 20, 85000,'contractor'),
    ('אינסטלציה','נזילה','אשדוד','רונית אבני','050-1000002','רחוב רוגוזין 4, אשדוד',40000,'Bit','דוד כהן','אורגני', 'נסגרה בהצלחה', 30, 65000,'business'),
    ('אינסטלציה','החלפת ברז','באר שבע','משה בר','050-1000003','שדרות רגר 8, באר שבע',25000,'אשראי','משה פרץ','המלצה', 'בטיפול', 1, null, null),
    ('אינסטלציה','פיצוץ בצינור','נתיבות','שרה כהן','050-1000004','רחוב האורן 2, נתיבות',60000,'מזומן','משה פרץ','Facebook', 'נשלחה לקבלן', 3, null, null),
    ('אינסטלציה','החלפת אסלה','אשדוד','דני לוי','050-1000005','רחוב הציונות 6, אשדוד',45000,'PayBox','דוד כהן','WhatsApp', 'לא נסגרה', 40, 0,'contractor'),
    ('חשמל','קצר חשמלי','באר שבע','מירי דהן','050-1000006','רחוב שדרות בן גוריון 20, באר שבע',30000,'מזומן','יוסי לוי','Google', 'נסגרה בהצלחה', 15, 32000,'contractor'),
    ('חשמל','תקלת תאורה','אשקלון','אבי סבן','050-1000007','רחוב הנשיא 9, אשקלון',18000,'Bit','יוסי לוי','אורגני', 'נסגרה בהצלחה', 50, 22000,'business'),
    ('חשמל','החלפת לוח חשמל','נתיבות','נועה עמר','050-1000008','רחוב ירושלים 3, נתיבות',90000,'אשראי','יוסי לוי','אחר', 'ממתינה', 2, null, null),
    ('מזגנים','ניקוי וטיפול','אשקלון','רפי אזולאי','050-1000009','רחוב הרצל 30, אשקלון',20000,'מזומן','יוסי לוי','Instagram', 'נסגרה בהצלחה', 12, 20000,'contractor'),
    ('מזגנים','תיקון מזגן לא מקרר','באר שבע','חני שמעוני','050-1000010','רחוב רמב"ם 5, באר שבע',35000,'Bit','יוסי לוי','Google', 'הקבלן אישר', 5, null, null),
    ('מנעולנות','פתיחת דלת נעולה','אשקלון','גדי טל','050-1000011','רחוב אחד העם 11, אשקלון',22000,'מזומן','אבי מזרחי','WhatsApp', 'נסגרה בהצלחה', 6, 25000,'contractor'),
    ('מנעולנות','החלפת צילינדר','אשדוד','ליאור נחום','050-1000012','רחוב הבנים 7, אשדוד',28000,'Bit','אבי מזרחי','המלצה', 'נסגרה בהצלחה', 10, 30000,'business'),
    ('מנעולנות','שכפול מפתחות','באר שבע','עדי ברק','050-1000013','רחוב יפו 14, באר שבע',9000,'מזומן','משה פרץ','אורגני', 'בדרך ללקוח', 1, null, null),
    ('אינסטלציה','נזילה','באר שבע','אורית מלכה','050-1000014','רחוב שז"ר 2, באר שבע',38000,'PayBox','דוד כהן','Google', 'לקוח לא ענה', 8, null, null),
    ('חשמל','התקנת נקודות חשמל','אשדוד','קובי פרידמן','050-1000015','רחוב הגדוד העברי 18, אשדוד',50000,'אשראי','יוסי לוי','Facebook', 'חדשה', 0, null, null)
) as d(profession_name, job_type_name, city_name, customer_name, customer_phone, address_full, quoted_price_agorot, payment_method_name, contractor_name, lead_source_name, status_name, hours_ago, final_price_agorot, payment_received_by);

insert into jobs (
  profession_id, job_type_id, city_id, customer_name, customer_phone,
  address_full, address_city, quoted_price_agorot, payment_method_id,
  contractor_id, commission_pct, lead_source_id, notes, status_id, opened_at
)
select
  p.id, jt.id, ci.id, d.customer_name, d.customer_phone,
  d.address_full, ci.name, d.quoted_price_agorot, pm.id,
  c.id, c.default_commission_pct, ls.id, 'עבודת דוגמה', st.id,
  now() - (d.hours_ago || ' hours')::interval
from tmp_demo_jobs d
join professions p on p.name = d.profession_name
join job_types jt on jt.name = d.job_type_name and jt.profession_id = p.id
join cities ci on ci.name = d.city_name
join payment_methods pm on pm.name = d.payment_method_name
join contractors c on c.name = d.contractor_name
join lead_sources ls on ls.name = d.lead_source_name
join job_statuses st on st.name = d.status_name;

-- Close the demo jobs that were seeded as already resolved, using the crafted final price / payer
do $$
declare
  r record;
begin
  for r in
    select j.id, d.final_price_agorot, d.payment_received_by, d.status_name
    from jobs j
    join tmp_demo_jobs d on d.customer_phone = j.customer_phone
    where d.status_name in ('נסגרה בהצלחה', 'לא נסגרה')
  loop
    if r.status_name = 'נסגרה בהצלחה' then
      perform close_job(
        r.id, true, r.final_price_agorot,
        (select payment_method_id from jobs where id = r.id),
        r.payment_received_by,
        'נסגרה - נתוני דוגמה',
        now() - interval '1 hour'
      );
    else
      perform close_job(r.id, false, 0, null, 'contractor', 'לא נסגרה - נתוני דוגמה', now() - interval '1 hour');
    end if;
  end loop;
end $$;

drop table tmp_demo_jobs;
