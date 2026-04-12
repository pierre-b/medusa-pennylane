import type { OrderAddressDTO, OrderDTO } from "@medusajs/framework/types";

import { PennylaneClient } from "../../client/pennylane-client";
import { upsertPennylaneCustomer } from "../upsert";

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

const billing = (overrides: Partial<OrderAddressDTO> = {}): OrderAddressDTO =>
  ({
    id: "addr_1",
    created_at: "2026-04-12T00:00:00.000Z",
    updated_at: "2026-04-12T00:00:00.000Z",
    first_name: "Jean",
    last_name: "Dupont",
    phone: "+33612345678",
    company: undefined,
    address_1: "12 rue du Commerce",
    postal_code: "75015",
    city: "Paris",
    country_code: "fr",
    ...overrides,
  }) as OrderAddressDTO;

type OrderOverrides = {
  id?: string;
  customer_id?: string | null;
  email?: string | null;
  billing_address?: OrderAddressDTO | undefined;
  metadata?: Record<string, unknown> | null;
};

const makeOrder = (overrides: OrderOverrides = {}): OrderDTO =>
  ({
    id: overrides.id ?? "order_01JABC",
    customer_id:
      overrides.customer_id === undefined ? "cust_1" : overrides.customer_id,
    email:
      overrides.email === undefined ? "jean@example.test" : overrides.email,
    billing_address:
      overrides.billing_address === undefined
        ? billing()
        : overrides.billing_address,
    metadata: overrides.metadata ?? null,
  }) as unknown as OrderDTO;

const makeClient = () =>
  new PennylaneClient({
    apiToken: "t",
    baseUrl: "https://example.test/api/external/v2",
  });

/* ------------------------------------------------------------------------ */
/* Group B — externalReference derivation                                   */
/* ------------------------------------------------------------------------ */

describe("upsertPennylaneCustomer — externalReference derivation (Group B)", () => {
  it("uses 'med_cust_<customer_id>' when the order has a customer", async () => {
    const client = makeClient();
    const getSpy = jest
      .spyOn(client, "get")
      .mockResolvedValue({ customers: [{ id: 99 }] });

    const result = await upsertPennylaneCustomer({
      order: makeOrder({ customer_id: "cust_abc" }),
      client,
    });

    expect(result.externalReference).toBe("med_cust_cust_abc");
    expect(getSpy).toHaveBeenCalled();
  });

  it("uses 'med_order_<order.id>' when the order is a guest (customer_id null)", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [{ id: 99 }] });

    const result = await upsertPennylaneCustomer({
      order: makeOrder({ id: "order_guest_xyz", customer_id: null }),
      client,
    });

    expect(result.externalReference).toBe("med_order_order_guest_xyz");
  });

  it("respects externalReferenceOverride when provided", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [{ id: 99 }] });

    const result = await upsertPennylaneCustomer({
      order: makeOrder(),
      client,
      externalReferenceOverride: "custom_reference_xyz",
    });

    expect(result.externalReference).toBe("custom_reference_xyz");
  });
});

/* ------------------------------------------------------------------------ */
/* Group C — lookup path                                                    */
/* ------------------------------------------------------------------------ */

describe("upsertPennylaneCustomer — lookup path (Group C)", () => {
  it("returns an existing customer with action='found'", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({
      customers: [{ id: 42, customer_type: "individual" }],
    });

    const result = await upsertPennylaneCustomer({
      order: makeOrder(),
      client,
    });

    expect(result).toEqual({
      customerId: 42,
      externalReference: "med_cust_cust_1",
      type: "individual",
      action: "found",
    });
  });

  it("returns type='company' when customer_type is 'company'", async () => {
    const client = makeClient();
    jest
      .spyOn(client, "get")
      .mockResolvedValue({ customers: [{ id: 7, customer_type: "company" }] });

    const result = await upsertPennylaneCustomer({
      order: makeOrder(),
      client,
    });
    expect(result.type).toBe("company");
  });

  it("falls through to the create path when the customers array is empty", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [] });
    const postSpy = jest.spyOn(client, "post").mockResolvedValue({ id: 101 });

    const result = await upsertPennylaneCustomer({
      order: makeOrder(),
      client,
    });

    expect(result.action).toBe("created");
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it("emits the spec-correct filter in the lookup query string", async () => {
    const client = makeClient();
    const getSpy = jest
      .spyOn(client, "get")
      .mockResolvedValue({ customers: [{ id: 1 }] });

    await upsertPennylaneCustomer({
      order: makeOrder({ customer_id: "cust_xyz" }),
      client,
    });

    const [path, opts] = getSpy.mock.calls[0] as [
      string,
      { query?: Record<string, unknown> } | undefined,
    ];
    expect(path).toBe("/customers");
    expect(opts?.query?.filter).toBe(
      JSON.stringify([
        {
          field: "external_reference",
          operator: "eq",
          value: "med_cust_cust_xyz",
        },
      ])
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Group D — individual-create path                                         */
/* ------------------------------------------------------------------------ */

describe("upsertPennylaneCustomer — individual create path (Group D)", () => {
  const setupEmptyLookup = () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [] });
    const postSpy = jest.spyOn(client, "post").mockResolvedValue({ id: 55 });
    return { client, postSpy };
  };

  it("POSTs to /individual_customers when no company is present", async () => {
    const { client, postSpy } = setupEmptyLookup();
    await upsertPennylaneCustomer({ order: makeOrder(), client });
    expect(postSpy.mock.calls[0]?.[0]).toBe("/individual_customers");
  });

  it("builds the expected body (first_name, last_name, external_reference, billing_address)", async () => {
    const { client, postSpy } = setupEmptyLookup();
    await upsertPennylaneCustomer({
      order: makeOrder({ customer_id: "cust_jd" }),
      client,
    });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body.first_name).toBe("Jean");
    expect(body.last_name).toBe("Dupont");
    expect(body.external_reference).toBe("med_cust_cust_jd");
    expect(body.billing_address).toEqual({
      address: "12 rue du Commerce",
      postal_code: "75015",
      city: "Paris",
      country_alpha2: "FR",
    });
  });

  it("includes emails array when order.email is set", async () => {
    const { client, postSpy } = setupEmptyLookup();
    await upsertPennylaneCustomer({
      order: makeOrder({ email: "jd@example.test" }),
      client,
    });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body.emails).toEqual(["jd@example.test"]);
  });

  it("omits emails when order.email is null or empty", async () => {
    const { client, postSpy } = setupEmptyLookup();
    await upsertPennylaneCustomer({
      order: makeOrder({ email: null }),
      client,
    });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect("emails" in body).toBe(false);
  });

  it("includes phone from billing_address when present", async () => {
    const { client, postSpy } = setupEmptyLookup();
    await upsertPennylaneCustomer({
      order: makeOrder({ billing_address: billing({ phone: "+33999" }) }),
      client,
    });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body.phone).toBe("+33999");
  });

  it("returns action='created' with the new customer id and type='individual'", async () => {
    const { client } = setupEmptyLookup();
    const result = await upsertPennylaneCustomer({
      order: makeOrder(),
      client,
    });
    expect(result).toMatchObject({
      customerId: 55,
      type: "individual",
      action: "created",
    });
  });
});

