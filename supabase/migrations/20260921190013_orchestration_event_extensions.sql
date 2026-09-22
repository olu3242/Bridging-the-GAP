-- Repair W14 human-work orchestration event vocabulary.
-- Historical human_work migration attempted these additions before the enum existed.

alter type public.btg_orchestration_event
  add value if not exists 'claimed_by_person';

alter type public.btg_orchestration_event
  add value if not exists 'released_by_person';

alter type public.btg_orchestration_event
  add value if not exists 'escalated';

alter type public.btg_orchestration_event
  add value if not exists 'reassigned';