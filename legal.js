(function(){
  var lang=localStorage.getItem('strivio_lang')||'fr',doc=document.body.dataset.doc||'terms';
  var content={
    privacy:{
      ar:['سياسة الخصوصية','نحتفظ فقط بالبيانات اللازمة لإنشاء الحساب، معالجة الطلب، التسليم والدعم. لا نبيع بياناتك. معلومات الدفع الحساسة تعالجها بوابة الدفع ولا تُحفظ في المتجر. يمكنك التواصل معنا لطلب تصحيح بياناتك أو حذفها عندما لا يوجد التزام قانوني بالاحتفاظ بها.'],
      fr:['Politique de confidentialité','Nous conservons uniquement les données nécessaires au compte, à la commande, à la livraison et au support. Nous ne vendons pas vos données. Les informations de carte sont traitées par la passerelle de paiement et ne sont pas stockées par Strivio. Vous pouvez demander la correction ou la suppression de vos données lorsque aucune obligation légale ne s’y oppose.'],
      en:['Privacy policy','We keep only the data required for your account, order, delivery, and support. We do not sell your data. Card details are processed by the payment gateway and are not stored by Strivio. You may request correction or deletion where no legal retention duty applies.']},
    terms:{
      ar:['شروط الخدمة','باستخدام المتجر توافق على تقديم معلومات صحيحة، وعدم مشاركة بيانات التسليم أو إساءة استخدام الحسابات. يبدأ الاشتراك من تاريخ التسليم الموضح في طلبك. يمنع تغيير بيانات الحساب العامة أو الإضرار بالمستخدمين الآخرين. مخالفة شروط المنتج قد تؤدي إلى إيقاف الخدمة دون استرداد.'],
      fr:['Conditions de service','En utilisant la boutique, vous acceptez de fournir des informations exactes, de protéger les données livrées et de respecter les règles du produit. L’abonnement commence à la date indiquée dans la commande. Toute modification non autorisée du compte ou nuisance aux autres utilisateurs peut entraîner la suspension sans remboursement.'],
      en:['Terms of service','By using the store, you agree to provide accurate information, protect delivered credentials, and follow each product’s rules. The subscription starts on the date shown in your order. Unauthorized account changes or disruption to other users may lead to suspension without refund.']},
    warranty:{
      ar:['الضمان والتسليم','يشمل الضمان مدة الاشتراك المحددة ما دمت ملتزماً بشروط الاستخدام. عند وجود مشكلة افتح بلاغاً من صفحة حسابي ليظهر سجل المحادثة والحالة. نعالج بيانات الدخول المعطلة أو ننقل الاشتراك عند الحاجة، ولا يشمل الضمان الأعطال الناتجة عن مشاركة الحساب أو تغيير إعداداته المحظورة.'],
      fr:['Garantie et livraison','La garantie couvre la durée affichée tant que les règles d’utilisation sont respectées. En cas de problème, ouvrez un signalement depuis Mon compte pour suivre les échanges et le statut. Nous corrigeons les accès défaillants ou transférons l’abonnement si nécessaire.'],
      en:['Warranty and delivery','Warranty covers the displayed subscription period while usage rules are followed. If an issue occurs, open a report from My Account to track the conversation and status. We repair failed access or transfer the subscription when required.']},
    refund:{
      ar:['سياسة الاسترداد','قبل التسليم يمكن مراجعة طلب الاسترداد بحسب حالة الدفع. بعد تسليم بيانات رقمية صالحة لا يتوفر استرداد لمجرد تغيير الرأي. إذا تعذر توفير الخدمة أو إصلاحها ضمن الضمان، نعرض الاستبدال أو الاسترداد المناسب بعد التحقق من الطلب.'],
      fr:['Politique de remboursement','Avant la livraison, une demande peut être étudiée selon l’état du paiement. Après livraison valide d’un produit numérique, aucun remboursement n’est dû pour simple changement d’avis. Si le service ne peut être fourni ou réparé sous garantie, un remplacement ou remboursement adapté est proposé après vérification.'],
      en:['Refund policy','Before delivery, a refund request may be reviewed according to payment status. Once valid digital access is delivered, change-of-mind refunds are unavailable. If service cannot be supplied or repaired under warranty, an appropriate replacement or refund is offered after verification.']}
  };
  var t=(content[doc]||content.terms)[lang]||(content[doc]||content.terms).fr;
  document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
  document.title='Strivio — '+t[0];document.getElementById('legal-title').textContent=t[0];document.getElementById('legal-copy').textContent=t[1];
})();
