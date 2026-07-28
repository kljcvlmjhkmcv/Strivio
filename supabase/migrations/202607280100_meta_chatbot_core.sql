-- Strivio Meta chatbot: private conversation ledger, editable knowledge base,
-- and safe operational settings. Provider secrets stay in Edge Function secrets.

create table if not exists public.chatbot_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  auto_reply_enabled boolean not null default true,
  ai_enabled boolean not null default true,
  provider text not null default 'gemini'
    check (provider in ('gemini', 'rules')),
  default_locale text not null default 'fr'
    check (default_locale in ('ar', 'fr', 'en', 'dz')),
  human_handoff_message jsonb not null default jsonb_build_object(
    'ar', 'وصلت رسالتك لفريق Strivio، وسيرد عليك أحد أفراد الفريق قريبًا.',
    'fr', 'Votre message a été transmis à l’équipe Strivio. Un conseiller vous répondra bientôt.',
    'en', 'Your message was sent to the Strivio team. A team member will reply soon.',
    'dz', 'Wassletna risaltek. L’équipe Strivio traja3lek قريبًا.'
  ),
  updated_at timestamptz not null default now()
);

insert into public.chatbot_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.chatbot_knowledge (
  id uuid primary key default gen_random_uuid(),
  knowledge_key text not null unique,
  category text not null default 'general',
  questions jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  keywords text[] not null default '{}'::text[],
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chatbot_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null
    check (channel in ('messenger', 'instagram', 'whatsapp', 'test')),
  channel_account_id text not null default '',
  external_user_id text not null,
  external_thread_id text,
  display_name text,
  locale text not null default 'fr'
    check (locale in ('ar', 'fr', 'en', 'dz')),
  mode text not null default 'bot'
    check (mode in ('bot', 'human', 'paused', 'closed')),
  handoff_reason text,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, channel_account_id, external_user_id)
);

