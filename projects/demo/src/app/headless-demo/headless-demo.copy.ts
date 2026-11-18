import {
  resolveEffectiveLocale,
  type EasyPaymentsLocale,
  type EasyPaymentsResolvedLocale,
} from '@easy-payments/angular';

/**
 * Merchant-owned Headless demo chrome (not library checkout strings).
 * English is canonical; es / pt / fr implement the same keys.
 */
export interface HeadlessDemoCopy {
  ariaLabel: string;
  kicker: string;
  title: string;
  lede: string;
  productHeading: string;
  quantityLabel: string;
  checkoutIdentity: string;
  runtimeSessionId: string;
  sessionState: string;
  selectedMethod: string;
  noneSelected: string;
  recoveringReturn: string;
  initializingSession: string;
  paymentProcessing: string;
  retryInitialize: string;
  retryInitializeAria: string;
  retryRecoverReturn: string;
  retryRecoverReturnAria: string;
  applyPendingConfiguration: string;
  applyPendingConfigurationAria: string;
  lastErrorPrefix: string;
  lastResultPrefix: string;
  authorizationOnly: string;
  pendingNote: string;
  fulfillmentNote: string;
  paymentMethodsHeading: string;
  paymentMethodsHint: string;
  noMethodsAvailable: string;
  available: string;
  unavailable: string;
  readinessReady: string;
  readinessLoading: string;
  readinessUnavailable: string;
  readinessMisconfigured: string;
  officialButton: string;
  merchantConfirm: string;
  providerMeta: string;
  interactionMeta: string;
  mockMeta: string;
  providerSurfaceHeading: string;
  mountIdle: string;
  mounting: string;
  confirmHint: string;
  officialButtonHint: string;
  processingCta: string;
  continueWithKlarna: string;
  continueWithAffirm: string;
  lifecycleEventsHeading: string;
  lifecycleEmpty: string;
  mountAriaGeneric: string;
  mountAriaForMethod: string;
  reasonApplePayLoading: string;
  reasonStillChecking: string;
  reasonMisconfigured: string;
  reasonNotAvailable: string;
  configSkipInFlight: string;
  mountNoticeOfficial: string;
  recoveryUnrelated: string;
  recoveryRetryable: string;
}

const EN: HeadlessDemoCopy = {
  ariaLabel: 'Headless Checkout demo',
  kicker: 'Merchant-owned UI',
  title: 'Headless Checkout',
  lede:
    'Mount official provider UI, confirm Card/Klarna/Affirm via the public session API, use official PayPal / Google Pay / Apple Pay controls, and recover Klarna/Affirm returns with recoverReturn(). Frontend outcomes are not authoritative fulfillment — use backend / webhooks.',
  productHeading: 'Product',
  quantityLabel: 'qty',
  checkoutIdentity: 'Checkout identity',
  runtimeSessionId: 'Runtime session id',
  sessionState: 'Session state',
  selectedMethod: 'Selected method',
  noneSelected: 'none',
  recoveringReturn: 'Recovering Klarna/Affirm return…',
  initializingSession: 'Initializing Headless session…',
  paymentProcessing: 'Payment processing…',
  retryInitialize: 'Retry initialize',
  retryInitializeAria: 'Retry Headless session initialize',
  retryRecoverReturn: 'Retry recoverReturn',
  retryRecoverReturnAria: 'Retry Klarna or Affirm return recovery without confirming again',
  applyPendingConfiguration: 'Apply pending configuration',
  applyPendingConfigurationAria: 'Apply pending Headless checkout configuration',
  lastErrorPrefix: 'Last error:',
  lastResultPrefix: 'Last result:',
  authorizationOnly:
    'Authorization only — funds are not captured. Confirm capture/fulfillment on your backend.',
  pendingNote:
    'Pending / processing — not success. Do not retry a charge; verify via backend/webhooks.',
  fulfillmentNote: 'Demo UI outcomes are not authoritative fulfillment.',
  paymentMethodsHeading: 'Payment methods',
  paymentMethodsHint:
    'Card / Klarna / Affirm mount a Payment Element and use the merchant Pay control. PayPal / Venmo / Google Pay / Apple Pay / Zip mount official provider buttons (buyer click starts payment).',
  noMethodsAvailable: 'No methods reported available for the current configuration.',
  available: 'available',
  unavailable: 'unavailable',
  readinessReady: 'ready',
  readinessLoading: 'loading',
  readinessUnavailable: 'unavailable',
  readinessMisconfigured: 'misconfigured',
  officialButton: 'Official button',
  merchantConfirm: 'Merchant confirm',
  providerMeta: 'provider',
  interactionMeta: 'interaction',
  mockMeta: 'mock',
  providerSurfaceHeading: 'Provider surface',
  mountIdle: 'Select a payment method to mount its official UI here.',
  mounting: 'Mounting provider UI…',
  confirmHint: 'Calls public session.confirm() for the selected Stripe method only.',
  officialButtonHint:
    'Official provider control is mounted above. Payment starts only from that control — not from a demo-owned Pay button.',
  processingCta: 'Processing…',
  continueWithKlarna: 'Continue with Klarna',
  continueWithAffirm: 'Continue with Affirm',
  lifecycleEventsHeading: 'Lifecycle events',
  lifecycleEmpty: 'No Headless lifecycle events yet.',
  mountAriaGeneric: 'Official provider mount',
  mountAriaForMethod: 'Official provider mount for {{method}}',
  reasonApplePayLoading:
    'Apple Pay eligibility is confirmed after mounting the Express Checkout Element.',
  reasonStillChecking: 'Still checking provider availability.',
  reasonMisconfigured: 'Provider configuration is incomplete for this method.',
  reasonNotAvailable: 'Not available in the current browser / provider configuration.',
  configSkipInFlight:
    'Checkout configuration changed while a payment or return recovery is in progress. Apply the pending update after this attempt settles — do not replace an active payment.',
  mountNoticeOfficial:
    'Use the official provider control above to pay. The demo never calls confirm() for PayPal, Venmo, Google Pay, Apple Pay, or Zip.',
  recoveryUnrelated:
    'No Headless-owned return for this checkout identity (unrelated or absent). Other checkout modes were not claimed.',
  recoveryRetryable:
    'Transient verification failure. Pending return data was preserved — retry recoverReturn() without confirming again or creating a new PaymentIntent.',
};

