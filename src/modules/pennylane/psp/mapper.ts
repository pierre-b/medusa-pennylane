import type { PaymentDTO, RefundDTO } from "@medusajs/framework/types";

export interface TransactionReference {
  banking_provider: string;
  provider_field_name: string;
  provider_field_value: string;
}

export interface PspMapper {
  readonly id: string;
  matches(providerId: string): boolean;
  toTransactionReference(payment: PaymentDTO): TransactionReference | null;
  toRefundTransactionReference?(
    payment: PaymentDTO,
    refund: RefundDTO
  ): TransactionReference | null;
}
