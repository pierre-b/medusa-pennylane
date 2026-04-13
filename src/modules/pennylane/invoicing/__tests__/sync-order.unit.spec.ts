import type {
  OrderAddressDTO,
  OrderDetailDTO,
  PaymentDTO,
} from "@medusajs/framework/types";

import { PennylaneClient } from "../../client/pennylane-client";
import { PennylaneValidationError } from "../../client/errors";
import { PspMapperRegistry } from "../../psp/registry";

import {
  syncOrderToPennylane,
  type InvoiceSyncRepo,
  type SyncOrderToPennylaneOptions,
} from "../sync-order";

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

const billing = (): OrderAddressDTO =>
  ({
    id: "addr_1",
    first_name: "Jean",
    last_name: "Dupont",
    address_1: "12 rue du Commerce",
    postal_code: "75015",
    city: "Paris",
    country_code: "fr",
  }) as unknown as OrderAddressDTO;

const capturedPayment = (overrides: Partial<PaymentDTO> = {}): PaymentDTO =>
  ({
    id: "pay_1",
    provider_id: "pp_stripe_stripe",
    data: { id: "pi_3AbC" },
    amount: 17.94,
    currency_code: "eur",
    captured_at: "2026-04-12T10:05:00.000Z",
    ...overrides,
  }) as unknown as PaymentDTO;

const makeOrder = (overrides: Partial<OrderDetailDTO> = {}): OrderDetailDTO =>
  ({
    id: "order_01JR",
    display_id: 42,
    currency_code: "eur",
    created_at: "2026-04-12T10:00:00.000Z",
    customer_id: "cust_1",
    email: "jean@example.test",
    billing_address: billing(),
    metadata: null,
    items: [
      {
        id: "item_a",
        title: "Tablette",
        quantity: 1,
        total: 10,
        tax_total: 0.5,
        metadata: { pennylane_vat_rate: "FR_55" },
      },
    ],
    shipping_methods: [],
    payment_collections: [{ payments: [capturedPayment()] }],
    ...overrides,
  }) as unknown as OrderDetailDTO;

const makeOptions = (
  overrides: Partial<SyncOrderToPennylaneOptions> = {}
): SyncOrderToPennylaneOptions => ({
  vatMetadataKey: "pennylane_vat_rate",
  defaultShippingVatRate: "FR_200",
  onUnknownPsp: "warn",
  ...overrides,
});

const makeClient = () =>
  new PennylaneClient({
    apiToken: "t",
    baseUrl: "https://example.test/api/external/v2",
  });

const makeRegistry = () => new PspMapperRegistry({ onUnknownPsp: "warn" });

const makeRepo = (): jest.Mocked<InvoiceSyncRepo> => ({
  listInvoiceSyncs: jest.fn(),
  createInvoiceSyncs: jest.fn(),
  updateInvoiceSyncs: jest.fn(),
});

/** Arm a client to simulate a successful C1+D2 sequence. */
const armSuccessfulClient = (
  client: PennylaneClient,
  { customerId = 555, invoiceId = 98765 } = {}
) => {
  jest
    .spyOn(client, "get")
    // C1 customer lookup → empty
    .mockResolvedValueOnce({ items: [] })
    // D2 invoice lookup → empty
    .mockResolvedValueOnce({ items: [] });
  jest
    .spyOn(client, "post")
    // C1 customer create
    .mockResolvedValueOnce({ id: customerId } as unknown)
    // D2 invoice create
    .mockResolvedValueOnce({ id: invoiceId } as unknown);
};

/* ------------------------------------------------------------------------ */
/* Group B — happy path                                                     */
/* ------------------------------------------------------------------------ */

