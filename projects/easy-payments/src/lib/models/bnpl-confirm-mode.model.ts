/**
 * Planned Buttons Only Klarna/Affirm confirmation strategy.
 *
 * - `auto` — prefer Direct when {@link evaluateBnplDirectReadiness} is ready; otherwise Payment Element.
 * - `direct` — require Direct readiness; otherwise a configuration error (no silent Element fallback).
 * - `element` — always use the existing Stripe Payment Element + Continue flow.
 *
 * **Not yet active in production components.** `<easy-payment-buttons>` continues to use
 * Payment Element for Klarna/Affirm regardless of this value until a later milestone wires it.
 */
export type BnplConfirmMode = 'auto' | 'direct' | 'element';