const ES: HeadlessDemoCopy = {
  ...EN,
  ariaLabel: 'Demo de Headless Checkout',
  kicker: 'UI del comercio',
  title: 'Headless Checkout',
  lede:
    'Monte la UI oficial del proveedor, confirme Card/Klarna/Affirm con la API pública de sesión, use los controles oficiales de PayPal / Google Pay / Apple Pay y recupere retornos de Klarna/Affirm con recoverReturn(). Los resultados del frontend no son fulfillment — use backend / webhooks.',
  productHeading: 'Producto',
  quantityLabel: 'cant.',
  checkoutIdentity: 'Identidad del checkout',
  runtimeSessionId: 'Id de sesión en tiempo de ejecución',
  sessionState: 'Estado de la sesión',
  selectedMethod: 'Método seleccionado',
  noneSelected: 'ninguno',
  recoveringReturn: 'Recuperando el retorno de Klarna/Affirm…',
  initializingSession: 'Inicializando la sesión Headless…',
  paymentProcessing: 'Procesando el pago…',
  retryInitialize: 'Reintentar initialize',
  retryInitializeAria: 'Reintentar la inicialización de la sesión Headless',
  retryRecoverReturn: 'Reintentar recoverReturn',
  retryRecoverReturnAria:
    'Reintentar la recuperación del retorno de Klarna o Affirm sin confirmar de nuevo',
  applyPendingConfiguration: 'Aplicar configuración pendiente',
  applyPendingConfigurationAria: 'Aplicar la configuración pendiente del checkout Headless',
  lastErrorPrefix: 'Último error:',
  lastResultPrefix: 'Último resultado:',
  authorizationOnly:
    'Solo autorización — los fondos no están capturados. Confirme la captura/fulfillment en su backend.',
  pendingNote:
    'Pendiente / en proceso — no es success. No reintente el cargo; verifique vía backend/webhooks.',
  fulfillmentNote: 'Los resultados de la UI demo no son fulfillment autoritativo.',
  paymentMethodsHeading: 'Métodos de pago',
  paymentMethodsHint:
    'Card / Klarna / Affirm montan un Payment Element y usan el control Pay del comercio. PayPal / Venmo / Google Pay / Apple Pay / Zip montan botones oficiales del proveedor (el clic del comprador inicia el pago).',
  noMethodsAvailable: 'No hay métodos disponibles para la configuración actual.',
  available: 'disponible',
  unavailable: 'no disponible',
  readinessReady: 'listo',
  readinessLoading: 'cargando',
  readinessUnavailable: 'no disponible',
  readinessMisconfigured: 'mal configurado',
  officialButton: 'Botón oficial',
  merchantConfirm: 'Confirmación del comercio',
  providerMeta: 'proveedor',
  interactionMeta: 'interacción',
  mockMeta: 'mock',
  providerSurfaceHeading: 'Superficie del proveedor',
  mountIdle: 'Seleccione un método de pago para montar aquí su UI oficial.',
  mounting: 'Montando la UI del proveedor…',
  confirmHint: 'Llama a session.confirm() público solo para el método Stripe seleccionado.',
  officialButtonHint:
    'El control oficial del proveedor está montado arriba. El pago solo comienza desde ese control — no desde un botón Pay de la demo.',
  processingCta: 'Procesando…',
  continueWithKlarna: 'Continuar con Klarna',
  continueWithAffirm: 'Continuar con Affirm',
  lifecycleEventsHeading: 'Eventos del ciclo de vida',
  lifecycleEmpty: 'Aún no hay eventos del ciclo de vida Headless.',
  mountAriaGeneric: 'Montaje del proveedor oficial',
  mountAriaForMethod: 'Montaje del proveedor oficial para {{method}}',
  reasonApplePayLoading:
    'La elegibilidad de Apple Pay se confirma tras montar el Express Checkout Element.',
  reasonStillChecking: 'Aún se comprueba la disponibilidad del proveedor.',
  reasonMisconfigured: 'La configuración del proveedor está incompleta para este método.',
  reasonNotAvailable: 'No disponible en el navegador / configuración del proveedor actuales.',
  configSkipInFlight:
    'La configuración del checkout cambió mientras un pago o recuperación de retorno está en curso. Aplique la actualización pendiente cuando este intento termine — no reemplace un pago activo.',
  mountNoticeOfficial:
    'Use el control oficial del proveedor de arriba para pagar. La demo nunca llama a confirm() para PayPal, Venmo, Google Pay, Apple Pay o Zip.',
  recoveryUnrelated:
    'No hay un retorno Headless de esta identidad de checkout (ajeno o ausente). No se reclamaron otros modos de checkout.',
  recoveryRetryable:
    'Fallo transitorio de verificación. Se conservaron los datos del retorno pendiente — reintente recoverReturn() sin confirmar de nuevo ni crear un PaymentIntent nuevo.',
};

