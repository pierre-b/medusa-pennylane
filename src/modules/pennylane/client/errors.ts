import { MedusaError } from "@medusajs/framework/utils";

export interface PennylaneErrorContext {
  status: number | null;
  pennylaneBody: unknown;
  code?: string;
  field?: string;
  cause?: unknown;
}

abstract class PennylaneError extends MedusaError {
  readonly status: number | null;
  readonly pennylaneBody: unknown;
  readonly code?: string;
  readonly field?: string;

  constructor(
    type: MedusaError["type"],
    message: string,
    context: PennylaneErrorContext
  ) {
    super(type, message);
    this.status = context.status;
    this.pennylaneBody = context.pennylaneBody;
    this.code = context.code;
    this.field = context.field;
    if (context.cause !== undefined) {
      (this as { cause?: unknown }).cause = context.cause;
    }
  }
}

export class PennylaneAuthError extends PennylaneError {
  constructor(message: string, context: PennylaneErrorContext) {
    super(MedusaError.Types.UNAUTHORIZED, message, context);
  }
}

export class PennylaneForbiddenError extends PennylaneError {
  constructor(message: string, context: PennylaneErrorContext) {
    super(MedusaError.Types.NOT_ALLOWED, message, context);
  }
}

export class PennylaneNotFoundError extends PennylaneError {
  constructor(message: string, context: PennylaneErrorContext) {
    super(MedusaError.Types.NOT_FOUND, message, context);
  }
}

export class PennylaneValidationError extends PennylaneError {
  constructor(message: string, context: PennylaneErrorContext) {
    super(MedusaError.Types.INVALID_DATA, message, context);
  }
}

export class PennylaneServerError extends PennylaneError {
  constructor(message: string, context: PennylaneErrorContext) {
    super(MedusaError.Types.UNEXPECTED_STATE, message, context);
  }
}

export class PennylaneNetworkError extends PennylaneError {
  constructor(message: string, context: PennylaneErrorContext) {
    super(MedusaError.Types.UNEXPECTED_STATE, message, context);
  }
}
