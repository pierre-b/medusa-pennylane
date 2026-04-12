import { stripeMapper } from "./stripe-mapper";
import type { PspMapper } from "./mapper";

export const BUILT_IN_PSP_MAPPERS: readonly PspMapper[] = [stripeMapper];
