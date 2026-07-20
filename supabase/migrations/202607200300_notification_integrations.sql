-- Connect customer-facing support and manual-activation lifecycle changes to
-- the unified notification center. These triggers keep database state as the
-- source of truth regardless of whether a change came from Operations, an Edge
-- Function, or a future admin client.

create or replace function public.notification_after_activation_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  f public.fulfillments%rowtype;
  current_status text;
begin
  select * into f from public.fulfillments where id=new.fulfillment_id;
  if not found or coalesce(f.mode,'')<>'manual_activation' then return new; end if;
  current_status=lower(coalesce(f.status,''));

  if new.sender_role='admin' and current_status not in ('delivered','completed','cancelled','failed') then
    perform public.enqueue_customer_notification(
      case when current_status='awaiting_customer' then 'activation.action_required' else 'activation.admin_message' end,
      f.order_id,
      case when current_status='awaiting_customer' then 'activation_action_required' else 'activation_message' end,
      jsonb_build_object(
        'ar','رسالة جديدة بخصوص تفعيل حسابك',
        'fr','Nouveau message concernant votre activation',
        'en','New message about your activation'
      ),
      jsonb_build_object(
        'ar','أضاف فريق Strivio رسالة جديدة. افتح الطلب لمراجعتها والرد إذا لزم.',
        'fr','L’équipe Strivio a ajouté un message. Ouvrez la commande pour le consulter et répondre si nécessaire.',
        'en','The Strivio team added a message. Open the order to review it and reply if needed.'
      ),
      f.id,null,f.service_id,
      concat('/my-account?order=',f.order_id::text),
      jsonb_build_object('message',new.message),
      true,
      concat('activation.message:',new.id::text)
    );
  elsif new.sender_role='customer' then
    perform public.enqueue_admin_notification(
      'activation.customer_reply','activation_customer_reply',
      jsonb_build_object('ar','رد جديد من العميل على طلب تفعيل','fr','Nouvelle réponse client sur une activation','en','New customer reply on an activation'),
      jsonb_build_object('ar','راجع محادثة التفعيل في مركز العمليات.','fr','Consultez la conversation dans le centre des opérations.','en','Review the activation conversation in Operations.'),
      f.order_id,f.id,null,f.service_id,'/operations',
      jsonb_build_object('message',new.message),false,
      concat('activation.customer_reply:',new.id::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notification_activation_message on public.activation_messages;
create constraint trigger notification_activation_message
after insert on public.activation_messages
deferrable initially deferred
for each row execute function public.notification_after_activation_message();

create or replace function public.notification_after_fulfillment_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  submitted_marker text;
begin
  if coalesce(new.mode,'')<>'manual_activation' then return new; end if;

  if lower(coalesce(new.status,'')) in ('delivered','completed')
     and lower(coalesce(old.status,'')) not in ('delivered','completed') then
    perform public.enqueue_customer_notification(
      'activation.completed',new.order_id,'activation_completed',
      jsonb_build_object('ar','تم تفعيل حسابك بنجاح','fr','Votre compte a été activé','en','Your account has been activated'),
      jsonb_build_object('ar','اكتمل التفعيل وأصبح الطلب جاهزًا. يمكنك الآن متابعة الطلب أو الإبلاغ عن أي مشكلة من حسابك.','fr','L’activation est terminée. Vous pouvez suivre la commande ou signaler un problème depuis votre compte.','en','Activation is complete. You can now follow the order or report an issue from your account.'),
      new.id,null,new.service_id,
      concat('/my-account?order=',new.order_id::text),
      jsonb_build_object(
        'completed_at',coalesce(new.delivered_at,now()),
        'admin_note',coalesce(new.delivery_summary->>'activation_completion_note','')
      ),
      true,
      concat('activation.completed:',new.id::text)
    );
  end if;

  if new.customer_input is distinct from old.customer_input
     and coalesce(new.customer_input,'{}'::jsonb)<>'{}'::jsonb then
    submitted_marker=coalesce(new.customer_input->>'submitted_at',new.updated_at::text,now()::text);
    perform public.enqueue_admin_notification(
      'activation.customer_details','activation_customer_details',
      jsonb_build_object('ar','استلمنا بيانات تفعيل جديدة','fr','Nouvelles informations d’activation','en','New activation details received'),
      jsonb_build_object('ar','أرسل العميل بيانات حسابه. راجعها بأمان من سجل الخدمة.','fr','Le client a envoyé ses informations. Consultez-les dans le registre du service.','en','The customer submitted account details. Review them in the service register.'),
      new.order_id,new.id,null,new.service_id,'/operations',
      jsonb_build_object('submitted_at',submitted_marker),false,
      concat('activation.customer_details:',new.id::text,':',md5(submitted_marker))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notification_fulfillment_change on public.fulfillments;
create trigger notification_fulfillment_change
after update of status,customer_input on public.fulfillments
for each row execute function public.notification_after_fulfillment_change();

create or replace function public.notification_after_problem_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.problem_reports%rowtype;
begin
  select * into p from public.problem_reports where id=new.problem_id;
  if not found then return new; end if;

  if new.sender_role='admin'
     and lower(coalesce(p.status,'')) not in ('resolved','closed','cancelled') then
    perform public.enqueue_customer_notification(
      'problem.admin_reply',p.order_id,'problem_admin_reply',
      jsonb_build_object('ar','رد جديد من فريق الدعم','fr','Nouvelle réponse du support','en','New support reply'),
      jsonb_build_object('ar','أضاف فريق Strivio تحديثًا جديدًا إلى بلاغك.','fr','L’équipe Strivio a ajouté une mise à jour à votre signalement.','en','The Strivio team added an update to your report.'),
      p.fulfillment_id,p.id,p.service_id,
      concat('/my-account?order=',p.order_id::text),
      jsonb_build_object('message',new.message),true,
      concat('problem.admin_reply:',new.id::text)
    );
  elsif new.sender_role='customer' then
    perform public.enqueue_admin_notification(
      'problem.customer_reply','problem_customer_reply',
      jsonb_build_object('ar','رد جديد على بلاغ','fr','Nouvelle réponse sur un signalement','en','New reply on a report'),
      jsonb_build_object('ar','أضاف العميل رسالة جديدة إلى البلاغ.','fr','Le client a ajouté un message au signalement.','en','The customer added a message to the report.'),
      p.order_id,p.fulfillment_id,p.id,p.service_id,'/operations',
      jsonb_build_object('message',new.message),false,
      concat('problem.customer_reply:',new.id::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notification_problem_message on public.problem_messages;
create constraint trigger notification_problem_message
after insert on public.problem_messages
deferrable initially deferred
for each row execute function public.notification_after_problem_message();

create or replace function public.notification_after_problem_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    perform public.enqueue_customer_notification(
      'problem.received',new.order_id,'problem_received',
      jsonb_build_object('ar','تم استلام بلاغك','fr','Votre signalement a été reçu','en','Your report was received'),
      jsonb_build_object('ar','تم تسجيل البلاغ ويمكنك متابعة المحادثة وحالته من حسابك.','fr','Votre signalement est enregistré. Vous pouvez suivre la conversation et son état depuis votre compte.','en','Your report was recorded. You can follow its conversation and status from your account.'),
      new.fulfillment_id,new.id,new.service_id,
      concat('/my-account?order=',new.order_id::text),
      '{}'::jsonb,true,
      concat('problem.received:',new.id::text)
    );
    perform public.enqueue_admin_notification(
      'problem.reported','problem_reported',
      jsonb_build_object('ar','بلاغ جديد من عميل','fr','Nouveau signalement client','en','New customer report'),
      jsonb_build_object('ar','راجع البلاغ الجديد في مركز العمليات.','fr','Consultez le nouveau signalement dans le centre des opérations.','en','Review the new report in Operations.'),
      new.order_id,new.fulfillment_id,new.id,new.service_id,'/operations',
      jsonb_build_object(
        'message',coalesce(to_jsonb(new)->>'message',to_jsonb(new)->>'description','')
      ),false,
      concat('problem.reported:',new.id::text)
    );
  elsif lower(coalesce(new.status,'')) in ('resolved','closed')
        and lower(coalesce(old.status,'')) not in ('resolved','closed') then
    perform public.enqueue_customer_notification(
      'problem.resolved',new.order_id,'problem_resolved',
      jsonb_build_object('ar','تم حل البلاغ','fr','Le signalement a été résolu','en','Your report was resolved'),
      jsonb_build_object('ar','أنهى فريق Strivio معالجة البلاغ. افتح المحادثة للاطلاع على آخر تحديث.','fr','L’équipe Strivio a terminé le traitement. Ouvrez la conversation pour voir la dernière mise à jour.','en','The Strivio team finished handling the report. Open the conversation to see the latest update.'),
      new.fulfillment_id,new.id,new.service_id,
      concat('/my-account?order=',new.order_id::text),
      jsonb_build_object('admin_note',coalesce(new.admin_notes,'')),true,
      concat('problem.resolved:',new.id::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notification_problem_change on public.problem_reports;
create trigger notification_problem_change
after insert or update of status on public.problem_reports
for each row execute function public.notification_after_problem_change();

revoke all on function public.notification_after_activation_message() from public,anon,authenticated;
revoke all on function public.notification_after_fulfillment_change() from public,anon,authenticated;
revoke all on function public.notification_after_problem_message() from public,anon,authenticated;
revoke all on function public.notification_after_problem_change() from public,anon,authenticated;
