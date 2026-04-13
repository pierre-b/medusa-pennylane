import { PennylaneClient } from "../../client/pennylane-client";
import { createPennylaneInvoice } from "../create-invoice";
import type { PennylaneInvoiceCreatePayload } from "../invoice-payload";

const makeClient = () =>
  new PennylaneClient({
    apiToken: "t",
    baseUrl: "https://example.test/api/external/v2",
  });

const makePayload = (
  overrides: Partial<PennylaneInvoiceCreatePayload> = {}
): PennylaneInvoiceCreatePayload => ({
  date: "2026-04-12",
  deadline: "2026-04-12",
  customer_id: 42,
  external_reference: "42",
  currency: "EUR",
  draft: false,
  label: "Medusa order #42",
  invoice_lines: [
    {
      label: "Tablette Chocolat Noir 70%",
      quantity: 2,
      raw_currency_unit_price: "8.50",
      unit: "piece",
      vat_rate: "FR_55",
    },
  ],
  ...overrides,
});

/* ------------------------------------------------------------------------ */
/* Group A — idempotent path                                                */
/* ------------------------------------------------------------------------ */

describe("createPennylaneInvoice — idempotent path (Group A)", () => {
  it("returns invoiceId with action='idempotent' when lookup finds a match, without POSTing", async () => {
    const client = makeClient();
    const getSpy = jest
      .spyOn(client, "get")
      .mockResolvedValue({ items: [{ id: 777 }] });
    const postSpy = jest.spyOn(client, "post");

    const result = await createPennylaneInvoice({
      payload: makePayload(),
      client,
      orderId: "order_01JABC",
    });

    expect(result).toEqual({
      invoiceId: 777,
      externalReference: "42",
      action: "idempotent",
    });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("falls through to POST when lookup returns an empty items[]", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ items: [] });
    const postSpy = jest
      .spyOn(client, "post")
      .mockResolvedValue({ id: 1234 } as unknown);

    const result = await createPennylaneInvoice({
      payload: makePayload(),
      client,
      orderId: "order_01JABC",
    });

    expect(result.action).toBe("created");
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it("calls GET /customer_invoices with the spec-correct JSON-array filter", async () => {
    const client = makeClient();
    const getSpy = jest
      .spyOn(client, "get")
      .mockResolvedValue({ items: [{ id: 777 }] });

    await createPennylaneInvoice({
      payload: makePayload({ external_reference: "1234" }),
      client,
      orderId: "order_01JABC",
    });

    expect(getSpy).toHaveBeenCalledWith("/customer_invoices", {
      query: {
        filter: JSON.stringify([
          {
            field: "external_reference",
            operator: "eq",
            value: "1234",
          },
        ]),
        limit: 1,
      },
    });
  });

  it("throws when the found invoice has a non-numeric id", async () => {
    const client = makeClient();
    jest
      .spyOn(client, "get")
      .mockResolvedValue({ items: [{ id: "not-a-number" }] });

    await expect(
      createPennylaneInvoice({
        payload: makePayload(),
        client,
        orderId: "order_01JABC",
      })
    ).rejects.toThrow(/non-numeric id|no numeric id/);
  });
});

/* ------------------------------------------------------------------------ */
/* Group B — create path                                                    */
/* ------------------------------------------------------------------------ */

describe("createPennylaneInvoice — create path (Group B)", () => {
  it("returns invoiceId with action='created' from a successful POST", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ items: [] });
    jest.spyOn(client, "post").mockResolvedValue({ id: 98765 } as unknown);

    const result = await createPennylaneInvoice({
      payload: makePayload(),
      client,
      orderId: "order_01JABC",
    });

    expect(result).toEqual({
      invoiceId: 98765,
      externalReference: "42",
      action: "created",
    });
  });

  it("POSTs the exact payload passed as input (no mutation, no extra fields)", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ items: [] });
    const postSpy = jest
      .spyOn(client, "post")
      .mockResolvedValue({ id: 1 } as unknown);

    const payload = makePayload();
    await createPennylaneInvoice({
      payload,
      client,
      orderId: "order_01JABC",
    });

    expect(postSpy).toHaveBeenCalledWith("/customer_invoices", {
      body: payload,
    });
    expect(postSpy.mock.calls[0][1]?.body).toBe(payload);
  });

  it("throws with a diagnostic message when the create response has a non-numeric id", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ items: [] });
    jest.spyOn(client, "post").mockResolvedValue({ id: "nope" } as unknown);

    await expect(
      createPennylaneInvoice({
        payload: makePayload(),
        client,
        orderId: "order_01JABC",
      })
    ).rejects.toThrow(
      /POST \/customer_invoices for order order_01JABC returned a non-numeric id/
    );
  });

  it("propagates typed client errors (e.g., 422) from the POST unchanged", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ items: [] });
    class FakeValidationError extends Error {
      status = 422;
    }
    const boom = new FakeValidationError("invalid payload");
    jest.spyOn(client, "post").mockRejectedValue(boom);

    await expect(
      createPennylaneInvoice({
        payload: makePayload(),
        client,
        orderId: "order_01JABC",
      })
    ).rejects.toBe(boom);
  });
});

/* ------------------------------------------------------------------------ */
/* Group C — response-shape validation + passthrough                         */
/* ------------------------------------------------------------------------ */

describe("createPennylaneInvoice — shape validation (Group C)", () => {
  it("throws a diagnostic error when the lookup response lacks an items array", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ has_more: false } as unknown);

    await expect(
      createPennylaneInvoice({
        payload: makePayload(),
        client,
        orderId: "order_01JABC",
      })
    ).rejects.toThrow(
      /unexpected GET \/customer_invoices response shape \(missing items array\) for order order_01JABC/
    );
  });

  it("propagates externalReference from payload.external_reference to the result", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ items: [] });
    jest.spyOn(client, "post").mockResolvedValue({ id: 1 } as unknown);

    const result = await createPennylaneInvoice({
      payload: makePayload({ external_reference: "my-ref-42" }),
      client,
      orderId: "order_01JABC",
    });

    expect(result.externalReference).toBe("my-ref-42");
  });
});