create table if not exists public.chatbot_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.chatbot_conversations(id) on delete cascade,
  provider_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_role text not null check (sender_role in ('customer', 'bot', 'admin', 'system')),
  message_text text not null,
  normalized_text text,
  locale text check (locale in ('ar', 'fr', 'en', 'dz')),
  intent text,
  confidence numeric(4, 3)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reply_source text
    check (reply_source is null or reply_source in ('rules', 'gemini', 'admin', 'system')),
  delivery_status text not null default 'received'
    check (delivery_status in ('received', 'queued', 'sent', 'delivered', 'failed', 'ignored')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists chatbot_messages_provider_id_uq
  on public.chatbot_messages(provider_message_id)
  where provider_message_id is not null and provider_message_id <> '';

create index if not exists chatbot_messages_conversation_created_idx
  on public.chatbot_messages(conversation_id, created_at desc);

create index if not exists chatbot_conversations_last_inbound_idx
  on public.chatbot_conversations(last_inbound_at desc nulls last);

create table if not exists public.chatbot_unanswered (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.chatbot_conversations(id) on delete set null,
  message_id uuid references public.chatbot_messages(id) on delete set null,
  message_text text not null,
  normalized_text text,
  locale text,
  reason text not null default 'unknown_intent',
  resolved boolean not null default false,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists chatbot_unanswered_open_idx
  on public.chatbot_unanswered(created_at desc)
  where resolved = false;

create or replace function public.chatbot_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chatbot_settings_touch on public.chatbot_settings;
create trigger chatbot_settings_touch
before update on public.chatbot_settings
for each row execute function public.chatbot_touch_updated_at();

drop trigger if exists chatbot_knowledge_touch on public.chatbot_knowledge;
create trigger chatbot_knowledge_touch
before update on public.chatbot_knowledge
for each row execute function public.chatbot_touch_updated_at();

drop trigger if exists chatbot_conversations_touch on public.chatbot_conversations;
create trigger chatbot_conversations_touch
before update on public.chatbot_conversations
for each row execute function public.chatbot_touch_updated_at();

alter table public.chatbot_settings enable row level security;
alter table public.chatbot_knowledge enable row level security;
alter table public.chatbot_conversations enable row level security;
alter table public.chatbot_messages enable row level security;
alter table public.chatbot_unanswered enable row level security;

drop policy if exists chatbot_settings_admin on public.chatbot_settings;
create policy chatbot_settings_admin on public.chatbot_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists chatbot_knowledge_admin on public.chatbot_knowledge;
create policy chatbot_knowledge_admin on public.chatbot_knowledge
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists chatbot_conversations_admin on public.chatbot_conversations;
create policy chatbot_conversations_admin on public.chatbot_conversations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists chatbot_messages_admin on public.chatbot_messages;
create policy chatbot_messages_admin on public.chatbot_messages
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists chatbot_unanswered_admin on public.chatbot_unanswered;
create policy chatbot_unanswered_admin on public.chatbot_unanswered
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.chatbot_settings from anon;
revoke all on public.chatbot_knowledge from anon;
revoke all on public.chatbot_conversations from anon;
revoke all on public.chatbot_messages from anon;
revoke all on public.chatbot_unanswered from anon;

grant select, insert, update, delete on public.chatbot_settings to authenticated;
grant select, insert, update, delete on public.chatbot_knowledge to authenticated;
grant select, insert, update, delete on public.chatbot_conversations to authenticated;
grant select, insert, update, delete on public.chatbot_messages to authenticated;
grant select, insert, update, delete on public.chatbot_unanswered to authenticated;

insert into public.chatbot_knowledge
  (knowledge_key, category, questions, answers, keywords, priority, active)
values
  (
    'payment_methods',
    'sales',
    jsonb_build_object(
      'ar', jsonb_build_array('كيف أدفع؟', 'ما هي طرق الدفع؟'),
      'fr', jsonb_build_array('Comment payer ?', 'Quels sont les moyens de paiement ?'),
      'en', jsonb_build_array('How can I pay?', 'What payment methods do you accept?'),
      'dz', jsonb_build_array('kifach nkhalles', 'win nkhalles', 'paiement kifach')
    ),
    jsonb_build_object(
      'ar', 'اختر المنتج ثم أضفه للسلة. ستظهر لك طرق الدفع المتاحة حاليًا قبل تأكيد الطلب.',
      'fr', 'Choisissez le produit et ajoutez-le au panier. Les moyens de paiement disponibles apparaîtront avant la confirmation.',
      'en', 'Choose the product and add it to your cart. Available payment methods will appear before confirmation.',
      'dz', 'Khayyer le produit w zidou panier. طرق الدفع المتاحة يبانولك قبل تأكيد الطلب.'
    ),
    array['payment','paiement','payer','pay','نخلص','الدفع','khalas','nkhalles','baridimob'],
    20,
    true
  ),
  (
    'delivery',
    'sales',
    jsonb_build_object(
      'ar', jsonb_build_array('متى يصل الطلب؟', 'هل التسليم فوري؟'),
      'fr', jsonb_build_array('La livraison est-elle instantanée ?', 'Quand vais-je recevoir ma commande ?'),
      'en', jsonb_build_array('Is delivery instant?', 'When will I receive my order?'),
      'dz', jsonb_build_array('wa9tach yji compte', 'livraison direct')
    ),
    jsonb_build_object(
      'ar', 'يعتمد التسليم على نوع الخدمة. الخدمات الآلية تُسلّم بعد تأكيد الدفع، أما خدمات التفعيل اليدوي فيتابعها فريق Strivio.',
      'fr', 'La livraison dépend du service. Les produits automatiques sont livrés après confirmation du paiement; les activations manuelles sont traitées par Strivio.',
      'en', 'Delivery depends on the service. Automatic products are delivered after payment confirmation; manual activations are handled by Strivio.',
      'dz', 'Livraison 3la 7sab service: automatique بعد تأكيد الدفع، والتفعيل اليدوي يكملو فريق Strivio.'
    ),
    array['delivery','livraison','تسليم','يوصل','instant','direct','wa9tach'],
    30,
    true
  ),
  (
    'order_privacy',
    'security',
    jsonb_build_object(
      'ar', jsonb_build_array('أين طلبي؟', 'أعطني معلومات حسابي'),
      'fr', jsonb_build_array('Où est ma commande ?', 'Donnez-moi les informations de mon compte'),
      'en', jsonb_build_array('Where is my order?', 'Give me my account credentials'),
      'dz', jsonb_build_array('win commande ta3i', 'madabik compte ta3i')
    ),
    jsonb_build_object(
      'ar', 'لحماية حسابك لا نرسل معلومات الطلب الحساسة في رسائل التواصل. افتح حسابك في Strivio لمتابعة الطلب وعرض تفاصيله.',
      'fr', 'Pour votre sécurité, nous ne partageons pas les informations sensibles de commande dans la messagerie. Ouvrez votre compte Strivio pour suivre la commande.',
      'en', 'For your security, we do not share sensitive order details in social messages. Open your Strivio account to track and view the order.',
      'dz', 'Bach نحمي حسابك، معلومات الطلب الحساسة ما نبعثوهاش هنا. ادخل لحسابك Strivio وشوف الطلب.'
    ),
    array['order','commande','طلب','حسابي','account','credentials','login'],
    10,
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