describe("syncOrderToPennylane — happy path (Group B)", () => {
  it("fresh order → creates InvoiceSync syncing, runs C1+D1+D2, updates to synced", async () => {
    const client = makeClient();
    armSuccessfulClient(client);
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([]);
    repo.createInvoiceSyncs.mockResolvedValue({ id: "sync_new" });
    repo.updateInvoiceSyncs.mockResolvedValue({});

    const result = await syncOrderToPennylane({
      order: makeOrder(),
      client,
      pspRegistry: makeRegistry(),
      invoiceSyncs: repo,
      options: makeOptions(),
    });

    expect(result).toMatchObject({
      invoiceSyncId: "sync_new",
      pennylaneInvoiceId: 98765,
      pennylaneCustomerId: 555,
      externalReference: "42",
      action: "created",
    });
    expect(result.warnings).toEqual([]);

    expect(repo.listInvoiceSyncs).toHaveBeenCalledWith({
      medusa_order_id: "order_01JR",
    });
    expect(repo.createInvoiceSyncs).toHaveBeenCalledWith({
      medusa_order_id: "order_01JR",
      external_reference: "42",
      status: "syncing",
    });
    expect(repo.updateInvoiceSyncs).toHaveBeenCalledWith({
      id: "sync_new",
      status: "synced",
      pennylane_invoice_id: "98765",
      last_error: null,
    });
  });

  it("already-synced row → short-circuits with action='already-synced', no API calls", async () => {
    const client = makeClient();
    const getSpy = jest.spyOn(client, "get");
    const postSpy = jest.spyOn(client, "post");
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([
      {
        id: "sync_existing",
        status: "synced",
        pennylane_invoice_id: "12345",
        external_reference: "42",
        last_error: null,
      },
    ]);

    const result = await syncOrderToPennylane({
      order: makeOrder(),
      client,
      pspRegistry: makeRegistry(),
      invoiceSyncs: repo,
      options: makeOptions(),
    });

    expect(result).toEqual({
      invoiceSyncId: "sync_existing",
      pennylaneInvoiceId: 12345,
      pennylaneCustomerId: null,
      externalReference: "42",
      action: "already-synced",
      warnings: [],
    });
    expect(getSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(repo.createInvoiceSyncs).not.toHaveBeenCalled();
    expect(repo.updateInvoiceSyncs).not.toHaveBeenCalled();
  });

  it("D2 returns action='idempotent' (Pennylane-side match) → flow completes, InvoiceSync synced", async () => {
    const client = makeClient();
    jest
      .spyOn(client, "get")
      // C1 customer lookup → empty
      .mockResolvedValueOnce({ items: [] })
      // D2 invoice lookup → existing
      .mockResolvedValueOnce({ items: [{ id: 4242 }] });
    jest
      .spyOn(client, "post")
      // C1 customer create
      .mockResolvedValueOnce({ id: 777 } as unknown);
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([]);
    repo.createInvoiceSyncs.mockResolvedValue({ id: "sync_new" });
    repo.updateInvoiceSyncs.mockResolvedValue({});

    const result = await syncOrderToPennylane({
      order: makeOrder(),
      client,
      pspRegistry: makeRegistry(),
      invoiceSyncs: repo,
      options: makeOptions(),
    });

    expect(result.action).toBe("idempotent");
    expect(result.pennylaneInvoiceId).toBe(4242);
    expect(repo.updateInvoiceSyncs).toHaveBeenCalledWith({
      id: "sync_new",
      status: "synced",
      pennylane_invoice_id: "4242",
      last_error: null,
    });
  });
});

/* ------------------------------------------------------------------------ */
/* Group C — retry paths                                                    */
/* ------------------------------------------------------------------------ */

describe("syncOrderToPennylane — retry paths (Group C)", () => {
  it("existing row with status='failed' → re-executes, clears last_error, lands synced", async () => {
    const client = makeClient();
    armSuccessfulClient(client);
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([
      {
        id: "sync_stale",
        status: "failed",
        pennylane_invoice_id: null,
        external_reference: "42",
        last_error: "Error: previous attempt failed",
      },
    ]);
    repo.updateInvoiceSyncs.mockResolvedValue({});

    const result = await syncOrderToPennylane({
      order: makeOrder(),
      client,
      pspRegistry: makeRegistry(),
      invoiceSyncs: repo,
      options: makeOptions(),
    });

    expect(result.action).toBe("created");
    expect(result.invoiceSyncId).toBe("sync_stale");

    expect(repo.createInvoiceSyncs).not.toHaveBeenCalled();
    const updateCalls = repo.updateInvoiceSyncs.mock.calls;
    expect(updateCalls[0][0]).toEqual({
      id: "sync_stale",
      status: "syncing",
      last_error: null,
    });
    expect(updateCalls[1][0]).toMatchObject({
      id: "sync_stale",
      status: "synced",
      pennylane_invoice_id: "98765",
      last_error: null,
    });
  });

  it("existing row with status='syncing' (prior crash) → re-executes same way", async () => {
    const client = makeClient();
    armSuccessfulClient(client);
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([
      {
        id: "sync_zombie",
        status: "syncing",
        pennylane_invoice_id: null,
        external_reference: "42",
        last_error: null,
      },
    ]);
    repo.updateInvoiceSyncs.mockResolvedValue({});

    const result = await syncOrderToPennylane({
      order: makeOrder(),
      client,
      pspRegistry: makeRegistry(),
      invoiceSyncs: repo,
      options: makeOptions(),
    });

    expect(result.action).toBe("created");
    expect(result.invoiceSyncId).toBe("sync_zombie");
    expect(repo.createInvoiceSyncs).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ */
/* Group D — failure paths                                                  */
/* ------------------------------------------------------------------------ */

describe("syncOrderToPennylane — failure paths (Group D)", () => {
  it("C1 throws → InvoiceSync updated to failed with last_error; error rethrown", async () => {
    const client = makeClient();
    // C1 lookup will throw
    const boom = new Error("lookup boom");
    jest.spyOn(client, "get").mockRejectedValue(boom);
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([]);
    repo.createInvoiceSyncs.mockResolvedValue({ id: "sync_abc" });
    repo.updateInvoiceSyncs.mockResolvedValue({});

    await expect(
      syncOrderToPennylane({
        order: makeOrder(),
        client,
        pspRegistry: makeRegistry(),
        invoiceSyncs: repo,
        options: makeOptions(),
      })
    ).rejects.toBe(boom);

    expect(repo.updateInvoiceSyncs).toHaveBeenCalledWith({
      id: "sync_abc",
      status: "failed",
      last_error: expect.stringContaining("lookup boom"),
    });
  });

  it("D2 throws PennylaneValidationError (422) → InvoiceSync failed, typed error rethrown", async () => {
    const client = makeClient();
    jest
      .spyOn(client, "get")
      .mockResolvedValueOnce({ items: [] }) // C1 lookup
      .mockRejectedValueOnce(
        new PennylaneValidationError("bad payload", {
          status: 422,
          pennylaneBody: { error: "bad payload" },
        })
      );
    jest.spyOn(client, "post").mockResolvedValueOnce({ id: 777 } as unknown); // C1 create
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([]);
    repo.createInvoiceSyncs.mockResolvedValue({ id: "sync_z" });
    repo.updateInvoiceSyncs.mockResolvedValue({});

    await expect(
      syncOrderToPennylane({
        order: makeOrder(),
        client,
        pspRegistry: makeRegistry(),
        invoiceSyncs: repo,
        options: makeOptions(),
      })
    ).rejects.toBeInstanceOf(PennylaneValidationError);

    const failedUpdate = repo.updateInvoiceSyncs.mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "failed"
    );
    expect(failedUpdate).toBeDefined();
    expect((failedUpdate![0] as { last_error: string }).last_error).toContain(
      "bad payload"
    );
  });

  it("D1 throws (missing VAT metadata) → InvoiceSync failed", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValueOnce({ items: [] }); // C1 lookup
    jest.spyOn(client, "post").mockResolvedValueOnce({ id: 777 } as unknown); // C1 create
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([]);
    repo.createInvoiceSyncs.mockResolvedValue({ id: "sync_d1" });
    repo.updateInvoiceSyncs.mockResolvedValue({});

    const brokenOrder = makeOrder({
      items: [
        {
          id: "item_a",
          title: "Tablette",
          quantity: 1,
          total: 10,
          tax_total: 0.5,
          metadata: null, // missing VAT key → D1 throws
        },
      ] as unknown as OrderDetailDTO["items"],
    });

    await expect(
      syncOrderToPennylane({
        order: brokenOrder,
        client,
        pspRegistry: makeRegistry(),
        invoiceSyncs: repo,
        options: makeOptions(),
      })
    ).rejects.toThrow(/no metadata/);

    const failedUpdate = repo.updateInvoiceSyncs.mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "failed"
    );
    expect(failedUpdate).toBeDefined();
  });

  it("last_error is truncated to 1000 chars", async () => {
    const client = makeClient();
    const longMsg = "x".repeat(5000);
    jest.spyOn(client, "get").mockRejectedValue(new Error(longMsg));
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([]);
    repo.createInvoiceSyncs.mockResolvedValue({ id: "sync_long" });
    repo.updateInvoiceSyncs.mockResolvedValue({});

    await expect(
      syncOrderToPennylane({
        order: makeOrder(),
        client,
        pspRegistry: makeRegistry(),
        invoiceSyncs: repo,
        options: makeOptions(),
      })
    ).rejects.toThrow();

    const failedUpdate = repo.updateInvoiceSyncs.mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "failed"
    );
    const lastError = (failedUpdate![0] as { last_error: string }).last_error;
    expect(lastError.length).toBeLessThanOrEqual(1000);
  });
});

/* ------------------------------------------------------------------------ */
/* Group E — passthrough                                                    */
/* ------------------------------------------------------------------------ */

describe("syncOrderToPennylane — passthrough (Group E)", () => {
  it("D1 warnings propagate to the result's warnings array", async () => {
    const client = makeClient();
    armSuccessfulClient(client);
    const repo = makeRepo();
    repo.listInvoiceSyncs.mockResolvedValue([]);
    repo.createInvoiceSyncs.mockResolvedValue({ id: "sync_warn" });
    repo.updateInvoiceSyncs.mockResolvedValue({});

    // Order with unknown PSP + onUnknownPsp: "warn" → D1 emits a warning
    const order = makeOrder({
      payment_collections: [
        {
          payments: [
            capturedPayment({
              provider_id: "pp_unknown_xyz",
              data: {}, // no id → mapper would return null
            }),
          ],
        },
      ] as unknown as OrderDetailDTO["payment_collections"],
    });

    const result = await syncOrderToPennylane({
      order,
      client,
      pspRegistry: makeRegistry(),
      invoiceSyncs: repo,
      options: makeOptions(),
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/no PSP mapper|pp_unknown_xyz/);
  });
});