const PT: HeadlessDemoCopy = {
  ...EN,
  ariaLabel: 'Demo do Headless Checkout',
  kicker: 'UI do lojista',
  title: 'Headless Checkout',
  lede:
    'Monte a UI oficial do provedor, confirme Card/Klarna/Affirm pela API pública da sessão, use os controles oficiais do PayPal / Google Pay / Apple Pay e recupere retornos Klarna/Affirm com recoverReturn(). Resultados do frontend não são fulfillment — use backend / webhooks.',
  productHeading: 'Produto',
  quantityLabel: 'qtd.',
  checkoutIdentity: 'Identidade do checkout',
  runtimeSessionId: 'Id da sessão em tempo de execução',
  sessionState: 'Estado da sessão',
  selectedMethod: 'Método selecionado',
  noneSelected: 'nenhum',
  recoveringReturn: 'Recuperando retorno Klarna/Affirm…',
  initializingSession: 'Inicializando sessão Headless…',
  paymentProcessing: 'Processando pagamento…',
  retryInitialize: 'Tentar initialize de novo',
  retryInitializeAria: 'Tentar novamente a inicialização da sessão Headless',
  retryRecoverReturn: 'Tentar recoverReturn de novo',
  retryRecoverReturnAria:
    'Tentar novamente a recuperação do retorno Klarna ou Affirm sem confirmar de novo',
  applyPendingConfiguration: 'Aplicar configuração pendente',
  applyPendingConfigurationAria: 'Aplicar a configuração pendente do checkout Headless',
  lastErrorPrefix: 'Último erro:',
  lastResultPrefix: 'Último resultado:',
  authorizationOnly:
    'Somente autorização — os fundos não foram capturados. Confirme a captura/fulfillment no seu backend.',
  pendingNote:
    'Pendente / em processamento — não é success. Não tente o cobro de novo; verifique via backend/webhooks.',
  fulfillmentNote: 'Os resultados da UI demo não são fulfillment autoritativo.',
  paymentMethodsHeading: 'Métodos de pagamento',
  paymentMethodsHint:
    'Card / Klarna / Affirm montam um Payment Element e usam o controle Pay do lojista. PayPal / Venmo / Google Pay / Apple Pay / Zip montam botões oficiais do provedor (o clique do comprador inicia o pagamento).',
  noMethodsAvailable: 'Nenhum método disponível para a configuração atual.',
  available: 'disponível',
  unavailable: 'indisponível',
  readinessReady: 'pronto',
  readinessLoading: 'carregando',
  readinessUnavailable: 'indisponível',
  readinessMisconfigured: 'mal configurado',
  officialButton: 'Botão oficial',
  merchantConfirm: 'Confirmação do lojista',
  providerMeta: 'provedor',
  interactionMeta: 'interação',
  mockMeta: 'mock',
  providerSurfaceHeading: 'Superfície do provedor',
  mountIdle: 'Selecione um método de pagamento para montar a UI oficial aqui.',
  mounting: 'Montando a UI do provedor…',
  confirmHint: 'Chama session.confirm() público apenas para o método Stripe selecionado.',
  officialButtonHint:
    'O controle oficial do provedor está montado acima. O pagamento só começa nesse controle — não em um botão Pay da demo.',
  processingCta: 'Processando…',
  continueWithKlarna: 'Continuar com Klarna',
  continueWithAffirm: 'Continuar com Affirm',
  lifecycleEventsHeading: 'Eventos do ciclo de vida',
  lifecycleEmpty: 'Ainda não há eventos do ciclo de vida Headless.',
  mountAriaGeneric: 'Montagem do provedor oficial',
  mountAriaForMethod: 'Montagem do provedor oficial para {{method}}',
  reasonApplePayLoading:
    'A elegibilidade do Apple Pay é confirmada após montar o Express Checkout Element.',
  reasonStillChecking: 'Ainda verificando a disponibilidade do provedor.',
  reasonMisconfigured: 'A configuração do provedor está incompleta para este método.',
  reasonNotAvailable: 'Indisponível no navegador / configuração do provedor atuais.',
  configSkipInFlight:
    'A configuração do checkout mudou enquanto um pagamento ou recuperação de retorno está em andamento. Aplique a atualização pendente depois que esta tentativa terminar — não substitua um pagamento ativo.',
  mountNoticeOfficial:
    'Use o controle oficial do provedor acima para pagar. A demo nunca chama confirm() para PayPal, Venmo, Google Pay, Apple Pay ou Zip.',
  recoveryUnrelated:
    'Nenhum retorno Headless desta identidade de checkout (não relacionado ou ausente). Outros modos de checkout não foram reivindicados.',
  recoveryRetryable:
    'Falha transitória de verificação. Os dados do retorno pendente foram preservados — tente recoverReturn() de novo sem confirmar novamente nem criar um novo PaymentIntent.',
};