/* ------------------------------------------------------------------------ */
/* Group E — company-create path                                            */
/* ------------------------------------------------------------------------ */

describe("upsertPennylaneCustomer — company create path (Group E)", () => {
  const setupB2B = (metadata?: Record<string, unknown>) => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [] });
    const postSpy = jest.spyOn(client, "post").mockResolvedValue({ id: 88 });
    const order = makeOrder({
      billing_address: billing({ company: "Chocolaterie SAS" }),
      metadata: metadata ?? null,
    });
    return { client, postSpy, order };
  };

  it("POSTs to /company_customers when company is present", async () => {
    const { client, postSpy, order } = setupB2B();
    await upsertPennylaneCustomer({ order, client });
    expect(postSpy.mock.calls[0]?.[0]).toBe("/company_customers");
  });

  it("uses billing_address.company as the Pennylane company name", async () => {
    const { client, postSpy, order } = setupB2B();
    await upsertPennylaneCustomer({ order, client });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body.name).toBe("Chocolaterie SAS");
  });

  it("includes reg_no from order.metadata.siren when present", async () => {
    const { client, postSpy, order } = setupB2B({ siren: "123456789" });
    await upsertPennylaneCustomer({ order, client });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body.reg_no).toBe("123456789");
  });

  it("includes vat_number from order.metadata.vat_number when present", async () => {
    const { client, postSpy, order } = setupB2B({ vat_number: "FR12345678" });
    await upsertPennylaneCustomer({ order, client });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body.vat_number).toBe("FR12345678");
  });

  it("omits reg_no and vat_number when the metadata keys are missing", async () => {
    const { client, postSpy, order } = setupB2B();
    await upsertPennylaneCustomer({ order, client });
    const body = postSpy.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect("reg_no" in body).toBe(false);
    expect("vat_number" in body).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* Group F — validation + defensive response handling                       */
/* ------------------------------------------------------------------------ */

describe("upsertPennylaneCustomer — validation + defensive handling (Group F)", () => {
  it("throws when order.billing_address is missing", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [] });
    const orderWithoutBilling = {
      id: "order_no_billing",
      customer_id: "cust_1",
      email: "j@example.test",
      metadata: null,
    } as unknown as OrderDTO;

    await expect(
      upsertPennylaneCustomer({ order: orderWithoutBilling, client })
    ).rejects.toThrow(/order_no_billing.*billing_address/i);
  });

  it("throws when the individual path is missing first_name", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [] });

    await expect(
      upsertPennylaneCustomer({
        order: makeOrder({
          id: "order_noname",
          billing_address: billing({ first_name: undefined }),
        }),
        client,
      })
    ).rejects.toThrow(/order_noname.*first_name/i);
  });

  it("treats empty company_name as individual (heuristic verification)", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [] });
    const postSpy = jest.spyOn(client, "post").mockResolvedValue({ id: 1 });

    await upsertPennylaneCustomer({
      order: makeOrder({ billing_address: billing({ company: "" }) }),
      client,
    });

    expect(postSpy.mock.calls[0]?.[0]).toBe("/individual_customers");
  });

  it("throws when the lookup response has no customers array", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ weird: "shape" });

    await expect(
      upsertPennylaneCustomer({ order: makeOrder(), client })
    ).rejects.toThrow(/customers/);
  });

  it("throws when the create response does not contain a numeric id", async () => {
    const client = makeClient();
    jest.spyOn(client, "get").mockResolvedValue({ customers: [] });
    jest.spyOn(client, "post").mockResolvedValue({ id: "not-a-number" });

    await expect(
      upsertPennylaneCustomer({ order: makeOrder(), client })
    ).rejects.toThrow(/id/);
  });
});
