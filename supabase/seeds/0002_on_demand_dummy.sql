-- OpenClaw — on-demand dummy data seed (DEV-ONLY)
-- Adds 30 on_demand_requests + their resulting calendar_posts per brand so
-- the /[slug]/on-demand listing has enough rows to exercise pagination
-- (20 per page → 2 pages).
--
-- Why a separate seed file:
--   on_demand_requests was added in migration 0009 (post 0001_dummy_data).
--   Keeping it isolated means re-running 0001 doesn't have to know about the
--   new table, and the on-demand UI can be tested independently.
--
-- Idempotent: every dummy on-demand row is tagged with `occasion_name LIKE
-- '__seed__%'` so re-running wipes prior dummy rows (and their linked posts)
-- before re-inserting, without touching real user data.
--
-- FK ordering note:
--   `on_demand_requests.post_id` references `calendar_posts.post_id`. The
--   request must be inserted with `post_id = NULL` first; the post is then
--   inserted (with `on_demand_request_id` pointing back); finally the request
--   is updated with the post id. Inserting them inline with both ids set
--   would violate `on_demand_requests_post_fk`.

begin;

-- Wipe previous on-demand dummy rows (and their linked posts) so re-running
-- this seed doesn't leave orphans.
delete from public.calendar_posts
 where on_demand_request_id in (
   select request_id from public.on_demand_requests
    where occasion_name like '__seed__%'
 );

delete from public.on_demand_requests
 where occasion_name like '__seed__%';

-- Insert 30 on-demand requests per existing brand. Mix of statuses so the
-- listing exercises every status badge + pagination at the same time.
do $$
declare
  rec record;
  base_time timestamptz := now();
  i int;
  req_id uuid;
  post_id_v uuid;
  status_v on_demand_status_type;
  has_post boolean;
  watermark_v boolean;
  route_v post_route_decision_type;
  post_status_v text;
  confidence_v int;
  content_type_v text;
  objective_v text;
  canvas_v text;
  caption_v text;
  occasion_v text;
  img_url text;
  -- Per-card created_at offset so the list orders deterministically (newest
  -- first) and pagination splits cleanly: card #1 is the freshest, card #30
  -- is the oldest.
  age_minutes int;
begin
  for rec in
    select brand_id, primary_channel, primary_color_hex
      from public.brand_profiles
     order by created_at asc
  loop
    for i in 1..30 loop
      -- Status rotation (every 5th is generating, every 7th is held, every
      -- 11th is failed, rest are delivered). Picsum supplies the dummy image
      -- via a per-card seed so each card gets a distinct picture.
      if i % 11 = 0 then
        status_v := 'failed';
      elsif i % 7 = 0 then
        status_v := 'held';
      elsif i % 5 = 0 then
        status_v := 'generating';
      else
        status_v := 'delivered';
      end if;

      -- Failed/generating requests have no post row.
      has_post := status_v in ('delivered','held');

      -- Vary the brief so cards look distinct in the grid.
      content_type_v := (array['lifestyle','offer','educational','testimonial','announcement'])[((i - 1) % 5) + 1];
      objective_v    := (array['awareness','engagement','conversion','cultural','trust'])[((i - 1) % 5) + 1];
      canvas_v       := (array['ig_square','ig_portrait','ig_story','snap'])[((i - 1) % 4) + 1];
      occasion_v     := '__seed__demo_' || lpad(i::text, 2, '0');

      -- Picsum dummy image. Per-card seed keeps the picture stable across
      -- re-seeds while still giving every card a different image.
      img_url := 'https://picsum.photos/seed/openclaw-od-' || rec.brand_id || '-' || i || '/800/800';

      -- Status-specific post fields.
      if status_v = 'held' then
        watermark_v := true;
        route_v := 'watermark';
        post_status_v := 'pending';
        confidence_v := 60 + (i % 10);
      else
        watermark_v := false;
        route_v := 'clean';
        post_status_v := 'approved';
        confidence_v := 80 + (i % 15);
      end if;

      caption_v := case
        when content_type_v = 'lifestyle'    then 'لمحة من تفاصيل اليوم — لحظة هادئة تستحق المشاركة 🌿 #' || i
        when content_type_v = 'offer'        then 'عرض الأسبوع — لا تفوّت الفرصة قبل انتهائها ✨ #' || i
        when content_type_v = 'educational'  then 'نصيحة سريعة — معلومة قد تغيّر طريقتك في التعامل مع هذا الموضوع 💡 #' || i
        when content_type_v = 'testimonial'  then 'تجربة عميل — كلمات صادقة تعكس الفرق الذي صنعناه معاً 💬 #' || i
        else                                      'إعلان جديد — تابعونا لمعرفة التفاصيل كاملةً 📢 #' || i
      end;

      age_minutes := i * 47; -- spread cards across ~24h, deterministic ordering.

      req_id := gen_random_uuid();

      -- Step 1: insert the request with post_id = null (FK requires post first).
      insert into public.on_demand_requests (
        request_id, brand_id,
        content_type, objective, platform, posting_time, month,
        occasion_name, hashtags,
        style_descriptor, hero_concept, canvas, color_palette,
        status, post_id, submitted_by,
        created_at, delivered_at, failure_reason
      ) values (
        req_id, rec.brand_id,
        content_type_v, objective_v,
        coalesce(rec.primary_channel, 'Instagram'::channel_type),
        base_time + (i || ' hours')::interval,
        to_char(base_time + (i || ' hours')::interval, 'YYYY-MM'),
        occasion_v,
        array['#openclaw_demo','#card_' || i],
        'editorial photography, natural light, brand-consistent palette',
        'Hero concept #' || i || ' — varied subject for grid demo',
        canvas_v,
        array[coalesce(rec.primary_color_hex, '#10b981'), '#FFFFFF'],
        status_v,
        null,
        null,
        base_time - (age_minutes || ' minutes')::interval,
        case when status_v = 'delivered' then base_time - ((age_minutes - 5) || ' minutes')::interval
             when status_v = 'held'      then base_time - ((age_minutes - 5) || ' minutes')::interval
             else null end,
        case when status_v = 'failed' then 'Image model returned a policy block — retry with safer prompt' else null end
      );

      -- Step 2 + 3: insert post (if any) and patch the link.
      if has_post then
        post_id_v := gen_random_uuid();
        insert into public.calendar_posts (
          post_id, calendar_id, brand_id, position,
          caption_ar, hashtags, content_type, posting_time,
          storage_url, confidence_score, watermark, status,
          route_decision, on_demand_request_id, created_at
        ) values (
          post_id_v, null, rec.brand_id, 0,
          caption_v,
          array['#openclaw_demo','#card_' || i],
          content_type_v,
          base_time + (i || ' hours')::interval,
          img_url,
          confidence_v,
          watermark_v,
          post_status_v,
          route_v,
          req_id,
          base_time - ((age_minutes - 5) || ' minutes')::interval
        );

        update public.on_demand_requests
           set post_id = post_id_v
         where request_id = req_id;
      end if;
    end loop;
  end loop;
end $$;

commit;
