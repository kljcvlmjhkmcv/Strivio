-- Conversion-focused chatbot controls. The values remain conservative enough
-- for Meta abuse protection while allowing customers to send natural message
-- bursts without losing context.

alter table public.chatbot_settings
  add column if not exists ten_minute_limit integer not null default 60,
  add column if not exists debounce_ms integer not null default 2500,
  add column if not exists typing_enabled boolean not null default true,
  add column if not exists max_clarifying_questions integer not null default 2,
  add column if not exists reply_char_limit integer not null default 650,
  add column if not exists allow_strivio_links boolean not null default true,
  add column if not exists conversion_tracking_enabled boolean not null default true,
  add column if not exists campaign_attribution_enabled boolean not null default true,
  add column if not exists website_pitch_ab_enabled boolean not null default true;

alter table public.chatbot_settings
  alter column burst_limit_per_minute set default 15,
  alter column max_followups_per_conversation set default 2;

-- Move untouched legacy defaults to the new recommended values without
-- overwriting any deliberate administrator customisation.
update public.chatbot_settings
set burst_limit_per_minute = 15
where burst_limit_per_minute = 6;

update public.chatbot_settings
set max_followups_per_conversation = 2
where max_followups_per_conversation = 1;

alter table public.chatbot_settings
  drop constraint if exists chatbot_settings_burst_limit_check,
  add constraint chatbot_settings_burst_limit_check
    check (burst_limit_per_minute between 3 and 60),
  drop constraint if exists chatbot_settings_ten_minute_limit_check,
  add constraint chatbot_settings_ten_minute_limit_check
    check (ten_minute_limit between 20 and 600),
  drop constraint if exists chatbot_settings_debounce_ms_check,
  add constraint chatbot_settings_debounce_ms_check
    check (debounce_ms between 500 and 5000),
  drop constraint if exists chatbot_settings_clarifying_questions_check,
  add constraint chatbot_settings_clarifying_questions_check
    check (max_clarifying_questions between 0 and 5),
  drop constraint if exists chatbot_settings_reply_char_limit_check,
  add constraint chatbot_settings_reply_char_limit_check
    check (reply_char_limit between 200 and 1900);

-- Persist lightweight sales attribution separately from short-term memory so
-- Operations can report a stable funnel without exposing customer credentials.
alter table public.chatbot_conversations
  add column if not exists sales_stage text not null default 'exploring',
  add column if not exists lead_source text,
  add column if not exists campaign_metadata jsonb not null default '{}'::jsonb,
  add column if not exists conversion_route text,
  add column if not exists converted_at timestamptz;

alter table public.chatbot_unanswered
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.chatbot_conversations
  drop constraint if exists chatbot_conversations_sales_stage_check,
  add constraint chatbot_conversations_sales_stage_check
    check (sales_stage in (
      'exploring',
      'qualifying',
      'offered',
      'ready_to_buy',
      'website',
      'manual',
      'handoff',
      'won',
      'lost'
    )),
  drop constraint if exists chatbot_conversations_conversion_route_check,
  add constraint chatbot_conversations_conversion_route_check
    check (
      conversion_route is null
      or conversion_route in ('website', 'manual', 'human')
    );

create index if not exists chatbot_conversations_sales_stage_idx
  on public.chatbot_conversations(sales_stage, updated_at desc);

create index if not exists chatbot_conversations_converted_at_idx
  on public.chatbot_conversations(converted_at desc)
  where converted_at is not null;

insert into public.chatbot_knowledge
  (knowledge_key, category, questions, answers, keywords, priority, active)
values
  (
    'full_subscription_warranty',
    'policy',
    jsonb_build_object(
      'ar', jsonb_build_array('هل المنتجات مضمونة؟', 'ماذا يحدث إذا ضاع الاشتراك؟'),
      'fr', jsonb_build_array('Est-ce que les produits sont garantis ?', 'Que se passe-t-il en cas de problème ?'),
      'en', jsonb_build_array('Are subscriptions guaranteed?', 'What happens if the service stops working?'),
      'dz', jsonb_build_array('kayen garantie', 'ila sra problème t3awdouli')
    ),
    jsonb_build_object(
      'ar', 'كل منتجات Strivio مضمونة طوال مدة الاشتراك المدفوعة. عند حدوث مشكلة غير ناتجة عن مخالفة شروط الاستخدام نقوم بالإصلاح أو الاستبدال أولًا، وإذا تعذر ذلك نعوض المدة المتبقية بخدمة مكافئة.',
      'fr', 'Tous les produits Strivio sont garantis pendant toute la durée payée. En cas de problème non causé par une violation des conditions, nous réparons ou remplaçons le service; si cela est impossible, la durée restante est compensée par un service équivalent.',
      'en', 'Every Strivio product is covered for the full paid term. For issues not caused by a terms violation, we repair or replace the service first; if that is impossible, the remaining term is compensated with an equivalent service.',
      'dz', 'Ga3 les produits Strivio مضمونين طول المدة المدفوعة. إذا صرات مشكلة ماشي بسبب مخالفة الشروط، نصلحو أو نعوضو الخدمة أولًا، وإذا ما قدرناش نعوضولك المدة الباقية بخدمة مكافئة.'
    ),
    array[
      'ضمان','مضمون','تعويض','استبدال','مشكلة','ضاع',
      'garantie','garanti','compensation','remplacement',
      'warranty','guarantee','replace','problem'
    ],
    5,
    true
  ),
  (
    'website_checkout_benefits',
    'sales',
    jsonb_build_object(
      'ar', jsonb_build_array('لماذا أشتري من الموقع؟', 'هل يمكن الدفع بالبطاقة الذهبية؟'),
      'fr', jsonb_build_array('Pourquoi commander sur le site ?', 'Puis-je payer avec Edahabia ou CIB ?'),
      'en', jsonb_build_array('Why should I order on the website?', 'Can I pay with Edahabia or CIB?'),
      'dz', jsonb_build_array('3lach nechri men site', 'n9dar nkhalles b dahabia')
    ),
    jsonb_build_object(
      'ar', 'الموقع هو المسار الأسرع والأكثر تنظيمًا: يدعم البطاقة الذهبية وCIB عبر SATIM، ويعرض العروض والكوبونات، وتتبع الطلب، والدعم، والتجديد من حساب العميل. ويمكن أيضًا إكمال الطلب يدويًا داخل المحادثة.',
      'fr', 'Le site est le parcours le plus rapide et organisé: paiement Edahabia ou CIB via SATIM, offres et coupons, suivi, support et renouvellement depuis le compte. La commande manuelle dans le chat reste disponible.',
      'en', 'The website is the fastest and most organized path: Edahabia or CIB through SATIM, offers and coupons, tracking, support, and renewals from the customer account. Manual chat ordering remains available.',
      'dz', 'الموقع هو الطريق الأسرع والمنظم: تخلص بـ Edahabia ولا CIB عبر SATIM، وتشوف العروض والكوبونات وتتبع الطلب والتجديد من حسابك. وتقدر تكمل يدويًا هنا ثاني.'
    ),
    array[
      'الموقع','البطاقة الذهبية','الذهبية','cib','satim',
      'site','website','edahabia','dahabia','checkout'
    ],
    8,
    true
  )
on conflict (knowledge_key) do update
set category = excluded.category,
    questions = excluded.questions,
    answers = excluded.answers,
    keywords = excluded.keywords,
    priority = excluded.priority,
    active = excluded.active,
    updated_at = now();
