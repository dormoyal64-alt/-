-- ---------------------------------------------------------------------------
-- הערות — the part of the survey that does not fit a heading
--
-- A survey already says what was found and what to do about it. What it could
-- not say is everything else the tradesman wants on the record: that the
-- neighbour's balcony was dripping and may be the real source, that the
-- cupboard could not be moved so one wall was not reached, that the meter was
-- ticking with every tap shut. None of that is a finding and none of it is a
-- recommendation, and all of it is the kind of thing that is remembered
-- wrongly three months later when somebody is deciding who pays.
--
-- So one free-text box at the end, printed at the end, in his own words.
-- ---------------------------------------------------------------------------

alter table leak_surveys
  add column if not exists notes text;

comment on column leak_surveys.notes is
  'Free text printed at the end of the survey report, under הערות.';

notify pgrst, 'reload schema';
