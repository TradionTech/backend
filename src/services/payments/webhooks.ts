// Webhook utilities for payment providers
// This can be extended for signature verification, etc.

export const webhookUtils = {
  verifyPaystackSignature(payload: string, signature: string, secret: string): boolean {
    // TODO: Implement Paystack webhook signature verification
    // For now, return true (implement proper verification in production)
    return true;
  }
};