const FR: HeadlessDemoCopy = {
  ...EN,
  ariaLabel: 'Démo Headless Checkout',
  kicker: 'UI du commerçant',
  title: 'Headless Checkout',
  lede:
    'Montez l’UI officielle du fournisseur, confirmez Card/Klarna/Affirm via l’API publique de session, utilisez les contrôles officiels PayPal / Google Pay / Apple Pay, et récupérez les retours Klarna/Affirm avec recoverReturn(). Les résultats frontend ne sont pas un fulfillment — utilisez le backend / les webhooks.',
  productHeading: 'Produit',
  quantityLabel: 'qté',
  checkoutIdentity: 'Identité du checkout',
  runtimeSessionId: 'Id de session d’exécution',
  sessionState: 'État de la session',
  selectedMethod: 'Méthode sélectionnée',
  noneSelected: 'aucune',
  recoveringReturn: 'Récupération du retour Klarna/Affirm…',
  initializingSession: 'Initialisation de la session Headless…',
  paymentProcessing: 'Traitement du paiement…',
  retryInitialize: 'Réessayer initialize',
  retryInitializeAria: 'Réessayer l’initialisation de la session Headless',
  retryRecoverReturn: 'Réessayer recoverReturn',
  retryRecoverReturnAria:
    'Réessayer la récupération du retour Klarna ou Affirm sans confirmer à nouveau',
  applyPendingConfiguration: 'Appliquer la configuration en attente',
  applyPendingConfigurationAria: 'Appliquer la configuration Headless en attente',
  lastErrorPrefix: 'Dernière erreur :',
  lastResultPrefix: 'Dernier résultat :',
  authorizationOnly:
    'Autorisation uniquement — les fonds ne sont pas capturés. Confirmez la capture/fulfillment côté backend.',
  pendingNote:
    'En attente / en cours — ce n’est pas un succès. Ne retentez pas le débit ; vérifiez via backend/webhooks.',
  fulfillmentNote: 'Les résultats de l’UI démo ne sont pas un fulfillment faisant autorité.',
  paymentMethodsHeading: 'Moyens de paiement',
  paymentMethodsHint:
    'Card / Klarna / Affirm montent un Payment Element et utilisent le contrôle Pay du commerçant. PayPal / Venmo / Google Pay / Apple Pay / Zip montent les boutons officiels du fournisseur (le clic de l’acheteur démarre le paiement).',
  noMethodsAvailable: 'Aucun moyen de paiement disponible pour la configuration actuelle.',
  available: 'disponible',
  unavailable: 'indisponible',
  readinessReady: 'prêt',
  readinessLoading: 'chargement',
  readinessUnavailable: 'indisponible',
  readinessMisconfigured: 'mal configuré',
  officialButton: 'Bouton officiel',
  merchantConfirm: 'Confirmation commerçant',
  providerMeta: 'fournisseur',
  interactionMeta: 'interaction',
  mockMeta: 'mock',
  providerSurfaceHeading: 'Surface du fournisseur',
  mountIdle: 'Sélectionnez un moyen de paiement pour monter son UI officielle ici.',
  mounting: 'Montage de l’UI du fournisseur…',
  confirmHint: 'Appelle session.confirm() public uniquement pour la méthode Stripe sélectionnée.',
  officialButtonHint:
    'Le contrôle officiel du fournisseur est monté ci-dessus. Le paiement ne démarre que depuis ce contrôle — pas depuis un bouton Pay de la démo.',
  processingCta: 'Traitement…',
  continueWithKlarna: 'Continuer avec Klarna',
  continueWithAffirm: 'Continuer avec Affirm',
  lifecycleEventsHeading: 'Événements du cycle de vie',
  lifecycleEmpty: 'Aucun événement du cycle de vie Headless pour le moment.',
  mountAriaGeneric: 'Montage du fournisseur officiel',
  mountAriaForMethod: 'Montage du fournisseur officiel pour {{method}}',
  reasonApplePayLoading:
    'L’éligibilité Apple Pay est confirmée après le montage de l’Express Checkout Element.',
  reasonStillChecking: 'Vérification de la disponibilité du fournisseur en cours.',
  reasonMisconfigured: 'La configuration du fournisseur est incomplète pour cette méthode.',
  reasonNotAvailable:
    'Indisponible dans le navigateur / la configuration fournisseur actuels.',
  configSkipInFlight:
    'La configuration du checkout a changé pendant un paiement ou une récupération de retour. Appliquez la mise à jour en attente une fois cette tentative terminée — ne remplacez pas un paiement actif.',
  mountNoticeOfficial:
    'Utilisez le contrôle officiel du fournisseur ci-dessus pour payer. La démo n’appelle jamais confirm() pour PayPal, Venmo, Google Pay, Apple Pay ou Zip.',
  recoveryUnrelated:
    'Aucun retour Headless pour cette identité de checkout (sans rapport ou absent). Les autres modes de checkout n’ont pas été revendiqués.',
  recoveryRetryable:
    'Échec de vérification transitoire. Les données de retour en attente ont été conservées — réessayez recoverReturn() sans confirmer à nouveau ni créer un nouveau PaymentIntent.',
};

const DICTIONARIES: Record<EasyPaymentsResolvedLocale, HeadlessDemoCopy> = {
  en: EN,
  es: ES,
  pt: PT,
  fr: FR,
};

export function resolveHeadlessDemoCopy(
  locale: EasyPaymentsLocale | string | null | undefined,
): HeadlessDemoCopy {
  return DICTIONARIES[resolveEffectiveLocale(locale)] ?? EN;
}

export function headlessDemoCopyForLocale(
  locale: EasyPaymentsResolvedLocale,
): HeadlessDemoCopy {
  return DICTIONARIES[locale] ?? EN;
}
